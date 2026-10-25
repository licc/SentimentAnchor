import { useMemo, useState } from 'react'
import { CalendarDays, ChevronRight, Flame, Snowflake, TrendingDown, TrendingUp } from 'lucide-react'
import type { CalendarDay, CalendarPayload } from '../../shared/types'
import { fmtAmount, fmtSigned, stageTone } from '../lib/format'
import { Modal } from './Modals'
import { SectionHeader, Tag } from './ui'

export function CalendarPanel({ data, loading, error }: { data: CalendarPayload | null; loading: boolean; error: string | null }) {
  const [selected, setSelected] = useState<CalendarDay | null>(null)
  const days = data?.days ?? []
  return (
    <section className="calendar-section section" id="calendar">
      <SectionHeader
        index="06"
        title="周期日历"
        subtitle="用历史涨停池回看情绪周期：高潮、发酵、修复、退潮，不靠记忆"
        right={
          <div className="calendar-head">
            <span><CalendarDays size={12} /> 最近 {days.length || '—'} 个交易日</span>
            <Tag tone="gold">历史阶段按涨停池近似</Tag>
          </div>
        }
      />
      <div className="calendar-card">
        {loading && !days.length ? (
          <div className="calendar-skeleton">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
        ) : days.length ? (
          <div className="calendar-grid">
            {days.map((day, i) => (
              <button
                type="button"
                className={`cal-day tone-${stageTone(day.stage)} ${i === days.length - 1 ? 'is-current' : ''}`}
                key={day.date}
                onClick={() => setSelected(day)}
              >
                <div className="cal-top">
                  <span className="cal-date mono">{day.date.slice(5).replace('-', '/')}</span>
                  <span className="cal-week">{weekday(day.date)}</span>
                  <em>{day.stage}</em>
                </div>
                <div className="cal-counts">
                  <span className="up mono">{day.limitUp}</span>
                  <i>/</i>
                  <span className="down mono">{day.limitDown}</span>
                  <small>涨停 / 跌停</small>
                </div>
                <div className="cal-score">
                  <span style={{ width: `${day.score}%` }} />
                </div>
                <div className="cal-foot">
                  <span>{day.topTheme}</span>
                  <b className={`mono ${day.indexPct >= 0 ? 'up' : 'down'}`}>{fmtSigned(day.indexPct)}%</b>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="calendar-empty">
            <CalendarDays size={22} />
            <p>{error ?? '暂无历史归档，交易日收盘后会自动积累。'}</p>
          </div>
        )}
        {data?.stats?.length ? (
          <div className="calendar-stats">
            <span className="calendar-stats-label">阶段 → 次日上证</span>
            {data.stats.map((s) => (
              <span className={`calendar-stat tone-${stageTone(s.stage)}`} key={s.stage}>
                <b>{s.stage}</b>
                <em className="mono">{s.avgNextPct >= 0 ? '+' : ''}{s.avgNextPct}%</em>
                <small>胜率 {s.winRate}% · {s.samples}次</small>
              </span>
            ))}
            <span className="calendar-stats-note">小样本，仅供复盘</span>
          </div>
        ) : null}
        <div className="calendar-note">
          <span><i className="legend-dot up" />今日为实时快照口径</span>
          <span>历史数据来自东方财富涨停/跌停池 + 同花顺日线，阶段为按涨停池近似的结果</span>
          <span className="calendar-more">点击任意日期查看历史复盘 <ChevronRight size={11} /></span>
        </div>
      </div>
      {selected ? <HistoryModal day={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  )
}

function HistoryModal({ day, onClose }: { day: CalendarDay; onClose: () => void }) {
  const top = useMemo(() => day.leaders[0], [day])
  return (
    <Modal
      title={`${day.date} · 周期复盘`}
      subtitle={`${day.stage} · 情绪近似分 ${day.score} · ${day.note}`}
      onClose={onClose}
      width={760}
    >
      <div className={`history-hero tone-${stageTone(day.stage)}`}>
        <div>
          <span className="eyebrow"><Flame size={12} /> 历史情绪</span>
          <h3>{day.stage} · {day.topTheme}</h3>
          <p>{top ? `空间核心 ${top.name}（${top.days}板，${fmtSigned(top.pct)}%）` : '空间核心待确认'}</p>
        </div>
        <div className="history-score mono">{day.score}<small>/100</small></div>
      </div>
      <div className="history-stats">
        <Stat label="上证涨跌" value={`${fmtSigned(day.indexPct)}%`} tone={day.indexPct >= 0 ? 'up' : 'down'} />
        <Stat label="两市成交" value={fmtAmount(day.amount)} />
        <Stat label="涨停 / 跌停" value={`${day.limitUp} / ${day.limitDown}`} tone={day.limitUp > day.limitDown ? 'up' : 'down'} />
        <Stat label="空间高度" value={`${day.maxBoard} 板`} />
      </div>
      <div className="history-columns">
        <div>
          <div className="history-list-head"><span><TrendingUp size={13} /> 涨停梯队</span><b>{day.limitUp} 家</b></div>
          {day.leaders.map((s) => (
            <div className="history-row" key={s.code}>
              <span className={`history-pct mono ${s.pct >= 0 ? 'up' : 'down'}`}>{fmtSigned(s.pct)}%</span>
              <b>{s.name}</b>
              <span className="mono">{s.code}</span>
              <Tag tone="up">{s.days}板</Tag>
              <small>{s.theme}</small>
            </div>
          ))}
        </div>
        <div>
          <div className="history-list-head"><span><TrendingDown size={13} /> 亏钱效应</span><b>{day.limitDown} 家</b></div>
          {day.laggards.length ? day.laggards.map((s) => (
            <div className="history-row" key={s.code}>
              <span className={`history-pct mono ${s.pct >= 0 ? 'up' : 'down'}`}>{fmtSigned(s.pct)}%</span>
              <b>{s.name}</b>
              <span className="mono">{s.code}</span>
              <Tag tone="down">{s.days}连跌</Tag>
              <small>{s.theme}</small>
            </div>
          )) : <div className="history-empty"><Snowflake size={14} /> 当日无跌停池数据</div>}
        </div>
      </div>
      <div className="history-foot">历史阶段为近似值，仅用于周期复盘，不构成投资建议。</div>
    </Modal>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="history-stat">
      <span>{label}</span>
      <b className={`mono ${tone ? `tone-text-${tone}` : ''}`}>{value}</b>
    </div>
  )
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(`${date}T12:00:00+08:00`))
}
