import { ArrowUpRight, Flame, Sparkles, Target, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import type { Snapshot, Stock, ThemeCluster } from '../../shared/types'
import { fmtPct, fmtSigned, toneOf } from '../lib/format'
import { MiniBar, SectionHeader, StarButton, Tag } from './ui'

export function Recognition({
  snapshot,
  watchCodes,
  onToggleWatch,
  onOpenStock,
}: {
  snapshot: Snapshot
  watchCodes: string[]
  onToggleWatch: (stock: Stock) => void
  onOpenStock: (stock: Stock, role?: string) => void
}) {
  const [tab, setTab] = useState<'up' | 'down'>('up')
  const rows = tab === 'up' ? snapshot.leaders : snapshot.laggards
  const up = tab === 'up'
  return (
    <section className="recognition section" id="recognition">
      <SectionHeader
        index="04"
        title="今日最易辨识度"
        subtitle="不是涨幅榜的简单复制，而是高度、封板、换手、主线与亏钱效应的综合排序"
        right={
          <div className="effect-tabs">
            <button type="button" className={up ? 'is-active up' : ''} onClick={() => setTab('up')}>
              <TrendingUp size={13} /> 赚钱效应
            </button>
            <button type="button" className={!up ? 'is-active down' : ''} onClick={() => setTab('down')}>
              <TrendingDown size={13} /> 亏钱效应
            </button>
          </div>
        }
      />
      <div className="recognition-grid">
        <article className="rank-card">
          <div className="rank-head">
            <div>
              <span className="eyebrow">
                {up ? <Flame size={12} /> : <TrendingDown size={12} />} {up ? '赚钱效应排行' : '亏钱效应排行'}
              </span>
              <h3>{up ? '资金愿意为谁付溢价' : '亏钱效应从哪里扩散'}</h3>
            </div>
            <span className="rank-count mono">{rows.length} / TOP</span>
          </div>
          <div className={`rank-list ${up ? 'is-up' : 'is-down'}`}>
            {rows.length ? (
              rows.map((s, i) => (
                <RankRow
                  key={s.code}
                  stock={s}
                  rank={i + 1}
                  active={watchCodes.includes(s.code)}
                  onToggle={() => onToggleWatch(s)}
                  onOpen={() => onOpenStock(s, up ? '赚钱效应' : '亏钱效应')}
                />
              ))
            ) : (
              <div className="rank-empty">暂无符合辨识度条件的标的</div>
            )}
          </div>
          <div className="rank-foot">
            <span>排序：连板高度 / 首封时间 / 换手 / 回封次数 / 涨跌幅</span>
            <span className="mono">10s 刷新</span>
          </div>
        </article>

        <div className="recognition-side">
          <ThemeSide themes={snapshot.themes} />
          <div className="play-card">
            <div className="play-head">
              <span className="eyebrow"><Target size={12} /> 操作方向</span>
              <Tag tone={snapshot.sentiment.stage === '退潮' ? 'down' : 'warn'}>{snapshot.sentiment.label}</Tag>
            </div>
            <p>{snapshot.headline.action}</p>
            <div className="play-confirm">
              <span><Sparkles size={12} /> 次日确认</span>
              <p>{snapshot.headline.confirm}</p>
            </div>
            <div className="play-risk">
              <span>当前风险</span>
              <b className={`tone-text-${snapshot.sentiment.risk === '高' ? 'down' : snapshot.sentiment.risk === '中' ? 'warn' : 'up'}`}>
                {snapshot.sentiment.risk}
              </b>
              <span>·</span>
              <span>周期 {snapshot.sentiment.stage}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function RankRow({
  stock,
  rank,
  active,
  onToggle,
  onOpen,
}: {
  stock: Stock
  rank: number
  active: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const tone = toneOf(stock.pct)
  return (
    <div
      className={`rank-row tone-${tone}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
    >
      <span className={`rank-num mono ${rank <= 3 ? 'is-top' : ''}`}>{String(rank).padStart(2, '0')}</span>
      <div className="rank-main">
        <div className="rank-name-line">
          <b>{stock.name}</b>
          {stock.tags.slice(0, 3).map((tag) => (
            <Tag key={tag} tone={tone} soft>
              {tag}
            </Tag>
          ))}
        </div>
        <div className="rank-meta">
          <span className="mono">{stock.code}</span>
          {stock.turnover > 0 ? <span>换手 {fmtPct(stock.turnover, 1)}</span> : null}
          {stock.firstLimitTime !== '—' ? <span>首封 {stock.firstLimitTime.slice(0, 5)}</span> : null}
          {stock.theme ? <span>{stock.theme}</span> : null}
        </div>
      </div>
      <span className={`rank-pct mono tone-text-${tone}`}>{fmtSigned(stock.pct)}%</span>
      <StarButton active={active} onClick={(e) => { e.stopPropagation(); onToggle() }} />
    </div>
  )
}

function ThemeSide({ themes }: { themes: ThemeCluster[] }) {
  const max = Math.max(1, ...themes.map((t) => t.count))
  return (
    <article className="theme-side">
      <div className="theme-side-head">
        <span className="eyebrow"><Flame size={12} /> 主线涨停簇</span>
        <span className="theme-side-note">联动强度</span>
      </div>
      <div className="theme-side-list">
        {themes.slice(0, 5).map((t, i) => (
          <div className="theme-side-row" key={t.name}>
            <div className="ts-row-top">
              <span>{t.name}</span>
              <b className="mono">{t.count}</b>
            </div>
            <MiniBar value={t.count} max={max} tone={i === 0 ? 'up' : i < 3 ? 'gold' : 'flat'} />
          </div>
        ))}
      </div>
      <div className="theme-side-foot">
        <ArrowUpRight size={12} />
        以涨停池关联板块聚合，实时反映资金抱团方向
      </div>
    </article>
  )
}
