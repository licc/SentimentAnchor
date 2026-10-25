import { ArrowUpRight, Pin, Star } from 'lucide-react'
import type { Anchor, Stock } from '../../shared/types'
import { fmtPrice, fmtSigned, toneOf } from '../lib/format'
import { SectionHeader, StarButton, Tag } from './ui'

export function AnchorGrid({
  anchors,
  watchlist,
  watchCodes,
  onToggleWatch,
  onOpenStock,
  onOpenWatchlist,
}: {
  anchors: Anchor[]
  watchlist: Stock[]
  watchCodes: string[]
  onToggleWatch: (stock: Stock) => void
  onOpenStock: (stock: Stock, role?: string) => void
  onOpenWatchlist: () => void
}) {
  return (
    <section className="anchors section" id="anchors">
      <SectionHeader
        index="01"
        title="今日情绪锚"
        subtitle="空间、换手、容量、回封、亏钱效应，一眼定位盘面锚点"
        right={
          <div className="anchor-legend">
            <span><i className="legend-dot up" />赚钱效应</span>
            <span><i className="legend-dot down" />亏钱效应</span>
            <span className="anchor-count"><Pin size={12} /> {anchors.length} 个锚点</span>
          </div>
        }
      />
      <div className="anchor-grid">
        {anchors.map((anchor, idx) => {
          const tone = toneOf(anchor.stock.pct)
          const inWatch = watchCodes.includes(anchor.stock.code)
          return (
            <article
              key={anchor.id}
              className={`anchor-card tone-${tone}`}
              role="button"
              tabIndex={0}
              onClick={() => onOpenStock(anchor.stock, anchor.role)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpenStock(anchor.stock, anchor.role)
                }
              }}
            >
              <div className="anchor-top">
                <span className="anchor-role">
                  <b>{String(idx + 1).padStart(2, '0')}</b>
                  {anchor.role}
                </span>
                <StarButton
                  active={inWatch}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleWatch(anchor.stock)
                  }}
                />
              </div>
              <div className={`anchor-pct mono tone-text-${tone}`}>{fmtSigned(anchor.stock.pct)}%</div>
              <div className="anchor-name-row">
                <span className="anchor-name">{anchor.stock.name}</span>
                <span className="anchor-code mono">{anchor.stock.code}</span>
              </div>
              <div className="anchor-label">{anchor.label}</div>
              <p className="anchor-reason">{anchor.reason}</p>
              <div className="anchor-bottom">
                <span className="mono">{fmtPrice(anchor.stock.price)}</span>
                <span className="anchor-open">
                  观察 <ArrowUpRight size={11} />
                </span>
              </div>
            </article>
          )
        })}
      </div>

      <div className="watch-strip">
        <div className="watch-strip-head">
          <span>
            <Star size={13} /> 自定义锚定池
          </span>
          <button type="button" onClick={onOpenWatchlist}>
            管理
          </button>
        </div>
        {watchlist.length ? (
          <div className="watch-chips">
            {watchlist.map((s) => (
              <div
                className={`watch-chip tone-${toneOf(s.pct)}`}
                key={s.code}
                role="button"
                tabIndex={0}
                onClick={() => onOpenStock(s, '自选')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpenStock(s, '自选')
                  }
                }}
              >
                <span>{s.name}</span>
                <b className="mono">{fmtSigned(s.pct)}%</b>
                <button
                  type="button"
                  className="chip-star"
                  aria-label={`移出自选 ${s.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleWatch(s)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <button type="button" className="watch-empty" onClick={onOpenWatchlist}>
            <span className="watch-empty-plus">+</span>
            添加你真正盯的票（代码 / 名称），纳入 10s 刷新
          </button>
        )}
      </div>
    </section>
  )
}
