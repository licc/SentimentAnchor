import { Copy, Plus, Save, Trash2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { QuantBacktestResult, QuantRobustnessResult, QuantTextStrategy } from '../../shared/types'
import { getIntradayAnalysis, runQuantBacktest, runQuantRobustness } from '../api'
import { useQuantStrategyLibrary } from '../hooks/useQuantStrategyLibrary'
import { AiStrategyBuilder } from './AiStrategyBuilder'
import { fmtPct } from '../lib/format'
import { TradingSectionHeader } from './trading-ui'

const TEMPLATE = `# 新策略

## 适用环境
情绪处于修复、发酵或高潮，分数 >= 55，趋势 >= 0。

## 选股
只做人工确认加入 T+1 量化池的股票，选择当日涨幅最强的一只。

## 买入
14:30 前买入，单票 30%，账户总仓位不超过 70%。

## 退出
止损 3%，止盈 5%，最长持有 3 个交易日。T+1 当日买入不可卖出。`

export function StrategyLibrary({ onToast }: { onToast: (message: string, tone?: 'up' | 'down') => void }) {
  const lib = useQuantStrategyLibrary()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [creating, setCreating] = useState(false)
  const [backtestCode, setBacktestCode] = useState('300502')
  const [backtestDays, setBacktestDays] = useState(180)
  const [backtest, setBacktest] = useState<QuantBacktestResult | null>(null)
  const [robustness, setRobustness] = useState<QuantRobustnessResult | null>(null)
  const [intraday, setIntraday] = useState<Awaited<ReturnType<typeof getIntradayAnalysis>> | null>(null)
  const [busy, setBusy] = useState(false)

  const strategies = lib.data?.strategies ?? []
  const selected = strategies.find((s) => s.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId) return
    const active = lib.data?.strategies.find((s) => s.status === 'active') ?? lib.data?.strategies[0]
    if (active) { setSelectedId(active.id); setName(active.name); setContent(active.content) }
  }, [lib.data, selectedId])

  function select(s: QuantTextStrategy) { setSelectedId(s.id); setName(s.name); setContent(s.content); setCreating(false); setBacktest(null); setRobustness(null) }

  async function save(): Promise<QuantTextStrategy | null> {
    if (!selected) return null
    setBusy(true)
    try { const next = await lib.update(selected.id, name, content); onToast('策略已保存并重新解析'); return next } catch (err) { onToast(err instanceof Error ? err.message : '保存失败', 'down'); return null } finally { setBusy(false) }
  }

  async function newStrategy() {
    setCreating(true); setSelectedId(null); setName('新策略'); setContent(TEMPLATE); setBacktest(null)
  }

  async function create() {
    setBusy(true)
    try { const next = await lib.create(name, content); setSelectedId(next.id); setCreating(false); onToast('策略已创建') } catch (err) { onToast(err instanceof Error ? err.message : '创建失败', 'down') } finally { setBusy(false) }
  }

  async function activate() {
    if (!selected) return
    const saved = await save()
    if (!saved) return
    setBusy(true)
    try {
      const quality = robustness?.code === backtestCode ? robustness : await runQuantRobustness(backtestCode, backtestDays, selected.id)
      setRobustness(quality)
      let force = false
      if (quality.positiveRatio < 40) {
        if (!window.confirm(`参数稳健性仅 ${quality.positiveRatio}% 邻域为正（门槛 40%）。仍要强制启用？`)) return
        force = true
      }
      await lib.activate(selected.id, force); onToast('策略已启用；T+1 引擎下一轮按此执行')
    } catch (err) { onToast(err instanceof Error ? err.message : '启用失败', 'down') } finally { setBusy(false) }
  }

  async function duplicate() {
    if (!selected) return
    try { const copy = await lib.duplicate(selected.id); setSelectedId(copy.id); setName(copy.name); setContent(copy.content); onToast('策略已复制') } catch (err) { onToast(err instanceof Error ? err.message : '复制失败', 'down') }
  }

  async function remove() {
    if (!selected || !window.confirm(`删除策略「${selected.name}」？`)) return
    try { await lib.remove(selected.id); setSelectedId(null); onToast('策略已删除') } catch (err) { onToast(err instanceof Error ? err.message : '删除失败', 'down') }
  }

  async function loadIntraday() {
    try { setIntraday(await getIntradayAnalysis(backtestCode)) } catch (err) { onToast(err instanceof Error ? err.message : '分时行情失败', 'down') }
  }

  async function runRobustnessTest() {
    setBusy(true)
    try { setRobustness(await runQuantRobustness(backtestCode, backtestDays, selected?.id)); onToast('参数稳健性测试完成') } catch (err) { onToast(err instanceof Error ? err.message : '稳健性失败', 'down') } finally { setBusy(false) }
  }

  async function runBacktest() {
    if (!selected) return
    const saved = await save()
    if (!saved) return
    setBusy(true)
    try { setBacktest(await runQuantBacktest({ code: backtestCode, days: backtestDays, strategyId: selected.id })); onToast('回测完成') } catch (err) { onToast(err instanceof Error ? err.message : '回测失败', 'down') } finally { setBusy(false) }
  }

  if (lib.error && !lib.data) return <section className="strategy-library"><div className="form-error">{lib.error}</div></section>

  return (
    <section className="strategy-library">
      <div className="strategy-lib-head">
        <div><span>策略库</span><em>文字定义 · 可见 · 可修改 · 可版本管理</em></div>
        <button type="button" className="quant-btn-quiet" onClick={() => void newStrategy()}><Plus size={12} /> 新建策略</button>
      </div>
      <AiStrategyBuilder module="t1" onSaved={() => void lib.refresh()} />
      <div className="strategy-lib-grid">
        <div className="strategy-list">
          {strategies.map((s) => (
            <button type="button" key={s.id} className={`strategy-list-item ${s.id === selectedId ? 'is-active' : ''}`} onClick={() => select(s)}>
              <span className={`strategy-state ${s.status}`}>{s.status === 'active' ? '启用中' : s.status === 'archived' ? '归档' : '草稿'}</span>
              <b>{s.name}</b>
              <em>v{s.version} · {new Date(s.updatedAt).toLocaleString('zh-CN')}</em>
            </button>
          ))}
          {creating ? <div className="strategy-list-item is-active"><span className="strategy-state draft">新建</span><b>{name || '新策略'}</b><em>未保存</em></div> : null}
        </div>

        <div className="strategy-editor">
          <div className="strategy-editor-head">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="策略名称" />
            <span>{selected ? `v${selected.version} · ${selected.history.length} 个历史版本` : '新策略'}</span>
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} placeholder="用文字描述适用环境、选股、买入、仓位和退出规则..." />
          <div className="strategy-parsed">
            <span>解析参数</span>
            {selected ? <>
              <b>模型 {selected.config.model === 'rule' ? '规则模型' : selected.config.model}</b>
              <b>分数 ≥ {selected.config.minScore}</b>
              <b>止损 {selected.config.stopLossPct}%</b>
              <b>止盈 {selected.config.takeProfitPct}%</b>
              <b>持有 {selected.config.maxHoldDays} 日</b>
              <b>单票 {selected.config.positionPct}%</b>
              <b>截止 {selected.config.entryCutoff}</b>
            </> : <em>保存后解析</em>}
          </div>
          <div className="strategy-actions">
            {creating ? <button type="button" className="quant-btn-primary" disabled={busy} onClick={() => void create()}><Save size={12} /> 创建</button> : <button type="button" className="quant-btn-primary" disabled={busy} onClick={() => void save()}><Save size={12} /> 保存</button>}
            {!creating ? <button type="button" className="quant-btn-quiet" disabled={busy || selected?.status === 'active'} onClick={() => void activate()}><Zap size={12} /> 启用</button> : null}
            {!creating ? <button type="button" className="quant-btn-quiet" disabled={busy} onClick={() => void duplicate()}><Copy size={12} /> 复制</button> : null}
            {!creating ? <button type="button" className="quant-btn-danger" disabled={busy} onClick={() => void remove()}><Trash2 size={12} /> 删除</button> : null}
          </div>
        </div>
      </div>

      <div className="quant-strategy-panel">
        <TradingSectionHeader variant="quant" title="历史回测" meta="使用当前编辑的策略回测，不会改变启用状态" />
        <div className="quant-backtest">
          <label>回测代码<input value={backtestCode} onChange={(e) => setBacktestCode(e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} /></label>
          <label>交易日<input type="number" value={backtestDays} onChange={(e) => setBacktestDays(Number(e.target.value))} /></label>
          <button type="button" className="quant-btn-quiet" disabled={busy || !selected} onClick={() => void runBacktest()}>运行回测</button>
          <button type="button" className="quant-btn-quiet" disabled={busy} onClick={() => void runRobustnessTest()}>参数稳健性</button><button type="button" className="quant-btn-quiet" disabled={busy} onClick={() => void loadIntraday()}>查看分时</button>
        </div>
        {backtest ? <BacktestResult result={backtest} /> : null}
        {robustness ? <div className="robustness-panel"><TradingSectionHeader variant="quant" title="参数稳健性" meta={`${robustness.note} · 正收益邻域 ${robustness.positiveRatio}%`} />{robustness.variants.map((v) => <div className="robustness-row" key={v.label}><span>{v.label}</span><b className={v.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(v.returnPct)}</b><em>回撤 {fmtPct(v.maxDrawdownPct)} · 胜率 {v.winRate.toFixed(1)}% · {v.trades} 笔</em></div>)}</div> : null}
        {intraday ? <IntradayChart data={intraday} /> : null}
      </div>
    </section>
  )
}

