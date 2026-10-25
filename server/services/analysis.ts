import type {
  Anchor,
  Breadth,
  ChartPoint,
  ForeignFear,
  Headline,
  LogBlock,
  Logs,
  MarketIndex,
  MarketPhaseKey,
  PhaseInfo,
  RuleCheck,
  Rules,
  Sector,
  Sentiment,
  Snapshot,
  SourceStatus,
  Stage,
  Stock,
  ThemeCluster,
  Tone,
} from '../../shared/types.js'
import type { QuoteMap } from '../providers/sina.js'
import type { RawBreadth, RawPoolItem } from '../providers/xgb.js'
import { timeLabel } from '../providers/xgb.js'

export interface AnalysisInput {
  now: number
  indices: MarketIndex[]
  breadthPoints: RawBreadth[]
  limitUpsRaw: RawPoolItem[]
  limitDownsRaw: RawPoolItem[]
  topRows: Stock[]
  bottomRows: Stock[]
  industry: Sector[]
  concept: Sector[]
  quotes: QuoteMap
  previousAmount: number
  avg5Amount: number | null
  prevWindowAmount: number
  avg5WindowAmount: number | null
  windowLabel: string | null
  windowDays: number | null
  watchlistCodes: string[]
  sources: SourceStatus[]
  refreshMs: number
  latencyMs: number
  notice?: string | null
  foreignFear?: ForeignFear | null
}

const TOTAL_STOCKS = 5574

export function buildSnapshot(input: AnalysisInput): Snapshot {
  const nowParts = shanghaiParts(input.now)
  const tradingDate = input.indices[0]?.date || nowParts.date
  const dataAsOf = input.indices[0]?.time
    ? `${input.indices[0].date} ${input.indices[0].time}`
    : `${nowParts.date} ${nowParts.time}`
  const marketStatus = resolveMarketStatus(input.now, tradingDate, input.indices[0]?.time)
  const phases = buildPhases(input.now, tradingDate, marketStatus)
  const phase = phases.find((p) => p.state === 'active') ?? phases[phases.length - 1]

  const limitUps = input.limitUpsRaw
    .map((s) => enrichStock(toStockFromRaw(s, 'limitUp'), input.quotes))
    .sort(sortLimitUp)
  const limitDowns = input.limitDownsRaw
    .map((s) => enrichStock(toStockFromRaw(s, 'limitDown'), input.quotes))
    .sort((a, b) => b.limitDownDays - a.limitDownDays || a.pct - b.pct)
  const topRows = input.topRows.map((s) => enrichStock(s, input.quotes)).sort((a, b) => b.pct - a.pct)
  const bottomRows = input.bottomRows.map((s) => enrichStock(s, input.quotes)).sort((a, b) => a.pct - b.pct)
  const leaders = buildLeaders(limitUps, topRows)
  const laggards = dedupe([...limitDowns, ...bottomRows.filter((s) => s.pct < 0)])
    .filter(anchorable)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 6)

  const latest = input.breadthPoints[input.breadthPoints.length - 1]
  const rise = latest?.rise_count ?? 0
  const fall = latest?.fall_count ?? 0
  const limitUp = latest?.limit_up_count ?? limitUps.length
  const limitDown = latest?.limit_down_count ?? limitDowns.length
  const total = Math.max(TOTAL_STOCKS, rise + fall)
  const flat = Math.max(0, total - rise - fall)
  const amount = input.indices
    .filter((i) => i.code === '000001' || i.code === '399001')
    .reduce((sum, i) => sum + i.amount, 0)
  const previousAmount = input.prevWindowAmount || 0
  const avg5Amount = input.avg5WindowAmount || null
  const brokenEver = limitUps.filter((s) => s.breakCount > 0).length
  const breadth: Breadth = {
    rise,
    fall,
    flat,
    limitUp,
    limitDown,
    broken: brokenEver,
    total,
    ratio: fall > 0 ? rise / fall : rise,
    amount,
    prevAmount: previousAmount,
    amountChangePct: previousAmount ? ((amount - previousAmount) / previousAmount) * 100 : null,
    amountDiff: previousAmount ? amount - previousAmount : null,
    avg5Amount,
    amountVs5Pct: avg5Amount ? ((amount - avg5Amount) / avg5Amount) * 100 : null,
    amountVs5Diff: avg5Amount ? amount - avg5Amount : null,
    amountWindow: input.windowLabel,
    amountWindowDays: input.windowDays,
  }

  const coreIndices = input.indices.filter((i) => i.code !== '899050')
  const avgIndexPct = coreIndices.length
    ? coreIndices.reduce((sum, i) => sum + i.pct, 0) / coreIndices.length
    : 0
  const maxBoard = limitUps.reduce((max, s) => Math.max(max, s.limitUpDays), 0)
  const multiBoard = limitUps.filter((s) => s.limitUpDays > 1).length
  const breakRate = limitUps.length ? brokenEver / limitUps.length : 0
  const sealRate = limitUps.length ? 1 - breakRate : 0
  const chart = buildChart(input.breadthPoints)
  const sentiment = buildSentiment({
    breadth,
    limitUps,
    limitDowns,
    avgIndexPct,
    maxBoard,
    multiBoard,
    breakRate,
    sealRate,
    chart,
    foreignFear: input.foreignFear ?? null,
  })
  const themes = buildThemes(input.limitUpsRaw, input.concept, limitUps)
  const sectors = {
    industry: input.industry.slice(0, 12),
    concept: input.concept.slice(0, 12),
  }
  const anchors = buildAnchors(limitUps, limitDowns, leaders, laggards, topRows)
  const headline = buildHeadline({
    stage: sentiment.stage,
    score: sentiment.score,
    limitUps,
    limitDowns,
    breadth,
    themes,
    sectors,
    maxBoard,
    multiBoard,
    avgIndexPct,
    phase,
  })
  const logs = buildLogs({
    indices: input.indices,
    breadth,
    sentiment,
    limitUps,
    limitDowns,
    maxBoard,
    multiBoard,
    themes,
    sectors,
    avgIndexPct,
    topRows,
    laggards,
    phase,
  })
  const rules = buildRules({ breadth, limitUps, limitDowns, maxBoard, themes, avgIndexPct, sentiment })
  const watchlist = input.watchlistCodes
    .map((code) => {
      const fromPool = [...limitUps, ...limitDowns, ...topRows, ...bottomRows].find((s) => s.code === code)
      if (fromPool) return fromPool
      return stockFromQuote(code, input.quotes)
    })
    .filter((s): s is Stock => Boolean(s))

  return {
    version: input.now,
    generatedAt: new Date(input.now).toISOString(),
    tradingDate,
    dataAsOf,
    marketStatus,
    phase,
    phases,
    indices: input.indices,
    breadth,
    sentiment,
    headline,
    anchors,
    leaders,
    laggards,
    limitUps: limitUps.slice().sort(sortLimitUp).slice(0, 30),
    limitDowns: limitDowns.slice().sort((a, b) => b.limitDownDays - a.limitDownDays || a.pct - b.pct),
    sectors,
    themes,
    logs,
    rules,
    watchlist,
    chart,
    sources: input.sources,
    refreshMs: input.refreshMs,
    nextRefreshAt: new Date(input.now + input.refreshMs).toISOString(),
    latencyMs: input.latencyMs,
    notice: input.notice ?? null,
  }
}

