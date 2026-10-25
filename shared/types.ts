export type Tone = 'up' | 'down' | 'flat' | 'warn'
export type Stage = '冰点' | '退潮' | '分歧' | '修复' | '发酵' | '高潮' | '过热'
export type MarketPhaseKey = 'preopen' | 'auction' | 'open' | 'lunch' | 'afternoon' | 'closed' | 'holiday'
export type StockStatus = 'limitUp' | 'limitDown' | 'broken' | 'strong' | 'weak' | 'normal'
export type SourceState = 'live' | 'stale' | 'fallback' | 'error'

export interface MarketIndex {
  code: string
  name: string
  price: number
  change: number
  pct: number
  open: number
  high: number
  low: number
  prevClose: number
  amount: number
  volume: number
  date: string
  time: string
  tone: Tone
}

export interface Breadth {
  rise: number
  fall: number
  flat: number
  limitUp: number
  limitDown: number
  broken: number
  total: number
  ratio: number
  amount: number
  prevAmount: number
  amountChangePct: number | null
  amountDiff: number | null
  avg5Amount: number | null
  amountVs5Pct: number | null
  amountVs5Diff: number | null
  amountWindow: string | null
  amountWindowDays: number | null
}

export interface Stock {
  symbol: string
  code: string
  name: string
  market: string
  price: number
  pct: number
  amount: number
  turnover: number
  marketCap: number
  floatCap: number
  volumeRatio: number | null
  open: number
  high: number
  low: number
  prevClose: number
  limitUpDays: number
  limitDownDays: number
  firstLimitTime: string
  lastLimitTime: string
  breakCount: number
  lockRatio: number
  theme: string
  reason: string
  status: StockStatus
  tags: string[]
  tone: Tone
}

export interface Anchor {
  id: string
  role: string
  label: string
  stock: Stock
  reason: string
  tone: Tone
  metric?: string
}

export interface Sector {
  code: string
  name: string
  pct: number
  amount: number
  up: number
  down: number
  count: number
  leader: string
  leaderPct: number
  kind: 'industry' | 'concept'
  tone: Tone
}

export interface ThemeCluster {
  name: string
  count: number
  stocks: string[]
  reason: string
  tone: Tone
}

export interface PhaseInfo {
  key: MarketPhaseKey
  label: string
  short: string
  time: string
  state: 'done' | 'active' | 'upcoming'
  desc: string
}

export interface ChartPoint {
  time: string
  ts: number
  rise: number
  fall: number
  limitUp: number
  limitDown: number
  temp: number
}

/** 单个交易日的情绪温度归档（供"7 日 / 14 日 / 30 日"趋势使用）。 */
export interface SentimentDayArchive {
  date: string
  /** 当日收盘（或最后一次采样）的情绪温度 */
  score: number
  high: number
  low: number
  /** 当日分钟级序列，仅保留时间与温度 */
  points: { time: string; temp: number }[]
  updatedAt: string
}

export interface SentimentHistoryResponse {
  /** 请求的天数 */
  days: number
  /** 实际有归档的交易日数量（可能少于请求天数） */
  available: number
  /** 是否正在后台回填历史 */
  backfilling: boolean
  /** 升序：最早的在前 */
  items: SentimentDayArchive[]
}

export interface SentimentComponent {
  label: string
  value: number
  score: number
  detail: string
  tone: Tone
}

export interface Sentiment {
  score: number
  stage: Stage
  stageKey: string
  label: string
  summary: string
  risk: '低' | '中' | '高'
  confidence: number
  components: SentimentComponent[]
  foreignFear: ForeignFear | null
  sealRate: number | null
  breakRate: number | null
  height: number
  trend: number
}

export interface LogBullet {
  label: string
  value: string
  tone?: Tone
}

export interface LogBlock {
  title: string
  badge?: string
  paragraphs: string[]
  bullets: LogBullet[]
  footer?: string
}

export interface Logs {
  market: LogBlock
  scan: LogBlock
  resonance: LogBlock
  stage: LogBlock
  rhythm: LogBlock
}

export interface RuleCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'watch'
  detail: string
}

export interface Rules {
  stage: RuleCheck[]
  newCycle: RuleCheck[]
  invalidation: RuleCheck[]
}

export interface Headline {
  kicker: string
  title: string
  summary: string
  action: string
  confirm: string
  tone: Tone
  confidence: number
}

