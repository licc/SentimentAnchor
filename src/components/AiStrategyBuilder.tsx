import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { AiStrategyDraft } from '../../shared/types'
import { activateQuantStrategy, activateT0Strategy, createQuantStrategy, createT0Strategy, generateAiStrategy } from '../api'

export function AiStrategyBuilder({ module, onSaved }: { module: 't0' | 't1'; onSaved?: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<AiStrategyDraft | null>(null)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function generate() {
    setBusy(true); setMessage(null)
    try {
      const d = await generateAiStrategy(module, prompt)
      setDraft(d); setContent(d.spec.content)
      setMessage(`已由 ${d.provider}/${d.model} 生成；执行方式：确定性代码，请检查后再保存`)
    } catch (err) { setMessage(err instanceof Error ? err.message : '生成失败') } finally { setBusy(false) }
  }

  function contentWithParams(draft: AiStrategyDraft): string {
    const spec = draft.spec
    const params = module === 't0'
      ? `\n\n## 解析参数\n进攻分数 >= ${spec.minScore}\n防守分数 < ${Math.max(1, Math.min(99, spec.minScore - 10))}\n进攻仓位 ${spec.riskOnPositionPct}%\n防守仓位 ${spec.riskOffPositionPct}%\n`
      : `\n\n## 解析参数\n最低分数 ${spec.minScore}\n单票仓位 ${spec.riskOnPositionPct}%\n止损 ${spec.stopLossPct}%\n止盈 ${spec.takeProfitPct}%\n持有 ${spec.maxHoldDays} 日\n买入截止 ${spec.entryCutoff}\n`
    return `${content}${params}`
  }

  async function save(activate: boolean) {
    if (!draft) return
    setBusy(true); setMessage(null)
    try {
      if (module === 't0') {
        const s = await createT0Strategy(draft.spec.name, contentWithParams(draft))
        if (activate) await activateT0Strategy(s.id)
      } else {
        const s = await createQuantStrategy({ name: draft.spec.name, content: contentWithParams(draft) })
        if (activate) await activateQuantStrategy(s.id)
      }
      setMessage(activate ? '已保存并启用，下一轮引擎使用' : '已保存为草稿')
      onSaved?.()
    } catch (err) { setMessage(err instanceof Error ? err.message : '保存失败') } finally { setBusy(false) }
  }

  return (
    <div className="ai-strategy-builder">
      <div className="ai-strategy-head"><span><Sparkles size={12} /> AI 生成策略</span><em>{module === 't0' ? 'T+0 ETF' : 'T+1 股票'}</em></div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述你的要求，例如：情绪修复时做 T+0 ETF，单票不超过 30%，止损 1%，14:45 停止买入，最多调仓 2 次" />
      <div className="ai-strategy-actions"><button type="button" className="quant-btn-primary" disabled={busy || prompt.trim().length < 6} onClick={() => void generate()}><Sparkles size={12} /> 生成策略</button></div>
      {message ? <div className="ai-strategy-message">{message}</div> : null}
      {draft ? (
        <div className="ai-strategy-preview">
          <div className="ai-strategy-fields">
            <span>环境 {draft.spec.stages.join('/')} · 分数 ≥ {draft.spec.minScore}</span>
            <span>进攻仓 {draft.spec.riskOnPositionPct}% · 防守仓 {draft.spec.riskOffPositionPct}%</span>
            <span>止损 {draft.spec.stopLossPct}% · 止盈 {draft.spec.takeProfitPct}% · 持有 {draft.spec.maxHoldDays} 日</span>
            <span>截止 {draft.spec.entryCutoff} · 调仓上限 {draft.spec.maxSwitchesPerDay} 次</span>
          </div>
          <textarea className="ai-strategy-content" value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="ai-strategy-actions">
            <button type="button" className="quant-btn-quiet" disabled={busy} onClick={() => void save(false)}>保存草稿</button>
            <button type="button" className="quant-btn-primary" disabled={busy} onClick={() => void save(true)}>保存并启用</button>
          </div>
          <em className="ai-strategy-safety">AI 只生成参数化规则；运行时由确定性代码执行，不会在盘中调用 AI；启用前请回测并人工确认。</em>
        </div>
      ) : null}
    </div>
  )
}
