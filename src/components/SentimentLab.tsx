import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Gauge, MoveDownRight, MoveUpRight, Waves } from 'lucide-react'
import type { ChartPoint, Sentiment, SentimentDayArchive, Snapshot } from '../../shared/types'
import { getSentimentHistory } from '../api'
import { fmtAmount, fmtAmountDelta, fmtCount, fmtSigned } from '../lib/format'
import { SectionHeader, Tag } from './ui'

export function SentimentLab({ snapshot }: { snapshot: Snapshot }) {
  const { sentiment, chart, breadth } = snapshot
  return (
    <section className="lab section" id="sentiment">
      <SectionHeader
        index="03"
        title="情绪结构"
        subtitle="把情绪拆成可观察的分量：广度、涨跌停差、封板质量、空间高度、指数动量"
        right={
          <div className="lab-legend">
            <span className="mono">{snapshot.tradingDate}</span>
            <span>·</span>
            <span>{chart.length} 个分钟采样</span>
            <Tag tone={sentiment.stage === '分歧' ? 'warn' : sentiment.stage === '退潮' ? 'down' : 'up'}>
              {sentiment.label}
            </Tag>
          </div>
        }
      />
      <div className="lab-grid">
        <ScoreCard sentiment={sentiment} />
        <ChartCard chart={chart} sentiment={sentiment} tradingDate={snapshot.tradingDate} />
        <BreadthCard snapshot={snapshot} />
      </div>
    </section>
  )
}

