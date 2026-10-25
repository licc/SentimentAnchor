import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getIntradayAnalysis, getIntradayBacktest, getIntradayRules } from '../api'
import { Modal } from './Modals'
import { TradingMetric, TradingMetricStrip, TradingSectionHeader } from './trading-ui'

type Analysis = Awaited<ReturnType<typeof getIntradayAnalysis>>
export function IntradayAnalysisModal({ symbol, date, onClose }: { symbol: string; date?: string; onClose: () => void }) {
  const [data, setData] = useState<Analysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rules, setRules] = useState<Awaited<ReturnType<typeof getIntradayRules>>>([])
  const [backtest, setBacktest] = useState<Awaited<ReturnType<typeof getIntradayBacktest>> | null>(null)
  const [btBusy, setBtBusy] = useState(false)
  useEffect(() => { void getIntradayAnalysis(symbol, date).then(setData).catch((err) => setError(err instanceof Error ? err.message : '分时分析失败')); void getIntradayRules().then(setRules).catch(() => undefined) }, [symbol, date])
  return (
    <Modal title={`分时检查 · ${symbol}`} subtitle="1 分钟真实分时 · 均价线 / 量能 / 买卖点 / 红旗" onClose={onClose} width={980}>
      {error ? <div className="form-error">{error}</div> : null}
      {data ? <>
        <div className={`intraday-score ${data.score.label === '危险' ? 'danger' : data.score.label === '弱' ? 'weak' : data.score.label === '强' ? 'strong' : ''}`}>
          <b>{data.score.label}</b><span>强项 {data.score.strength} / 弱项 {data.score.weak}</span><em>{data.date} · 昨收 {data.prevClose.toFixed(2)}</em>
        </div>
        <TradingMetricStrip columns={6}>
          <TradingMetric label="开盘" value={`${data.stats.openPct.toFixed(2)}%`} tone={data.stats.openPct >= 0 ? 'up' : 'down'} />
          <TradingMetric label="收盘" value={`${data.stats.closePct.toFixed(2)}%`} tone={data.stats.closePct >= 0 ? 'up' : 'down'} />
          <TradingMetric label="价>均价" value={`${data.stats.aboveVwapRatio.toFixed(1)}%`} />
          <TradingMetric label="均价斜率" value={`${data.stats.slopePct.toFixed(2)}%`} tone={data.stats.slopePct >= 0 ? 'up' : 'down'} />
          <TradingMetric label="涨跌量比" value={data.stats.upDownVolumeRatio.toFixed(2)} />
          <TradingMetric label="收盘位置" value={`${data.stats.closePosition.toFixed(0)}%`} />
        </TradingMetricStrip>
        <div className="intraday-chart">
          <svg viewBox="0 0 900 330" preserveAspectRatio="none">
            <defs><linearGradient id="intradayFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--gold)" stopOpacity=".18" /><stop offset="1" stopColor="var(--gold)" stopOpacity="0" /></linearGradient></defs>
            <line x1="36" y1="20" x2="36" y2="250" stroke="var(--line)" />
            <line x1="36" y1="250" x2="880" y2="250" stroke="var(--line)" />
            {(() => {
              const min = Math.min(...data.bars.map((b) => Math.min(b.price, b.vwap)))
              const max = Math.max(...data.bars.map((b) => Math.max(b.price, b.vwap)))
              const span = max - min || 1
              const maxVol = Math.max(...data.bars.map((b) => b.volume), 1)
              const x = (i: number) => 36 + (i / Math.max(1, data.bars.length - 1)) * 840
              const y = (p: number) => 20 + ((max - p) / span) * 230
              const vy = (v: number) => 320 - (v / maxVol) * 50
              return <>
                <polygon fill="url(#intradayFill)" points={`${x(0)},250 ${data.bars.map((b, i) => `${x(i)},${y(b.price)}`).join(' ')} ${x(data.bars.length - 1)},250`} />
                <polyline fill="none" stroke="var(--gold)" strokeWidth="1.4" points={data.bars.map((b, i) => `${x(i)},${y(b.price)}`).join(' ')} />
                <polyline fill="none" stroke="var(--line-strong)" strokeWidth="1" points={data.bars.map((b, i) => `${x(i)},${y(b.vwap)}`).join(' ')} />
                {data.bars.map((b, i) => <rect key={i} x={x(i) - 1} y={vy(b.volume)} width="2" height={320 - vy(b.volume)} fill={b.price >= b.vwap ? 'var(--red)' : 'var(--green)'} opacity=".32" />)}
                {data.signals.map((s) => { const i = data.bars.findIndex((b) => b.time === s.time); if (i < 0) return null; const isBuy = s.action === 'buy'; return <g key={s.id + s.time}><circle cx={x(i)} cy={y(s.price)} r="3.5" fill={isBuy ? 'var(--green-deep)' : 'var(--red)'} /><text x={x(i) + 5} y={y(s.price) + (isBuy ? -5 : 10)} fill={isBuy ? 'var(--green-deep)' : 'var(--red)'} fontSize="8">{s.id}</text></g> })}
                <text x="3" y="24" fill="var(--muted-2)" fontSize="8">{max.toFixed(2)}</text>
                <text x="3" y="248" fill="var(--muted-2)" fontSize="8">{min.toFixed(2)}</text>
              </>
            })()}
          </svg>
          <div className="intraday-legend"><span><i className="price-line" />价格</span><span><i className="avg-line" />均价线</span><span>B/S 为规则信号，不是自动委托</span></div>
        </div>
        <div className="intraday-grid">
          <div>
            <TradingSectionHeader title="红旗检查" meta={`${data.redFlags.length} 条`} />
            {data.redFlags.length ? <div className="intraday-flags">{data.redFlags.map((f) => <div key={f.id}><AlertTriangle size={11} /><b>{f.text}</b><em>{f.value}</em></div>)}</div> : <div className="intraday-ok"><CheckCircle2 size={12} /> 未命中主要红旗</div>}
          </div>
          <div>
            <TradingSectionHeader title="规则信号" meta={`${data.signals.length} 个`} />
            <div className="intraday-signals">{data.signals.length ? data.signals.map((s) => <div key={s.id + s.time} className={`sig-${s.action}`}><b>{s.id}</b><span>{s.time} · {s.price.toFixed(2)}</span><em>{s.reason}</em></div>) : <div className="etf-empty">当日暂无规则信号</div>}</div>
          </div>
        </div>
        <div className="intraday-bt-head"><TradingSectionHeader title="5 日分时回测" meta="规则近似 · 小样本" /><button type="button" className="quant-btn-quiet" disabled={btBusy} onClick={() => { setBtBusy(true); void getIntradayBacktest(symbol).then(setBacktest).catch((err) => setError(err instanceof Error ? err.message : '分时回测失败')).finally(() => setBtBusy(false)) }}>{btBusy ? '回测中…' : '运行 5 日回测'}</button></div>
        {backtest ? <div className="intraday-bt"><div><span>规则</span><span>信号</span><span>次日均值</span><span>胜率</span></div>{backtest.rows.map((r) => <div key={r.rule}><b>{r.rule}</b><span>{r.signals}</span><b className={r.avgNextReturnPct >= 0 ? 'up' : 'down'}>{r.avgNextReturnPct.toFixed(2)}%</b><span>{r.winRate.toFixed(1)}%</span></div>)}<em>{backtest.note}</em></div> : null}
        <div className="intraday-rules">
          <TradingSectionHeader title="分时规则库" meta="统计来自 shqx 3883 样本；只展示，不自动交易" />
          <div className="intraday-rule-head"><span>规则</span><span>窗口</span><span>条件</span><span>样本</span><span>期望</span><span>结论</span></div>
          {rules.map((r) => <div className={`intraday-rule ${r.verdict}`} key={r.id}><b>{r.id} · {r.name}</b><span>{r.window}</span><span>{r.condition}</span><span>{r.sample ?? '—'}</span><span className={(r.expectancyPct ?? 0) >= 0 ? 'up' : 'down'}>{r.expectancyPct == null ? '—' : `${r.expectancyPct.toFixed(2)}%`}</span><em>{r.verdict === 'keep' ? '保留' : r.verdict === 'drop' ? '不建议' : '观察'}</em></div>)}
        </div>
        <div className="modal-note">{data.note} 分时分析不会自动下单。</div>
      </> : <div className="etf-empty">读取 1 分钟分时…</div>}
    </Modal>
  )
}
