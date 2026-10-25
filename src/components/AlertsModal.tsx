import { AlertTriangle, Bell, Check, BellRing, Save, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AlertConfig, AlertEvent, AlertPayload } from '../../shared/types'
import { timeOf } from '../lib/format'
import { Modal } from './Modals'

export function AlertsModal({
  payload,
  onClose,
  onSave,
  onRead,
  onRefresh,
}: {
  payload: AlertPayload | null
  onClose: () => void
  onSave: (config: Partial<AlertConfig>) => Promise<unknown>
  onRead: (ids?: string[]) => Promise<unknown>
  onRefresh: () => Promise<void>
}) {
  const [rules, setRules] = useState(payload?.config.rules ?? [])
  const [webhookUrl, setWebhookUrl] = useState(payload?.config.webhookUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')

  useEffect(() => {
    if (!payload) return
    setRules(payload.config.rules)
    setWebhookUrl(payload.config.webhookUrl)
  }, [payload])

  async function save() {
    setSaving(true)
    try {
      await onSave({ rules, webhookUrl })
      setNotice('预警规则已保存，下一轮行情生效')
      setTimeout(() => setNotice(null), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function enableBrowser() {
    if (typeof Notification === 'undefined') {
      setNotice('当前浏览器不支持系统通知')
      return
    }
    const p = await Notification.requestPermission()
    setPermission(p)
    setNotice(p === 'granted' ? '浏览器通知已开启' : '浏览器通知未授权')
  }

  async function readAll() {
    await onRead()
  }

  return (
    <Modal title="预警中心" subtitle="规则命中后通过页面提醒、浏览器通知和 Webhook 推送" onClose={onClose} width={760}>
      <div className="alert-toolbar">
        <span className={`alert-browser-state is-${permission}`}>
          {permission === 'granted' ? <BellRing size={13} /> : <Bell size={13} />}
          {permission === 'granted' ? '浏览器通知已开启' : permission === 'denied' ? '浏览器通知被拒绝' : '浏览器通知未开启'}
        </span>
        <button type="button" className="ai-btn" onClick={() => void enableBrowser()}>
          {permission === 'granted' ? '重新授权' : '开启通知'}
        </button>
        <button type="button" className="ai-btn" onClick={() => void readAll()}>
          全部标记已读
        </button>
      </div>

      <div className="alert-config">
        <div className="alert-section-title"><ShieldAlert size={13} /> 触发规则</div>
        <div className="alert-rule-list">
          {rules.map((rule) => (
            <div className={`alert-rule ${rule.enabled ? 'is-on' : ''}`} key={rule.id}>
              <label className="alert-check">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: e.target.checked } : r))}
                />
                <span><Check size={10} /></span>
              </label>
              <div className="alert-rule-main">
                <b>{rule.label}</b>
                <p>{rule.description}</p>
              </div>
              <div className="alert-rule-threshold">
                <input
                  type="number"
                  value={rule.threshold}
                  step={rule.unit === '%' ? 0.5 : 1}
                  onChange={(e) => setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, threshold: Number(e.target.value) } : r))}
                />
                <span>{rule.unit}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="alert-webhook">
          <label htmlFor="webhook">Webhook URL（可选）</label>
          <input id="webhook" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://qyapi.weixin.qq.com/... 或自定义接收地址" />
          <span>命中时 POST {`{ source, events }`}，5s 超时，失败不阻塞行情。</span>
        </div>
        <div className="alert-save-row">
          <span>{notice ?? '规则每 10s 随快照评估一次，冷却：同一规则触发后需条件解除才会再次提醒。'}</span>
          <button type="button" className="ai-btn ai-btn-deep" onClick={() => void save()} disabled={saving}>
            <Save size={12} /> {saving ? '保存中' : '保存规则'}
          </button>
        </div>
      </div>

      <div className="alert-history">
        <div className="alert-section-title">
          <Bell size={13} /> 预警记录
          <button type="button" className="alert-refresh" onClick={() => void onRefresh()}>刷新</button>
        </div>
        {payload?.events.length ? payload.events.map((e) => <AlertRow event={e} key={e.id} />) : (
          <div className="alert-empty">当前没有预警记录。规则触发后会出现在这里，并同步到右上角铃铛。</div>
        )}
      </div>
    </Modal>
  )
}

function AlertRow({ event }: { event: AlertEvent }) {
  return (
    <div className={`alert-row level-${event.level} ${event.read ? 'is-read' : ''}`}>
      <span className="alert-level"><AlertTriangle size={12} /></span>
      <div className="alert-row-main">
        <div><b>{event.title}</b>{!event.read ? <i /> : null}</div>
        <p>{event.detail}</p>
      </div>
      <span className="alert-time mono">{timeOf(event.createdAt)}</span>
    </div>
  )
}

export function notifyBrowser(event: AlertEvent) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification(`情绪锚 · ${event.title}`, { body: event.detail, tag: event.id })
  } catch {
    // Notification construction can fail in some webviews.
  }
}