function buildSentiment(args: {
  breadth: Breadth
  limitUps: Stock[]
  limitDowns: Stock[]
  avgIndexPct: number
  maxBoard: number
  multiBoard: number
  breakRate: number
  sealRate: number
  chart: ChartPoint[]
  foreignFear: ForeignFear | null
}): Sentiment {
  const { breadth, limitUps, limitDowns, avgIndexPct, maxBoard, breakRate, sealRate, chart, foreignFear } = args
  const ratio = breadth.rise / Math.max(1, breadth.rise + breadth.fall)
  const balance = (breadth.limitUp - breadth.limitDown) / (breadth.limitUp + breadth.limitDown + 8)
  const breadthScore = ratio * 100
  const limitScore = ((balance + 1) / 2) * 100
  const sealScore = sealRate * 100
  const heightScore = Math.min(1, maxBoard / 6) * 100
  const momentumScore = Math.min(100, Math.max(0, ((avgIndexPct + 2) / 4) * 100))
  const foreignScore = foreignFear ? 100 - foreignFear.score : 50
  let score =
    (breadthScore * 0.31 + limitScore * 0.20 + sealScore * 0.15 + heightScore * 0.14 + momentumScore * 0.12) * 0.92 + foreignScore * 0.08

  if (breadth.limitDown >= 20 && breadth.limitUp < 30) score = Math.min(score, 24)
  if (breadth.limitUp >= 80 && ratio > 0.68) score = Math.max(score, 86)
  score = Math.round(Math.max(0, Math.min(100, score)))

  let stage: Stage
  if (breadth.limitUp < 20 && breadth.limitDown >= 15) {
    stage = '冰点'
  } else if (breadth.rise / Math.max(1, breadth.fall) < 0.55 || breadth.limitDown >= 18) {
    stage = '退潮'
  } else if (breadth.limitUp >= 80 && ratio > 0.68) {
    stage = '高潮'
  } else if (breadth.limitUp >= 45 && ratio > 0.58 && breadth.limitDown <= 10 && maxBoard >= 3) {
    stage = '发酵'
  } else if (ratio >= 0.55 && score >= 54) {
    stage = '修复'
  } else {
    stage = '分歧'
  }
  const stageKeyMap: Record<Stage, string> = {
    冰点: 'ice',
    退潮: 'ebb',
    分歧: 'diverge',
    修复: 'repair',
    发酵: 'ferment',
    高潮: 'climax',
    过热: 'overheat',
  }
  const summaryMap: Record<Stage, string> = {
    冰点: '亏钱效应主导，优先防守，等跌停收敛与首板确认。',
    退潮: '高位补跌扩散，控制仓位，不做弱转强幻想。',
    分歧: '多空换手加剧，只做核心回封与低位确认。',
    修复: '亏钱效应收敛，试错仓位向主线核心集中。',
    发酵: '赚钱效应扩散，围绕主线辨识度持股。',
    高潮: '一致性最强，兑现预期同步升温，去弱留强。',
    过热: '情绪透支，提防高位分歧与集中兑现。',
  }
  const risk: '低' | '中' | '高' =
    breadth.limitDown >= 15 || ratio < 0.4 ? '高' : breakRate > 0.32 || score < 50 ? '中' : '低'
  const prior = chart.length > 8 ? chart[Math.max(0, chart.length - 9)].temp : chart[0]?.temp ?? score
  const trend = Math.round((score - prior) * 10) / 10
  const components = [
    {
      label: '涨跌家数',
      value: Math.round(ratio * 1000) / 10,
      score: Math.round(breadthScore),
      detail: `${breadth.rise} 涨 / ${breadth.fall} 跌`,
      tone: ratio >= 0.5 ? ('up' as Tone) : ('down' as Tone),
    },
    {
      label: '涨跌停差',
      value: breadth.limitUp - breadth.limitDown,
      score: Math.round(limitScore),
      detail: `${breadth.limitUp} 涨停 / ${breadth.limitDown} 跌停`,
      tone: breadth.limitUp >= breadth.limitDown ? ('up' as Tone) : ('down' as Tone),
    },
    {
      label: '封板质量',
      value: Math.round(sealRate * 1000) / 10,
      score: Math.round(sealScore),
      detail: `${args.limitUps.filter((s) => s.breakCount > 0).length} 只回封`,
      tone: sealRate >= 0.65 ? ('up' as Tone) : ('warn' as Tone),
    },
    {
      label: '空间高度',
      value: maxBoard,
      score: Math.round(heightScore),
      detail: `${args.multiBoard} 只连板`,
      tone: maxBoard >= 4 ? ('up' as Tone) : ('flat' as Tone),
    },
    {
      label: '海外恐慌',
      value: foreignFear?.score ?? 50,
      score: Math.round(foreignScore),
      detail: foreignFear?.detail ?? '外部数据暂不可用',
      tone: foreignFear && foreignFear.score >= 60 ? ('down' as Tone) : foreignFear && foreignFear.score <= 30 ? ('up' as Tone) : ('flat' as Tone),
    },
    {
      label: '指数动量',
      value: Math.round(avgIndexPct * 100) / 100,
      score: Math.round(momentumScore),
      detail: `核心指数均值`,
      tone: avgIndexPct >= 0 ? ('up' as Tone) : ('down' as Tone),
    },
  ]
  const stageLabel: Record<Stage, string> = {
    冰点: '冰点防守',
    退潮: '退潮防守',
    分歧: '分歧换手',
    修复: '修复试错',
    发酵: '发酵进攻',
    高潮: '高潮兑现',
    过热: '过热警惕',
  }
  return {
    score,
    stage,
    stageKey: stageKeyMap[stage],
    label: stageLabel[stage],
    summary: summaryMap[stage],
    risk,
    confidence: Math.min(96, 62 + Math.round(Math.abs(ratio - 0.5) * 40) + (maxBoard >= 3 ? 8 : 0)),
    components,
    foreignFear,
    sealRate: Math.round(sealRate * 1000) / 10,
    breakRate: Math.round(breakRate * 1000) / 10,
    height: maxBoard,
    trend,
  }
}

