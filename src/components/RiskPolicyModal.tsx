import { Save, Sparkles, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { activateRiskPolicy, generateRiskPolicyDraft, getRiskPolicies, saveRiskPolicy, type RiskPolicyView } from '../api'
import { Modal } from './Modals'
import { TradingSectionHeader } from './trading-ui'

export function RiskPolicyModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [policies, setPolicies] = useState<RiskPolicyView[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = policies.find((p) => p.id === selectedId) ?? policies[0]
  useEffect(() => { void getRiskPolicies().then((d) => { setPolicies(d.policies); setSelectedId(d.activeByScope.manual ?? d.policies[0]?.id ?? '') }) }, [])
  function patchRule(id: string, patch: Partial<RiskPolicyView['rules'][number]>) {
    setPolicies((current) => current.map((p) => p.id !== selectedId ? p : { ...p, rules: p.rules.map((r) => r.id === id ? { ...r, ...patch } : r) }))
  }
  async function save(activate: boolean) {
    if (!selected) return
    setBusy(true); setError(null)
    try {
      await saveRiskPolicy(selected.id, { rules: selected.rules, scope: selected.scope })
      if (activate) await activateRiskPolicy(selected.id)
      const next = await getRiskPolicies(); setPolicies(next.policies); setSelectedId(next.activeByScope[selected.scope] ?? selected.id); onChanged?.()
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') } finally { setBusy(false) }
  }
  return (
    <Modal title="风控编排" subtitle="买入前置规则组合 · 规则按顺序检查 · 全部硬规则通过才可委托" onClose={onClose} width={900}>
      <div className="ai-policy-box">
        <div><Sparkles size={12} /><b>AI 生成编排</b><span>描述风控要求，AI 只生成规则/参数，不直接下单。</span></div>
        <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="例如：只做均价线上方、量价配合、B1/B3/B4 买点，红旗不超过1条，追高不超过3%，单笔5000" />
        <div><button type="button" className="quant-btn-primary" disabled={aiBusy || aiPrompt.trim().length < 6} onClick={() => { setAiBusy(true); setAiMessage(null); void generateRiskPolicyDraft(aiPrompt).then((draft) => { setPolicies((current) => current.map((p) => p.id === selected.id ? { ...p, name: draft.name, description: draft.description, scope: draft.scope, rules: draft.rules } : p)); setAiMessage(`${draft.provider}/${draft.model} 已生成，请检查后保存并启用`) }).catch((err) => setAiMessage(err instanceof Error ? err.message : '生成失败')).finally(() => setAiBusy(false)) }}><Sparkles size={12} /> 生成编排</button>{aiMessage ? <em>{aiMessage}</em> : null}</div>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="policy-layout">
        <div className="policy-list">
          {policies.map((p) => <button type="button" key={p.id} className={`policy-item ${p.id === selectedId ? 'is-active' : ''}`} onClick={() => setSelectedId(p.id)}><span>{p.status === 'active' ? '启用中' : '草稿'}</span><b>{p.name}</b><em>{p.rules.filter((r) => r.enabled).length} 条规则</em></button>)}
        </div>
        <div className="policy-detail">
          {selected ? <>
            <TradingSectionHeader title={selected.name} meta={`v${selected.version} · ${selected.description}`} />
            <label className="policy-scope">作用范围<select value={selected.scope} onChange={(e) => setPolicies((current) => current.map((p) => p.id === selected.id ? { ...p, scope: e.target.value as typeof p.scope } : p))}><option value="all">全部（手动 + T+0 + T+1）</option><option value="manual">仅主动交易</option><option value="t0">仅 T+0</option><option value="t1">仅 T+1</option></select></label>
            <div className="policy-rules">
              {selected.rules.map((r) => <div className={`policy-rule ${r.enabled ? '' : 'is-off'} ${r.severity} ${HARD_RULES.has(r.id) ? 'is-hard' : ''}`} key={r.id}><label><input type="checkbox" checked={r.enabled} disabled={HARD_RULES.has(r.id)} onChange={(e) => patchRule(r.id, { enabled: e.target.checked })} /> {r.label}{HARD_RULES.has(r.id) ? <small>硬规则</small> : null}</label><select value={r.severity} disabled={HARD_RULES.has(r.id)} onChange={(e) => patchRule(r.id, { severity: e.target.value as 'block' | 'warn' })}><option value="block">拦截</option><option value="warn">告警</option></select>{ruleParamFields(r.id).map((f) => <label className="policy-param" key={f.key}>{f.label}<input value={String(r.params?.[f.key] ?? '')} onChange={(e) => patchRule(r.id, { params: { ...r.params, [f.key]: f.type === 'number' ? Number(e.target.value) : f.type === 'list' ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : e.target.value } })} /></label>)}</div>)}
            </div>
            <div className="policy-actions"><button type="button" className="quant-btn-quiet" disabled={busy} onClick={() => void save(false)}><Save size={12} /> 保存编排</button><button type="button" className="quant-btn-primary" disabled={busy || selected.status === 'active'} onClick={() => void save(true)}><Zap size={12} /> 保存并启用</button></div>
            <div className="auto-settings-note">告警规则不阻止委托；拦截规则失败则不允许正式提交。风控编排只作用于买入前置检查。</div>
          </> : null}
        </div>
      </div>
    </Modal>
  )
}


function ruleParamFields(id: string): Array<{ key: string; label: string; type: 'number' | 'list' | 'text' }> {
  const fields: Record<string, Array<{ key: string; label: string; type: 'number' | 'list' | 'text' }>> = {
    session: [{ key: 'allowedSessions', label: '时段', type: 'list' }],
    'order-limit': [{ key: 'maxOrderAmount', label: '单笔¥', type: 'number' }],
    cash: [{ key: 'minCashReserve', label: '保留¥', type: 'number' }],
    'symbol-exposure': [{ key: 'maxSymbolPct', label: '单票%', type: 'number' }],
    'account-exposure': [{ key: 'maxAccountExposurePct', label: '总仓%', type: 'number' }],
    'daily-loss': [{ key: 'maxDailyLossPct', label: '日亏%', type: 'number' }],
    'daily-limit': [{ key: 'maxOrdersPerDay', label: '日次数', type: 'number' }],
    duplicate: [{ key: 'duplicateWindowSec', label: '重复秒', type: 'number' }],
    'data-freshness': [{ key: 'maxAgeSec', label: '行情秒', type: 'number' }],
    'blocked-code': [{ key: 'blockedCodes', label: '黑名单', type: 'list' }],
    'intraday-structure': [{ key: 'minAboveRatio', label: '线上%', type: 'number' }],
    'volume-price': [{ key: 'minUpDownVolumeRatio', label: '量比', type: 'number' }],
    'intraday-redflags': [{ key: 'maxRedFlags', label: '红旗上限', type: 'number' }],
    'buy-point': [{ key: 'requireSignal', label: '买点', type: 'text' }],
    chase: [{ key: 'maxAboveVwapPct', label: '追高%', type: 'number' }],
  }
  return fields[id] ?? []
}

const HARD_RULES = new Set(['session', 'quote', 'price', 'lot', 'cash', 'account-exposure', 'daily-loss', 'data-freshness', 'duplicate'])