export interface SourceStatus {
  id: string
  name: string
  state: SourceState
  updatedAt: string | null
  latencyMs: number | null
  message: string
}

export interface Snapshot {
  version: number
  generatedAt: string
  tradingDate: string
  dataAsOf: string
  marketStatus: '盘中' | '午间休市' | '已收盘' | '集合竞价' | '未开盘' | '休市'
  phase: PhaseInfo
  phases: PhaseInfo[]
  indices: MarketIndex[]
  breadth: Breadth
  sentiment: Sentiment
  headline: Headline
  anchors: Anchor[]
  leaders: Stock[]
  laggards: Stock[]
  limitUps: Stock[]
  limitDowns: Stock[]
  sectors: { industry: Sector[]; concept: Sector[] }
  themes: ThemeCluster[]
  logs: Logs
  rules: Rules
  watchlist: Stock[]
  chart: ChartPoint[]
  sources: SourceStatus[]
  refreshMs: number
  nextRefreshAt: string
  latencyMs: number
  notice: string | null
}

export interface WatchlistConfig {
  codes: string[]
  updatedAt: string
}

export type AiMode = 'local' | 'llm'
export type AiStance = '进攻' | '观察' | '防守'

export interface AiConclusion {
  label: string
  text: string
  tone: Tone
}

export interface AiInsight {
  fingerprint: string
  generatedAt: string
  mode: AiMode
  provider: string
  model: string
  title: string
  stance: AiStance
  confidence: number
  summary: string
  conclusions: AiConclusion[]
  attack: string
  avoid: string
  confirm: string
  risks: string[]
  sourceNote: string
}

export interface AiEnvelope {
  insight: AiInsight
  llmConfigured: boolean
  llmError?: string
}

export interface CalendarLeader {
  code: string
  name: string
  pct: number
  days: number
  theme: string
}

export interface CalendarDay {
  date: string
  indexPct: number
  indexClose: number
  amount: number
  limitUp: number
  limitDown: number
  maxBoard: number
  topTheme: string
  stage: string
  score: number
  leaders: CalendarLeader[]
  laggards: CalendarLeader[]
  note: string
}

export interface CalendarStat {
  stage: string
  samples: number
  avgNextPct: number
  winRate: number
}

export interface CalendarPayload {
  generatedAt: string
  days: CalendarDay[]
  partial: boolean
  stats?: CalendarStat[]
}

export type AlertLevel = 'info' | 'warn' | 'risk'

export interface AlertRule {
  id: string
  label: string
  description: string
  enabled: boolean
  threshold: number
  unit: string
}

export interface AlertConfig {
  rules: AlertRule[]
  webhookUrl: string
  updatedAt: string
}

export interface AlertEvent {
  id: string
  createdAt: string
  date: string
  level: AlertLevel
  title: string
  detail: string
  read: boolean
}

export interface AlertPayload {
  config: AlertConfig
  events: AlertEvent[]
  unread: number
}

export interface AiConfigPublic {
  configured: boolean
  source: 'env' | 'file' | 'none'
  provider: string
  baseUrl: string
  model: string
  masked: string
}

export interface AiTestResult {
  ok: boolean
  latencyMs: number
  model: string
  message: string
}

export interface AiModelsResult {
  ok: boolean
  models: string[]
  message: string
}

export interface EtfQuote {
  code: string
  name: string
  price: number
  pct: number
  amount: number
  tone: Tone
}

export interface EtfSignal {
  regime: 'risk-on' | 'neutral' | 'risk-off'
  targetCode: string | null
  targetName: string | null
  reason: string
  score: number
  stage: string
  trend: number
  positionPct: number
  foreignFear?: ForeignFear | null
  updatedAt: string
}

export interface EtfBrokerStatus {
  ok: boolean
  mode: string
  clientRunning: boolean
  clientLoggedIn: boolean
  account: {
    totalAsset: number
    cashAvailable: number
    marketValue: number
    pnlToday: number
    updatedAt: string
  } | null
  positions: Array<{
    symbol: string
    name: string
    quantity: number
    available: number
    costPrice: number
    lastPrice: number
    marketValue: number
    pnl: number
    pnlPct: number
  }>
  warnings?: string[]
  error: string | null
}

export interface EtfPaperTrade {
  id: string
  time: string
  code: string
  name: string
  side: 'buy' | 'sell'
  price: number
  quantity: number
  amount: number
  fee?: number
  note: string
}