function buildChart(points: RawBreadth[]): ChartPoint[] {
  const recent = points.slice(-260)
  return recent.map((p) => {
    const ratio = p.rise_count / Math.max(1, p.rise_count + p.fall_count)
    const balance = (p.limit_up_count - p.limit_down_count) / (p.limit_up_count + p.limit_down_count + 8)
    const temp = Math.round(
      Math.max(
        4,
        Math.min(98, 15 + ratio * 55 + balance * 20 + Math.max(-0.18, Math.min(0.18, (p.limit_up_count - 30) / 90)) * 15),
      ),
    )
    return {
      time: timeLabel(p.timestamp),
      ts: p.timestamp,
      rise: p.rise_count,
      fall: p.fall_count,
      limitUp: p.limit_up_count,
      limitDown: p.limit_down_count,
      temp,
    }
  })
}

function buildThemes(raw: RawPoolItem[], concept: Sector[], limitUps: Stock[]): ThemeCluster[] {
  const map = new Map<string, { stocks: string[]; reason: string }>()
  const generic = new Set([
    '其他', '业绩增长', '昨日涨停', '融资融券', '转融券标的', '深股通', '沪股通',
    '机构重仓', '基金重仓', '预盈预增', '年报预增', '次新股', '新股与次新股', '昨日连板',
  ])
  for (const item of raw) {
    const plates = item.surge_reason?.related_plates ?? []
    for (const plate of plates) {
      if (generic.has(plate.plate_name)) continue
      const existing = map.get(plate.plate_name) ?? { stocks: [], reason: '' }
      if (!existing.stocks.includes(item.stock_chi_name)) existing.stocks.push(item.stock_chi_name)
      if (!existing.reason && plate.plate_reason) existing.reason = plate.plate_reason
      map.set(plate.plate_name, existing)
    }
  }
  const clusters = [...map.entries()]
    .map(([name, value]) => {
      const sector = concept.find((c) => c.name.includes(name) || name.includes(c.name))
      return {
        name,
        count: value.stocks.length,
        stocks: value.stocks.slice(0, 4),
        reason: value.reason || (sector ? `板块涨幅 ${signed(sector.pct)}%，领涨 ${sector.leader}` : '涨停池共振'),
        tone: 'up' as Tone,
      }
    })
    .sort((a, b) => b.count - a.count)
  if (clusters.length > 0) return clusters.slice(0, 6)
  return limitUps.slice(0, 4).map((s) => ({
    name: s.theme || '个股行情',
    count: 1,
    stocks: [s.name],
    reason: s.reason || `${s.limitUpDays}连板，独立辨识度`,
    tone: 'up' as Tone,
  }))
}

