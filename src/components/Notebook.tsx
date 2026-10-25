import { ArrowUpRight, Dot, Layers3, Radar } from 'lucide-react'
import type { LogBlock, Sector, ThemeCluster } from '../../shared/types'
import { fmtSigned } from '../lib/format'
import { MiniBar, SectionHeader, Tag } from './ui'

export function Notebook({
  logs,
  themes,
  sectors,
}: {
  logs: Record<'market' | 'scan' | 'resonance' | 'stage' | 'rhythm', LogBlock>
  themes: ThemeCluster[]
  sectors: { industry: Sector[]; concept: Sector[] }
}) {
  return (
    <section className="notebook section" id="notebook">
      <SectionHeader
        index="02"
        title="周期观察日志"
        subtitle="指数与家数、主线与分化、阶段与节奏，把盘面写成可执行的判断"
        right={
          <div className="notebook-legend">
            <span><Dot size={14} /> 规则实时生成</span>
            <span>非事后复盘</span>
            <Tag tone="gold">6 维判定</Tag>
          </div>
        }
      />
      <div className="notebook-grid">
        <div className="notebook-col">
          <LogCard block={logs.market} number="01" />
          <LogCard block={logs.stage} number="02" />
        </div>
        <div className="notebook-col">
          <LogCard block={logs.scan} number="03" />
          <ThemeBoard themes={themes} sectors={sectors} />
        </div>
        <div className="notebook-col">
          <LogCard block={logs.resonance} number="04" />
          <LogCard block={logs.rhythm} number="05" highlight />
        </div>
      </div>
    </section>
  )
}

function LogCard({ block, number, highlight = false }: { block: LogBlock; number: string; highlight?: boolean }) {
  return (
    <article className={`log-card ${highlight ? 'is-highlight' : ''}`}>
      <div className="log-head">
        <div className="log-title">
          <span className="log-number mono">{number}</span>
          <h3>{block.title}</h3>
        </div>
        {block.badge ? <span className="log-badge">{block.badge}</span> : null}
      </div>
      <div className="log-body">
        {block.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="log-bullets">
        {block.bullets.map((b, i) => (
          <div className="log-bullet" key={`${b.label}-${i}`}>
            <span className="lb-label">{b.label}</span>
            <span className={`lb-value ${b.tone ? `tone-text-${b.tone}` : ''}`}>{b.value}</span>
          </div>
        ))}
      </div>
      {block.footer ? <div className="log-foot">{block.footer}</div> : null}
    </article>
  )
}

function ThemeBoard({ themes, sectors }: { themes: ThemeCluster[]; sectors: { industry: Sector[]; concept: Sector[] } }) {
  const max = Math.max(1, ...themes.map((t) => t.count))
  return (
    <article className="theme-board">
      <div className="theme-board-head">
        <div>
          <span className="eyebrow">
            <Layers3 size={12} /> 涨停簇图谱
          </span>
          <h3>主线集中在哪里</h3>
        </div>
        <span className="theme-board-total mono">{themes.reduce((s, t) => s + t.count, 0)}</span>
      </div>
      <div className="theme-list">
        {themes.slice(0, 4).map((t, i) => (
          <div className="theme-row" key={t.name}>
            <span className={`theme-rank ${i === 0 ? 'is-top' : ''}`}>{i + 1}</span>
            <div className="theme-main">
              <div className="theme-name-row">
                <b>{t.name}</b>
                <span className="mono">{t.count} 家</span>
              </div>
              <MiniBar value={t.count} max={max} tone={i === 0 ? 'up' : 'gold'} />
              <div className="theme-stocks">{t.stocks.slice(0, 3).join(' · ')}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="sector-mini">
        <div className="sector-mini-head">
          <span><Radar size={12} /> 板块温度</span>
          <span>涨幅 / 领涨</span>
        </div>
        {sectors.concept.slice(0, 3).map((s) => (
          <div className="sector-mini-row" key={s.code}>
            <span className="sector-mini-name">{s.name}</span>
            <span className={`tone-text-${s.pct >= 0 ? 'up' : 'down'}`}>{fmtSigned(s.pct)}%</span>
            <span className="sector-mini-leader">{s.leader}</span>
            <ArrowUpRight size={11} />
          </div>
        ))}
      </div>
    </article>
  )
}
