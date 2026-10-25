import type { SentimentHistoryResponse, Snapshot, WatchlistConfig } from '../shared/types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = text
    try {
      const body = JSON.parse(text) as { error?: unknown }
      if (typeof body.error === 'string') message = body.error
    } catch {
      // keep plain text
    }
    throw new Error(message || `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export function getSnapshot() {
  return json<Snapshot>('/api/snapshot', { cache: 'no-store' })
}

/** 情绪温度多日归档：今日以外的 7 / 14 / 30 日视图用。只取日级汇总，不带分钟序列。 */
export function getSentimentHistory(days: number) {
  return json<SentimentHistoryResponse>(`/api/sentiment/history?days=${days}&points=0`, { cache: 'no-store' })
}

export function forceRefresh() {
  return json<{ ok: boolean; snapshot: Snapshot }>('/api/refresh', { method: 'POST' })
}

export function getWatchlist() {
  return json<WatchlistConfig>('/api/watchlist', { cache: 'no-store' })
}

export function saveWatchlist(code: string, action: 'add' | 'remove') {
  return json<WatchlistConfig>('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, action }),
  })
}

export function saveWatchCodes(codes: string[]) {
  return json<WatchlistConfig>('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codes }),
  })
}

export function getAiInsight() {
  return json<import('../shared/types').AiEnvelope>('/api/ai', { cache: 'no-store' })
}

export function generateAiInsight(mode: 'local' | 'llm', force = true) {
  return json<import('../shared/types').AiEnvelope>('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, force }),
  })
}

export function getCalendar() {
  return json<import('../shared/types').CalendarPayload>('/api/calendar', { cache: 'no-store' })
}

export function getAlerts() {
  return json<import('../shared/types').AlertPayload>('/api/alerts', { cache: 'no-store' })
}

export function saveAlertConfig(input: { rules?: unknown; webhookUrl?: string }) {
  return json<import('../shared/types').AlertPayload>('/api/alerts/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function markAlertsRead(ids?: string[]) {
  return json<import('../shared/types').AlertPayload>('/api/alerts/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
}

export function getAuth() {
  return json<{ required: boolean; authed: boolean }>('/api/auth', { cache: 'no-store' })
}

export function login(token: string) {
  return json<{ ok: boolean; required: boolean }>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

export function logout() {
  return json<{ ok: boolean }>('/api/logout', { method: 'POST' })
}

export function getAiConfig() {
  return json<import('../shared/types').AiConfigPublic>('/api/ai/config', { cache: 'no-store' })
}

export function saveAiConfig(input: {
  apiKey?: string
  baseUrl?: string
  model?: string
  provider?: string
}) {
  return json<import('../shared/types').AiConfigPublic>('/api/ai/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function clearAiConfig() {
  return json<import('../shared/types').AiConfigPublic>('/api/ai/clear', { method: 'POST' })
}


export function fetchAiModels(input: {
  apiKey?: string
  baseUrl?: string
  model?: string
  provider?: string
}) {
  return json<import('../shared/types').AiModelsResult>('/api/ai/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function testAiConnection(input?: {
  apiKey?: string
  baseUrl?: string
  model?: string
  provider?: string
}) {
  return json<import('../shared/types').AiTestResult>('/api/ai/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  })
}

export function getEtfDesk(force = false) {
  return json<import('../shared/types').EtfDeskPayload>(`/api/etf${force ? '?force=1' : ''}`, { cache: 'no-store' })
}

export function getEtfConfig() {
  return json<import('../shared/types').EtfStrategyConfig>('/api/etf/config', { cache: 'no-store' })
}

export function saveEtfConfig(universe: Array<{ code: string; role: string }>) {
  return json<import('../shared/types').EtfStrategyConfig>('/api/etf/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ universe }),
  })
}

export function resetEtfConfig() {
  return json<import('../shared/types').EtfStrategyConfig>('/api/etf/config/reset', { method: 'POST' })
}

export function getEtfHistory() {
  return json<import('../shared/types').EtfHistoryPayload>('/api/etf/history', { cache: 'no-store' })
}

export function placeEtfLiveOrder(input: {
  symbol: string
  side: 'buy' | 'sell'
  price: number
  quantity: number
}) {
  return json<import('../shared/types').EtfLiveOrderResult>('/api/etf/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, confirm: 'LIVE' }),
  })
}

export function getEtfAuto() {
  return json<import('../shared/types').EtfAutoState>('/api/etf/auto', { cache: 'no-store' })
}

export function startEtfAuto() {
  return json<import('../shared/types').EtfAutoState>('/api/etf/auto/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'AUTO' }),
  })
}

export function pauseEtfAuto() {
  return json<import('../shared/types').EtfAutoState>('/api/etf/auto/pause', { method: 'POST' })
}

export function flattenEtfAuto() {
  return json<import('../shared/types').EtfAutoState>('/api/etf/auto/flatten', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'FLATTEN' }),
  })
}

export function getEtfExecutions(limit = 50) {
  return json<{ executions: import('../shared/types').EtfExecutionRecord[] }>(`/api/etf/executions?limit=${limit}`, { cache: 'no-store' })
}

export function getEtfSelection() {
  return json<import('../shared/types').EtfSelection>('/api/etf/selection', { cache: 'no-store' })
}

export function refreshEtfSelection() {
  return json<import('../shared/types').EtfSelection>('/api/etf/selection/refresh', { method: 'POST' })
}

export function reconcileEtfExecutions() {
  return json<{ checked: number; reconciled: Array<{ executionId: string; orderId: string }>; unresolved: number }>('/api/etf/executions/reconcile', { method: 'POST' })
}


export function dismissEtfExecution(id: string) {
  return json<{ checked: number; unresolved: number; positions: Array<{ symbol: string; quantity: number }> }>(`/api/etf/executions/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DISMISS' }),
  })
}