function buildAnchors(
  limitUps: Stock[],
  limitDowns: Stock[],
  leaders: Stock[],
  laggards: Stock[],
  topRows: Stock[],
): Anchor[] {
  const used = new Set<string>()
  const pool = dedupe([...limitUps, ...leaders, ...topRows, ...limitDowns, ...laggards]).filter(anchorable)
  const pick = (fn: (s: Stock) => number, filter: (s: Stock) => boolean = () => true): Stock | undefined => {
    const candidates = pool
      .filter((s) => !used.has(s.code) && filter(s))
      .sort((a, b) => fn(b) - fn(a))
    const chosen = candidates[0]
    if (chosen) used.add(chosen.code)
    return chosen
  }
  const anchors: Anchor[] = []
  const push = (role: string, stock: Stock | undefined, label: string, reason: string) => {
    if (!stock) return
    anchors.push({
      id: `${role}-${stock.code}`,
      role,
      label,
      stock,
      reason,
      tone: stock.tone,
      metric: `${signed(stock.pct)}%`,
    })
  }
  const space = pick((s) => s.limitUpDays * 1000 + s.pct, (s) => s.status === 'limitUp')
  push('空间龙', space, space ? `${space.limitUpDays}板空间` : '—', space ? reasonFor(space) : '')
  const vice = pick((s) => s.limitUpDays * 1000 + s.lockRatio, (s) => s.status === 'limitUp')
  push('次高标', vice, vice ? `${vice.limitUpDays}板` : '—', vice ? reasonFor(vice) : '')
  const turnover = pick((s) => s.turnover, (s) => s.status === 'limitUp')
  push('换手龙', turnover, turnover ? `换手${fmtPct(turnover.turnover)}` : '—', turnover ? reasonFor(turnover) : '')
  const capacity = pick((s) => s.marketCap, (s) => s.status === 'limitUp')
  push('容量核心', capacity, capacity ? fmtMarketCap(capacity.marketCap) : '—', capacity ? reasonFor(capacity) : '')
  const reseal = pick((s) => s.breakCount, (s) => s.status === 'limitUp' && s.breakCount > 0)
  push('回封先锋', reseal, reseal ? `回封${reseal.breakCount}次` : '—', reseal ? reasonFor(reseal) : '')
  const elastic = pick((s) => s.pct, (s) => s.status === 'limitUp' && /^(30|68|92)/.test(s.code))
  push('20cm弹性', elastic, elastic ? '20cm' : '—', elastic ? reasonFor(elastic) : '')
  const limitDown = pick((s) => s.limitDownDays * 100 + Math.abs(s.pct), (s) => s.status === 'limitDown')
  push('跌停锚', limitDown, limitDown ? `${limitDown.limitDownDays}连跌停` : '—', limitDown ? reasonFor(limitDown) : '')
  const bigLoss = pick((s) => -s.pct, (s) => s.pct < 0 && s.status !== 'limitDown')
  push('大面锚', bigLoss, bigLoss ? '亏钱效应' : '—', bigLoss ? reasonFor(bigLoss) : '')
  const watch = pick(
    (s) => (s.status === 'limitUp' ? 50 : 0) + s.pct + (s.theme ? 10 : 0),
    (s) => s.pct > 0,
  )
  push('主线观察', watch, watch ? watch.theme || '趋势' : '—', watch ? reasonFor(watch) : '')
  return anchors.slice(0, 9)
}

function buildHeadline(args: {
  stage: Stage
  score: number
  limitUps: Stock[]
  limitDowns: Stock[]
  breadth: Breadth
  themes: ThemeCluster[]
  sectors: { industry: Sector[]; concept: Sector[] }
  maxBoard: number
  multiBoard: number
  avgIndexPct: number
  phase: PhaseInfo
}): Headline {
  const space = args.limitUps.slice().sort(sortLimitUp)[0]
  const theme = args.themes[0]?.name || args.sectors.concept[0]?.name || args.sectors.industry[0]?.name || '局部结构'
  const lead = space ? `${space.name}${space.limitUpDays}板` : `${theme}领涨`
  const move = `${signed(args.avgIndexPct)}%`
  let title: string
  let action: string
  if (args.stage === '冰点' || args.stage === '退潮') {
    title = `${lead}独木难支，${args.breadth.limitDown}家跌停｜${args.stage}期，先防守`
    action = '压缩仓位，回避高位断板与一致加速；只保留抗跌核心观察，不接飞刀。'
  } else if (args.stage === '高潮') {
    title = `${theme}全面扩散，${args.breadth.limitUp}家涨停｜高潮日，去弱留强`
    action = '兑现一致加速，仓位向主线核心集中；不在高潮日追后排，等待分歧回封。'
  } else if (args.stage === '分歧') {
    title = `${lead}承压，${args.breadth.broken}只回封｜分歧加剧，等确认`
    action = '只做核心回封与低位首板，回避中位股；不确认不加仓，破位即降仓。'
  } else {
    title = `${lead}打开空间，${theme}领涨｜${args.breadth.limitUp}家涨停·${args.breadth.limitDown}家跌停`
    action = `围绕${theme}核心与低位补涨，分歧低吸、一致不追；用回封与量能确认强度。`
  }
  const summary =
    `核心指数均值 ${move}，两市成交 ${fmtAmount(args.breadth.amount)}` +
    `${args.breadth.amountChangePct == null ? '' : `（同时段${args.breadth.amountDiff != null && args.breadth.amountDiff < 0 ? '缩量' : '放量'} ${fmtAmountDelta(args.breadth.amountDiff)} / ${Math.abs(args.breadth.amountChangePct).toFixed(2)}%）`}。` +
    `上涨 ${args.breadth.rise} 家 / 下跌 ${args.breadth.fall} 家，空间高度 ${args.maxBoard} 板，` +
    `连板 ${args.multiBoard} 家，情绪温度 ${args.score}。`
  const confirm =
    `确认信号：${space?.name ?? '空间龙'}次日溢价、${theme}涨停≥5家、跌停≤10家；` +
    `若高位股补跌或成交萎缩，则按${args.stage === '发酵' ? '分歧' : '退潮'}处理。`
  return {
    kicker: `${args.phase.short} · ${args.stage} · 情绪温度 ${args.score}`,
    title,
    summary,
    action,
    confirm,
    tone: ['高潮', '发酵', '修复'].includes(args.stage) ? 'up' : args.stage === '分歧' ? 'warn' : 'down',
    confidence: Math.min(95, 60 + args.maxBoard * 4 + Math.min(12, args.multiBoard)),
  }
}

