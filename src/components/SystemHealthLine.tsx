import { useSystemHealth } from '../hooks/useSystemHealth'

export function SystemHealthLine() {
  const health = useSystemHealth()
  if (!health) return null
  const alerts = health.alerts ?? []
  return (
    <div className={`shared-health-line ${health.ok && alerts.length === 0 ? '' : 'has-alert'}`}>
      <span>系统 <b>{health.ok ? '正常' : '异常'}</b></span>
      <span>快照刷新 {health.snapshot ? `${Math.round(health.snapshot.ageMs / 1000)}s` : '—'}</span>
      <span>订单意图 {health.intents.active}</span>
      <span>账本 {health.ledger.orders}/{health.ledger.fills}</span>
      <span>T0 {health.coordinator ? `${health.coordinator.t0.pct.toFixed(1)}%` : '—'} · T1 {health.coordinator ? `${health.coordinator.t1.pct.toFixed(1)}%` : '—'}</span>
      <span className={alerts.length ? 'down' : ''}>{alerts.length ? alerts.join(' · ') : '无告警'}</span>
      <span>急停 {health.killSwitch.active ? '开启' : '关闭'}</span>
    </div>
  )
}
