import { AlertTriangle, Save, ShieldCheck, ShieldOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RiskConfig } from '../../shared/types'
import { useRisk } from '../hooks/useRisk'
import { TradingMetric, TradingMetricStrip, TradingSectionHeader } from './trading-ui'
import { useKillSwitch } from '../hooks/useKillSwitch'
import { useCoordinator } from '../hooks/useCoordinator'
import { useSystemHealth } from '../hooks/useSystemHealth'
import { LedgerModal } from './LedgerModal'
import { RiskPolicyModal } from './RiskPolicyModal'
import { fmtMoney, timeOf } from '../lib/format'

export function RiskCenter({ onToast }: { onToast: (message: string, tone?: 'up' | 'down') => void }) {
  const risk = useRisk()
  const kill = useKillSwitch()
  const coord = useCoordinator()
  const health = useSystemHealth()
  const [form, setForm] = useState<RiskConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)

  useEffect(() => {
    if (risk.status?.config) setForm(risk.status.config)
  }, [risk.status?.config])

  async function save() {
    if (!form) return
    setBusy(true)
    try { await risk.save(form); onToast('风控配置已保存') } catch (err) { onToast(err instanceof Error ? err.message : '保存失败', 'down') } finally { setBusy(false) }
  }

  if (!form) return <section className="risk-center"><div className="etf-empty">{risk.error ?? '加载风控…'}</div></section>
  const status = risk.status

  return (
    <section className="risk-center">
      <div className="risk-head">
        <div>
          <span className="quant-kicker"><ShieldCheck size={12} /> 风控中心</span>
          <h2>买入拦截 + 止损</h2>
          <p>所有买入指令在下发券商前经过统一风控；止损独立监控持仓，卖出仍走统一券商通道。</p>
        </div>
        <div className="risk-head-badges"><span className={`risk-badge ${form.enabled ? 'on' : 'off'}`}>{form.enabled ? '风控启用' : '风控关闭'}</span><span className={`risk-badge ${kill.state?.active ? 'off' : 'on'}`}>{kill.state?.active ? '系统急停中' : '系统正常'}</span></div>
      </div>

      <TradingMetricStrip columns={5}>
        <TradingMetric label="今日拦截" value={status?.blockedToday ?? 0} />
        <TradingMetric label="今日止损事件" value={status?.stopToday ?? 0} />
        <TradingMetric label="最近买入检查" value={status?.lastCheckAt ? timeOf(status.lastCheckAt) : '—'} />
        <TradingMetric label="最近止损扫描" value={status?.lastStopCheckAt ? timeOf(status.lastStopCheckAt) : '—'} />
        <TradingMetric label="自动止损" value={form.stop.autoExecute ? '执行' : '只告警'} />
      </TradingMetricStrip>

      <div className="risk-health-line">
        <span>系统健康 <b className={health?.ok ? 'up' : 'down'}>{health?.ok ? '正常' : '异常'}</b></span>
        <span>快照刷新 {health?.snapshot ? `${Math.round(health.snapshot.ageMs / 1000)}s` : '—'}</span>
        <span>券商 {health?.broker?.ok ? '在线' : '异常'}</span>
        <span>订单意图 {health?.intents.active ?? 0}</span>
        <span>账本 订单 {health?.ledger.orders ?? 0} / 成交 {health?.ledger.fills ?? 0}</span>
        <span>自动 T0 {health?.auto?.t0?.status ?? '—'} / T1 {health?.auto?.t1?.status ?? '—'}</span>
        <span className={`health-alert ${health?.alerts?.length ? 'has' : ''}`}>{health?.alerts?.length ? health.alerts.join(' · ') : '无告警'}</span>
      </div>

      <div className="risk-grid">
        <div className="risk-panel">
          <TradingSectionHeader variant="quant" icon={<ShieldCheck size={12} />} title="买入风控编排" meta="规则与参数统一在编排中管理" />
          <p className="risk-policy-note">买入前置规则、阈值、拦截/告警和作用范围已迁移到“风控编排”。这里不再维护第二套固定参数。</p>
          <div className="risk-actions"><button type="button" className="quant-btn-primary" onClick={() => setPolicyOpen(true)}>打开风控编排</button></div>
        </div>

        <div className="risk-panel">
          <TradingSectionHeader variant="quant" icon={<AlertTriangle size={12} />} title="止损监控" meta="走统一交易通道" />
          <div className="risk-form">
            <label>止损模式<select value={form.stop.mode} onChange={(e) => setForm({ ...form, stop: { ...form.stop, mode: e.target.value as 'fixed' | 'trailing' } })}><option value="fixed">固定止损</option><option value="trailing">移动止损</option></select></label>
            <label>止损线 %<input type="number" step="0.1" value={form.stop.thresholdPct} onChange={(e) => setForm({ ...form, stop: { ...form.stop, thresholdPct: Number(e.target.value) } })} /></label>
            <label>移动回撤 %<input type="number" step="0.1" value={form.stop.trailingPct} onChange={(e) => setForm({ ...form, stop: { ...form.stop, trailingPct: Number(e.target.value) } })} /></label>
            <label>扫描间隔 秒<input type="number" value={form.stop.checkIntervalSec} onChange={(e) => setForm({ ...form, stop: { ...form.stop, checkIntervalSec: Number(e.target.value) } })} /></label>
            <label className="risk-check"><input type="checkbox" checked={form.stop.enabled} onChange={(e) => setForm({ ...form, stop: { ...form.stop, enabled: e.target.checked } })} /> 启用止损扫描</label>
            <label className="risk-check"><input type="checkbox" checked={form.stop.autoExecute} onChange={(e) => setForm({ ...form, stop: { ...form.stop, autoExecute: e.target.checked } })} /> 自动卖出（否则只告警）</label>
            <label className="risk-check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> 总风控开关</label>
          </div>
          <div className="risk-warning"><ShieldOff size={13} /> 自动止损关闭时只记录告警，不会发卖单；T+1 当日买入 available=0 时无法卖出。</div>
        </div>
      </div>

      <div className="risk-panel">
        <TradingSectionHeader variant="quant" title="策略资金额度" meta="与 T+0 / T+1 共用账户" />
        {coord.config ? <div className="risk-form"><label>T+0 最大仓位 %<input type="number" value={coord.config.t0MaxPct} onChange={(e) => void coord.save({ ...coord.config!, t0MaxPct: Number(e.target.value) })} /></label><label>T+1 最大仓位 %<input type="number" value={coord.config.t1MaxPct} onChange={(e) => void coord.save({ ...coord.config!, t1MaxPct: Number(e.target.value) })} /></label><label>账户总仓位 %<input type="number" value={coord.config.accountMaxPct} onChange={(e) => void coord.save({ ...coord.config!, accountMaxPct: Number(e.target.value) })} /></label><label>现金保留 ¥<input type="number" value={coord.config.reserveCash} onChange={(e) => void coord.save({ ...coord.config!, reserveCash: Number(e.target.value) })} /></label><label>开仓优先级<select value={coord.config.priority} onChange={(e) => void coord.save({ ...coord.config!, priority: e.target.value as 't0' | 't1' | 'equal' })}><option value="equal">先到先得</option><option value="t0">T+0 优先</option><option value="t1">T+1 优先</option></select></label></div> : null}
      </div>

      <div className="risk-health-line">
        <span>T+0 使用 <b>{coord.status ? `${coord.status.t0.pct.toFixed(1)}% / ${coord.status.config.t0MaxPct}%` : '—'}</b></span>
        <span>T+1 使用 <b>{coord.status ? `${coord.status.t1.pct.toFixed(1)}% / ${coord.status.config.t1MaxPct}%` : '—'}</b></span>
        <span>账户仓位 <b>{coord.status ? `${coord.status.accountExposure.pct.toFixed(1)}% / ${coord.status.config.accountMaxPct}%` : '—'}</b></span>
        <span>剩余额度 <b>{coord.status ? `¥${fmtMoney(coord.status.accountExposure.remaining)}` : '—'}</b></span>
      </div>

      <div className="risk-actions">{kill.state?.active ? <button type="button" className="quant-btn-quiet" onClick={() => void kill.clear().then(() => onToast('急停已解除'))}>解除急停</button> : <button type="button" className="quant-btn-danger" onClick={() => { if (window.confirm('急停会暂停 T+0/T+1 自动执行，并阻止所有买入；确认?')) void kill.activate('手动急停').then(() => onToast('系统已急停')).catch((err) => onToast(err instanceof Error ? err.message : '急停失败', 'down')) }}>紧急停止</button>}<button type="button" className="quant-btn-quiet" onClick={() => setLedgerOpen(true)}>交易账本</button><button type="button" className="quant-btn-primary" disabled={busy} onClick={() => void save()}><Save size={12} /> 保存风控配置</button></div>

      <div className="risk-panel">
        <TradingSectionHeader variant="quant" title="风控事件" meta="最近 100 条 · 保存在 data/risk-events.json" />
        <div className="risk-decisions">
          {(status?.decisions ?? []).length === 0 ? <div className="etf-empty">暂无风控事件</div> : status?.decisions.map((d) => (
            <div className="risk-decision" key={d.id}>
              <span className={`risk-kind ${d.kind}`}>{d.kind === 'buy' ? '买入' : d.kind === 'stop' ? '止损' : '止损拦截'}</span>
              <b>{d.symbol}</b>
              <em>{d.side} {d.quantity} · {d.price?.toFixed(3)}</em>
              <span>{d.source}</span>
              <span className={`risk-result ${d.status}`}>{d.status === 'blocked' ? '拦截' : d.status === 'alert' ? '告警' : d.status}</span>
              <p>{d.reasons.join('；') || d.note || '通过'}</p>
              <time>{timeOf(d.time)}</time>
            </div>
          ))}
        </div>
      </div>
      {policyOpen ? <RiskPolicyModal onClose={() => setPolicyOpen(false)} onChanged={() => void risk.refresh()} /> : null}
      {ledgerOpen ? <LedgerModal onClose={() => setLedgerOpen(false)} /> : null}
    </section>
  )
}
