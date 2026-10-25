import type { RiskPolicyRule, RiskScope } from './risk-policy.js'
import { getActiveRiskPolicy, hardRuleViolations } from './risk-policy.js'
import { getResolvedLlmConfig } from '../ai-config.js'

export interface RiskPolicyDraft { name: string; description: string; scope: RiskScope; rules: RiskPolicyRule[]; model: string; provider: string }

export async function generateRiskPolicyDraft(prompt: string): Promise<RiskPolicyDraft> {
  const cfg = getResolvedLlmConfig()
  if (!cfg) throw new Error('未配置大模型，无法生成风控编排')
  const text = prompt.trim()
  if (text.length < 6) throw new Error('请描述风控要求')
  const base = getActiveRiskPolicy('manual')
  const skeleton = base.rules.map((r) => ({ id: r.id, label: r.label, enabled: r.enabled, severity: r.severity, params: r.params }))
  const system = `你是 A 股交易风控编排器。只输出合法 JSON，不要 Markdown、不要代码。
你要把用户要求翻译成给定规则列表的启用状态、拦截/告警级别和参数。禁止新增规则 ID。
规则列表：${JSON.stringify(base.rules.map((r) => ({ id: r.id, label: r.label, params: r.params })))}
输出结构：
{"name":"策略名","description":"说明","scope":"all|manual|t0|t1","rules":[{"id":"规则id","enabled":true,"severity":"block|warn","params":{}}]}
硬风控（仓位、单笔、资金、亏损、ST、公告）必须保留 block，不能靠 AI 判断直接绕过。分时结构、量价、红旗、买点、追高可以设为 block 或 warn。`
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ model: cfg.model, temperature: 0.15, max_tokens: 3000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }),
  })
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; model?: string }
  const content = data.choices?.[0]?.message?.content ?? ''
  if (!content) throw new Error('LLM 返回为空')
  const parsed = JSON.parse(content) as Record<string, unknown>
  const rawRules = Array.isArray(parsed.rules) ? parsed.rules as Array<Record<string, unknown>> : []
  const rules = base.rules.map((r) => {
    const next = rawRules.find((x) => String(x.id) === r.id)
    return next ? { ...r, enabled: Boolean(next.enabled ?? r.enabled), severity: next.severity === 'warn' ? 'warn' as const : 'block' as const, params: normalizeParams(r.id, { ...r.params, ...(next.params as object ?? {}) }) } : r
  })
  const violations = hardRuleViolations(rules)
  if (violations.length) throw new Error(`AI 生成的编排关闭了硬风控：${violations.join('、')}`)
  return {
    name: String(parsed.name ?? 'AI 风控编排').slice(0, 40),
    description: String(parsed.description ?? text).slice(0, 300),
    scope: ['all', 'manual', 't0', 't1'].includes(String(parsed.scope)) ? parsed.scope as RiskScope : 'all',
    rules, model: data.model || cfg.model, provider: cfg.provider,
  }
}

function normalizeParams(id: string, raw: Record<string, unknown>): Record<string, number | string | string[] | boolean> {
  const n = (v: unknown, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : fallback))
  const out = { ...raw } as Record<string, number | string | string[] | boolean>
  if (out.maxOrderAmount != null) out.maxOrderAmount = n(out.maxOrderAmount, 15000, 100, 1_000_000)
  if (out.minCashReserve != null) out.minCashReserve = n(out.minCashReserve, 100, 0, 1_000_000)
  if (out.maxSymbolPct != null) out.maxSymbolPct = n(out.maxSymbolPct, 40, 1, 100)
  if (out.maxAccountExposurePct != null) out.maxAccountExposurePct = n(out.maxAccountExposurePct, 70, 1, 100)
  if (out.maxDailyLossPct != null) out.maxDailyLossPct = n(out.maxDailyLossPct, 3, 0.2, 20)
  if (out.maxOrdersPerDay != null) out.maxOrdersPerDay = Math.round(n(out.maxOrdersPerDay, 20, 1, 500))
  if (out.duplicateWindowSec != null) out.duplicateWindowSec = Math.round(n(out.duplicateWindowSec, 30, 0, 3600))
  if (out.maxAgeSec != null) out.maxAgeSec = Math.round(n(out.maxAgeSec, 30, 5, 300))
  if (out.minAboveRatio != null) out.minAboveRatio = n(out.minAboveRatio, 50, 0, 100)
  if (out.minUpDownVolumeRatio != null) out.minUpDownVolumeRatio = n(out.minUpDownVolumeRatio, 1.2, 0, 10)
  if (out.maxRedFlags != null) out.maxRedFlags = Math.round(n(out.maxRedFlags, 1, 0, 6))
  if (out.maxAboveVwapPct != null) out.maxAboveVwapPct = n(out.maxAboveVwapPct, 3, 0, 20)
  if (out.requireSignal != null) out.requireSignal = out.requireSignal === true || out.requireSignal === 'true'
  if (Array.isArray(out.blockedCodes)) out.blockedCodes = out.blockedCodes.map(String)
  if (Array.isArray(out.allowedSessions)) out.allowedSessions = out.allowedSessions.map(String)
  return out
}
