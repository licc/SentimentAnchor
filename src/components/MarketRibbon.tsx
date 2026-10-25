import { CalendarDays, Check, ChevronRight, Radio } from 'lucide-react'
import type { MarketIndex, PhaseInfo, Snapshot } from '../../shared/types'
import { cnDate, fmtAmount, fmtPrice, fmtSigned, toneOf } from '../lib/format'

export function DateBar({
  snapshot,
  view,
  onViewChange,
}: {
  snapshot: Snapshot
  view: 'decision' | 'pro'
  onViewChange: (view: 'decision' | 'pro') => void
}) {
  const d = cnDate(snapshot.tradingDate)
  return (
    <div className="datebar">
      <div className="date-card">
        <CalendarDays size={16} />
        <span className="date-main mono">{d.date}</span>
        <span className="date-week">{d.weekday}</span>
        <span className="date-tag">实时工作台</span>
      </div>
      <nav className="section-nav" aria-label="页面导航">
        <a href="#anchors" className="active">
          今日锚定
        </a>
        <a href="#ai">AI 研判</a>
        <a href="/jyt">交易台</a>
        <a href="#recognition">辨识度</a>
        <a href="#rules">周期规则</a>
        {view === 'pro' ? <a href="#sentiment">情绪结构</a> : null}
        {view === 'pro' ? <a href="#calendar">周期日历</a> : null}
      </nav>
      <div className="datebar-right">
        <div className="view-toggle" role="group" aria-label="视图切换">
          <button type="button" className={view === 'decision' ? 'is-active' : ''} onClick={() => onViewChange('decision')}>
            决策台
          </button>
          <button type="button" className={view === 'pro' ? 'is-active' : ''} onClick={() => onViewChange('pro')}>
            全量监控
          </button>
        </div>
        <span className="refresh-note">
          <Radio size={12} /> 10s 自动刷新
        </span>
        <span className="divider-dot" />
        <span>盘中每 10 秒校准一次，收盘定格</span>
      </div>
    </div>
  )
}

export function PhaseRail({ phases, active }: { phases: PhaseInfo[]; active: PhaseInfo }) {
  return (
    <section className="phase-card">
      <div className="phase-title">
        <span>日内节奏</span>
        <b>{active.short}</b>
      </div>
      <div className="phase-track">
        {phases.map((p, i) => (
          <div className={`phase-item is-${p.state}`} key={`${p.time}-${i}`} title={p.desc}>
            <span className="phase-node">
              {p.state === 'done' ? <Check size={10} strokeWidth={3} /> : <i />}
            </span>
            <div className="phase-copy">
              <span className="phase-time mono">{p.time}</span>
              <span className="phase-label">{p.label.replace(/^\d{2}:\d{2}\s*/, '')}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="phase-now">
        <span className="phase-now-kicker">{active.time}</span>
        <span>{active.desc}</span>
        <ChevronRight size={13} />
      </div>
    </section>
  )
}

export function IndexStrip({ indices }: { indices: MarketIndex[] }) {
  return (
    <section className="index-strip" aria-label="核心指数">
      {indices.map((idx) => {
        const tone = toneOf(idx.pct)
        const range = idx.high - idx.low
        const closePos = range > 0 ? ((idx.price - idx.low) / range) * 100 : 50
        const openPos = range > 0 ? ((idx.open - idx.low) / range) * 100 : 50
        return (
          <article className={`index-card tone-${tone}`} key={idx.code}>
            <div className="index-head">
              <span className="index-name">{idx.name}</span>
              <span className="index-code mono">{idx.code}</span>
            </div>
            <div className="index-main">
              <span className={`index-pct mono tone-text-${tone}`}>{fmtSigned(idx.pct)}%</span>
              <span className="index-price mono">{fmtPrice(idx.price)}</span>
            </div>
            <div className="range-line" title={`低 ${fmtPrice(idx.low)} / 高 ${fmtPrice(idx.high)}`}>
              <span className="range-fill" style={{ left: `${Math.min(openPos, closePos)}%`, width: `${Math.abs(closePos - openPos)}%` }} />
              <span className="range-open" style={{ left: `${openPos}%` }} />
              <span className="range-close" style={{ left: `${closePos}%` }} />
            </div>
            <div className="index-foot">
              <span>成交 {fmtAmount(idx.amount)}</span>
              <span className="mono">
                {fmtPrice(idx.low)} — {fmtPrice(idx.high)}
              </span>
            </div>
          </article>
        )
      })}
    </section>
  )
}
