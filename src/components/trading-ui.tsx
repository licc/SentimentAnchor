import type { ReactNode } from 'react'

/** Shared trading-page primitives. Keep class names stable so existing CSS still applies. */
export function TradingSectionHeader({
  title,
  meta,
  icon,
  variant = 'etf',
}: {
  title: ReactNode
  meta?: ReactNode
  icon?: ReactNode
  variant?: 'etf' | 'quant'
}) {
  const cls = variant === 'quant' ? 'quant-section-head' : 'etf-subhead'
  return (
    <div className={cls}>
      <span>{icon}{title}</span>
      {meta ? <span>{meta}</span> : null}
    </div>
  )
}

export function TradingMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'up' | 'down' | 'flat'
}) {
  return (
    <div className="trading-metric">
      <span>{label}</span>
      <b className={tone ? tone : undefined}>{value}</b>
      {sub ? <em>{sub}</em> : null}
    </div>
  )
}

export function TradingStatusBadge({ tone = 'flat', children }: { tone?: 'up' | 'down' | 'warn' | 'flat'; children: ReactNode }) {
  return <span className={`trading-status trading-status-${tone}`}>{children}</span>
}

export function TradingEmpty({ children }: { children: ReactNode }) {
  return <div className="etf-empty">{children}</div>
}
export function TradingMetricStrip({ columns = 4, children }: { columns?: number; children: ReactNode }) {
  return <div className="trading-metric-strip" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{children}</div>
}

export interface TradingColumn<T> {
  key: string
  label: ReactNode
  className?: string
  render: (row: T) => ReactNode
}

export function TradingTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  empty = '暂无数据',
  className = '',
}: {
  columns: TradingColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  rowClassName?: (row: T, index: number) => string
  empty?: string
  className?: string
}) {
  if (rows.length === 0) return <TradingEmpty>{empty}</TradingEmpty>
  return (
    <div className={`trading-table ${className}`}>
      <table>
        <thead><tr>{columns.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={rowKey(row, i)} className={rowClassName?.(row, i)}>{columns.map((c) => <td key={c.key} className={c.className}>{c.render(row)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