function BacktestResult({ result }: { result: QuantBacktestResult }) {
  const bars = result.bars
  const min = Math.min(...bars.map((b) => b.low))
  const max = Math.max(...bars.map((b) => b.high))
  const maxVol = Math.max(...bars.map((b) => b.volume), 1)
  const span = max - min || 1
  const avg = bars.map((_, i) => {
    const window = bars.slice(Math.max(0, i - 19), i + 1)
    return window.reduce((sum, b) => sum + b.close, 0) / window.length
  })
  const x = (i: number) => 44 + (i / Math.max(1, bars.length - 1)) * 820
  const y = (p: number) => 18 + ((max - p) / span) * 270
  const vy = (v: number) => 390 - (v / maxVol) * 65
  const dates = new Map(bars.map((b, i) => [b.date, i]))
  const first = bars[0]
  const last = bars[bars.length - 1]
  const mean = bars.reduce((sum, b) => sum + b.close, 0) / bars.length
  const stat = (label: string, value: string, tone?: 'up' | 'down') => <div><span>{label}</span><b className={tone}>{value}</b></div>
  return (
    <div className="backtest-visual">
      <div className="backtest-stats">
        {stat('区间起点', first?.close.toFixed(2) ?? '—')}
        {stat('区间终点', last?.close.toFixed(2) ?? '—')}
        {stat('区间涨跌', fmtPct(result.returnPct), result.returnPct >= 0 ? 'up' : 'down')}
        {stat('最高 / 最低', `${max.toFixed(2)} / ${min.toFixed(2)}`)}
        {stat('区间均价', mean.toFixed(2))}
        {stat('成交量', `${(bars.reduce((sum, b) => sum + b.volume, 0) / 1e8).toFixed(2)} 亿`)}
      </div>
            {result.dataQuality ? <div className={`backtest-quality ${result.dataQuality.suspendedDays || result.dataQuality.largeGaps ? 'warn' : ''}`}>数据质量：{result.dataQuality.note}</div> : null}
      {result.metrics ? <div className="backtest-metrics"><span>夏普 <b>{result.metrics.sharpe.toFixed(2)}</b></span><span>索提诺 <b>{result.metrics.sortino.toFixed(2)}</b></span><span>年化 <b className={result.metrics.annualizedReturnPct >= 0 ? 'up' : 'down'}>{fmtPct(result.metrics.annualizedReturnPct)}</b></span><span>盈亏比 <b>{result.metrics.profitFactor.toFixed(2)}</b></span><span>期望 <b className={result.metrics.expectancyPct >= 0 ? 'up' : 'down'}>{fmtPct(result.metrics.expectancyPct)}</b></span><span>连续亏损 <b>{result.metrics.maxConsecutiveLosses}</b></span><span>基准 <b className={result.metrics.benchmarkReturnPct >= 0 ? 'up' : 'down'}>{fmtPct(result.metrics.benchmarkReturnPct)}</b></span><span>基准回撤 <b className="down">{fmtPct(result.metrics.benchmarkMaxDrawdownPct)}</b></span></div> : null}
      {result.rollingWindows?.length ? <div className="backtest-windows"><div><span>窗口</span><span>起始</span><span>结束</span><span>收益</span><span>回撤</span><span>胜率</span><span>笔数</span></div>{result.rollingWindows.map((w) => <div key={w.label}><b>{w.label}</b><span>{w.startDate}</span><span>{w.endDate}</span><b className={w.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(w.returnPct)}</b><span className="down">{fmtPct(w.maxDrawdownPct)}</span><span>{w.winRate.toFixed(1)}%</span><span>{w.trades}</span></div>)}</div> : null}
      {result.outOfSample ? <div className="backtest-oos"><span>样本外</span><b className={result.outOfSample.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(result.outOfSample.returnPct)}</b><em>回撤 {fmtPct(result.outOfSample.maxDrawdownPct)} · 胜率 {result.outOfSample.winRate.toFixed(1)}% · {result.outOfSample.trades} 笔</em></div> : null}
      <div className="backtest-chart">
        <svg viewBox="0 0 900 440" preserveAspectRatio="none">
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--red)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--red)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((p) => <line key={p} x1="40" x2="870" y1={18 + p * 270} y2={18 + p * 270} stroke="var(--line)" strokeDasharray="2 4" />)}
          <line x1="40" y1="288" x2="870" y2="288" stroke="var(--line)" />
          <line x1="40" y1="390" x2="870" y2="390" stroke="var(--line)" />
          <polygon fill="url(#priceFill)" points={`${x(0)},300 ${bars.map((b, i) => `${x(i)},${y(b.close)}`).join(' ')} ${x(bars.length - 1)},300`} />
          <polyline fill="none" stroke="var(--red)" strokeWidth="1.8" points={bars.map((b, i) => `${x(i)},${y(b.close)}`).join(' ')} />
          <polyline fill="none" stroke="var(--gold)" strokeWidth="1.2" points={avg.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          {bars.map((b, i) => <rect key={b.date} x={x(i) - 1.5} y={vy(b.volume)} width="3" height={390 - vy(b.volume)} fill={b.close >= b.open ? 'var(--red)' : 'var(--green)'} opacity="0.35" />)}
          {result.trades.slice(0, 8).map((t, i) => {
            const ei = dates.get(t.entryDate)
            const xi = dates.get(t.exitDate)
            return <g key={i}>
              {ei != null ? <><circle cx={x(ei)} cy={y(t.entryPrice)} r="4" fill="var(--green)" /><text x={x(ei) + 6} y={y(t.entryPrice) - 5} fill="var(--green)" fontSize="9">B{i + 1} 买 {t.entryPrice.toFixed(2)}</text></> : null}
              {xi != null ? <><circle cx={x(xi)} cy={y(t.exitPrice)} r="4" fill="var(--red)" /><text x={x(xi) + 6} y={y(t.exitPrice) + 11} fill="var(--red)" fontSize="9">S{i + 1} 卖 {t.exitPrice.toFixed(2)}</text></> : null}
            </g>
          })}
          <text x="4" y="24" fill="var(--muted-2)" fontSize="9">{max.toFixed(2)}</text>
          <text x="4" y="286" fill="var(--muted-2)" fontSize="9">{min.toFixed(2)}</text>
          <text x="42" y="407" fill="var(--muted-2)" fontSize="8">{first?.date}</text>
          <text x="800" y="407" fill="var(--muted-2)" fontSize="8">{last?.date}</text>
          <text x="4" y="304" fill="var(--muted-2)" fontSize="7">VOL</text>
        </svg>
        <div className="backtest-legend"><span><i className="price-line" /> 收盘价</span><span><i className="avg-line" /> 均线</span><span><i className="buy-dot" /> 买入</span><span><i className="sell-dot" /> 卖出</span><span>下方为成交量</span></div>
      </div>
      <div className="quant-trades">{result.trades.slice(-8).map((t, i) => <span key={i}>{t.entryDate} → {t.exitDate} <b className={t.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(t.returnPct)}</b> {t.reason}</span>)}</div>
    </div>
  )
}

