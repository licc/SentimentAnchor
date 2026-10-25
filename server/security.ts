import { timingSafeEqual } from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'

export function authToken(): string {
  return process.env.APP_TOKEN || ''
}

export function authRequired(): boolean {
  return Boolean(authToken())
}

export function tokenMatches(value: string | undefined): boolean {
  const expected = authToken()
  if (!expected || !value) return false
  const a = Buffer.from(value)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const chunk of (header ?? '').split(';')) {
    const idx = chunk.indexOf('=')
    if (idx < 0) continue
    const k = chunk.slice(0, idx).trim()
    const v = chunk.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

export async function assertSafeWebhookUrl(raw: string): Promise<string> {
  const value = raw.trim()
  if (!value) return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Webhook URL 格式不正确')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook 只支持 http/https')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') {
    throw new Error('Webhook 不能指向本机或内网')
  }
  const literal = net.isIP(host)
  if (literal) {
    if (isPrivateIp(host)) throw new Error('Webhook 不能指向内网地址')
    return url.toString()
  }
  let addresses: { address: string }[]
  try {
    addresses = await dns.lookup(host, { all: true })
  } catch {
    throw new Error('Webhook 域名无法解析')
  }
  if (addresses.some((a) => isPrivateIp(a.address))) throw new Error('Webhook 不能解析到内网地址')
  return url.toString()
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number)
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true
    if (p[0] === 169 && p[1] === 254) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true
    return false
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase()
    if (s === '::1' || s === '::' || s.startsWith('fe80:') || s.startsWith('fc') || s.startsWith('fd')) return true
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7))
    return false
  }
  return true
}