function buildLogs(args: {
  indices: MarketIndex[]
  breadth: Breadth
  sentiment: Sentiment
  limitUps: Stock[]
  limitDowns: Stock[]
  maxBoard: number
  multiBoard: number
  themes: ThemeCluster[]
  sectors: { industry: Sector[]; concept: Sector[] }
  avgIndexPct: number
  topRows: Stock[]
  laggards: Stock[]
  phase: PhaseInfo
}): Logs {
  const { breadth, sentiment, limitUps, limitDowns, themes, sectors } = args
  const sh = args.indices.find((i) => i.code === '000001')
  const cyb = args.indices.find((i) => i.code === '399006')
  const kc = args.indices.find((i) => i.code === '000688')
  const bz = args.indices.find((i) => i.code === '899050')
  const space = limitUps[0]
  const tracking = limitUps.slice(0, 3)
  const topTheme = themes[0]
  const topIndustry = sectors.industry[0]
  const topConcept = sectors.concept[0]
  const leadingIndex = args.indices.slice().sort((a, b) => b.pct - a.pct)[0]
  const laggingIndex = args.indices.slice().sort((a, b) => a.pct - b.pct)[0]
  const style =
    (sh?.pct ?? 0) > (cyb?.pct ?? 0) + 0.4
      ? '权重相对占优，题材内部缩圈'
      : (cyb?.pct ?? 0) > (sh?.pct ?? 0) + 0.4
        ? '成长风格占优，小盘弹性更强'
        : '大小盘均衡，结构性行情为主'
  const resonance =
    args.avgIndexPct > 0 && breadth.ratio > 1.2
      ? '指数与家数共振向上'
      : args.avgIndexPct < 0 && breadth.ratio < 0.9
        ? '指数与家数共振向下'
        : args.avgIndexPct > 0
          ? '指数强、个股分化，赚钱效应未全面扩散'
          : '指数弱、个股活跃，结构性背离'
  const amountText =
    breadth.amountChangePct == null
      ? fmtAmount(breadth.amount)
      : `${fmtAmount(breadth.amount)}（同时段${breadth.amountChangePct >= 0 ? '放量' : '缩量'} ${fmtAmountDelta(breadth.amountDiff)} / ${Math.abs(breadth.amountChangePct).toFixed(2)}%）`
  const market: LogBlock = {
    title: '大盘环境',
    badge: args.phase.short,
    paragraphs: [
      `指数：上证 ${signed(sh?.pct)}%，深成 ${signed(args.indices.find((i) => i.code === '399001')?.pct)}%，创业板 ${signed(cyb?.pct)}%，科创50 ${signed(kc?.pct)}%。`,
      `广度：上涨 ${breadth.rise} 家，下跌 ${breadth.fall} 家，涨跌比 ${breadth.ratio.toFixed(2)}；涨停 ${breadth.limitUp} 家、跌停 ${breadth.limitDown} 家，${resonance}。`,
    ],
    bullets: [
      { label: '两市成交', value: amountText, tone: (breadth.amountChangePct ?? 0) >= 0 ? 'up' : 'down' },
      {
        label: '量能对比',
        value:
          breadth.amountVs5Pct == null
            ? '同时段均值待同步'
            : `较5日同时段均值 ${breadth.amountVs5Diff != null && breadth.amountVs5Diff < 0 ? '缩量' : '放量'} ${fmtAmountDelta(breadth.amountVs5Diff)} / ${Math.abs(breadth.amountVs5Pct).toFixed(2)}%`,
        tone: (breadth.amountVs5Pct ?? 0) >= 0 ? 'up' : 'down',
      },
      { label: '指数结构', value: `${leadingIndex?.name ?? '—'}强 / ${laggingIndex?.name ?? '—'}弱`, tone: 'flat' },
      { label: '风格', value: style, tone: 'flat' },
    ],
    footer: `数据时点 ${args.phase.time} · 涨跌家数来自全市场分钟快照`,
  }
  const scan: LogBlock = {
    title: '新方向扫描',
    badge: topTheme ? `${topTheme.count}家涨停` : '轮动',
    paragraphs: topTheme
      ? [
          `涨停簇：${topTheme.name} ${topTheme.count} 家，${topTheme.stocks.join('、')}。${topTheme.reason}`,
          `板块：${topConcept ? `${topConcept.name} ${signed(topConcept.pct)}%（领涨 ${topConcept.leader}）` : '概念数据待同步'}；${topIndustry ? `${topIndustry.name} ${signed(topIndustry.pct)}%` : ''}。`,
        ]
      : ['涨停池暂未形成明确板块簇，资金以个股辨识度为主。'],
    bullets: themes.slice(0, 3).map((t) => ({
      label: t.name,
      value: `${t.count} 家 · ${t.stocks.slice(0, 2).join('/')}`,
      tone: 'up' as Tone,
    })),
    footer: `强势集中度：${themes.slice(0, 3).reduce((s, t) => s + t.count, 0)} 家 / ${breadth.limitUp} 家涨停`,
  }
  const resonanceBlock: LogBlock = {
    title: '共振与分离',
    badge: resonance.includes('背离') ? '背离' : '共振',
    paragraphs: [
      `① 指数 × 家数：${resonance}。${breadth.ratio >= 1.2 ? '上涨家数占优，赚钱效应有宽度。' : '上涨家数不足，强度集中在局部。'}`,
      `② 大小盘：上证 ${signed(sh?.pct)}% vs 创业板 ${signed(cyb?.pct)}%，${style}；北证50 ${signed(bz?.pct)}%。`,
      `③ 情绪 × 指数：情绪温度 ${sentiment.score}（${sentiment.stage}），指数均值 ${signed(args.avgIndexPct)}%，${sentiment.score >= 60 && args.avgIndexPct < 0 ? '情绪强于指数，需防背离修复' : '二者方向基本一致'}。`,
    ],
    bullets: [
      {
        label: '量价',
        value:
          (breadth.amountChangePct ?? 0) > 0 && args.avgIndexPct > 0
            ? '放量上行，良性'
            : (breadth.amountChangePct ?? 0) < 0 && args.avgIndexPct < 0
              ? '缩量下行，观望'
              : '量价未形成同向确认',
        tone: (breadth.amountChangePct ?? 0) > 0 ? 'up' : 'warn',
      },
      { label: '情绪位置', value: `${sentiment.stage} · 风险${sentiment.risk}`, tone: sentiment.risk === '高' ? 'down' : 'flat' },
      {
        label: '高位反馈',
        value: `${args.maxBoard}板高度 / ${breadth.broken}只回封`,
        tone: breadth.broken > limitUps.length * 0.35 ? 'warn' : 'up',
      },
    ],
    footer: '看分离是否收敛，而不是只看指数涨跌',
  }
  const stage: LogBlock = {
    title: '周期阶段与旧周期',
    badge: sentiment.stage,
    paragraphs: [
      `当前阶段：${sentiment.stage}。${sentiment.summary}`,
      `空间高度 ${args.maxBoard} 板，连板 ${args.multiBoard} 家，回封 ${breadth.broken} 家（${sentiment.breakRate ?? 0}%），跌停 ${breadth.limitDown} 家。`,
    ],
    bullets: [
      { label: '老周期锚', value: space ? `${space.name}（${space.limitUpDays}板）` : '待确认', tone: 'flat' },
      { label: '新周期候选', value: topTheme ? `${topTheme.name}（${topTheme.count}家）` : '未形成', tone: topTheme ? 'up' : 'warn' },
      { label: '风险点', value: `${breadth.limitDown}家跌停 / ${breadth.broken}只回封`, tone: 'warn' },
      { label: '跟踪池', value: `${tracking.map((s) => s.name).join('、') || '—'}`, tone: 'flat' },
    ],
    footer: `阶段判定：${sentiment.stageKey} · 置信度 ${sentiment.confidence}%`,
  }
  const rhythm: LogBlock = {
    title: '结论与节奏',
    badge: sentiment.label,
    paragraphs: [
      sentiment.stage === '退潮' || sentiment.stage === '冰点'
        ? '周期仍在释放亏钱效应，今日首要任务是控制回撤。'
        : sentiment.stage === '高潮'
          ? '一致性进入高位，兑现与接力同时发生，适合去弱留强。'
          : sentiment.stage === '分歧'
            ? '核心仍有承接，但中位股开始掉队，只做确认后的核心。'
            : '修复/发酵窗口，围绕主线核心与低位补涨，避免追一致。',
      `明日观察：${space?.name ?? '空间龙'}能否溢价、${topTheme?.name ?? '主线'}能否维持 5 家以上涨停、跌停是否收敛至 10 家以内。`,
    ],
    bullets: [
      { label: '进攻', value: topTheme ? `${topTheme.name}核心 / 首板低位` : '等待主线', tone: 'up' },
      { label: '规避', value: '高位断板、后排一致加速、无量跟风', tone: 'down' },
      { label: '仓位', value: sentiment.stage === '高潮' ? '逢高兑现，7成以内' : sentiment.stage === '退潮' ? '防守，3成以内' : '中性，5-6成', tone: 'warn' },
    ],
    footer: '纪律优先于预测：确认加仓，破位减仓',
  }
  return { market, scan, resonance: resonanceBlock, stage, rhythm }
}


