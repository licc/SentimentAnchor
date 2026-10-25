import { Save, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSystemConfig } from '../hooks/useSystemConfig'
import { getBackupStatus, getNotifyConfig, runBackupNow, saveBackupConfig, saveNotifyConfig, testNotify } from '../api'
import { Modal } from './Modals'
import { getPitDates, getPitSnapshot, testBrokerConnection } from '../api'

export function SystemSettingsModal({ onClose, onToast }: { onClose: () => void; onToast: (message: string, tone?: 'up' | 'down') => void }) {
  const cfg = useSystemConfig()
  const [brokerUrl, setBrokerUrl] = useState('')
  const [brokerKey, setBrokerKey] = useState('')
  const [orderTimeoutMs, setOrderTimeoutMs] = useState(20_000)
  const [statusTtlMs, setStatusTtlMs] = useState(8_000)
  const [maxManualOrderAmount, setMaxManualOrderAmount] = useState(50_000)
  const [backup, setBackup] = useState<Awaited<ReturnType<typeof getBackupStatus>> | null>(null)
  const [notifyCfg, setNotifyCfg] = useState<Awaited<ReturnType<typeof getNotifyConfig>> | null>(null)
  const [notifyToken, setNotifyToken] = useState('')
  const [notifyWebhook, setNotifyWebhook] = useState('')
  const [busyExtra, setBusyExtra] = useState(false)
  const [clearKey, setClearKey] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [pitDates, setPitDates] = useState<string[]>([])
  const [pitDate, setPitDate] = useState('')
  const [pit, setPit] = useState<Awaited<ReturnType<typeof getPitSnapshot>> | null>(null)

  useEffect(() => {
    void getBackupStatus().then(setBackup).catch(() => undefined)
    void getNotifyConfig().then((n) => { setNotifyCfg(n); setNotifyWebhook(n.webhookUrl) }).catch(() => undefined)
  }, [])

  useEffect(() => { void getPitDates().then((d) => { setPitDates(d.dates); if (d.dates[0]) setPitDate(d.dates[0]) }).catch(() => undefined) }, [])
  useEffect(() => { if (pitDate) void getPitSnapshot(pitDate).then(setPit).catch(() => setPit(null)) }, [pitDate])
  useEffect(() => {
    if (!cfg.config) return
    setBrokerUrl(cfg.config.brokerUrl)
    setOrderTimeoutMs(cfg.config.orderTimeoutMs)
    setStatusTtlMs(cfg.config.statusTtlMs)
    setMaxManualOrderAmount(cfg.config.maxManualOrderAmount)
  }, [cfg.config])

  async function save() {
    try {
      await cfg.save({ brokerUrl, brokerKey: brokerKey || undefined, clearBrokerKey: clearKey, orderTimeoutMs, statusTtlMs, maxManualOrderAmount })
      setBrokerKey(''); setClearKey(false)
      onToast('系统配置已保存，下一笔请求生效')
    } catch (err) { onToast(err instanceof Error ? err.message : '保存失败', 'down') }
  }

  return (
    <Modal title="系统设置" subtitle="交易接口和人工下单上限；保存后下一笔请求生效，不需要重启" onClose={onClose} width={680}>
      <div className="settings-section">
        <div className="quant-section-head"><span><ShieldCheck size={12} /> 交易接口</span><em>Windows 上的 thsapi</em></div>
        <div className="settings-form">
          <label>接口地址<input value={brokerUrl} onChange={(e) => setBrokerUrl(e.target.value)} placeholder="http://127.0.0.1:8888" /></label>
          <label>API Key<input type="password" value={brokerKey} onChange={(e) => setBrokerKey(e.target.value)} placeholder={cfg.config?.brokerKeyConfigured ? cfg.config.brokerKeyMasked : '未配置'} /></label>
          <label>下单超时 ms<input type="number" min="5000" max="120000" step="1000" value={orderTimeoutMs} onChange={(e) => setOrderTimeoutMs(Number(e.target.value))} /></label>
          <label>状态缓存 ms<input type="number" min="1000" max="60000" step="1000" value={statusTtlMs} onChange={(e) => setStatusTtlMs(Number(e.target.value))} /></label>
          <label className="settings-wide">人工单笔上限 ¥<input type="number" min="100" step="1000" value={maxManualOrderAmount} onChange={(e) => setMaxManualOrderAmount(Number(e.target.value))} /></label>
        </div>
        <div className="auto-settings-note">接口地址只保存在服务端 data/runtime-config.json。API Key 可留空；留空表示保持原值，勾选“清除已保存 Key”才会删除。当前请求只会在 Key 非空时发送 X-API-Key。</div>
        <div className="broker-test-row"><label className="risk-check"><input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> 清除已保存 Key</label><button type="button" className="quant-btn-quiet" disabled={testing} onClick={() => { setTesting(true); setTestResult(null); void testBrokerConnection().then((r) => setTestResult(r.ok ? `连接成功 · HTTP ${r.status} · Key ${r.keySent ? '已发送' : '未发送'}` : `连接失败 · ${r.error ?? `HTTP ${r.status}`} · Key ${r.keySent ? '已发送' : '未发送'}`)).catch((err) => setTestResult(err instanceof Error ? err.message : '测试失败')).finally(() => setTesting(false)) }}>{testing ? '测试中…' : '测试接口'}</button>{testResult ? <em className={testResult.startsWith('连接成功') ? 'up' : 'down'}>{testResult}</em> : null}</div>
      </div>
      <div className="settings-section">
        <div className="quant-section-head"><span>历史快照</span><em>Point-in-time 股票池 · 部署后逐日积累</em></div>
        {pitDates.length ? <div className="pit-viewer"><select value={pitDate} onChange={(e) => setPitDate(e.target.value)}>{pitDates.map((d) => <option key={d} value={d}>{d}</option>)}</select>{pit ? <div><span>{pit.stage} · {pit.score} 分 · 外围 {pit.foreignFear ?? '—'}</span><b>{pit.stocks.length} 只当日可见标的</b><em>{pit.stocks.filter((x) => x.st).length} 只 ST</em></div> : null}</div> : <div className="auto-settings-note">尚无历史快照；每个交易日首次有效行情后自动记录。</div>}
      </div>
      {cfg.error ? <div className="form-error">{cfg.error}</div> : null}
      <div className="settings-section">
        <div className="quant-section-head"><span>自动备份</span><em>JSON + SQLite</em></div>
        {backup ? <div className="settings-form"><label>启用<select value={backup.config.enabled ? 'on' : 'off'} onChange={(e) => { const enabled = e.target.value === 'on'; setBackup({ ...backup, config: { ...backup.config, enabled } }); void saveBackupConfig({ ...backup.config, enabled }) }}><option value="on">开启</option><option value="off">关闭</option></select></label><label>间隔 小时<input type="number" min="1" max="168" value={backup.config.intervalHours} onChange={(e) => { const intervalHours = Number(e.target.value); setBackup({ ...backup, config: { ...backup.config, intervalHours } }); void saveBackupConfig({ ...backup.config, intervalHours }) }} /></label><label>保留份数<input type="number" min="1" max="60" value={backup.config.keep} onChange={(e) => { const keep = Number(e.target.value); setBackup({ ...backup, config: { ...backup.config, keep } }); void saveBackupConfig({ ...backup.config, keep }) }} /></label><label>最近备份<input readOnly value={backup.config.lastAt ? new Date(backup.config.lastAt).toLocaleString() : '尚未备份'} /></label></div> : null}
        <div className="settings-inline"><button type="button" className="quant-btn-quiet" disabled={busyExtra} onClick={() => void runBackupNow().then(() => getBackupStatus().then(setBackup)).then(() => onToast('备份已创建')).catch(() => onToast('备份失败', 'down'))}>立即备份</button><span>{backup?.backups.length ? `${backup.backups.length} 份本地备份` : '暂无备份'}</span></div>
      </div>

      <div className="settings-section">
        <div className="quant-section-head"><span>手机告警</span><em>Server酱 / PushPlus / Webhook</em></div>
        {notifyCfg ? <div className="settings-form"><label>启用<select value={notifyCfg.enabled ? 'on' : 'off'} onChange={(e) => setNotifyCfg({ ...notifyCfg, enabled: e.target.value === 'on' })}><option value="on">开启</option><option value="off">关闭</option></select></label><label>通道<select value={notifyCfg.provider} onChange={(e) => setNotifyCfg({ ...notifyCfg, provider: e.target.value as typeof notifyCfg.provider })}><option value="serverchan">Server酱</option><option value="pushplus">PushPlus</option><option value="webhook">Webhook</option></select></label><label>Token<input type="password" value={notifyToken} onChange={(e) => setNotifyToken(e.target.value)} placeholder={notifyCfg.tokenConfigured ? notifyCfg.token : '未配置'} /></label><label className="settings-wide">Webhook URL<input value={notifyWebhook} onChange={(e) => setNotifyWebhook(e.target.value)} placeholder="https://..." /></label></div> : null}
        <div className="settings-inline"><button type="button" className="quant-btn-quiet" disabled={busyExtra || !notifyCfg} onClick={() => { setBusyExtra(true); void saveNotifyConfig({ enabled: notifyCfg!.enabled, provider: notifyCfg!.provider, token: notifyToken || undefined, webhookUrl: notifyWebhook }).then((next) => { setNotifyCfg(next); setNotifyToken(''); onToast('手机告警配置已保存') }).catch(() => onToast('通知配置保存失败', 'down')).finally(() => setBusyExtra(false)) }}>保存告警</button><button type="button" className="quant-btn-quiet" disabled={busyExtra} onClick={() => { setBusyExtra(true); void testNotify().then((r) => onToast(r.ok ? '测试通知已发送' : r.error || '发送失败', r.ok ? 'up' : 'down')).finally(() => setBusyExtra(false)) }}>测试通知</button></div>
      </div>

      <div className="settings-actions"><button type="button" className="quant-btn-primary" disabled={cfg.busy} onClick={() => void save()}><Save size={12} /> 保存配置</button></div>
    </Modal>
  )
}
