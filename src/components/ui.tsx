import type { ReactNode } from 'react'
import { Star } from 'lucide-react'

export function SectionHeader({
  index,
  title,
  subtitle,
  right,
  dark = false,
}: {
  index: string
  title: string
  subtitle?: string
  right?: ReactNode
  dark?: boolean
}) {
  return (
    <div className={`section-head ${dark ? 'is-dark' : ''}`}>
      <div className="section-head-main">
        <span className="section-index">{index}</span>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {right ? <div className="section-head-right">{right}</div> : null}
    </div>
  )
}

export function Tag({
  children,
  tone = 'flat',
  soft = true,
}: {
  children: ReactNode
  tone?: 'up' | 'down' | 'flat' | 'warn' | 'gold'
  soft?: boolean
}) {
  return <span className={`tag tag-${tone} ${soft ? 'is-soft' : ''}`}>{children}</span>
}

export function StarButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: (e: React.MouseEvent) => void
  label?: string
}) {
  return (
    <button
      type="button"
      className={`star-btn ${active ? 'is-active' : ''}`}
      onClick={onClick}
      aria-label={label ?? (active ? '移出自选' : '加入自选')}
      title={label ?? (active ? '移出自选' : '加入自选')}
    >
      <Star size={13} strokeWidth={1.8} fill={active ? 'currentColor' : 'none'} />
    </button>
  )
}

export function MiniBar({ value, max = 100, tone = 'up' }: { value: number; max?: number; tone?: string }) {
  const pct = Math.max(2, Math.min(100, (value / max) * 100))
  return (
    <span className="mini-bar">
      <span className={`mini-bar-fill tone-${tone}`} style={{ width: `${pct}%` }} />
    </span>
  )
}

export function StatusDot({ state }: { state: 'live' | 'stale' | 'fallback' | 'error' }) {
  return <span className={`status-dot dot-${state}`} />
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>
}
