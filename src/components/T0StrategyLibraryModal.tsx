import { Save, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getIntradayAnalysis, getIntradayBacktest } from '../api'
import { IntradayChart } from './StrategyLibrary'
import { useT0Strategies } from '../hooks/useT0Strategies'
import { Modal } from './Modals'
import { AiStrategyBuilder } from './AiStrategyBuilder'

export function T0StrategyLibraryModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const lib = useT0Strategies()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [chartCode, setChartCode] = useState('518880')
  const [chart, setChart] = useState<Awaited<ReturnType<typeof getIntradayAnalysis>> | null>(null)
  const [chartError, setChartError] = useState<string | null>(null)
  const [bt, setBt] = useState<Awaited<ReturnType<typeof getIntradayBacktest>> | null>(null)
  const [btBusy, setBtBusy] = useState(false)
  const selected = lib.data?.strategies.find((s) => s.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId) return
    const active = lib.data?.strategies.find((s) => s.status === 'active') ?? lib.data?.strategies[0]
    if (active) { setSelectedId(active.id); setContent(active.content) }
  }, [lib.data, selectedId])

  function select(id: string) {
    const s = lib.data?.strategies.find((x) => x.id === id)
    if (s) { setSelectedId(id); setContent(s.content) }
  }

  return (
    <Modal title="T+0 策略库" subtitle="T+0 自己的策略模型；同一时间只启用一个" onClose={onClose} width={860}>
      <AiStrategyBuilder module="t0" onSaved={() => { void lib.refresh(); onChanged?.() }} />
      <div className="t0-lib-grid">
        <div className="strategy-list">
          {(lib.data?.strategies ?? []).map((s) => (
            <button type="button" key={s.id} className={`strategy-list-item ${s.id === selectedId ? 'is-active' : ''}`} onClick={() => select(s.id)}>
              <span className={`strategy-state ${s.status}`}>{s.status === 'active' ? '启用中' : '草稿'}</span>
              <b>{s.name}</b>
              <em>v{s.version}</em>
            </button>
          ))}
        </div>
        <div className="strategy-editor">
          <div className="strategy-editor-head"><b>{selected?.name ?? 'T+0 策略'}</b><span>{selected ? `v${selected.version}` : ''}</span></div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} placeholder="用文字描述 T+0 的进攻、防守、仓位和执行规则" />
          <div className="strategy-parsed">
            <span>解析</span>
            {selected ? <><b>进攻 ≥ {selected.config.riskOnScore}</b><b>防守 &lt; {selected.config.riskOffScore}</b><b>进攻仓 {Math.round(selected.config.riskOnPositionPct * 100)}%</b><b>防守仓 {Math.round(selected.config.riskOffPositionPct * 100)}%</b><b>{selected.config.allowRisk ? '允许风险ETF' : '只做防守'}</b></> : null}
          </div>
          <div className="strategy-actions">
            <button type="button" className="quant-btn-primary" disabled={lib.busy || !selected} onClick={() => void lib.save(selected!.id, content).then(() => { onChanged?.(); }).catch(() => undefined)}><Save size={12} /> 保存</button>
            <button type="button" className="quant-btn-quiet" disabled={lib.busy || !selected || selected.status === 'active'} onClick={() => void lib.activate(selected!.id).then(() => onChanged?.()).catch(() => undefined)}><Zap size={12} /> 启用</button>
          </div>
        </div>
      </div>
      <div className="t0-chart-block">
        <div className="t0-chart-bar"><span>策略分时验证</span><input value={chartCode} onChange={(e) => setChartCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="ETF 代码" /><button type="button" className="quant-btn-quiet" onClick={() => { setChartError(null); void getIntradayAnalysis(chartCode).then(setChart).catch((err) => setChartError(err instanceof Error ? err.message : '分时失败')) }}>查看分时</button><button type="button" className="quant-btn-quiet" disabled={btBusy} onClick={() => { setBtBusy(true); setChartError(null); void getIntradayBacktest(chartCode).then(setBt).catch((err) => setChartError(err instanceof Error ? err.message : '回测失败')).finally(() => setBtBusy(false)) }}>{btBusy ? '回测中…' : '5日分时验证'}</button>{chartError ? <em>{chartError}</em> : null}</div>
        {chart ? <IntradayChart data={chart} /> : null}
        {bt ? <div className="intraday-bt"><div><span>规则</span><span>信号</span><span>次日均值</span><span>胜率</span></div>{bt.rows.map((r) => <div key={r.rule}><b>{r.rule}</b><span>{r.signals}</span><b className={r.avgNextReturnPct >= 0 ? 'up' : 'down'}>{r.avgNextReturnPct.toFixed(2)}%</b><span>{r.winRate.toFixed(1)}%</span></div>)}<em>{bt.note}</em></div> : null}
      </div>
      <div className="auto-settings-note">启用后 T+0 信号下一轮使用该模型；不会自动启动自动执行。</div>
      {lib.error ? <div className="form-error">{lib.error}</div> : null}
    </Modal>
  )
}
