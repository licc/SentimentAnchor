import { ArrowDownRight, ArrowUpRight, Clock3, Star, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Stock } from '../../shared/types'
import { fmtAmount, fmtMarketCap, fmtPct, fmtPrice, fmtSigned, toneOf } from '../lib/format'
import { getCorporateActions, getStockAnnouncements } from '../api'
import { Tag } from './ui'

export function StockDrawer({
  stock,
  role,
  watched,
  onClose,
  onToggle,
}: {
  stock: Stock
  role?: string
  watched: boolean
  onClose: () => void
  onToggle: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const tone = toneOf(stock.pct)
  const [actions, setActions] = useState<Array<{ exDate: string; cashPerShare: number; shareRatio: number; description: string }>>([])
  const [announcements, setAnnouncements] = useState<Array<{ title: string; date: string; type: string; risk: boolean }>>([])
  useEffect(() => {
    setActions([]); setAnnouncements([])
    void getCorporateActions(stock.code).then((rows) => setActions(rows.slice(0, 3))).catch(() => undefined)
    void getStockAnnouncements(stock.code).then((rows) => setAnnouncements(rows.slice(0, 4))).catch(() => undefined)
  }, [stock.code])
  return (
    <div className="drawer-layer" onMouseDown={onClose}>
      <aside className="stock-drawer" onMouseDown={(e) => e.stopPropagation()} aria-label={`${stock.name} 详情`}>
        <div className="drawer-head">
          <div className="drawer-role">
            <span className="eyebrow">{role ?? '锚定标的'}</span>
            <span className={`drawer-status tone-${tone}`}>
              {stock.status === 'limitUp' ? '封板' : stock.status === 'limitDown' ? '跌停' : stock.status === 'broken' ? '开板' : '跟踪'}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-title">
          <div>
            <h2>{stock.name}</h2>
            <div className="drawer-code mono">
              {stock.code} · {stock.market.toUpperCase()}
              {stock.theme ? <span> · {stock.theme}</span> : null}
            </div>
          </div>
          <div className={`drawer-pct tone-text-${tone}`}>
            {tone === 'up' ? <ArrowUpRight size={20} /> : tone === 'down' ? <ArrowDownRight size={20} /> : null}
            <b className="mono">{fmtSigned(stock.pct)}%</b>
            <span className="mono">{fmtPrice(stock.price)}</span>
          </div>
        </div>
        <div className="drawer-tags">
          {stock.tags.map((tag) => (
            <Tag key={tag} tone={tone}>{tag}</Tag>
          ))}
        </div>
        <div className="drawer-metrics">
          <Metric label="成交额" value={fmtAmount(stock.amount)} />
          <Metric label="换手率" value={stock.turnover ? fmtPct(stock.turnover, 2) : '—'} />
          <Metric label="量比" value={stock.volumeRatio ? stock.volumeRatio.toFixed(2) : '—'} />
          <Metric label="总市值" value={fmtMarketCap(stock.marketCap)} />
          <Metric label="首封时间" value={stock.firstLimitTime !== '—' ? stock.firstLimitTime : '—'} />
          <Metric label="炸板次数" value={String(stock.breakCount)} />
          <Metric label="连板高度" value={`${stock.limitUpDays || stock.limitDownDays || 0} 板`} />
          <Metric label="封单占比" value={stock.lockRatio ? `${stock.lockRatio.toFixed(2)}%` : '—'} />
        </div>
        <div className="drawer-section">
          <h3><Clock3 size={13} /> 为什么是它</h3>
          <p>{reasonFromStock(stock)}</p>
        </div>
        {stock.reason ? (
          <div className="drawer-section">
            <h3>盘口证据</h3>
            <p className="drawer-evidence">{stock.reason}</p>
          </div>
        ) : null}
        {announcements.length ? (
          <div className="drawer-section">
            <h3>近期公告</h3>
            <div className="drawer-announcements">{announcements.map((a) => <div key={a.title + a.date} className={a.risk ? 'is-risk' : ''}><span>{a.date}</span><b>{a.title}</b>{a.risk ? <em>风险</em> : null}</div>)}</div>
          </div>
        ) : null}
        {actions.length ? (
          <div className="drawer-section">
            <h3>分红 / 送转</h3>
            <div className="drawer-actions-list">{actions.map((a) => <div key={a.exDate}><span>{a.exDate}</span><b>{a.description || `每股 ${a.cashPerShare.toFixed(2)} 元`}</b></div>)}</div>
            <p className="drawer-disclaimer">回测已按这些除权日做前复权；实盘账本尚未自动入账。</p>
          </div>
        ) : null}
        <div className="drawer-actions">
          <button type="button" className={`drawer-watch ${watched ? 'is-active' : ''}`} onClick={onToggle}>
            <Star size={15} fill={watched ? 'currentColor' : 'none'} />
            {watched ? '已加入自选锚定' : '加入自选锚定'}
          </button>
          <span className="drawer-disclaimer">每 10s 随锚定池刷新</span>
        </div>
      </aside>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawer-metric">
      <span>{label}</span>
      <b className="mono">{value}</b>
    </div>
  )
}

function reasonFromStock(stock: Stock): string {
  if (stock.status === 'limitDown') return `${stock.limitDownDays || 1} 连跌停，亏钱效应锚点；重点观察是否出现撬板与跌停收敛。`
  if (stock.status === 'broken') return '盘中开板，封板质量转弱；观察能否回封，回封失败则降低辨识度。'
  if (stock.limitUpDays > 1) return `${stock.limitUpDays} 连板，处于情绪高度梯队；观察次日溢价与板块跟随。`
  return '盘口出现强辨识度，纳入观察池；以封板、换手与板块共振确认强度。'
}