function anchorable(s: Stock): boolean {
  if (!s?.code) return false
  if (/ST|退/.test(s.name)) return false
  if (/^(4|8|92)/.test(s.code)) return false
  return true
}

function buildLeaders(limitUps: Stock[], topRows: Stock[]): Stock[] {
  const used = new Set<string>()
  const out: Stock[] = []
  const add = (s?: Stock) => {
    if (!s || used.has(s.code) || !anchorable(s)) return
    used.add(s.code)
    out.push(s)
  }
  limitUps.slice(0, 2).forEach(add)
  const twenty = [...limitUps, ...topRows].find((s) => !used.has(s.code) && anchorable(s) && s.pct >= 19.5 && /^(30|68)/.test(s.code))
  add(twenty)
  const turnover = [...limitUps].filter((s) => !used.has(s.code) && anchorable(s)).sort((a, b) => b.turnover - a.turnover)[0]
  add(turnover)
  const strong = topRows.find((s) => !used.has(s.code) && anchorable(s) && s.pct > 0 && s.status !== 'limitUp')
  add(strong)
  limitUps.filter((s) => !used.has(s.code)).forEach(add)
  topRows.filter((s) => !used.has(s.code)).forEach(add)
  return out.slice(0, 6)
}

function buildRules(args: {
  breadth: Breadth
  limitUps: Stock[]
  limitDowns: Stock[]
  maxBoard: number
  themes: ThemeCluster[]
  avgIndexPct: number
  sentiment: Sentiment
}): Rules {
  const { breadth, limitUps, limitDowns, maxBoard, themes, avgIndexPct, sentiment } = args
  const themeCount = themes[0]?.count ?? 0
  const stage: RuleCheck[] = [
    check('limitup', '涨停家数 ≥ 45', breadth.limitUp >= 45, `${breadth.limitUp} 家`),
    check('limitdown', '跌停家数 ≤ 10', breadth.limitDown <= 10, `${breadth.limitDown} 家`),
    check('breadth', '涨跌家数比 ≥ 1.5', breadth.ratio >= 1.5, `${breadth.ratio.toFixed(2)}`),
    check('height', '空间高度 ≥ 4 板', maxBoard >= 4, `${maxBoard} 板`),
    check('seal', '回封占比 ≤ 35%', (sentiment.breakRate ?? 0) <= 35, `${sentiment.breakRate ?? 0}%`),
  ]
  const newCycle: RuleCheck[] = [
    check('leader', '空间龙晋级 / 高度打开', maxBoard >= 4, limitUps[0] ? `${limitUps[0].name} ${limitUps[0].limitUpDays}板` : '待确认'),
    check('cluster', '主线涨停簇 ≥ 5 家', themeCount >= 5, themes[0] ? `${themes[0].name} ${themeCount}家` : '未形成'),
    check('index', '指数放量转强', avgIndexPct > 0 && (breadth.amountChangePct ?? 0) > 0, `${signed(avgIndexPct)}% / ${breadth.amountChangePct == null ? '量能待同步' : signed(breadth.amountChangePct) + '%'}`),
    check('loss', '跌停收敛至个位数', breadth.limitDown < 10, `${breadth.limitDown} 家`),
  ]
  const invalidation: RuleCheck[] = [
    check('high', '跌停家数 ≥ 5', breadth.limitDown >= 5, `${breadth.limitDown} 家跌停`),
    check('break', '涨停池回封占比 > 40%', (sentiment.breakRate ?? 0) > 40, `${sentiment.breakRate ?? 0}% 回封`),
    check('volume', '成交额萎缩 > 12%', (breadth.amountChangePct ?? 0) < -12, breadth.amountChangePct == null ? '待同步' : `${signed(breadth.amountChangePct)}%`),
    check(
      'breadth',
      '上涨家数占比 < 40%',
      breadth.rise / Math.max(1, breadth.rise + breadth.fall) < 0.4,
      `${((breadth.rise / Math.max(1, breadth.rise + breadth.fall)) * 100).toFixed(1)}%`,
    ),
  ]
  return { stage, newCycle, invalidation }
}