export interface EtfFeeModel {
  commissionRate: number
  minCommission: number
  slippageBps: number
  stampDuty: number
  maxDailyFeePct: number
  maxDailyFeeAmount?: number
}

export interface EtfDeskPayload {
  broker: EtfBrokerStatus
  quotes: EtfQuote[]
  signal: EtfSignal
  universe: Array<{ code: string; name: string; role: EtfRole }>
  rules: EtfStrategyRules
  today: EtfDailyRecord
  selection: EtfSelection
  fees: EtfFeeModel
  maxManualOrderAmount?: number
  tradeMode: 'readonly' | 'live'
  note: string
}

export type EtfRole = 'risk' | 'hedge' | 'defensive' | 'cash'

export interface EtfUniverseItem {
  code: string
  role: EtfRole
}

export interface EtfStrategyConfig {
  universe: EtfUniverseItem[]
  updatedAt: string
}

export interface EtfSignalRecord {
  id: string
  time: string
  regime: EtfSignal['regime']
  targetCode: string | null
  targetName: string | null
  reason: string
  score: number
  stage: string
  trend: number
}

export interface EtfDailyRecord {
  date: string
  mode: 'paper' | 'live'
  startedAt: string
  updatedAt: string
  startEquity: number
  equity: number
  pnl: number
  pnlPct: number
  trades: EtfPaperTrade[]
  signals: EtfSignalRecord[]
  note: string
}

export interface EtfStrategyRules {
  riskOnScore: number
  riskOffScore: number
  cooldownSec: number
  maxPositionPct: number
  stopLossPct: number
  maxSwitchesPerDay: number
  lotSize: number
  flatTime: string
}

export interface EtfHistoryPayload {
  days: EtfDailyRecord[]
}

export interface EtfLiveOrderResult {
  ok: boolean
  message: string
  orderId: string | null
  status: string
  broker: EtfBrokerStatus
  today: EtfDailyRecord | null
}

export interface EtfAutoState {
  status: 'idle' | 'running' | 'waiting' | 'recovering' | 'paused' | 'error'
  enabled: boolean
  startedAt: string | null
  lastTick: string | null
  lastAction: string
  lastError: string | null
  target: string | null
  confirmCount: number
  pendingOrderId: string | null
  retryCount: number
  nextRetryAt: string | null
}

export type EtfExecutionStatus = 'submitting' | 'accepted' | 'filled' | 'partial' | 'cancelled' | 'rejected' | 'timeout' | 'unknown' | 'blocked'

export interface EtfExecutionFactors {
  source: 'auto' | 'manual' | 'quant' | 'risk'
  regime?: string
  score?: number
  stage?: string
  trend?: number
  target?: string
  reason?: string
  quote?: number
  quotePct?: number
  accountTotal?: number
  cashAvailable?: number
  position?: string
  rules?: EtfStrategyRules
  note?: string
}

export interface EtfExecutionEvidence {
  sources: string[]
  orderStatus: string
  orderFilled: number
  tradeQty: number
  tradePrice: number | null
  positionAfter: number
  cashAfter: number | null
  consistent: boolean
  note: string
}

export interface EtfExecutionRecord {
  id: string
  createdAt: string
  updatedAt: string
  mode: 'auto' | 'manual'
  side: 'buy' | 'sell'
  symbol: string
  name: string
  price: number
  quantity: number
  amount: number
  fee: number
  cashAfter: number | null
  positionBefore?: number | null
  positionAfter: number | null
  evidence?: EtfExecutionEvidence
  status: EtfExecutionStatus
  orderId: string | null
  filled: number
  entryPrice?: number | null
  realizedPnl?: number | null
  realizedPnlPct?: number | null
  brokerStatus: string
  message: string
  resolution: string
  factors: EtfExecutionFactors
}

export interface EtfSelectionItem {
  code: string
  name: string
  role: EtfRole
  score: number
  vol20: number
  avgAmount20: number
  tickPct: number
  roundTripPct: number
  pct: number
  reason: string
}

export interface EtfSelection {
  date: string
  generatedAt: string
  source: string
  items: EtfSelectionItem[]
  candidates: EtfSelectionItem[]
  note: string
}

export interface EtfSentimentLogQuote {
  code: string
  name: string
  price: number
  pct: number
  amount: number
}