export function IntradayChart({ data }: { data: Awaited<ReturnType<typeof getIntradayAnalysis>> }) {
  const bars = data.bars
  if (bars.length < 2) return <div className="etf-empty">暂无分时数据</div>
  const prices = bars.map((b) => b.price)
  const vwaps = bars.map((b) => b.vwap)
  const min = Math.min(...prices, ...vwaps)
  const max = Math.max(...prices, ...vwaps)
  const maxVol = Math.max(...bars.map((b) => b.volume), 1)
  const span = max - min || 1
  const x = (i: number) => 48 + (i / (bars.length - 1)) * 812
  const y = (p: number) => 22 + ((max - p) / span) * 250
  const vy = (v: number) => 392 - (v / maxVol) * 58
  const idx = new Map(bars.map((b, i) => [b.time, i]))
  const stat = (label: string, value: string, tone?: 'up' | 'down') => <div><span>{label}</span><b className={tone}>{value}</b></div>
  return (
    <div className="intraday-panel">
      <TradingSectionHeader variant="quant" title="分时图 · 1 分钟" meta={`${data.date} 09:30 → 15:00 · VWAP / 量能 / B1-B4`} />
      <div className="intraday-chart-stats">
        {stat('收盘', `${data.stats.closePct >= 0 ? '+' : ''}${data.stats.closePct.toFixed(2)}%`, data.stats.closePct >= 0 ? 'up' : 'down')}
        {stat('价 > 均价', `${data.stats.aboveVwapRatio.toFixed(1)}%`)}
        {stat('涨跌量比', data.stats.upDownVolumeRatio.toFixed(2))}
        {stat('收盘位置', `${data.stats.closePosition.toFixed(0)}%`)}
        {stat('红旗', `${data.redFlags.length} 条`, data.redFlags.length ? 'down' : 'up')}
      </div>
      <div className="backtest-chart">
        <svg viewBox="0 0 900 420" preserveAspectRatio="none">
          {[0, 0.25, 0.5, 0.75, 1].map((p) => <line key={p} x1="48" x2="860" y1={22 + p * 250} y2={22 + p * 250} stroke="var(--line)" strokeDasharray="2 4" />)}
          <line x1="48" y1="22" x2="48" y2="392" stroke="var(--line)" />
          <line x1="48" y1="272" x2="860" y2="272" stroke="var(--line)" />
          <line x1="48" y1="392" x2="860" y2="392" stroke="var(--line)" />
          <polyline fill="none" stroke="var(--red)" strokeWidth="1.5" points={bars.map((b, i) => `${x(i)},${y(b.price)}`).join(' ')} />
          <polyline fill="none" stroke="var(--gold)" strokeWidth="1.2" strokeDasharray="3 2" points={bars.map((b, i) => `${x(i)},${y(b.vwap)}`).join(' ')} />
          <line x1="48" y1={vy(data.stats.medianVolume * 3)} x2="860" y2={vy(data.stats.medianVolume * 3)} stroke="var(--warn)" strokeDasharray="3 3" opacity=".7" />
          {bars.map((b, i) => <rect key={i} x={x(i) - 1.5} y={vy(b.volume)} width="3" height={392 - vy(b.volume)} fill={b.price >= b.vwap ? 'var(--red)' : 'var(--green)'} opacity=".35" />)}
          {data.signals.filter((s) => s.action !== 'watch').map((s) => { const i = idx.get(s.time); if (i == null) return null; const buy = s.action === 'buy'; return <g key={s.id + s.time}><circle cx={x(i)} cy={y(s.price)} r="4" fill={buy ? 'var(--green)' : 'var(--red)'} /><text x={x(i) + 6} y={y(s.price) + (buy ? -6 : 11)} fill={buy ? 'var(--green)' : 'var(--red)'} fontSize="9">{s.id}</text></g> })}
          <text x="4" y="26" fill="var(--muted-2)" fontSize="9">{max.toFixed(2)}</text>
          <text x="4" y="270" fill="var(--muted-2)" fontSize="9">{min.toFixed(2)}</text>
          <text x="52" y="410" fill="var(--muted-2)" fontSize="8">09:30</text>
          <text x="405" y="410" fill="var(--muted-2)" fontSize="8">11:30 / 13:00</text>
          <text x="820" y="410" fill="var(--muted-2)" fontSize="8">15:00</text>
          <text x="4" y="358" fill="var(--muted-2)" fontSize="7">VOL</text>
          <text x="4" y={vy(data.stats.medianVolume * 3) - 3} fill="var(--warn)" fontSize="7">3× 中位量</text>
        </svg>
      </div>
      <div className="intraday-legend"><span><i className="price-line" />价格</span><span><i className="avg-line" />VWAP 均价线</span><span>红绿柱：分钟量</span><span>{data.note}</span></div>
    </div>
  )
}