function check(id: string, label: string, pass: boolean, detail: string): RuleCheck {
  return { id, label, status: pass ? 'pass' : 'fail', detail }
}

function reasonFor(s: Stock): string {
  if (s.status === 'limitDown') {
    const parts = [`${s.limitDownDays || 1}连跌停`]
    if (s.firstLimitTime && s.firstLimitTime !== '—') parts.push(`${s.firstLimitTime.slice(0, 5)}封死`)
    if (s.turnover > 0) parts.push(`换手${fmtPct(s.turnover)}`)
    if (s.theme) parts.push(s.theme)
    return parts.slice(0, 4).join(' · ')
  }
  const parts: string[] = []
  if (s.limitUpDays > 1) parts.push(`${s.limitUpDays}连板`)
  else if (s.status === 'limitUp') parts.push('首板')
  if (s.firstLimitTime && s.firstLimitTime !== '—') parts.push(`${s.firstLimitTime.slice(0, 5)}首封`)
  if (s.breakCount > 0) parts.push(`回封${s.breakCount}次`)
  if (s.turnover > 0) parts.push(`换手${fmtPct(s.turnover)}`)
  if (s.theme) parts.push(s.theme)
  if (s.status !== 'limitUp' && s.pct < 0) parts.push('跌幅居前')
  if (s.status !== 'limitUp' && s.pct > 0) parts.push('强势')
  if (!parts.length && s.reason) parts.push(s.reason.slice(0, 32))
  return parts.slice(0, 4).join(' · ') || '盘口辨识度'
}

function enrichStock(stock: Stock, quotes: QuoteMap): Stock {
  const q = quotes[stock.code]
  if (!q) return stock
  const pct = q.pct || stock.pct
  const limit = limitThreshold(stock.code, stock.name)
  let status = stock.status
  const tags = [...stock.tags]
  if (status === 'limitUp' && pct < limit - 0.5) {
    status = 'broken'
    tags.push('开板')
  }
  return {
    ...stock,
    name: q.name || stock.name,
    price: q.price || stock.price,
    pct: round(pct, 2),
    open: q.open,
    high: q.high,
    low: q.low,
    prevClose: q.prevClose,
    amount: q.amount,
    status,
    tone: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
    tags: [...new Set(tags)].slice(0, 5),
  }
}

function stockFromQuote(code: string, quotes: QuoteMap): Stock | null {
  const q = quotes[code]
  if (!q) return null
  return {
    symbol: `${code}.${q.symbol.startsWith('sh') ? 'SS' : q.symbol.startsWith('sz') ? 'SZ' : 'BJ'}`,
    code,
    name: q.name,
    market: q.symbol.slice(0, 2),
    price: q.price,
    pct: round(q.pct, 2),
    amount: q.amount,
    turnover: 0,
    marketCap: 0,
    floatCap: 0,
    volumeRatio: null,
    open: q.open,
    high: q.high,
    low: q.low,
    prevClose: q.prevClose,
    limitUpDays: 0,
    limitDownDays: 0,
    firstLimitTime: '—',
    lastLimitTime: '—',
    breakCount: 0,
    lockRatio: 0,
    theme: '',
    reason: '',
    status: 'normal',
    tags: ['自选'],
    tone: q.pct > 0 ? 'up' : q.pct < 0 ? 'down' : 'flat',
  }
}

function toStockFromRaw(raw: RawPoolItem, status: 'limitUp' | 'limitDown'): Stock {
  const [code, suffix = ''] = raw.symbol.split('.')
  const market = suffix.toLowerCase() || guessMarket(code)
  const pct = round(raw.change_percent * 100, 2)
  const days = status === 'limitUp' ? raw.limit_up_days : raw.limit_down_days
  const is20 = /^(30|68|92)/.test(code)
  const plates = raw.surge_reason?.related_plates ?? []
  const theme = plates[0]?.plate_name ?? ''
  const reason = (raw.surge_reason?.stock_reason ?? '').replace(/\s+/g, ' ').trim()
  const first = status === 'limitUp' ? raw.first_limit_up : raw.first_limit_down
  const last = status === 'limitUp' ? raw.last_limit_up : raw.last_limit_down
  const tags: string[] = []
  if (status === 'limitUp') {
    if (days > 1) tags.push(`${days}连板`)
    else tags.push('首板')
    if (is20 && pct >= 19.5) tags.push('20cm')
    if (first > 0 && formatClock(first) <= '09:26:00') tags.push('竞价板')
    if (raw.break_limit_up_times > 0) tags.push(`回封${raw.break_limit_up_times}`)
  } else {
    if (days > 1) tags.push(`${days}连跌停`)
    else tags.push('跌停')
    if (raw.break_limit_down_times > 0) tags.push('撬板')
  }
  if (raw.is_new_stock) tags.push('新股')
  if (raw.yesterday_limit_up_days > 0 && status === 'limitDown') tags.push('昨日涨停')
  if (theme) tags.push(theme)
  return {
    symbol: raw.symbol,
    code,
    name: raw.stock_chi_name,
    market,
    price: round(raw.price, 2),
    pct,
    amount: 0,
    turnover: round(raw.turnover_ratio * 100, 2),
    marketCap: raw.total_capital,
    floatCap: raw.non_restricted_capital,
    volumeRatio: raw.volume_bias_ratio ? round(raw.volume_bias_ratio, 2) : null,
    open: 0,
    high: 0,
    low: 0,
    prevClose: 0,
    limitUpDays: raw.limit_up_days,
    limitDownDays: raw.limit_down_days,
    firstLimitTime: formatClock(first),
    lastLimitTime: formatClock(last),
    breakCount: status === 'limitUp' ? raw.break_limit_up_times : raw.break_limit_down_times,
    lockRatio: round((status === 'limitUp' ? raw.buy_lock_volume_ratio : raw.sell_lock_volume_ratio) * 100, 3),
    theme,
    reason,
    status,
    tags: [...new Set(tags)].slice(0, 5),
    tone: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
  }
}