export function getEtfSentimentLog(limit = 100) {
  return json<{ logs: import('../shared/types').EtfSentimentLog[] }>(`/api/etf/sentiment-log?limit=${limit}`, { cache: 'no-store' })
}

export function getQuantPool() {
  return json<import('../shared/types').QuantPoolPayload>('/api/quant/pool', { cache: 'no-store' })
}

export function addQuantCode(code: string) {
  return json<import('../shared/types').QuantPoolPayload>('/api/quant/pool', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', code }),
  })
}

export function removeQuantCode(code: string) {
  return json<import('../shared/types').QuantPoolPayload>('/api/quant/pool', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', code }),
  })
}

export function getQuantAuto() {
  return json<import('../shared/types').QuantAutoState>('/api/quant/auto', { cache: 'no-store' })
}

export function startQuantAuto() {
  return json<import('../shared/types').QuantAutoState>('/api/quant/auto/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'QUANT' }),
  })
}

export function pauseQuantAuto() {
  return json<import('../shared/types').QuantAutoState>('/api/quant/auto/pause', { method: 'POST' })
}

export function flattenQuantAuto() {
  return json<import('../shared/types').QuantAutoState>('/api/quant/auto/flatten', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'QUANT_FLATTEN' }),
  })
}

export function getBrokerCommands() {
  return json<import('../shared/types').BrokerCommandState>('/api/broker/commands', { cache: 'no-store' })
}

export function getQuantStrategy() {
  return json<import('../shared/types').QuantStrategyPayload>('/api/quant/strategy', { cache: 'no-store' })
}

