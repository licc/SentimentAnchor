import type { ForeignFear } from '../../shared/types.js'

let cache: { value: ForeignFear; at: number } | null = null
let inflight: Promise<{ value: ForeignFear; at: number; latencyMs: number }> | null = null

/** Global panic: VIX + US futures + gold + offshore CNH. Cached for 60s. */
export async function fetchGlobalFear(): Promise<{ value: ForeignFear; at: number; latencyMs: number }> {
  if (cache && Date.now() - cache.at < 60_000) return { ...cache, latencyMs: 0 }
  if (inflight) return inflight
  const started = Date.now()
  inflight = doFetch(started).finally(() => { inflight = null })
  return inflight
}

async function doFetch(started: number): Promise<{ value: ForeignFear; at: number; latencyMs: number }> {
  const [vix, kospi, nikkei, sina] = await Promise.all([
    fetchYahooIndex('^VIX').catch(() => null),
    fetchYahooIndex('^KS11').catch(() => null),
    fetchYahooIndex('^N225').catch(() => null),
    fetchSinaGlobal().catch(() => null),
  ])
  const usFuturesPct = sina?.usFuturesPct ?? null
  const goldPct = sina?.goldPct ?? null
  const usdcnhPct = sina?.usdcnhPct ?? null
  const kospiPct = kospi?.changePct ?? null
  const nikkeiPct = nikkei?.changePct ?? null
  let score = 50
  if (vix?.level != null) {
    const v = vix.level
    score = v < 15 ? 12 : v < 20 ? 28 : v < 25 ? 48 : v < 30 ? 68 : v < 40 ? 85 : 95
    score += Math.max(-15, Math.min(15, vix.changePct != null ? vix.changePct * 3 : 0))
  }
  if (usFuturesPct != null) score += Math.max(-12, Math.min(12, -usFuturesPct * 4))
  if (goldPct != null) score += Math.max(-6, Math.min(6, goldPct * 2))
  if (usdcnhPct != null) score += Math.max(-6, Math.min(6, usdcnhPct * 8))
  if (kospiPct != null) score += Math.max(-5, Math.min(5, -kospiPct * 1.5))
  if (nikkeiPct != null) score += Math.max(-5, Math.min(5, -nikkeiPct * 1.5))
  score = Math.round(Math.max(0, Math.min(100, score)))
  const level = score >= 80 ? '极端' : score >= 60 ? '高' : score >= 35 ? '中' : '低'
  const detail = [
    vix?.level != null ? `VIX ${vix.level.toFixed(1)}${vix.changePct != null ? ` (${vix.changePct > 0 ? '+' : ''}${vix.changePct.toFixed(1)}%)` : ''}` : null,
    usFuturesPct != null ? `美股期货 ${usFuturesPct > 0 ? '+' : ''}${usFuturesPct.toFixed(2)}%` : null,
    goldPct != null ? `黄金 ${goldPct > 0 ? '+' : ''}${goldPct.toFixed(2)}%` : null,
    usdcnhPct != null ? `离岸人民币 ${usdcnhPct > 0 ? '+' : ''}${usdcnhPct.toFixed(2)}%` : null,
    kospiPct != null ? `韩国 KOSPI ${kospiPct > 0 ? '+' : ''}${kospiPct.toFixed(2)}%` : null,
    nikkeiPct != null ? `日本 日经 ${nikkeiPct > 0 ? '+' : ''}${nikkeiPct.toFixed(2)}%` : null,
  ].filter(Boolean).join(' · ') || '外部恐慌数据暂不可用'
  const value: ForeignFear = {
    vix: vix?.level ?? null, vixChangePct: vix?.changePct ?? null,
    usFuturesPct, goldPct, usdcnhPct, kospiPct, nikkeiPct,
    score, level, detail, updatedAt: new Date().toISOString(),
  }
  cache = { value, at: Date.now() }
  return { value, at: Date.now(), latencyMs: Date.now() - started }
}

async function fetchYahooIndex(symbol: string): Promise<{ level: number; changePct: number | null } | null> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) return null
  const data = await res.json() as { chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } }
  const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((x): x is number => typeof x === 'number') ?? []
  if (!closes.length) return null
  const level = closes[closes.length - 1]
  const prev = closes.length > 1 ? closes[closes.length - 2] : null
  return { level, changePct: prev ? ((level - prev) / prev) * 100 : null }
}

async function fetchSinaGlobal(): Promise<{ usFuturesPct: number | null; goldPct: number | null; usdcnhPct: number | null } | null> {
  const res = await fetch('https://hq.sinajs.cn/list=hf_ES,hf_GC,fx_susdcnh', {
    headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) return null
  const text = await res.text()
  const line = (name: string) => new RegExp(`var hq_str_${name}="([^"]*)"`).exec(text)?.[1] ?? ''
  const es = line('hf_ES').split(',')
  const gc = line('hf_GC').split(',')
  const fx = line('fx_susdcnh').split(',')
  const pct = (current: number, prev: number) => current > 0 && prev > 0 ? ((current - prev) / prev) * 100 : null
  return {
    usFuturesPct: pct(Number(es[0]), Number(es[7])),
    goldPct: pct(Number(gc[0]), Number(gc[7])),
    usdcnhPct: pct(Number(fx[1]), Number(fx[5])),
  }
}
