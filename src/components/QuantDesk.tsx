import { Activity, ClipboardList, FlaskConical, Pause, Play, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useEtfDeskContext } from '../contexts/EtfDeskContext'
import { useQuantPool } from '../hooks/useQuantPool'
import { useQuantAuto } from '../hooks/useQuantAuto'
import { useQuantStrategy } from '../hooks/useQuantStrategy'
import { useQuantStrategyLibrary } from '../hooks/useQuantStrategyLibrary'
import { QuantStrategyLibraryModal } from './QuantStrategyLibraryModal'
import { TradingMetric, TradingMetricStrip, TradingSectionHeader, TradingTable } from './trading-ui'
import { fmtMoney, fmtPct, fmtSigned } from '../lib/format'
import { EtfExecutionModal } from './EtfExecutionModal'

export function QuantDesk({ onToast }: { onToast: (message: string, tone?: 'up' | 'down') => void }) {
  const { data, loading, error, refresh } = useEtfDeskContext()
  const [executionsOpen, setExecutionsOpen] = useState(false)
  const quant = useQuantPool()
  const auto = useQuantAuto()
  const strategy = useQuantStrategy()
  const strategyLib = useQuantStrategyLibrary()
  const [manualCode, setManualCode] = useState('')
  const [busy, setBusy] = useState(false)
  const running = ['running', 'waiting', 'recovering'].includes(auto.state?.status ?? '')
  const [strategyModalOpen, setStrategyModalOpen] = useState(false)

  if (loading) return <section className="quant-desk"><div className="etf-empty">加载量化数据…</div></section>
  if (!data) return <section className="quant-desk"><div className="etf-error"><span>{error ?? '量化数据不可用'}</span><button type="button" onClick={() => void refresh(true)}>重试</button></div></section>

  const { broker, signal } = data
  const quantPool = quant.pool
  const poolItems = quantPool?.items ?? []
  const suggestions = (quantPool?.candidates ?? []).filter((c) => !(quantPool?.codes ?? []).includes(c.code)).slice(0, 10)
  const positions = broker.positions.filter((p) => p.quantity > 0)
  const activeDefinition = strategyLib.data?.strategies.find((s) => s.status === 'active')

  async function run(action: 'start' | 'pause' | 'flatten') {
    if (action === 'start' && !window.confirm('启动 T+1 量化？会按量化池和情绪环境自动买入股票，接口必须是 LIVE。')) return
    if (action === 'flatten' && !window.confirm('T+1 清仓只会卖出已可卖的持仓，当日买入的股票不能当日卖出。确认？')) return
    setBusy(true)
    try {
      await auto.run(action)
      await refresh(true)
      onToast(action === 'start' ? 'T+1 量化已启动' : action === 'pause' ? 'T+1 量化已暂停' : 'T+1 清仓指令已提交')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'T+1 操作失败', 'down')
    } finally { setBusy(false) }
  }

  return (
    <section className="quant-desk">
      <div className="quant-hero">
        <div>
          <span className="quant-kicker"><FlaskConical size={12} /> T+1 股票量化</span>
          <h2>{strategy.data?.active?.name ?? '情绪锚 · 龙头跟随'}</h2>
          <p>只管理 T+1 股票范围；与 T+0 ETF 共用账户和交易接口，不共用交易规则。</p>
        </div>
        <span className={`quant-status ${auto.state?.status ?? 'idle'}`}>{auto.state?.status === 'running' ? '运行中' : auto.state?.status === 'waiting' ? '等待接口' : auto.state?.status === 'paused' ? '已暂停' : '未启动'}</span>
      </div>

      <div className="etf-auto-panel quant-auto-panel">
        <div className="etf-auto-head">
          <span className="etf-auto-kicker"><Activity size={11} /> T+1 自动执行</span>
          <b>{auto.state?.status === 'running' ? '运行中' : auto.state?.status === 'waiting' ? '等待接口' : auto.state?.status === 'paused' ? '已暂停' : '未启动'}</b>
          <p>{auto.state?.lastAction ?? 'T+1 未启动'}{auto.state?.lastError ? ` · ${auto.state.lastError}` : ''}{auto.state?.targetCode ? ` · 目标 ${auto.state.targetName} · 入场价 ${auto.state.entryPrice ?? '—'}` : ''}</p>
        </div>
        <div className="quant-actions">
          {running ? (
            <button type="button" className="etf-auto-pause" disabled={busy} onClick={() => void run('pause')}><Pause size={12} /> 暂停</button>
          ) : (
            <button type="button" className="etf-auto-start" disabled={busy || poolItems.length === 0 || !(broker.ok && broker.mode === 'live')} onClick={() => void run('start')}><Play size={12} /> 启动 T+1</button>
          )}
          <button type="button" className="etf-auto-flatten" onClick={() => setStrategyModalOpen(true)}>量化策略库</button>
          <button type="button" className="etf-auto-flatten" disabled={busy} onClick={() => setExecutionsOpen(true)}><ClipboardList size={12} /> 执行记录</button>
          <button type="button" className="etf-auto-flatten" disabled={busy} onClick={() => void refresh(true)}>刷新</button>
          <button type="button" className="etf-auto-flatten" disabled={busy || !running} onClick={() => void run('flatten')}><Trash2 size={12} /> 清仓</button>
        </div>
      </div>

      <TradingMetricStrip columns={4}>
        <TradingMetric label="情绪环境" value={`${signal.stage} · ${signal.score}`} sub={`${signal.regime === 'risk-on' ? '进攻' : signal.regime === 'risk-off' ? '防守' : '观望'} · 趋势 ${fmtSigned(signal.trend, 1)}`} />
        <TradingMetric label="T+1 股票池" value={`${poolItems.length} 只`} sub={quantPool?.codes.join(' · ') || '等待加入'} />
        <TradingMetric label="账户可用" value={broker.account ? `¥${fmtMoney(broker.account.cashAvailable)}` : '—'} sub="与 T+0 共用资金" />
        <TradingMetric label="T+1 持仓" value={`${positions.filter((p) => /^(0|3|6)\d{5}$/.test(p.symbol)).length} 只`} sub="按代码自动归属" />
      </TradingMetricStrip>

      <div className="etf-grid">
        <div className="etf-main">
          <div className="etf-scope">
            <div className="etf-scope-head"><span>T+1 交易范围</span><b>量化股票池 · {poolItems.length} 只</b><em>只做人工确认后的 T+1 股票；与 T+0 共用资金</em></div>
            <div className="etf-scope-chips">{poolItems.length ? poolItems.map((s) => <span key={s.code}>{s.code} {s.name}</span>) : <span>池为空</span>}</div>
          </div>

          <div className="quant-pool-tools">
            <TradingSectionHeader title="情绪锚浮现" meta="人工确认后加入" />
            {quant.error ? <div className="form-error">{quant.error}</div> : null}
            <div className="quant-suggestions">
              {suggestions.length === 0 ? <div className="etf-empty">暂无可浮现候选</div> : suggestions.map((c) => (
                <div className="quant-suggestion" key={c.code}>
                  <div><b>{c.name}</b><small>{c.code} · {c.source}</small><em>{c.reason || c.theme || '—'}</em></div>
                  <span className="mono">{c.price ? c.price.toFixed(2) : '—'}</span>
                  <span className={`mono ${c.pct >= 0 ? 'up' : 'down'}`}>{fmtPct(c.pct)}</span>
                  <span className={`quant-afford ${c.affordable ? 'ok' : 'no'}`}>{c.affordable ? '100股可买' : '100股不足'}</span>
                  <button type="button" className="etf-pool-btn" disabled={quant.busy} onClick={() => void quant.add(c.code).then(() => onToast(`已加入 ${c.code}`)).catch((err) => onToast(err instanceof Error ? err.message : '加入失败', 'down'))}><Plus size={11} /> 加入</button>
                </div>
              ))}
            </div>
            <form className="quant-manual-add" onSubmit={(e) => { e.preventDefault(); const code = manualCode.trim(); if (!code) return; void quant.add(code).then(() => { setManualCode(''); onToast(`已加入 ${code}`) }).catch((err) => onToast(err instanceof Error ? err.message : '加入失败', 'down')) }}>
              <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="手工输入 6 位股票代码" maxLength={6} />
              <button type="submit" className="etf-pool-btn" disabled={quant.busy}><Plus size={11} /> 手工加入</button>
            </form>
          </div>

          <div className="quant-stock-table">
            <TradingSectionHeader title="我的 T+1 股票池" meta="人工确认后生效" />
            <TradingTable
              rows={poolItems}
              rowKey={(s) => s.code}
              empty="T+1 池为空。先从情绪锚浮现中选择，或手工加入。"
              columns={[
                { key: 'stock', label: '股票', render: (s) => <><b>{s.name}</b><small>{s.code}</small></> },
                { key: 'price', label: '现价', className: 'mono', render: (s) => (s.price ? s.price.toFixed(2) : '—') },
                { key: 'pct', label: '涨跌', className: 'mono', render: (s) => <span className={s.pct >= 0 ? 'up' : 'down'}>{fmtPct(s.pct)}</span> },
                { key: 'strategy', label: '策略', render: (s) => <select className="quant-row-select" value={s.strategyId ?? ''} onChange={(e) => void quant.assign(s.code, e.target.value).then(() => onToast(`已指定 ${s.code} 策略`)).catch((err) => onToast(err instanceof Error ? err.message : '指定失败', 'down'))}><option value="">默认</option>{strategyLib.data?.strategies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> },
                { key: 'afford', label: '100股', render: (s) => <span className={`quant-afford ${s.affordable ? 'ok' : 'no'}`}>{s.affordable ? '可买' : '资金不足'}</span> },
                { key: 'action', label: '操作', render: (s) => <button type="button" className="quant-remove" disabled={quant.busy} onClick={() => void quant.remove(s.code).then(() => onToast(`已移除 ${s.code}`)).catch((err) => onToast(err instanceof Error ? err.message : '移除失败', 'down'))}><Trash2 size={11} /></button> },
              ]}
            />
          </div>
        </div>

        <aside className="etf-aside">
          <div className="etf-signal tone-flat">
            <TradingSectionHeader title="量化策略" meta={`${strategy.data?.active?.model ?? 'rule'} 模型`} />
            <div className="etf-signal-main"><span className="etf-signal-label">当前启用</span><b>{strategy.data?.active?.name ?? '—'}</b><small>{strategy.data?.active?.description ?? '在量化策略库中启用一个模型'}</small></div>
            <p>{activeDefinition ? activeDefinition.content.replace(/^#+\s*/gm, '').replace(/\n+/g, ' ').slice(0, 180) : '策略库中定义文字模型、回测并启用。'}</p>
            <div className="etf-signal-metrics">
              <div><span>最低分数</span><b>{strategy.data?.active?.minScore ?? '—'}</b></div>
              <div><span>单票</span><b>{strategy.data?.active?.positionPct ?? '—'}%</b></div>
              <div><span>最长持有</span><b>{strategy.data?.active?.maxHoldDays ?? '—'} 日</b></div>
            </div>
          </div>

          <div className="etf-rules-card">
            <TradingSectionHeader icon={<ShieldAlert size={12} />} title="T+1 规则" meta="独立于 T+0" />
            <div className="etf-rule-grid">
              <div><span>交易制度</span><b>T+1</b></div>
              <div><span>入场环境</span><b>{strategy.data?.active?.stages?.join('/') ?? '—'}</b></div>
              <div><span>止损</span><b>-{strategy.data?.active?.stopLossPct ?? '—'}%</b></div>
              <div><span>止盈</span><b>+{strategy.data?.active?.takeProfitPct ?? '—'}%</b></div>
              <div><span>买入截止</span><b>{strategy.data?.active?.entryCutoff ?? '—'}</b></div>
              <div><span>当日卖出</span><b>不允许</b></div>
            </div>
          </div>
        </aside>
      </div>

      <div className="quant-note"><ShieldAlert size={13} /> T+1 只交易人工确认的量化池；当日买入不可当日卖出，不沿用 ETF 的 14:55 清仓。</div>
      {executionsOpen ? <EtfExecutionModal onClose={() => setExecutionsOpen(false)} /> : null}
      {strategyModalOpen ? <QuantStrategyLibraryModal onClose={() => setStrategyModalOpen(false)} onToast={onToast} /> : null}
    </section>
  )
}