export function saveQuantStrategy(input: { active?: string; config?: Partial<import('../shared/types').QuantStrategyConfig> }) {
  return json<import('../shared/types').QuantStrategyPayload>('/api/quant/strategy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function runQuantBacktest(input: { code: string; days: number; strategyId?: string }) {
  return json<import('../shared/types').QuantBacktestResult>('/api/quant/backtest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function getQuantStrategyLibrary() {
  return json<import('../shared/types').QuantStrategyLibraryPayload>('/api/quant/strategies', { cache: 'no-store' })
}

export function createQuantStrategy(input: { name: string; content: string }) {
  return json<import('../shared/types').QuantTextStrategy>('/api/quant/strategies', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function updateQuantStrategy(id: string, input: { name: string; content: string }) {
  return json<import('../shared/types').QuantTextStrategy>(`/api/quant/strategies/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function activateQuantStrategy(id: string, force = false) {
  return json<import('../shared/types').QuantTextStrategy>(`/api/quant/strategies/${encodeURIComponent(id)}/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) })
}

export function duplicateQuantStrategy(id: string) {
  return json<import('../shared/types').QuantTextStrategy>(`/api/quant/strategies/${encodeURIComponent(id)}/duplicate`, { method: 'POST' })
}

export function deleteQuantStrategy(id: string) {
  return json<{ ok: boolean }>(`/api/quant/strategies/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function assignQuantStrategy(code: string, strategyId: string) {
  return json<import('../shared/types').QuantPoolPayload>('/api/quant/pool', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'assign', code, strategyId }),
  })
}

export function getRiskStatus() {
  return json<import('../shared/types').RiskStatus>('/api/risk', { cache: 'no-store' })
}

export function saveRiskConfig(input: Partial<import('../shared/types').RiskConfig>) {
  return json<import('../shared/types').RiskConfig>('/api/risk/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function getEtfFeeSettings() {
  return json<{ maxDailyFeePct: number; maxDailyFeeAmount: number; updatedAt: string }>('/api/etf/fees', { cache: 'no-store' })
}

export function saveEtfFeeSettings(input: { maxDailyFeePct?: number; maxDailyFeeAmount?: number }) {
  return json<{ maxDailyFeePct: number; maxDailyFeeAmount: number; updatedAt: string }>('/api/etf/fees', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function getEtfAutoConfig() {
  return json<import('../shared/types').EtfAutoConfig>('/api/etf/auto/config', { cache: 'no-store' })
}

export function saveEtfAutoConfig(input: Partial<import('../shared/types').EtfAutoConfig>) {
  return json<import('../shared/types').EtfAutoConfig>('/api/etf/auto/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function getT0Strategies() {
  return json<import('../shared/types').T0StrategyPayload>('/api/etf/strategies', { cache: 'no-store' })
}

export function saveT0Strategy(id: string, content: string) {
  return json<import('../shared/types').T0StrategyDefinition>(`/api/etf/strategies/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
  })
}

export function activateT0Strategy(id: string) {
  return json<import('../shared/types').T0StrategyDefinition>(`/api/etf/strategies/${encodeURIComponent(id)}/activate`, { method: 'POST' })
}

export function generateAiStrategy(module: 't0' | 't1' | 'risk', prompt: string) {
  return json<import('../shared/types').AiStrategyDraft>('/api/strategies/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module, prompt }),
  })
}

export function createT0Strategy(name: string, content: string) {
  return json<import('../shared/types').T0StrategyDefinition>('/api/etf/strategies', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content }),
  })
}

export function getKillSwitch() {
  return json<{ active: boolean; reason: string; updatedAt: string }>('/api/system/kill', { cache: 'no-store' })
}

export function activateKillSwitch(reason = '手动急停') {
  return json<{ active: boolean; reason: string; updatedAt: string }>('/api/system/kill', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'KILL', reason }),
  })
}

export function clearKillSwitch() {
  return json<{ active: boolean; reason: string; updatedAt: string }>('/api/system/kill/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'CLEAR_KILL' }),
  })
}

export function getCoordinatorConfig() {
  return json<import('../shared/types').CoordinatorConfigLike>('/api/system/coordinator', { cache: 'no-store' })
}

export function saveCoordinatorConfig(input: { t0MaxPct: number; t1MaxPct: number; accountMaxPct: number; reserveCash: number; priority: 't0' | 't1' | 'equal' }) {
  return json<import('../shared/types').CoordinatorConfigLike>('/api/system/coordinator', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function getSystemHealth() {
  return json<{
    ok: boolean
    now: string
    snapshot: { generatedAt: string; ageMs: number; marketStatus: string } | null
    broker: { ok: boolean; mode: string; warnings?: string[] } | null
    auto: Record<string, { status: string; enabled: boolean }>
    intents: { active: number }
    ledger: { orders: number; fills: number; riskEvents: number }
    coordinator?: { t0: { pct: number; cap: number }; t1: { pct: number; cap: number }; accountExposure: { pct: number; cap: number } } | null
    ledgerConsistency?: { ok: boolean; executionFills: number; ledgerFills: number; note: string }
    alerts?: string[]
    killSwitch: { active: boolean; reason: string }
  }>('/api/system/health', { cache: 'no-store' })
}

export function getLedger(filter: { symbol?: string; status?: string } = {}) {
  const q = new URLSearchParams()
  if (filter.symbol) q.set('symbol', filter.symbol)
  if (filter.status) q.set('status', filter.status)
  return json<{
    summary: { orders: number; fills: number; riskEvents: number; filledNotional: number; fees: number; blocked: number }
    recent: Array<{ client_order_id: string; broker_order_id: string | null; symbol: string; side: string; price: number; quantity: number; status: string; source: string; created_at: string; error: string | null }>
  }>(`/api/ledger${q.toString() ? `?${q}` : ''}`, { cache: 'no-store' })
}

export function runQuantRobustness(code: string, days = 180, strategyId?: string) {
  return json<import('../shared/types').QuantRobustnessResult>('/api/quant/robustness', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, days, strategyId }),
  })
}