function ScoreCard({ sentiment }: { sentiment: Sentiment }) {
  const score = sentiment.score
  const angle = Math.PI - (score / 100) * Math.PI
  const markerX = 110 + 88 * Math.cos(angle)
  const markerY = 112 - 88 * Math.sin(angle)
  return (
    <article className="lab-card score-card">
      <div className="lab-card-head">
        <span className="eyebrow"><Gauge size={12} /> 情绪温度</span>
        <span className={`score-risk tone-${sentiment.risk === '高' ? 'down' : sentiment.risk === '中' ? 'warn' : 'up'}`}>
          风险 {sentiment.risk}
        </span>
      </div>
      <div className="gauge-wrap">
        <svg viewBox="0 0 220 132" className="gauge-svg" role="img" aria-label={`情绪温度 ${score}`}>
          <defs>
            <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2a9a78" />
              <stop offset="42%" stopColor="#d6a24a" />
              <stop offset="100%" stopColor="#d34b35" />
            </linearGradient>
          </defs>
          <path d="M 20 112 A 90 90 0 0 1 200 112" className="gauge-track" pathLength="100" />
          <path
            d="M 20 112 A 90 90 0 0 1 200 112"
            className="gauge-value"
            pathLength="100"
            strokeDasharray={`${score} 100`}
          />
          <circle cx={markerX} cy={markerY} r="5" className="gauge-marker" />
          <text x="20" y="128" className="gauge-tick">0</text>
          <text x="110" y="19" className="gauge-tick mid">50</text>
          <text x="194" y="128" className="gauge-tick">100</text>
        </svg>
        <div className="gauge-center">
          <div className="gauge-score mono">{score}</div>
          <div className="gauge-stage">{sentiment.stage}</div>
          <div className={`gauge-trend ${sentiment.trend >= 0 ? 'is-up' : 'is-down'}`}>
            {sentiment.trend >= 0 ? <MoveUpRight size={11} /> : <MoveDownRight size={11} />}
            {fmtSigned(sentiment.trend, 1)}
          </div>
        </div>
      </div>
      <p className="score-summary">{sentiment.summary}</p>
      <div className="score-components">
        {sentiment.components.map((c) => (
          <div className="component-row" key={c.label} title={c.detail}>
            <span className="component-label">{c.label}</span>
            <span className="component-bar">
              <i className={`tone-bg-${c.tone}`} style={{ width: `${Math.max(3, c.score)}%` }} />
            </span>
            <span className="component-score mono">{c.score}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

type ChartRange = 'day' | 7 | 14 | 30

const CHART_W = 760
const CHART_H = 208
const CHART_PAD = { l: 40, r: 16, t: 18, b: 26 }

function RangeTabs({ value, onChange }: { value: ChartRange; onChange: (next: ChartRange) => void }) {
  const options: { key: ChartRange; label: string }[] = [
    { key: 'day', label: '当日' },
    { key: 7, label: '7 日' },
    { key: 14, label: '14 日' },
    { key: 30, label: '30 日' },
  ]
  return (
    <div className="range-tabs" role="tablist" aria-label="情绪温度时间区间">
      {options.map((o) => (
        <button
          key={String(o.key)}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          className={`range-tab${value === o.key ? ' is-active' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 近 N 个交易日的情绪温度趋势：每天一个点（取当日归档的收盘温度）。 */
function DailyTrend({ days, tradingDate }: { days: number; tradingDate: string }) {
  const [items, setItems] = useState<SentimentDayArchive[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [reload, setReload] = useState(0)
  const [hover, setHover] = useState<{ x: number; y: number; item: SentimentDayArchive } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getSentimentHistory(days)
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        setBackfilling(Boolean(res.backfilling))
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取历史失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [days, tradingDate, reload])

  // 后台回填期间每 5 秒刷新一次，图表会逐步长出来，不需要手动刷新页面
  useEffect(() => {
    if (!backfilling) return
    const id = window.setInterval(() => setReload((n) => n + 1), 5_000)
    return () => window.clearInterval(id)
  }, [backfilling])

  const innerW = CHART_W - CHART_PAD.l - CHART_PAD.r
  const innerH = CHART_H - CHART_PAD.t - CHART_PAD.b
  const geometry = useMemo(() => {
    if (!items.length) return null
    const points = items.map((item, i) => {
      const x = CHART_PAD.l + (items.length === 1 ? innerW / 2 : (i / (items.length - 1)) * innerW)
      const y = CHART_PAD.t + (1 - Math.max(0, Math.min(100, item.score)) / 100) * innerH
      return { x, y, item }
    })
    const line = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ')
    return { points, line }
  }, [items, innerH, innerW])

  if (loading && !items.length) return <div className="chart-empty">正在读取近 {days} 日归档…</div>
  if (error) return <div className="chart-empty">读取失败：{error}</div>
  if (!items.length) {
    return (
      <div className="chart-empty">
        {backfilling ? '正在回填历史数据（约 30 秒）…' : '暂无历史归档，稍后会自动补齐。'}
      </div>
    )
  }

  const scores = items.map((i) => i.score)
  const high = Math.max(...scores)
  const low = Math.min(...scores)
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length
  const highDay = items[scores.indexOf(high)]
  const lowDay = items[scores.indexOf(low)]
  const labelIdx = items.length <= 3 ? items.map((_, i) => i) : [0, Math.floor((items.length - 1) / 2), items.length - 1]

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg || !geometry) return
    const rect = svg.getBoundingClientRect()
    const rx = ((e.clientX - rect.left) / rect.width) * CHART_W
    let best = geometry.points[0]
    for (const pt of geometry.points) {
      if (Math.abs(pt.x - rx) < Math.abs(best.x - rx)) best = pt
    }
    setHover({ x: best.x, y: best.y, item: best.item })
  }

  return (
    <>
      <div className="chart-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="sentiment-chart"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`近 ${days} 个交易日情绪温度趋势`}
        >
          {[20, 40, 60, 80].map((v) => {
            const y = CHART_PAD.t + (1 - v / 100) * innerH
            return (
              <g key={v}>
                <line x1={CHART_PAD.l} y1={y} x2={CHART_W - CHART_PAD.r} y2={y} className="chart-grid" />
                <text x={CHART_PAD.l - 8} y={y + 3} className="chart-y">{v}</text>
              </g>
            )
          })}
          <line
            x1={CHART_PAD.l}
            y1={CHART_PAD.t + (1 - 50 / 100) * innerH}
            x2={CHART_W - CHART_PAD.r}
            y2={CHART_PAD.t + (1 - 50 / 100) * innerH}
            className="chart-midline"
          />
          {geometry ? (
            <>
              <path d={geometry.line} fill="none" stroke="#c53b2c" strokeWidth="2.2" strokeLinejoin="round" className="chart-line" />
              {geometry.points.map((pt) => (
                <circle key={pt.item.date} cx={pt.x} cy={pt.y} r={items.length > 20 ? 1.6 : 2.6} className="chart-dot" />
              ))}
            </>
          ) : null}
          {labelIdx.map((idx, i) => {
            const pt = geometry?.points[idx]
            if (!pt) return null
            return (
              <text
                key={items[idx].date}
                x={pt.x}
                y={CHART_H - 8}
                className="chart-x"
                textAnchor={i === 0 ? 'start' : i === labelIdx.length - 1 ? 'end' : 'middle'}
              >
                {items[idx].date.slice(5)}
              </text>
            )
          })}
          {hover ? (
            <g>
              <line x1={hover.x} y1={CHART_PAD.t} x2={hover.x} y2={CHART_PAD.t + innerH} className="chart-cursor" />
              <circle cx={hover.x} cy={hover.y} r="4" className="chart-hover-dot" />
            </g>
          ) : null}
        </svg>
        {hover ? (
          <div className="chart-tooltip" style={{ left: `${(hover.x / CHART_W) * 100}%`, top: `${(hover.y / CHART_H) * 100}%` }}>
            <div className="ct-time">{hover.item.date}</div>
            <div className="ct-row"><span>收盘温度</span><b>{hover.item.score}</b></div>
            <div className="ct-row"><span>当日最高</span><b className="up">{hover.item.high}</b></div>
            <div className="ct-row"><span>当日最低</span><b className="down">{hover.item.low}</b></div>
          </div>
        ) : null}
      </div>
      <div className="chart-foot">
        <span><i className="line-key" /> 每日收盘情绪温度（0-100）</span>
        <span>
          共 {items.length} 个交易日 · 均值 {avg.toFixed(1)} · 最高 {high}（{highDay.date.slice(5)}）· 最低 {low}（{lowDay.date.slice(5)}）
          {items.length < days ? (backfilling ? ' · 回填中…' : ' · 历史不足') : ''}
        </span>
      </div>
    </>
  )
}

function ChartCard({ chart, sentiment, tradingDate }: { chart: ChartPoint[]; sentiment: Sentiment; tradingDate: string }) {
  const W = 760
  const H = 208
  const pad = { l: 40, r: 16, t: 18, b: 26 }
  const innerW = W - pad.l - pad.r
  const innerH = H - pad.t - pad.b
  const [range, setRange] = useState<ChartRange>('day')
  const [hover, setHover] = useState<{ x: number; y: number; p: ChartPoint } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const geometry = useMemo(() => {
    if (chart.length === 0) return null
    const points = chart.map((p, i) => {
      const x = pad.l + (i / Math.max(1, chart.length - 1)) * innerW
      const y = pad.t + (1 - p.temp / 100) * innerH
      return { x, y, p }
    })
    const line = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ')
    const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${pad.t + innerH} L ${points[0].x.toFixed(2)} ${pad.t + innerH} Z`
    return { points, line, area }
  }, [chart, innerH, innerW, pad.l, pad.t])

  if (range !== 'day') {
    return (
      <article className="lab-card chart-card">
        <div className="lab-card-head">
          <span className="eyebrow"><Activity size={12} /> 情绪温度 · 近 {range} 日</span>
          <RangeTabs value={range} onChange={setRange} />
        </div>
        <DailyTrend days={range} tradingDate={tradingDate} />
      </article>
    )
  }

  if (!geometry) return <article className="lab-card chart-card">暂无分时数据</article>

  const high = Math.max(...chart.map((p) => p.temp))
  const low = Math.min(...chart.map((p) => p.temp))
  const last = chart[chart.length - 1]
  const presets = [0, Math.round(chart.length * 0.25), Math.round(chart.length * 0.5), Math.round(chart.length * 0.75), chart.length - 1]
  const labels = presets.map((i) => chart[Math.min(i, chart.length - 1)]?.time).filter(Boolean)

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const rx = ((e.clientX - rect.left) / rect.width) * W
    const ratio = Math.max(0, Math.min(1, (rx - pad.l) / innerW))
    const idx = Math.round(ratio * (chart.length - 1))
    const pt = geometry!.points[idx]
    if (pt) setHover({ x: pt.x, y: pt.y, p: pt.p })
  }

  return (
    <article className="lab-card chart-card">
      <div className="lab-card-head">
        <span className="eyebrow"><Activity size={12} /> 日内情绪温度</span>
        <RangeTabs value={range} onChange={setRange} />
        <div className="chart-head-stats">
          <span>当前 <b className="mono">{last.temp}</b></span>
          <span>高 <b className="mono">{high}</b></span>
          <span>低 <b className="mono">{low}</b></span>
          <span className={`tone-text-${sentiment.stage === '退潮' ? 'down' : 'up'}`}>{sentiment.stage}</span>
        </div>
      </div>
      <div className="chart-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="sentiment-chart"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label="日内情绪温度曲线"
        >
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d34b35" stopOpacity="0.24" />
              <stop offset="60%" stopColor="#d6a24a" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#d6a24a" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#b78a3e" />
              <stop offset="55%" stopColor="#d45a3c" />
              <stop offset="100%" stopColor="#c53b2c" />
            </linearGradient>
          </defs>
          {[20, 40, 60, 80].map((v) => {
            const y = pad.t + (1 - v / 100) * innerH
            return (
              <g key={v}>
                <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} className="chart-grid" />
                <text x={pad.l - 8} y={y + 3} className="chart-y">{v}</text>
              </g>
            )
          })}
          <line
            x1={pad.l}
            y1={pad.t + (1 - 50 / 100) * innerH}
            x2={W - pad.r}
            y2={pad.t + (1 - 50 / 100) * innerH}
            className="chart-midline"
          />
          <path d={geometry.area} fill="url(#areaGrad)" />
          <path d={geometry.line} fill="none" stroke="url(#lineGrad)" strokeWidth="2.2" strokeLinejoin="round" className="chart-line" />
          {geometry.points.map((pt) => (
            <circle key={pt.p.ts} cx={pt.x} cy={pt.y} r="1.05" className="chart-dot" />
          ))}
          <circle cx={geometry.points[geometry.points.length - 1].x} cy={geometry.points[geometry.points.length - 1].y} r="3.6" className="chart-last" />
          {labels.map((label, i) => {
            const idx = presets[i]
            const x = pad.l + (idx / Math.max(1, chart.length - 1)) * innerW
            return (
              <text key={`${label}-${i}`} x={x} y={H - 8} className="chart-x" textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>
                {label}
              </text>
            )
          })}
          {hover ? (
            <g>
              <line x1={hover.x} y1={pad.t} x2={hover.x} y2={pad.t + innerH} className="chart-cursor" />
              <circle cx={hover.x} cy={hover.y} r="4" className="chart-hover-dot" />
            </g>
          ) : null}
        </svg>
        {hover ? (
          <div className="chart-tooltip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
            <div className="ct-time">{hover.p.time}</div>
            <div className="ct-row"><span>温度</span><b>{hover.p.temp}</b></div>
            <div className="ct-row"><span>上涨</span><b className="up">{hover.p.rise}</b></div>
            <div className="ct-row"><span>下跌</span><b className="down">{hover.p.fall}</b></div>
            <div className="ct-row"><span>涨停</span><b>{hover.p.limitUp}</b></div>
          </div>
        ) : null}
      </div>
      <div className="chart-foot">
        <span><i className="line-key" /> 情绪温度（0-100）</span>
        <span>09:25 — 15:00 · 每分钟一个采样点</span>
      </div>
    </article>
  )
}

function BreadthCard({ snapshot }: { snapshot: Snapshot }) {
  const { breadth, sentiment } = snapshot
  const total = Math.max(1, breadth.rise + breadth.fall)
  const upPct = (breadth.rise / total) * 100
  return (
    <article className="lab-card breadth-card">
      <div className="lab-card-head">
        <span className="eyebrow"><Waves size={12} /> 市场广度</span>
        <span className="breadth-ratio mono">{breadth.ratio.toFixed(2)} : 1</span>
      </div>
      <div className="breadth-split">
        <div className="breadth-split-bar">
          <span className="bs-up" style={{ width: `${upPct}%` }} />
          <span className="bs-down" style={{ width: `${100 - upPct}%` }} />
        </div>
        <div className="breadth-split-labels">
          <span className="up">涨 {fmtCount(breadth.rise)}</span>
          <span className="down">跌 {fmtCount(breadth.fall)}</span>
        </div>
      </div>
      <div className="breadth-stats">
        <div className="breadth-stat">
          <span>涨停</span>
          <b className="up mono">{breadth.limitUp}</b>
        </div>
        <div className="breadth-stat">
          <span>跌停</span>
          <b className="down mono">{breadth.limitDown}</b>
        </div>
        <div className="breadth-stat">
          <span>回封</span>
          <b className="warn mono">{breadth.broken}</b>
        </div>
        <div className="breadth-stat">
          <span title="沪深两市成交额，不含北交所">成交额</span>
          <b className="mono">{fmtAmount(breadth.amount)}</b>
        </div>
      </div>
      <div className="breadth-quality">
        <div className="bq-head">
          <span>封板质量</span>
          <b className="mono">{sentiment.sealRate?.toFixed(1)}%</b>
        </div>
        <div className="bq-bar">
          <span style={{ width: `${sentiment.sealRate ?? 0}%` }} />
        </div>
        <div className="bq-foot">
          <span>回封占比 {sentiment.breakRate?.toFixed(1)}%</span>
          <span className={`tone-text-${(breadth.amountChangePct ?? 0) >= 0 ? 'up' : 'down'}`} title={`较昨日 ${breadth.amountWindow ?? ''} 同时段`}>
            {breadth.amountChangePct == null || breadth.amountDiff == null ? '较昨同时间 —' : `较昨同时间 ${breadth.amountDiff >= 0 ? '放量' : '缩量'} ${fmtAmountDelta(breadth.amountDiff)} / ${Math.abs(breadth.amountChangePct).toFixed(2)}%`}
          </span>
        </div>
      </div>
    </article>
  )
}
