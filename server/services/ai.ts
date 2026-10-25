import { createHash } from 'node:crypto'
import type { AiConclusion, AiEnvelope, AiInsight, AiStance, Snapshot, Tone } from '../../shared/types.js'
import { getResolvedLlmConfig } from './ai-config.js'
import { fmtAmountDelta } from './analysis.js'

const LOCAL_MODEL = 'quant-rule-v1'
const localCache = new Map<string, AiInsight>()
const llmCache = new Map<string, AiInsight>()

function fingerprint(snapshot: Snapshot): string {
  const core = [
    snapshot.tradingDate,
    snapshot.marketStatus,
    snapshot.sentiment.score,
    snapshot.sentiment.stage,
    snapshot.breadth.rise,
    snapshot.breadth.fall,
    snapshot.breadth.limitUp,
    snapshot.breadth.limitDown,
    snapshot.breadth.broken,
    Math.round(snapshot.breadth.amount / 1e8),
    snapshot.breadth.amountChangePct?.toFixed(2) ?? 'na',
    snapshot.headline.title,
    snapshot.anchors[0]?.stock.pct ?? 'na',
  ].join('|')
  return createHash('sha1').update(core).digest('hex').slice(0, 12)
}

export function llmConfig() {
  return getResolvedLlmConfig()
}

export function getLocalInsight(snapshot: Snapshot, force = false): AiInsight {
  const fp = fingerprint(snapshot)
  if (!force) {
    const cached = localCache.get(fp)
    if (cached) return cached
  }
  const insight = buildLocalInsight(snapshot, fp)
  localCache.clear()
  localCache.set(fp, insight)
  return insight
}

export function getCachedDeepInsight(snapshot: Snapshot): AiInsight | null {
  return llmCache.get(fingerprint(snapshot)) ?? null
}

export function getAiEnvelope(snapshot: Snapshot): AiEnvelope {
  const llm = llmConfig()
  const cachedDeep = getCachedDeepInsight(snapshot)
  return {
    insight: cachedDeep ?? getLocalInsight(snapshot),
    llmConfigured: Boolean(llm),
  }
}

export async function generateAi(snapshot: Snapshot, mode: 'local' | 'llm', force = false): Promise<AiEnvelope> {
  const llm = llmConfig()
  if (mode === 'llm') {
    if (!llm) {
      return {
        insight: getLocalInsight(snapshot, force),
        llmConfigured: false,
        llmError: '未配置 LLM_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY，已回退本地推理',
      }
    }
    const fp = fingerprint(snapshot)
    if (!force) {
      const cached = llmCache.get(fp)
      if (cached) return { insight: cached, llmConfigured: true }
    }
    try {
      const insight = await callLlm(snapshot, fp, llm)
      llmCache.clear()
      llmCache.set(fp, insight)
      return { insight, llmConfigured: true }
    } catch (err) {
      return {
        insight: getLocalInsight(snapshot, true),
        llmConfigured: true,
        llmError: err instanceof Error ? `大模型调用失败：${err.message}` : '大模型调用失败，已回退本地推理',
      }
    }
  }
  llmCache.clear()
  return { insight: getLocalInsight(snapshot, force), llmConfigured: Boolean(llm) }
}