export function getCoordinatorStatus() {
  return json<{
    config: import('../shared/types').CoordinatorConfigLike
    account: { totalAsset: number; cashAvailable: number; marketValue: number }
    t0: { used: number; cap: number; remaining: number; pct: number }
    t1: { used: number; cap: number; remaining: number; pct: number }
    accountExposure: { used: number; cap: number; remaining: number; pct: number }
  }>('/api/system/coordinator/status', { cache: 'no-store' })
}

export function preflightManualOrder(input: { symbol: string; side: 'buy' | 'sell'; price: number; quantity: number; reason: string }) {
  return json<import('../shared/types').ManualOrderPreflight>('/api/manual/preflight', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function getManualQuote(symbol: string) {
  return json<import('../shared/types').EtfQuote | null>(`/api/manual/quote?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
}

export function placeManualOrder(input: { symbol: string; side: 'buy' | 'sell'; price: number; quantity: number; reason: string }) {
  return json<import('../shared/types').EtfLiveOrderResult>('/api/etf/order', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, manual: true, confirm: 'LIVE' }),
  })
}

export function getSystemConfig() {
  return json<{
    brokerUrl: string
    brokerKeyConfigured: boolean
    brokerKeyMasked: string
    orderTimeoutMs: number
    statusTtlMs: number
    maxManualOrderAmount: number
    updatedAt: string
  }>('/api/system/config', { cache: 'no-store' })
}

export function saveSystemConfig(input: { brokerUrl: string; brokerKey?: string; clearBrokerKey?: boolean; orderTimeoutMs: number; statusTtlMs: number; maxManualOrderAmount: number }) {
  return json<Awaited<ReturnType<typeof getSystemConfig>>>('/api/system/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function getPortfolioAnalytics() {
  return json<{
    generatedAt: string
    today: string | null
    trades: number
    closedTrades: number
    realizedPnl: number
    fees: number
    winRate: number
    profitFactor: number
    avgWin: number
    avgLoss: number
    symbols: Array<{ symbol: string; realizedPnl: number; trades: number; fees: number }>
  }>('/api/analytics/portfolio', { cache: 'no-store' })
}

export function getTradePlans() {
  return json<Array<{ id: string; createdAt: string; symbol: string; side: 'buy' | 'sell'; entryPrice: number; stopPrice: number | null; targetPrice: number | null; quantity: number; riskAmount: number | null; reason: string; status: 'open' | 'closed'; orderId: string | null; review: string | null; reviewAt: string | null }>>('/api/plans', { cache: 'no-store' })
}

export function createTradePlan(input: { symbol: string; side: 'buy' | 'sell'; entryPrice: number; stopPrice?: number | null; targetPrice?: number | null; quantity: number; riskAmount?: number | null; reason: string; orderId?: string | null }) {
  return json<Awaited<ReturnType<typeof getTradePlans>>[number]>('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function reviewTradePlan(id: string, review: string) {
  return json<Awaited<ReturnType<typeof getTradePlans>>[number]>(`/api/plans/${encodeURIComponent(id)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review }) })
}

