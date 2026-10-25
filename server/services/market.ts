import fs from 'node:fs'
import path from 'node:path'
import type { ForeignFear, MarketIndex, Sector, Snapshot, SourceStatus, Stock, WatchlistConfig } from '../../shared/types.js'
import { fetchAmountBaseline, fetchAmountWindow, fetchVolumeBaseline, type AmountBaseline, type AmountWindow } from '../providers/eastmoney.js'
import { fetchThsAmountBaseline } from '../providers/ths.js'
import { fetchGlobalFear } from '../providers/global-fear.js'
import { fetchIndices, fetchRank, fetchSectors, fetchStockQuotes, prefixFor, type QuoteMap } from '../providers/sina.js'
import { fetchBreadthLine, fetchLimitPools, type RawBreadth, type RawPoolItem } from '../providers/xgb.js'
import { buildSnapshot, shanghaiParts } from './analysis.js'
import { atomicWriteJson } from '../lib/atomic.js'

const ROOT = process.cwd()
const DATA_DIR = path.join(ROOT, 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const SNAPSHOT_PATH = path.join(DATA_DIR, 'last-snapshot.json')

interface Cache<T> {
  value: T
  at: number
  status: SourceStatus
}

interface SourceDef {
  id: string
  name: string
}

const SOURCE_DEFS: SourceDef[] = [
  { id: 'xgb-breadth', name: '选股宝 · 全市场广度' },
  { id: 'xgb-pools', name: '选股宝 · 涨停/跌停池' },
  { id: 'sina-index', name: '新浪 · 指数行情' },
  { id: 'sina-rank', name: '新浪 · 涨跌幅榜' },
  { id: 'sina-sector', name: '新浪 · 行业/概念' },
  { id: 'em-kline', name: '日线量能基线' },
  { id: 'em-window', name: '东财 · 同时段量能' },
  { id: 'global-fear', name: '全球恐慌 · VIX/美股期货/黄金' },
]

export class MarketService {
  refreshMs: number
  snapshot: Snapshot | null = null
  listeners = new Set<(snapshot: Snapshot) => void>()
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private tickCount = 0
  private startedAt = Date.now()

  private breadthCache: Cache<{ points: RawBreadth[]; at: number }> | null = null
  private poolsCache: Cache<{ limitUp: RawPoolItem[]; limitDown: RawPoolItem[]; at: number }> | null = null
  private indexCache: Cache<MarketIndex[]> | null = null
  private rankUpCache: Cache<Stock[]> | null = null
  private rankDownCache: Cache<Stock[]> | null = null
  private sectorCache: Cache<{ industry: Sector[]; concept: Sector[] }> | null = null
  private baselineCache: Cache<AmountBaseline> | null = null
  private windowCache: Cache<AmountWindow> | null = null
  private globalFearCache: Cache<ForeignFear> | null = null
  private quoteCache: QuoteMap = {}
  private sources = new Map<string, SourceStatus>()
  private poolsBusy = false
  private poolsAttemptAt = 0

  private config: WatchlistConfig

  constructor(refreshMs = 10_000) {
    this.refreshMs = refreshMs
    this.config = loadConfig()
    for (const def of SOURCE_DEFS) {
      this.sources.set(def.id, {
        id: def.id,
        name: def.name,
        state: 'error',
        updatedAt: null,
        latencyMs: null,
        message: '等待首次同步',
      })
    }
    const cached = loadSnapshot()
    if (cached) {
      this.snapshot = { ...cached, notice: '服务重启 · 正在同步最新行情，当前为最近一次快照' }
    }
  }

  async start() {
    await this.tick()
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  getWatchlist() {
    return this.config
  }

  setWatchlist(codes: string[]) {
    const clean = [...new Set(codes.filter((code) => /^\d{6}$/.test(code)))].slice(0, 20)
    this.config = { ...this.config, codes: clean, updatedAt: new Date().toISOString() }
    saveConfig(this.config)
    void this.tick()
    return this.config
  }

  health() {
    const now = Date.now()
    const states = [...this.sources.values()]
    return {
      ok: Boolean(this.snapshot),
      uptimeSec: Math.round((now - this.startedAt) / 1000),
      refreshMs: this.refreshMs,
      lastUpdate: this.snapshot?.generatedAt ?? null,
      dataAgeMs: this.snapshot ? now - new Date(this.snapshot.generatedAt).getTime() : null,
      tickCount: this.tickCount,
      sources: states,
      watchlist: this.config.codes,
      marketStatus: this.snapshot?.marketStatus ?? '休市',
    }
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.tick()
    }, this.refreshMs)
  }

  async tick() {
    if (this.ticking) return
    this.ticking = true
    this.tickCount += 1
    const started = Date.now()
    try {
      const now = Date.now()
      const today = shanghaiParts(now).date
      const tasks: Promise<unknown>[] = []

      tasks.push(this.syncBreadth())
      tasks.push(this.syncIndices())

      const rankAge = Math.min(this.rankUpCache?.at ?? 0, this.rankDownCache?.at ?? 0)
      if (!this.rankUpCache || !this.rankDownCache || now - rankAge > 30_000) {
        tasks.push(this.syncRank())
      } else {
        this.touch('sina-rank', this.rankUpCache.at, 0, '30秒缓存')
      }

      const sectorAge = this.sectorCache?.at ?? 0
      if (!this.sectorCache || now - sectorAge > 60_000) {
        tasks.push(this.syncSectors())
      } else {
        this.touch('sina-sector', this.sectorCache.at, 0, '60秒缓存')
      }

      const poolAge = this.poolsCache?.at ?? 0
      if ((!this.poolsCache || now - poolAge > 15_000) && now - this.poolsAttemptAt > 20_000) {
        // Slow upstream pools must never hold back the 10s core snapshot.
        this.poolsAttemptAt = now
        void this.refreshPools()
      } else if (this.poolsCache) {
        this.touch('xgb-pools', this.poolsCache.at, 0, '后台刷新 · 使用最近缓存')
      }

      const baselineAge = this.baselineCache?.at ?? 0
      if (!this.baselineCache || now - baselineAge > 30 * 60_000) {
        tasks.push(this.syncBaseline(today))
      } else if (this.baselineCache) {
        this.touch('em-kline', this.baselineCache.at, 0, '30分钟缓存')
      }

      const windowAge = this.windowCache?.at ?? 0
      if (!this.windowCache || now - windowAge > 60_000) {
        tasks.push(this.syncAmountWindow(today, now))
      } else if (this.windowCache) {
        this.touch('em-window', this.windowCache.at, 0, '60秒缓存')
      }

      const fearAge = this.globalFearCache?.at ?? 0
      if (!this.globalFearCache || now - fearAge > 60_000) void this.syncGlobalFear()
      else this.touch('global-fear', this.globalFearCache.at, 0, '60秒缓存')

      await Promise.allSettled(tasks)

      const symbols = [
        ...(this.poolsCache?.value.limitUp ?? []).map((s) => prefixFor(s.symbol.split('.')[0])),
        ...(this.poolsCache?.value.limitDown ?? []).map((s) => prefixFor(s.symbol.split('.')[0])),
        ...(this.rankUpCache?.value ?? []).slice(0, 40).map((s) => prefixFor(s.code)),
        ...(this.rankDownCache?.value ?? []).slice(0, 40).map((s) => prefixFor(s.code)),
        ...this.config.codes.map(prefixFor),
      ]
      await this.syncQuotes(symbols)

      this.rebuild(started)
    } catch (err) {
      console.error('[market] tick failed', err)
      this.markError('system', '行情引擎', err)
    } finally {
      this.ticking = false
      this.schedule()
    }
  }

  private async syncBreadth() {
    const started = Date.now()
    try {
      const res = await fetchBreadthLine()
      this.breadthCache = {
        value: { points: res.points, at: res.at },
        at: res.at,
        status: live('xgb-breadth', '选股宝 · 全市场广度', res.at, res.latencyMs, `${res.points.length} 个分钟点`),
      }
      this.sources.set('xgb-breadth', this.breadthCache.status)
    } catch (err) {
      this.fallback('xgb-breadth', '选股宝 · 全市场广度', err, this.breadthCache?.at)
    }
  }

  private async refreshPools() {
    if (this.poolsBusy) return
    this.poolsBusy = true
    const started = Date.now()
    try {
      await this.syncPools()
    } finally {
      this.poolsBusy = false
      // A slow pool response should publish a fresh anchor set when it lands,
      // without delaying the next 10s core tick.
      this.rebuild(started)
    }
  }

  private async syncPools() {
    const started = Date.now()
    try {
      const res = await fetchLimitPools()
      this.poolsCache = {
        value: { limitUp: res.limitUp, limitDown: res.limitDown, at: res.at },
        at: res.at,
        status: live(
          'xgb-pools',
          '选股宝 · 涨停/跌停池',
          res.at,
          res.latencyMs,
          `涨停 ${res.limitUp.length} / 跌停 ${res.limitDown.length}`,
        ),
      }
      this.sources.set('xgb-pools', this.poolsCache.status)
    } catch (err) {
      this.fallback('xgb-pools', '选股宝 · 涨停/跌停池', err, this.poolsCache?.at)
    }
  }

  private async syncIndices() {
    try {
      const res = await fetchIndices()
      this.indexCache = {
        value: res.indices,
        at: res.at,
        status: live('sina-index', '新浪 · 指数行情', res.at, res.latencyMs, `${res.indices.length} 个指数`),
      }
      this.sources.set('sina-index', this.indexCache.status)
    } catch (err) {
      this.fallback('sina-index', '新浪 · 指数行情', err, this.indexCache?.at)
    }
  }

  private async syncRank() {
    try {
      const [up, down] = await Promise.all([fetchRank('up'), fetchRank('down')])
      this.rankUpCache = {
        value: up.rows,
        at: up.at,
        status: live('sina-rank', '新浪 · 涨跌幅榜', up.at, Math.max(up.latencyMs, down.latencyMs), '涨幅榜/跌幅榜各100'),
      }
      this.rankDownCache = {
        value: down.rows,
        at: down.at,
        status: this.rankUpCache.status,
      }
      this.sources.set('sina-rank', this.rankUpCache.status)
    } catch (err) {
      this.fallback('sina-rank', '新浪 · 涨跌幅榜', err, this.rankUpCache?.at)
    }
  }

  private async syncSectors() {
    try {
      const res = await fetchSectors()
      this.sectorCache = {
        value: { industry: res.industry, concept: res.concept },
        at: res.at,
        status: live(
          'sina-sector',
          '新浪 · 行业/概念',
          res.at,
          res.latencyMs,
          `行业 ${res.industry.length} / 概念 ${res.concept.length}`,
        ),
      }
      this.sources.set('sina-sector', this.sectorCache.status)
    } catch (err) {
      this.fallback('sina-sector', '新浪 · 行业/概念', err, this.sectorCache?.at)
    }
  }

  private async syncAmountWindow(today: string, now: number) {
    try {
      const res = await fetchAmountWindow(today, now)
      this.windowCache = {
        value: res,
        at: res.at,
        status: live('em-window', '东财 · 同时段量能', res.at, res.latencyMs, `09:30-${res.windowLabel} · 近${res.windowDays}日`),
      }
      this.sources.set('em-window', this.windowCache.status)
    } catch (err) {
      this.fallback('em-window', '东财 · 同时段量能', err, this.windowCache?.at)
    }
  }

  private async syncBaseline(today: string) {
    try {
      const res = await fetchAmountBaseline(today)
      this.baselineCache = {
        value: res,
        at: res.at,
        status: live('em-kline', '东财 · 量能基线', res.at, res.latencyMs, `日线基准 ${res.tradingDate}`),
      }
      this.sources.set('em-kline', this.baselineCache.status)
    } catch (err) {
      try {
        const res = await fetchThsAmountBaseline(today)
        this.baselineCache = {
          value: res,
          at: res.at,
          status: live('em-kline', '同花顺 · 量能基线', res.at, res.latencyMs, `日线基准 ${res.tradingDate}`),
        }
        this.sources.set('em-kline', this.baselineCache.status)
      } catch (thsErr) {
        try {
          if (!this.indexCache?.value?.length) throw new Error('指数未就绪')
          const res = await fetchVolumeBaseline(this.indexCache.value)
          this.baselineCache = {
            value: res,
            at: res.at,
            status: live('em-kline', '量能估算 · 腾讯日线', res.at, res.latencyMs, `成交量估算基准 ${res.tradingDate}`),
          }
          this.sources.set('em-kline', this.baselineCache.status)
        } catch (fallbackErr) {
          this.fallback('em-kline', '量能基线', fallbackErr, this.baselineCache?.at)
        }
      }
    }
  }

  private async syncGlobalFear() {
    try {
      const res = await fetchGlobalFear()
      this.globalFearCache = {
        value: res.value,
        at: res.at,
        status: live('global-fear', '全球恐慌 · VIX/美股期货/黄金', res.at, res.latencyMs, res.value.detail),
      }
      this.sources.set('global-fear', this.globalFearCache.status)
    } catch (err) {
      this.fallback('global-fear', '全球恐慌 · VIX/美股期货/黄金', err, this.globalFearCache?.at)
    }
  }

  private async syncQuotes(symbols: string[]) {
    if (symbols.length === 0) return
    try {
      const res = await fetchStockQuotes(symbols)
      this.quoteCache = { ...this.quoteCache, ...res.map }
    } catch {
      // Quotes are an enrichment layer: pool/index data still renders if this fails.
    }
  }

  private rebuild(startedAt: number) {
    if (!this.indexCache && !this.poolsCache && !this.breadthCache) return
    const sourceList = SOURCE_DEFS.map((d) => this.sources.get(d.id)).filter((s): s is SourceStatus => Boolean(s))
    const failed = sourceList.filter((s) => s.state === 'error' || s.state === 'stale')
    const notice = failed.length
      ? `${failed.map((s) => s.name).join('、')} 暂未更新，已使用最近缓存；核心行情仍按 ${this.refreshMs / 1000}s 刷新。`
      : null
    const snapshot = buildSnapshot({
      now: Date.now(),
      indices: this.indexCache?.value ?? [],
      breadthPoints: this.breadthCache?.value.points ?? [],
      limitUpsRaw: this.poolsCache?.value.limitUp ?? [],
      limitDownsRaw: this.poolsCache?.value.limitDown ?? [],
      topRows: this.rankUpCache?.value ?? [],
      bottomRows: this.rankDownCache?.value ?? [],
      industry: this.sectorCache?.value.industry ?? [],
      concept: this.sectorCache?.value.concept ?? [],
      quotes: this.quoteCache,
      previousAmount: this.baselineCache?.value.prevAmount ?? 0,
      avg5Amount: this.baselineCache?.value.avg5Amount ?? null,
      prevWindowAmount: this.windowCache?.value.prevWindowAmount ?? 0,
      avg5WindowAmount: this.windowCache?.value.avg5WindowAmount ?? null,
      windowLabel: this.windowCache?.value.windowLabel ?? null,
      windowDays: this.windowCache?.value.windowDays ?? null,
      watchlistCodes: this.config.codes,
      sources: sourceList,
      refreshMs: this.refreshMs,
      latencyMs: Date.now() - startedAt,
      notice,
      foreignFear: this.globalFearCache?.value ?? null,
    })
    snapshot.version = Date.now()
    if (snapshot.anchors.length < 6 && this.snapshot?.tradingDate === snapshot.tradingDate && this.snapshot.anchors.length > snapshot.anchors.length) {
      snapshot.anchors = this.snapshot.anchors
    }
    this.snapshot = snapshot
    this.persistSnapshot()
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* client stream errors are isolated */ }
    }
    if (this.tickCount % 30 === 0) {
      console.log(
        `[market] ${snapshot.tradingDate} ${snapshot.dataAsOf} · ${snapshot.sentiment.stage} ${snapshot.sentiment.score} · ` +
          `涨停${snapshot.breadth.limitUp}/跌停${snapshot.breadth.limitDown} · ${snapshot.latencyMs}ms`,
      )
    }
  }

  private persistSnapshot() {
    try {
      atomicWriteJson(SNAPSHOT_PATH, this.snapshot)
    } catch {
      // Persistence is best-effort only.
    }
  }

  private fallback(id: string, name: string, err: unknown, cachedAt?: number) {
    const message = err instanceof Error ? err.message : 'upstream error'
    if (cachedAt) {
      const age = Date.now() - cachedAt
      this.sources.set(id, {
        id,
        name,
        state: age > 90_000 ? 'stale' : 'fallback',
        updatedAt: new Date(cachedAt).toISOString(),
        latencyMs: null,
        message: `上游异常，使用 ${Math.round(age / 1000)}s 前缓存（${message}）`,
      })
    } else {
      this.sources.set(id, {
        id,
        name,
        state: 'error',
        updatedAt: null,
        latencyMs: null,
        message,
      })
    }
  }

  private markError(id: string, name: string, err: unknown) {
    this.sources.set(id, {
      id,
      name,
      state: 'error',
      updatedAt: null,
      latencyMs: null,
      message: err instanceof Error ? err.message : 'unknown error',
    })
  }

  private touch(id: string, at: number, latencyMs: number, message: string) {
    const existing = this.sources.get(id)
    if (!existing) return
    this.sources.set(id, {
      ...existing,
      state: existing.state === 'error' ? 'fallback' : 'live',
      updatedAt: new Date(at).toISOString(),
      latencyMs,
      message,
    })
  }
}

function live(id: string, name: string, at: number, latencyMs: number, message: string): SourceStatus {
  return { id, name, state: 'live', updatedAt: new Date(at).toISOString(), latencyMs, message }
}

function loadConfig(): WatchlistConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as WatchlistConfig
    return {
      codes: Array.isArray(raw.codes) ? raw.codes.filter((c) => /^\d{6}$/.test(c)).slice(0, 20) : [],
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    }
  } catch {
    return { codes: [], updatedAt: new Date().toISOString() }
  }
}

function saveConfig(config: WatchlistConfig) {
  try {
    atomicWriteJson(CONFIG_PATH, config)
  } catch (err) {
    console.error('[market] save config failed', err)
  }
}

function loadSnapshot(): Snapshot | null {
  try {
    const cached = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot
    return {
      ...cached,
      watchlist: [],
      notice: '服务重启 · 正在同步最新行情，当前为最近一次运行时快照',
      sources: cached.sources.map((source) => ({
        ...source,
        state: 'stale',
        message: `运行时缓存 · ${source.message}`,
      })),
    }
  } catch {
    return null
  }
}
