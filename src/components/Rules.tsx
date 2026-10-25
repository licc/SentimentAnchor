import { AlertTriangle, Check, CircleDashed, ShieldCheck, X } from 'lucide-react'
import type { RuleCheck, Snapshot } from '../../shared/types'
import { SectionHeader, Tag } from './ui'

export function Rules({ snapshot }: { snapshot: Snapshot }) {
  const { rules, sentiment } = snapshot
  const passCount = rules.stage.filter((r) => r.status === 'pass').length
  const newCount = rules.newCycle.filter((r) => r.status === 'pass').length
  const alertCount = rules.invalidation.filter((r) => r.status === 'pass').length
  return (
    <section className="rules section" id="rules">
      <SectionHeader
        index="05"
        title="周期规则 · 新周期识别"
        subtitle="用固定规则约束主观判断：阶段成立、周期切换、失效信号，逐条打勾"
        right={
          <div className="rules-head-right">
            <Tag tone={alertCount ? 'down' : 'up'}>
              {alertCount ? `${alertCount} 个失效信号触发` : '暂无失效信号'}
            </Tag>
            <span className="mono">规则引擎 v1.0</span>
          </div>
        }
      />
      <div className="rules-grid">
        <RuleCard
          tone="up"
          icon={<ShieldCheck size={15} />}
          title="阶段成立条件"
          subtitle={`${passCount} / ${rules.stage.length} 项成立`}
          progress={(passCount / rules.stage.length) * 100}
          checks={rules.stage}
          mode="stage"
        />
        <RuleCard
          tone="gold"
          icon={<CircleDashed size={15} />}
          title="新周期识别信号"
          subtitle={`${newCount} / ${rules.newCycle.length} 项确认`}
          progress={(newCount / rules.newCycle.length) * 100}
          checks={rules.newCycle}
          mode="new"
        />
        <RuleCard
          tone="down"
          icon={<AlertTriangle size={15} />}
          title="失效 / 防守信号"
          subtitle={alertCount ? `${alertCount} 项需要警惕` : '当前均未触发'}
          progress={(alertCount / rules.invalidation.length) * 100}
          checks={rules.invalidation}
          mode="invalid"
        />
      </div>
      <div className="rules-foot">
        <div className="rules-quote">
          <span>“</span>
          规则不是预测，而是仓位开关。阶段成立才进攻，失效信号出现就降仓；不因一根阳线改变周期判断。
        </div>
        <div className="rules-legend">
          <span><Check size={11} /> 成立 / 确认</span>
          <span><X size={11} /> 未满足</span>
          <span><AlertTriangle size={11} /> 失效警示</span>
          <b>当前：{sentiment.stage} · {sentiment.label}</b>
        </div>
      </div>
    </section>
  )
}

function RuleCard({
  tone,
  icon,
  title,
  subtitle,
  progress,
  checks,
  mode,
}: {
  tone: 'up' | 'gold' | 'down'
  icon: React.ReactNode
  title: string
  subtitle: string
  progress: number
  checks: RuleCheck[]
  mode: 'stage' | 'new' | 'invalid'
}) {
  return (
    <article className={`rule-card tone-${tone}`}>
      <div className="rule-head">
        <span className="rule-icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="rule-progress">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="rule-list">
        {checks.map((check) => {
          const ok = check.status === 'pass'
          const isAlert = mode === 'invalid' && ok
          return (
            <div className={`rule-row ${isAlert ? 'is-alert' : ok ? 'is-pass' : 'is-fail'}`} key={check.id}>
              <span className="rule-status">
                {isAlert ? <AlertTriangle size={12} /> : ok ? <Check size={12} /> : <X size={12} />}
              </span>
              <span className="rule-label">{check.label}</span>
              <span className="rule-detail mono">{check.detail}</span>
            </div>
          )
        })}
      </div>
      <div className="rule-card-foot">
        {mode === 'invalid' ? '触发任一信号 → 降低仓位 / 停止进攻' : '全部满足 → 确认阶段 / 提升仓位'}
      </div>
    </article>
  )
}
