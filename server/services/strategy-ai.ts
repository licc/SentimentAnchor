import type { AiRiskLimits, AiStrategyDraft, AiStrategySpec } from '../../shared/types.js'
import { getResolvedLlmConfig } from './ai-config.js'

export async function generateStrategyDraft(input: { module: 't0' | 't1' | 'risk'; prompt: string }): Promise<AiStrategyDraft> {
  const cfg = getResolvedLlmConfig()
  if (!cfg) throw new Error('未配置 LLM_API_KEY / DEEPSEEK_API_KEY，无法使用 AI 生成策略')
  const prompt = String(input.prompt ?? '').trim()
  if (prompt.length < 6) throw new Error('请至少描述一条策略要求')
  const system = `你是 A 股量化策略编译器。用户会给出交易要求，你必须输出合法 JSON，不要 Markdown。
只允许生成可被规则引擎执行的参数，不准输出代码、外部接口、未来函数、收益承诺或个股推荐。
模块：${input.module === 't0' ? 'T+0 ETF，日内可买卖，14:55 清仓' : input.module === 't1' ? 'T+1 股票，当日买入不可卖出，按持有日退出' : '风控策略，只生成买入限制和止损参数，不生成交易信号'}。
JSON schema:
{
 "name": "策略名，最多30字",
 "content": "给人看的完整文字策略，必须包含：适用环境、选股、买入、仓位、退出、风控",
 "stages": ["修复","发酵","高潮"],
 "minScore": 0-100,
 "riskOnPositionPct": 5-70,
 "riskOffPositionPct": 0-70,
 "stopLossPct": 0.5-10,
 "takeProfitPct": 0.5-20,
 "maxHoldDays": 1-10,
 "entryCutoff": "HH:mm",
 "priceAboveOpen": true/false,
 "minPct": -5到5,
 "maxPct": 0到20,
 "breakout20": true/false,
 "pullback": true/false,
 "maxSwitchesPerDay": 0-20,
 "maxDailyLossPct": 0.2-10,
 "cooldownSec": 0-3600
}
约束：T+0 必须允许日内退出，不能设长持有；T+1 必须 maxHoldDays>=1，不能要求当日卖出；不准使用杠杆、做空、融资。
如果是 risk 模块，必须额外输出：
"risk": {
  "maxOrderAmount": 1000-100000,
  "maxSymbolPct": 5-100,
  "maxAccountExposurePct": 10-100,
  "minCashReserve": 0-10000,
  "maxOrdersPerDay": 1-100,
  "duplicateWindowSec": 0-3600,
  "stopLossPct": 0.5-10,
  "autoExecute": false
}
风控策略只能收紧或调整风险参数，autoExecute 默认 false，必须人工启用。`
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: cfg.model, temperature: 0.2, max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: `模块：${input.module}\n用户要求：${prompt}` }],
    }),
  })
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; model?: string }
  const content = data.choices?.[0]?.message?.content ?? ''
  if (!content) throw new Error('LLM 返回为空')
  const parsed = JSON.parse(content) as Record<string, unknown>
  return { spec: normalize(parsed, input.module), warnings: [], model: data.model || cfg.model, provider: cfg.provider, execution: 'deterministic-code' }
}

function normalize(raw: Record<string, unknown>, module: 't0' | 't1' | 'risk'): AiStrategySpec {
  const content = String(raw.content ?? '').slice(0, 6000)
  if (content.length < 20) throw new Error('LLM 没有生成有效策略正文')
  if (module === 'risk') {
    const r = (raw.risk ?? {}) as Record<string, unknown>
    const risk: AiRiskLimits = {
      maxOrderAmount: clamp(num(r.maxOrderAmount, 5_000), 100, 100_000),
      maxSymbolPct: clamp(num(r.maxSymbolPct, 30), 5, 100),
      maxAccountExposurePct: clamp(num(r.maxAccountExposurePct, 60), 10, 100),
      minCashReserve: clamp(num(r.minCashReserve, 100), 0, 10_000),
      maxOrdersPerDay: Math.round(clamp(num(r.maxOrdersPerDay, 10), 1, 100)),
      duplicateWindowSec: Math.round(clamp(num(r.duplicateWindowSec, 60), 0, 3600)),
      stopLossPct: clamp(num(r.stopLossPct, 2), 0.5, 10),
      autoExecute: false,
    }
    return {
      module: 'risk', name: String(raw.name ?? 'AI 风控策略').slice(0, 30), content,
      stages: ['修复', '发酵', '高潮'], minScore: 0, riskOnPositionPct: 0, riskOffPositionPct: 0,
      stopLossPct: risk.stopLossPct, takeProfitPct: 0, maxHoldDays: 1, entryCutoff: '14:30',
      priceAboveOpen: false, minPct: 0, maxPct: 0, breakout20: false, pullback: false,
      maxSwitchesPerDay: 0, maxDailyLossPct: 0.2, cooldownSec: 0, risk,
    }
  }
  const stages = Array.isArray(raw.stages) ? raw.stages.map(String).filter((s) => ['修复', '发酵', '高潮', '分歧', '退潮', '冰点'].includes(s)) : ['修复', '发酵', '高潮']
  const cutoff = String(raw.entryCutoff ?? (module === 't0' ? '14:45' : '14:30'))
  const spec: AiStrategySpec = {
    module,
    name: String(raw.name ?? 'AI 生成策略').slice(0, 30),
    content,
    stages: stages.length ? stages : ['修复', '发酵', '高潮'],
    minScore: clamp(num(raw.minScore, 55), 0, 100),
    riskOnPositionPct: clamp(num(raw.riskOnPositionPct, module === 't0' ? 50 : 30), 5, 70),
    riskOffPositionPct: clamp(num(raw.riskOffPositionPct, 30), 0, 70),
    stopLossPct: clamp(num(raw.stopLossPct, 3), 0.5, 10),
    takeProfitPct: clamp(num(raw.takeProfitPct, 5), 0.5, 20),
    maxHoldDays: Math.round(clamp(num(raw.maxHoldDays, module === 't0' ? 1 : 3), 1, 10)),
    entryCutoff: /^\d{1,2}:\d{2}$/.test(cutoff) ? cutoff : module === 't0' ? '14:45' : '14:30',
    priceAboveOpen: Boolean(raw.priceAboveOpen),
    minPct: clamp(num(raw.minPct, 0), -5, 5),
    maxPct: clamp(num(raw.maxPct, module === 't0' ? 100 : 5), 0, 20),
    breakout20: Boolean(raw.breakout20),
    pullback: Boolean(raw.pullback),
    maxSwitchesPerDay: Math.round(clamp(num(raw.maxSwitchesPerDay, 1), 0, 20)),
    maxDailyLossPct: clamp(num(raw.maxDailyLossPct, 2), 0.2, 10),
    cooldownSec: Math.round(clamp(num(raw.cooldownSec, 600), 0, 3600)),
  }
  return spec
}

function num(v: unknown, fallback: number): number { const n = Number(v); return Number.isFinite(n) ? n : fallback }
function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)) }
