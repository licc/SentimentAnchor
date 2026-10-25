import fs from 'node:fs'
import path from 'node:path'

export interface NotifyConfig { enabled: boolean; provider: 'serverchan' | 'pushplus' | 'webhook'; token: string; webhookUrl: string; updatedAt: string }
const FILE = path.join(process.cwd(), 'data', 'notify-config.json')
let config: NotifyConfig = load()

export function getNotifyConfig() { return { ...config, token: config.token ? `${config.token.slice(0, 4)}••••` : '', tokenConfigured: Boolean(config.token) } }
export function saveNotifyConfig(input: Partial<NotifyConfig> & { token?: string }) {
  config = {
    enabled: input.enabled ?? config.enabled,
    provider: ['serverchan', 'pushplus', 'webhook'].includes(String(input.provider)) ? input.provider as NotifyConfig['provider'] : config.provider,
    token: typeof input.token === 'string' && input.token.trim() ? input.token.trim() : config.token,
    webhookUrl: String(input.webhookUrl ?? config.webhookUrl).trim(),
    updatedAt: new Date().toISOString(),
  }
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(config, null, 2)) } catch { /* best effort */ }
  return getNotifyConfig()
}
export async function sendNotification(title: string, content: string): Promise<{ ok: boolean; error?: string }> {
  if (!config.enabled) return { ok: false, error: '通知未启用' }
  try {
    if (config.provider === 'serverchan') {
      if (!config.token) throw new Error('未配置 Server酱 token')
      const res = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(config.token)}.send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, desp: content }), signal: AbortSignal.timeout(8_000) })
      if (!res.ok) throw new Error(`Server酱 HTTP ${res.status}`)
    } else if (config.provider === 'pushplus') {
      if (!config.token) throw new Error('未配置 PushPlus token')
      const res = await fetch('https://www.pushplus.plus/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: config.token, title, content, template: 'txt' }), signal: AbortSignal.timeout(8_000) })
      if (!res.ok) throw new Error(`PushPlus HTTP ${res.status}`)
    } else {
      if (!config.webhookUrl) throw new Error('未配置 Webhook')
      const res = await fetch(config.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'sentiment-anchor', title, content }), signal: AbortSignal.timeout(8_000) })
      if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`)
    }
    return { ok: true }
  } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) } }
}
function load(): NotifyConfig {
  try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as NotifyConfig; return { enabled: Boolean(raw.enabled), provider: raw.provider || 'serverchan', token: raw.token || '', webhookUrl: raw.webhookUrl || '', updatedAt: raw.updatedAt || new Date().toISOString() } } catch { return { enabled: false, provider: 'serverchan', token: '', webhookUrl: '', updatedAt: new Date().toISOString() } }
}
