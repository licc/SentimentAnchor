export function fmtSigned(n?: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`
}

export function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export function fmtPrice(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toFixed(2)
  if (n >= 100) return n.toFixed(2)
  return n.toFixed(2)
}

export function fmtAmount(n?: number | null): string {
  if (!n || !Number.isFinite(n)) return '—'
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`
  if (n >= 1e8) return `${(n / 1e8).toFixed(0)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(0)}万`
  return `${Math.round(n)}`
}

export function fmtAmountPrecise(n?: number | null): string {
  if (!n || !Number.isFinite(n)) return '—'
  if (n >= 1e12) return `${(n / 1e12).toFixed(3)}万亿`
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  return `${Math.round(n)}`
}

export function fmtAmountDelta(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(abs / 1e12).toFixed(3)}万亿`
  if (abs >= 1e8) return `${(abs / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(abs / 1e4).toFixed(1)}万`
  return `${Math.round(abs)}`
}

export function fmtCount(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN')
}

export function toneOf(n: number): 'up' | 'down' | 'flat' {
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
}

export function cnDate(date: string): { date: string; weekday: string } {
  const d = new Date(`${date}T12:00:00+08:00`)
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'Asia/Shanghai' }).format(d)
  return { date, weekday }
}

export function timeOf(iso?: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

export function clockOf(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function stageTone(stage: string): 'up' | 'warn' | 'down' | 'flat' {
  if (stage === '高潮' || stage === '发酵' || stage === '修复') return 'up'
  if (stage === '分歧') return 'warn'
  if (stage === '退潮' || stage === '冰点') return 'down'
  return 'flat'
}

export function riskTone(risk: string): 'up' | 'warn' | 'down' {
  return risk === '高' ? 'down' : risk === '中' ? 'warn' : 'up'
}

export function fmtMarketCap(n?: number | null): string {
  if (!n || !Number.isFinite(n)) return '—'
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`
  if (n >= 1e8) return `${(n / 1e8).toFixed(0)}亿`
  return `${Math.round(n / 1e4)}万`
}

export function fmtMoney(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })
}