export function getBackupStatus() {
  return json<{ config: { enabled: boolean; intervalHours: number; keep: number; lastAt: string | null }; backups: Array<{ name: string; at: string; files: number }> }>('/api/system/backup', { cache: 'no-store' })
}
export function saveBackupConfig(input: { enabled: boolean; intervalHours: number; keep: number }) {
  return json<{ enabled: boolean; intervalHours: number; keep: number; lastAt: string | null }>('/api/system/backup/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}
export function runBackupNow() {
  return json<{ name: string; files: number }>('/api/system/backup', { method: 'POST' })
}
export function getNotifyConfig() {
  return json<{ enabled: boolean; provider: 'serverchan' | 'pushplus' | 'webhook'; token: string; tokenConfigured: boolean; webhookUrl: string; updatedAt: string }>('/api/system/notify', { cache: 'no-store' })
}
export function saveNotifyConfig(input: { enabled: boolean; provider: 'serverchan' | 'pushplus' | 'webhook'; token?: string; webhookUrl: string }) {
  return json<Awaited<ReturnType<typeof getNotifyConfig>>>('/api/system/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}
export function testNotify() {
  return json<{ ok: boolean; error?: string }>('/api/system/notify/test', { method: 'POST' })
}

export function getIntradayAnalysis(symbol: string, date?: string) {
  const q = new URLSearchParams({ symbol })
  if (date) q.set('date', date)
  return json<{
    symbol: string; date: string; prevClose: number
    bars: Array<{ time: string; price: number; vwap: number; volume: number }>
    stats: { openPct: number; closePct: number; highPct: number; lowPct: number; aboveVwapRatio: number; slopePct: number; upDownVolumeRatio: number; peakVolumeMultiple: number; peakTime: string; closePosition: number; trendEfficiency: number; closeVsVwapPct: number; medianVolume: number }
    score: { label: '强' | '中性' | '弱' | '危险'; strength: number; weak: number }
    signals: Array<{ id: string; time: string; price: number; reason: string; action: 'buy' | 'sell' | 'watch' }>
    redFlags: Array<{ id: string; text: string; value: string }>
    note: string
  }>(`/api/intraday/analysis?${q}`, { cache: 'no-store' })
}

export function getIntradayRules() {
  return json<Array<{ id: string; side: 'buy' | 'sell'; name: string; window: string; condition: string; size: string; sample: number | null; expectancyPct: number | null; winRate: number | null; verdict: 'keep' | 'watch' | 'drop'; note: string }>>('/api/intraday/rules', { cache: 'no-store' })
}

export function getAnnouncements(symbol: string) {
  return json<Array<{ code: string; title: string; date: string; type: string; risk: boolean }>>(`/api/stock/announcements?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
}

export function getPreopen(date?: string) {
  const q = date ? `?date=${encodeURIComponent(date)}` : ''
  return json<{
    date: string; generatedAt: string; stage: string; sentimentScore: number; foreignFear: number | null
    items: Array<{ code: string; name: string; price: number; pct: number; theme: string; source: string; reason: string; score: number; estimatedCost: number; affordable: boolean }>
    note: string
  }>(`/api/preopen${q}`, { cache: 'no-store' })
}

export function generatePreopen() {
  return json<Awaited<ReturnType<typeof getPreopen>>>('/api/preopen', { method: 'POST' })
}

export function getIntradayBacktest(symbol: string) {
  return json<{ symbol: string; days: number; rows: Array<{ rule: string; signals: number; avgNextReturnPct: number; winRate: number; samples: Array<{ date: string; time: string; price: number; nextClose: number; returnPct: number }> }>; note: string }>(`/api/intraday/backtest?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
}

export interface RiskPolicyRuleView { id: string; label: string; enabled: boolean; severity: 'block' | 'warn'; params: Record<string, number | string | string[] | boolean> }
export interface RiskPolicyView { id: string; name: string; description: string; scope: 'all' | 'manual' | 't0' | 't1'; status: 'active' | 'draft'; version: number; rules: RiskPolicyRuleView[]; updatedAt: string }
export function getRiskPolicies() { return json<{ activeByScope: Record<string, string | null>; policies: RiskPolicyView[] }>('/api/risk/policies', { cache: 'no-store' }) }
export function saveRiskPolicy(id: string, input: { rules: RiskPolicyRuleView[]; scope?: RiskPolicyView['scope'] }) { return json<RiskPolicyView>(`/api/risk/policies/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) }
export function activateRiskPolicy(id: string) { return json<RiskPolicyView>(`/api/risk/policies/${encodeURIComponent(id)}/activate`, { method: 'POST' }) }

export function generateRiskPolicyDraft(prompt: string) {
  return json<{ name: string; description: string; scope: 'all' | 'manual' | 't0' | 't1'; rules: RiskPolicyRuleView[]; model: string; provider: string }>('/api/risk/policies/ai-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })
}

export function testBrokerConnection() {
  return json<{ ok: boolean; status?: number; url: string; keySent: boolean; body?: string; error?: string }>('/api/system/broker/test', { cache: 'no-store' })
}

export function getCorporateActions(symbol: string) {
  return json<Array<{ symbol: string; exDate: string; cashPerShare: number; shareRatio: number; description: string }>>(`/api/stock/corporate-actions?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
}

export function getStockAnnouncements(symbol: string) {
  return json<Array<{ code: string; title: string; date: string; type: string; risk: boolean }>>(`/api/stock/announcements?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
}

export function getPitDates() {
  return json<{ dates: string[] }>('/api/pit', { cache: 'no-store' })
}

export function getPitSnapshot(date: string) {
  return json<{ date: string; recordedAt: string; stage: string; score: number; foreignFear: number | null; stocks: Array<{ code: string; name: string; st: boolean }> }>(`/api/pit?date=${encodeURIComponent(date)}`, { cache: 'no-store' })
}