function buildPhases(now: number, tradingDate: string, status: Snapshot['marketStatus']): PhaseInfo[] {
  const defs: { key: MarketPhaseKey; label: string; short: string; time: string; minutes: number; desc: string }[] = [
    { key: 'auction', label: '09:25 竞价完毕', short: '竞价', time: '09:25', minutes: 9 * 60 + 25, desc: '竞价定价，识别高开与核按钮' },
    { key: 'open', label: '09:35 开盘后5分钟', short: '开盘', time: '09:35', minutes: 9 * 60 + 35, desc: '承接验证，去弱留强' },
    { key: 'open', label: '10:00 盘中', short: '盘中', time: '10:00', minutes: 10 * 60, desc: '主线发酵，确认板块簇' },
    { key: 'lunch', label: '11:30 午间收盘', short: '午盘', time: '11:30', minutes: 11 * 60 + 30, desc: '半日复盘，量能与高度' },
    { key: 'afternoon', label: '13:00 下午', short: '午后', time: '13:00', minutes: 13 * 60, desc: '午后承接与尾盘抢筹' },
    { key: 'closed', label: '15:00 收盘', short: '收盘', time: '15:00', minutes: 15 * 60, desc: '定调周期，复盘锚定' },
  ]
  const nowParts = shanghaiParts(now)
  const sameDay = tradingDate === nowParts.date
  const nowMin = nowParts.hour * 60 + nowParts.minute + nowParts.second / 60
  let active = -1
  if (sameDay) {
    if (nowMin >= 15 * 60) active = 5
    else if (nowMin >= 13 * 60) active = 4
    else if (nowMin >= 11 * 60 + 30) active = 3
    else if (nowMin >= 10 * 60) active = 2
    else if (nowMin >= 9 * 60 + 35) active = 1
    else if (nowMin >= 9 * 60 + 25) active = 0
  }
  return defs.map((d, i) => ({
    key: d.key,
    label: d.label,
    short: d.short,
    time: d.time,
    state: active < 0 ? (sameDay ? 'upcoming' : 'done') : i < active ? 'done' : i === active ? 'active' : 'upcoming',
    desc: d.desc,
  }))
}

function resolveMarketStatus(now: number, tradingDate: string, quoteTime?: string): Snapshot['marketStatus'] {
  const p = shanghaiParts(now)
  const weekend = p.weekday === 0 || p.weekday === 6
  if (weekend || tradingDate !== p.date) return '休市'
  const min = p.hour * 60 + p.minute
  if (min < 9 * 60 + 15) return '未开盘'
  if (min < 9 * 60 + 30) return '集合竞价'
  if (min < 11 * 60 + 30) return '盘中'
  if (min < 13 * 60) return '午间休市'
  if (min < 15 * 60) return '盘中'
  return '已收盘'
}

export function shanghaiParts(now: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date(now))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekdayMap[get('weekday')] ?? 1,
  }
}

function formatClock(unix: number): string {
  if (!unix) return '—'
  return new Date(unix * 1000).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function limitThreshold(code: string, name: string): number {
  if (/ST/.test(name)) return 5
  if (/^(30|68)/.test(code)) return 20
  if (/^(8|4|92)/.test(code)) return 30
  return 10
}

function guessMarket(code: string) {
  if (code.startsWith('6')) return 'sh'
  if (code.startsWith('0') || code.startsWith('3')) return 'sz'
  return 'bj'
}

function dedupe(list: Stock[]): Stock[] {
  const seen = new Set<string>()
  const out: Stock[] = []
  for (const s of list) {
    if (!s?.code || seen.has(s.code)) continue
    seen.add(s.code)
    out.push(s)
  }
  return out
}

function sortLimitUp(a: Stock, b: Stock) {
  return b.limitUpDays - a.limitUpDays || a.firstLimitTime.localeCompare(b.firstLimitTime) || b.lockRatio - a.lockRatio
}

export function signed(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`
}

export function fmtAmountDelta(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(abs / 1e12).toFixed(3)}万亿`
  if (abs >= 1e8) return `${(abs / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(abs / 1e4).toFixed(1)}万`
  return `${Math.round(abs)}`
}

export function fmtAmount(n: number): string {
  if (!n) return '—'
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`
  if (n >= 1e8) return `${(n / 1e8).toFixed(0)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(0)}万`
  return `${Math.round(n)}`
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`
}

function fmtMarketCap(n: number): string {
  if (!n) return '—'
  if (n >= 1e8) return `${(n / 1e8).toFixed(0)}亿市值`
  return `${(n / 1e4).toFixed(0)}万市值`
}

function round(n: number, d = 2): number {
  const f = 10 ** d
  return Math.round(n * f) / f
}