export interface EtfSentimentLog {
  id: string
  time: string
  tradingDate: string
  marketStatus: string
  score: number
  stage: string
  trend: number
  risk: string
  confidence: number
  regime: EtfSignal['regime']
  targetCode: string | null
  targetName: string | null
  reason: string
  decision: string
  breadth: {
    rise: number
    fall: number
    limitUp: number
    limitDown: number
    amount: number
    ratio: number
  }
  quotes: EtfSentimentLogQuote[]
  account: { totalAsset: number; cashAvailable: number; marketValue: number } | null
  positions: Array<{ symbol: string; name: string; quantity: number; available: number }>
  source: string
  channel?: 't0' | 't1' | 'system'
}

export interface QuantCandidate {
  code: string
  name: string
  price: number
  pct: number
  theme: string
  source: string
  reason: string
  affordable: boolean
  strategyId?: string | null
}

export interface QuantPoolPayload {
  codes: string[]
  assignments: Record<string, string>
  items: QuantCandidate[]
  candidates: QuantCandidate[]
  updatedAt: string | null
}


export interface QuantAutoState {
  status: 'idle' | 'running' | 'waiting' | 'recovering' | 'paused' | 'error'
  enabled: boolean
  startedAt: string | null
  lastTick: string | null
  lastAction: string
  lastError: string | null
  targetCode: string | null
  targetName: string | null
  entryDate: string | null
  entryPrice: number | null
  entryQuantity: number | null
  retryCount: number
  nextRetryAt: string | null
}

export interface BrokerCommandState {
  kind: 'place' | 'cancel' | 'cancelAll' | null
  label: string
  startedAt: number | null
  queued: number
  lastFinishedAt: number | null
  lastError: string | null
}

export type QuantStrategyId = string

export interface QuantStrategyConfig {
  id: QuantStrategyId
  model: string
  name: string
  description: string
  stages: string[]
  minScore: number
  stopLossPct: number
  takeProfitPct: number
  maxHoldDays: number
  positionPct: number
  entryCutoff: string
  entry: {
    priceAboveOpen: boolean
    minPct: number
    maxPct: number
    breakout20: boolean
    pullback: boolean
  }
}

export interface QuantBacktestTrade {
  entryDate: string
  exitDate: string
  entryPrice: number
  exitPrice: number
  returnPct: number
  reason: string
}

export interface QuantBacktestBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface QuantBacktestOOS {
  returnPct: number
  maxDrawdownPct: number
  winRate: number
  trades: number
}

export interface QuantBacktestMetrics {
  annualizedReturnPct: number
  sharpe: number
  sortino: number
  profitFactor: number
  expectancyPct: number
  maxConsecutiveLosses: number
  benchmarkReturnPct: number
  benchmarkMaxDrawdownPct: number
}

export interface QuantBacktestWindow {
  label: string
  startDate: string
  endDate: string
  returnPct: number
  maxDrawdownPct: number
  winRate: number
  trades: number
}

export interface QuantBacktestResult {
  code: string
  name: string
  strategy: QuantStrategyId
  days: number
  returnPct: number
  maxDrawdownPct: number
  winRate: number
  trades: QuantBacktestTrade[]
  bars: QuantBacktestBar[]
  outOfSample?: QuantBacktestOOS
  dataQuality?: { suspendedDays: number; largeGaps: number; note: string }
  metrics?: QuantBacktestMetrics
  rollingWindows?: QuantBacktestWindow[]
  equity: Array<{ date: string; value: number }>
}

export interface QuantStrategyPayload {
  active: QuantStrategyConfig
  strategies: QuantStrategyConfig[]
}

export interface QuantTextStrategy {
  id: string
  name: string
  content: string
  status: 'active' | 'draft' | 'archived'
  version: number
  createdAt: string
  updatedAt: string
  config: QuantStrategyConfig
  history: Array<{ version: number; content: string; config: QuantStrategyConfig; savedAt: string }>
}

export interface QuantStrategyLibraryPayload {
  activeId: string | null
  strategies: QuantTextStrategy[]
}

export interface RiskCheck {
  id: string
  label: string
  passed: boolean
  detail: string
}

export interface RiskDecision {
  id: string
  time: string
  kind: 'buy' | 'stop' | 'stop_blocked'
  allowed: boolean
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  source: string
  checks: RiskCheck[]
  reasons: string[]
  status: 'allowed' | 'blocked' | 'alert' | 'submitted' | 'failed'
  note?: string
}