function buildLocalInsight(snapshot: Snapshot, fp: string): AiInsight {
  const { sentiment, breadth, anchors, themes, sectors, headline, phase, rules } = snapshot
  const space = anchors.find((a) => a.role === '空间龙')?.stock
  const vice = anchors.find((a) => a.role === '次高标')?.stock
  const loss = anchors.find((a) => a.role === '跌停锚')?.stock
  const theme = themes[0]
  const themeName = theme?.name || sectors.concept[0]?.name || sectors.industry[0]?.name || '结构性题材'
  const stance: AiStance = ['发酵', '高潮', '修复'].includes(sentiment.stage)
    ? sentiment.risk === '高'
      ? '观察'
      : '进攻'
    : sentiment.stage === '分歧'
      ? '观察'
      : '防守'
  const amountText = breadth.amountChangePct == null ? '量能基线待同步' : `同时段${breadth.amountChangePct >= 0 ? '放量' : '缩量'} ${fmtAmountDelta(breadth.amountDiff)} / ${Math.abs(breadth.amountChangePct).toFixed(2)}%`
  const indexText = snapshot.indices
    .slice(0, 4)
    .map((i) => `${i.name} ${i.pct >= 0 ? '+' : ''}${i.pct.toFixed(2)}%`)
    .join('，')
  const title =
    stance === '防守'
      ? `${themeName}退潮，${space?.name ?? '空间龙'}孤木难支｜${sentiment.stage}期先守后攻`
      : stance === '观察'
        ? `${space?.name ?? themeName}高度承压，${themeName}内部缩圈｜${sentiment.stage}期等确认`
        : `${space?.name ?? themeName}${space?.limitUpDays ?? ''}板打开空间，${themeName}领涨｜${sentiment.stage}期聚焦核心`
  const conclusions: AiConclusion[] = [
    {
      label: '情绪结构',
      text: `情绪温度 ${sentiment.score}，${sentiment.stage}；上涨 ${breadth.rise} 家 / 下跌 ${breadth.fall} 家，涨跌比 ${breadth.ratio.toFixed(2)}；涨停 ${breadth.limitUp} / 跌停 ${breadth.limitDown}。${sentiment.summary}`,
      tone: sentiment.risk === '高' ? 'down' : sentiment.risk === '中' ? 'warn' : 'up',
    },
    {
      label: '主线判断',
      text: theme
        ? `${theme.name}聚集 ${theme.count} 家涨停，${theme.stocks.slice(0, 3).join('、')} 为辨识度核心；${sectors.concept[0] ? `概念端 ${sectors.concept[0].name} ${sectors.concept[0].pct >= 0 ? '+' : ''}${sectors.concept[0].pct.toFixed(2)}%` : ''}。`
        : '涨停池暂未形成 5 家以上的主线簇，资金以个股辨识度为主。',
      tone: theme ? 'up' : 'warn',
    },
    {
      label: '个股锚定',
      text: `${space ? `${space.name}（${space.limitUpDays}板）为空间锚` : '空间锚待确认'}；${vice ? `${vice.name}为次高标` : '次高标缺失'}；${loss ? `${loss.name}（${loss.limitDownDays || 1}连跌停）为亏钱效应锚` : '跌停锚较弱'}。`,
      tone: loss ? 'down' : 'flat',
    },
  ]
  const attack =
    stance === '进攻'
      ? `围绕${themeName}核心与低位补涨，优先做分歧回封与首次分歧低吸；不追一致加速，仓位以 5-6 成为中枢。`
      : stance === '观察'
        ? `只做 ${themeName} 核心的回封确认与低位首板，中位股不接力；确认前仓位 3-5 成。`
        : `先防守，控制仓位在 3 成以内；不接高位断板，不博弈弱转强，等跌停收敛与首板晋级。`
  const avoid =
    sentiment.stage === '退潮' || sentiment.stage === '冰点'
      ? '高位断板、昨日涨停补跌、无量跟风；不在退潮期做“便宜”幻想。'
      : '高位一致加速、后排跟风、缩量反抽；破位不补仓。'
  const confirm = `${space?.name ?? '空间龙'}次日溢价、${themeName}维持 5 家以上涨停、跌停收敛至 10 家以内；任一不满足，按${sentiment.stage === '发酵' ? '分歧' : '退潮'}处理。`
  const risks: string[] = []
  if (breadth.limitDown >= 5) risks.push(`跌停 ${breadth.limitDown} 家，亏钱效应仍在扩散`)
  if ((sentiment.breakRate ?? 0) > 35) risks.push(`涨停池回封占比 ${sentiment.breakRate}%，封板质量偏弱`)
  if ((breadth.amountChangePct ?? 0) < 0) risks.push(`量能${breadth.amountChangePct?.toFixed(1)}%，缺少增量确认`)
  if (breadth.ratio < 1) risks.push('上涨家数不占优，赚钱效应偏窄')
  if (!risks.length) risks.push('主线一致性较高，注意高潮次日分歧与兑现')
  const failed = rules.stage.filter((r) => r.status === 'fail').map((r) => r.label)
  if (failed.length) risks.push(`阶段条件未满足：${failed.join('、')}`)
  return {
    fingerprint: fp,
    generatedAt: new Date().toISOString(),
    mode: 'local',
    provider: 'local-engine',
    model: LOCAL_MODEL,
    title,
    stance,
    confidence: Math.min(94, sentiment.confidence + (theme ? 3 : 0)),
    summary: `${indexText}。两市成交 ${(breadth.amount / 1e12).toFixed(2)} 万亿，${amountText}；情绪温度 ${sentiment.score}（${sentiment.stage}），${headline.action}`,
    conclusions,
    attack,
    avoid,
    confirm,
    risks: risks.slice(0, 4),
    sourceNote: '基于当前快照的本地量化规则生成，未调用外部大模型；配置 LLM_API_KEY 后可切换深度研判。',
  }
}

