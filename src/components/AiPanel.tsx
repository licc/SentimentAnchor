import { AlertTriangle, BrainCircuit, CheckCircle2, LockKeyhole, RefreshCw, Sparkles, Target, Zap } from 'lucide-react'
import type { AiInsight } from '../../shared/types'
import { timeOf } from '../lib/format'
import { SectionHeader, Tag } from './ui'

export function AiPanel({
  insight,
  loading,
  generating,
  llmConfigured,
  onRefresh,
  onDeep,
  error,
}: {
  insight: AiInsight | null
  loading: boolean
  generating: 'local' | 'llm' | null
  llmConfigured: boolean
  onRefresh: () => void
  onDeep: () => void
  error: string | null
}) {
  const busy = loading || Boolean(generating)
  return (
    <section className="ai-section section" id="ai">
      <SectionHeader
        index="AI"
        title="AI 研判室"
        subtitle="把盘面数据转成可执行的判断：情绪、主线、锚点、风险与次日确认"
        right={
          <div className="ai-head-actions">
            <span className="ai-live-badge">
              <i />
              AI 实时更新 {insight ? timeOf(insight.generatedAt) : '—'}
            </span>
            <button type="button" className="ai-btn" onClick={onRefresh} disabled={busy}>
              <RefreshCw size={12} className={generating === 'local' ? 'spin' : ''} />
              重新研判
            </button>
            <button
              type="button"
              className={`ai-btn ai-btn-deep ${llmConfigured ? '' : 'is-locked'}`}
              onClick={onDeep}
              disabled={busy || !llmConfigured}
              title={llmConfigured ? '调用已配置的大模型生成深度研判' : '先配置 API Key 后启用'}
            >
              {llmConfigured ? <BrainCircuit size={13} /> : <LockKeyhole size={12} />}
              {generating === 'llm' ? '深度推理中' : 'LLM 深度研判'}
            </button>
          </div>
        }
      />

      <div className={`ai-card ${busy ? 'is-busy' : ''}`}>
        {insight ? (
          <>
            <div className="ai-main">
              <div className="ai-topline">
                <span className="ai-mark"><Sparkles size={15} /></span>
                <span className={`ai-mode is-${insight.mode}`}>
                  {insight?.mode === 'llm' ? 'LLM 在线' : '本地量化推理'}
                </span>
                <span className="ai-model mono">{insight.provider} / {insight.model}</span>
                <span className="ai-spacer" />
                <span className="ai-confidence" title="模型自评置信度，未做统计校准">模型置信度 <b className="mono">{insight.confidence}</b></span>
              </div>
              <div className="ai-title-row">
                <span className={`ai-stance tone-${stanceTone(insight.stance)}`}>{insight.stance}</span>
                <h3>{insight.title}</h3>
              </div>
              <p className="ai-summary">{insight.summary}</p>
              <div className="ai-conclusions">
                {insight.conclusions.map((c, i) => (
                  <div className="ai-conclusion" key={`${c.label}-${i}`}>
                    <div className="ai-conclusion-label">
                      <span>{c.label}</span>
                      <i className={`tone-bg-${c.tone}`} />
                    </div>
                    <p>{c.text}</p>
                  </div>
                ))}
              </div>
              <div className="ai-risks">
                <span className="ai-risk-title"><AlertTriangle size={12} /> 风险扫描</span>
                {insight.risks.map((r, i) => (
                  <span className="ai-risk" key={`${r}-${i}`}>{r}</span>
                ))}
              </div>
            </div>

            <aside className="ai-plan">
              <div className="ai-plan-head">
                <span><Zap size={13} /> 执行剧本</span>
                <Tag tone={insight.stance === '进攻' ? 'up' : insight.stance === '防守' ? 'down' : 'warn'}>
                  {insight.stance}
                </Tag>
              </div>
              <PlanRow icon={<Target size={12} />} label="进攻 / 观察" text={insight.attack} tone="up" />
              <PlanRow icon={<AlertTriangle size={12} />} label="规避" text={insight.avoid} tone="down" />
              <PlanRow icon={<CheckCircle2 size={12} />} label="次日确认" text={insight.confirm} tone="gold" />
              <div className="ai-source-note">
                {insight.sourceNote}
              </div>
            </aside>
          </>
        ) : (
          <div className="ai-skeleton">
            <div className="ai-skeleton-head"><Sparkles size={15} /> AI 正在读取当前快照…</div>
            <div className="ai-skeleton-line w70" />
            <div className="ai-skeleton-line w90" />
            <div className="ai-skeleton-grid">
              <span /><span /><span />
            </div>
          </div>
        )}
        {busy ? <div className="ai-busy-bar"><span /></div> : null}
      </div>
      {error ? <div className="ai-error">AI 研判异常：{error}</div> : null}
      <div className="ai-disclaimer">
        <Sparkles size={11} />
        AI 辅助研判，不构成投资建议。{insight?.mode === 'llm' ? ' 当前为 LLM 在线研判，生成结果仍可能出错，请结合原始行情复核。' : llmConfigured ? ' 当前展示本地量化推理；配置已存在，可切换 LLM 深度研判。' : ' 当前未配置大模型，使用本地量化规则推理；配置 LLM_API_KEY 后启用 LLM 深度研判。'}
      </div>
    </section>
  )
}

function PlanRow({ icon, label, text, tone }: { icon: React.ReactNode; label: string; text: string; tone: 'up' | 'down' | 'gold' }) {
  return (
    <div className={`ai-plan-row tone-${tone}`}>
      <span className="ai-plan-label">{icon}{label}</span>
      <p>{text}</p>
    </div>
  )
}

function stanceTone(stance: AiInsight['stance']): 'up' | 'down' | 'warn' {
  return stance === '进攻' ? 'up' : stance === '防守' ? 'down' : 'warn'
}