export interface RiskConfig {
  enabled: boolean
  buy: {
    maxOrderAmount: number
    maxSymbolPct: number
    maxAccountExposurePct: number
    minCashReserve: number
    maxOrdersPerDay: number
    maxDailyLossPct: number
    duplicateWindowSec: number
    blockedCodes: string[]
    allowedSessions: string[]
    blockSt: boolean
    blockAnnouncementRisk: boolean
  }
  stop: {
    enabled: boolean
    autoExecute: boolean
    mode: 'fixed' | 'trailing'
    thresholdPct: number
    trailingPct: number
    checkIntervalSec: number
  }
}

export interface RiskStatus {
  config: RiskConfig
  decisions: RiskDecision[]
  lastCheckAt: string | null
  lastStopCheckAt: string | null
  blockedToday: number
  stopToday: number
}

export interface ForeignFear {
  vix: number | null
  vixChangePct: number | null
  usFuturesPct: number | null
  goldPct: number | null
  usdcnhPct: number | null
  kospiPct: number | null
  nikkeiPct: number | null
  score: number
  level: '低' | '中' | '高' | '极端'
  detail: string
  updatedAt: string
  stale?: boolean
}

export interface EtfAutoConfig {
  stopLossPct: number
  maxDailyLossPct: number
  maxSwitchesPerDay: number
  cooldownSec: number
  flatTime: string
  flattenEnabled: boolean
  maxOrderAmount: number
  updatedAt: string
}

export interface T0StrategyConfig {
  stages: string[]
  riskOnScore: number
  riskOffScore: number
  riskOnPositionPct: number
  riskOffPositionPct: number
  allowRisk: boolean
}

export interface T0StrategyDefinition {
  id: string
  name: string
  content: string
  status: 'active' | 'draft'
  version: number
  updatedAt: string
  config: T0StrategyConfig
}

export interface T0StrategyPayload {
  activeId: string | null
  strategies: T0StrategyDefinition[]
}

export interface AiRiskLimits {
  maxOrderAmount: number
  maxSymbolPct: number
  maxAccountExposurePct: number
  minCashReserve: number
  maxOrdersPerDay: number
  duplicateWindowSec: number
  stopLossPct: number
  autoExecute: boolean
}

export interface AiStrategySpec {
  module: 't0' | 't1' | 'risk'
  name: string
  content: string
  stages: string[]
  minScore: number
  riskOnPositionPct: number
  riskOffPositionPct: number
  stopLossPct: number
  takeProfitPct: number
  maxHoldDays: number
  entryCutoff: string
  priceAboveOpen: boolean
  minPct: number
  maxPct: number
  breakout20: boolean
  pullback: boolean
  maxSwitchesPerDay: number
  maxDailyLossPct: number
  cooldownSec: number
  risk?: AiRiskLimits
}

export interface AiStrategyDraft {
  spec: AiStrategySpec
  warnings: string[]
  model: string
  provider: string
  execution: 'deterministic-code'
}

export interface EtfOrderIntent {
  clientOrderId: string
  symbol: string
  side: 'buy' | 'sell'
  price: number
  quantity: number
  source: string
  status: 'pending' | 'submitted' | 'filled' | 'rejected' | 'cancelled' | 'unknown'
  orderId: string | null
  createdAt: string
  updatedAt: string
  error: string | null
}

export interface CoordinatorConfigLike {
  t0MaxPct: number
  t1MaxPct: number
  accountMaxPct: number
  reserveCash: number
  priority: 't0' | 't1' | 'equal'
  updatedAt: string
}

export interface QuantRobustnessVariant {
  label: string
  returnPct: number
  maxDrawdownPct: number
  winRate: number
  trades: number
  returnDeltaPct: number
}

export interface QuantRobustnessResult {
  code: string
  base: { returnPct: number; maxDrawdownPct: number; winRate: number; trades: number }
  variants: QuantRobustnessVariant[]
  positiveRatio: number
  note: string
}

export interface ManualOrderPreflight {
  allowed: boolean
  side: 'buy' | 'sell'
  symbol: string
  quote: EtfQuote | null
  position: EtfBrokerStatus['positions'][number] | null
  amount: number
  checks: RiskCheck[]
  reasons: string[]
  account: EtfBrokerStatus['account']
}


export interface TradePlan {
  id: string
  createdAt: string
  symbol: string
  side: 'buy' | 'sell'
  entryPrice: number
  stopPrice: number | null
  targetPrice: number | null
  quantity: number
  riskAmount: number | null
  reason: string
  status: 'open' | 'closed'
  orderId: string | null
  review: string | null
  reviewAt: string | null
}