async function callLlm(
  snapshot: Snapshot,
  fp: string,
  cfg: NonNullable<ReturnType<typeof llmConfig>>,
): Promise<AiInsight> {
  const compact = {
    tradingDate: snapshot.tradingDate,
    marketStatus: snapshot.marketStatus,
    phase: snapshot.phase.short,
    indices: snapshot.indices.map((i) => ({ name: i.name, pct: round(i.pct), amount: i.amount })),
    breadth: {
      rise: snapshot.breadth.rise,
      fall: snapshot.breadth.fall,
      limitUp: snapshot.breadth.limitUp,
      limitDown: snapshot.breadth.limitDown,
      ratio: round(snapshot.breadth.ratio),
      amount: snapshot.breadth.amount,
      amountChangePct: snapshot.breadth.amountChangePct == null ? null : round(snapshot.breadth.amountChangePct),
    },
    sentiment: {
      score: snapshot.sentiment.score,
      stage: snapshot.sentiment.stage,
      risk: snapshot.sentiment.risk,
      components: snapshot.sentiment.components,
    },
    anchors: snapshot.anchors.map((a) => ({ role: a.role, name: a.stock.name, code: a.stock.code, pct: a.stock.pct, reason: a.reason })),
    leaders: snapshot.leaders.map((s) => ({ name: s.name, code: s.code, pct: s.pct, tags: s.tags })),
    laggards: snapshot.laggards.map((s) => ({ name: s.name, code: s.code, pct: s.pct, tags: s.tags })),
    themes: snapshot.themes.slice(0, 5),
    sectors: {
      industry: snapshot.sectors.industry.slice(0, 4).map((s) => ({ name: s.name, pct: s.pct, leader: s.leader })),
      concept: snapshot.sectors.concept.slice(0, 4).map((s) => ({ name: s.name, pct: s.pct, leader: s.leader })),
    },
    rules: snapshot.rules,
    headline: snapshot.headline,
  }
  const system = `你是一名严谨的A股超短线情绪交易复盘助手。只依据用户提供的行情快照分析，不得编造数据、新闻或个股逻辑。输出必须是合法 JSON，不要 Markdown 代码块。
字段要求：
{
 "title": "一句话标题，含空间龙/主线/阶段",
 "stance": "进攻|观察|防守",
 "confidence": 0-100整数,
 "summary": "2-3句，包含指数、广度、量能、情绪",
 "conclusions": [{"label":"情绪结构|主线判断|个股锚定","text":"...","tone":"up|down|warn|flat"}],
 "attack": "进攻/观察方向，具体但简短",
 "avoid": "规避方向",
 "confirm": "次日确认条件，含数字",
 "risks": ["风险1","风险2","风险3"]
}
不要给出买卖指令或收益承诺。`
  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.key}`,
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.35,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `实时行情快照如下，请生成研判：\n${JSON.stringify(compact)}` },
      ],
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${text.slice(0, 120)}`)
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[]
    model?: string
  }
  const message = data.choices?.[0]?.message
  const content = message?.content || ''
  if (!content) {
    // Some reasoning models put the JSON draft in reasoning_content when max_tokens is tight.
    // Prefer a clean content response; only use reasoning as a last resort.
    if (message?.reasoning_content) {
      try {
        const parsed = parseJson(message.reasoning_content)
        return buildLlmInsight(snapshot, fp, cfg, data.model, parsed)
      } catch {
        // fall through to the clear error
      }
    }
    throw new Error(`empty LLM response (finish=${data.choices?.[0]?.finish_reason ?? 'unknown'})`)
  }
  const parsed = parseJson(content)
  return buildLlmInsight(snapshot, fp, cfg, data.model, parsed)
}

function buildLlmInsight(
  snapshot: Snapshot,
  fp: string,
  cfg: NonNullable<ReturnType<typeof llmConfig>>,
  responseModel: string | undefined,
  parsed: any,
): AiInsight {
  const stance = ['进攻', '观察', '防守'].includes(parsed.stance) ? (parsed.stance as AiStance) : '观察'
  const conclusions = Array.isArray(parsed.conclusions)
    ? parsed.conclusions.slice(0, 4).map((c: any, i: number) => ({
        label: String(c?.label ?? `结论${i + 1}`).slice(0, 20),
        text: String(c?.text ?? '').slice(0, 280),
        tone: normalizeTone(c?.tone),
      }))
    : []
  return {
    fingerprint: fp,
    generatedAt: new Date().toISOString(),
    mode: 'llm',
    provider: cfg.provider,
    model: responseModel || cfg.model,
    title: String(parsed.title ?? snapshot.headline.title).slice(0, 90),
    stance,
    confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 70))),
    summary: String(parsed.summary ?? '').slice(0, 700),
    conclusions,
    attack: String(parsed.attack ?? '').slice(0, 300),
    avoid: String(parsed.avoid ?? '').slice(0, 300),
    confirm: String(parsed.confirm ?? '').slice(0, 300),
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5).map((r: unknown) => String(r).slice(0, 160)) : [],
    sourceNote: `由 ${cfg.provider} / ${responseModel || cfg.model} 基于当前快照生成，仅供参考。`,
  }
}

function parseJson(content: string): any {
  const cleaned = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('invalid JSON response')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function normalizeTone(tone: unknown): Tone {
  return tone === 'up' || tone === 'down' || tone === 'warn' ? tone : 'flat'
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
