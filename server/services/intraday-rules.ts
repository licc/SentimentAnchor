export interface IntradayRule {
  id: string
  side: 'buy' | 'sell'
  name: string
  window: string
  condition: string
  size: string
  sample: number | null
  expectancyPct: number | null
  winRate: number | null
  verdict: 'keep' | 'watch' | 'drop'
  note: string
}

export const INTRADAY_RULES: IntradayRule[] = [
  { id: 'B1', side: 'buy', name: '首次放量站上均价线', window: '09:45-10:30', condition: '价格上穿 VWAP，当分钟量 ≥ 3× 中位量', size: '3 成', sample: 3411, expectancyPct: 0.49, winRate: 52.2, verdict: 'keep', note: '可保留，优先确认承接。' },
  { id: 'B2', side: 'buy', name: '缩量回踩均价线不破', window: '09:45-11:30', condition: '回踩 VWAP 不破，回踩量 < 前 5 分钟均量的 0.7×', size: '加到 5 成', sample: 2981, expectancyPct: 0.05, winRate: 48.9, verdict: 'drop', note: '接近随机，不建议作为独立买点。' },
  { id: 'B3', side: 'buy', name: '放量突破早盘高点', window: '13:00-14:00', condition: '突破 11:30 前高点，量能同步放大', size: '加到 7 成', sample: 674, expectancyPct: 1.42, winRate: 56.7, verdict: 'keep', note: '统计最强，优先保留。' },
  { id: 'B4', side: 'buy', name: '尾盘放量破全天高点', window: '14:30-15:00', condition: '价上 VWAP 且突破当日最高，量能放大', size: '隔夜 2 成', sample: 176, expectancyPct: 1.33, winRate: 59.1, verdict: 'watch', note: '样本较少，只做小仓位隔夜。' },
  { id: 'S1', side: 'sell', name: '跌破均价线且放量', window: '09:30-15:00', condition: '价格跌破 VWAP，当分钟量 > 3× 中位量', size: '立即减半', sample: 2297, expectancyPct: -0.54, winRate: 54.0, verdict: 'keep', note: '卖点中最值得保留。' },
  { id: 'S2', side: 'sell', name: '反抽均价线不过', window: '09:30-15:00', condition: '跌破后反抽 VWAP 附近再次被压回', size: '清仓', sample: 9, expectancyPct: -1.34, winRate: 55.6, verdict: 'drop', note: '样本只有 9 次，暂不作为独立规则。' },
  { id: 'S3', side: 'sell', name: '天量滞涨', window: '09:30-15:00', condition: '单分钟量 > 30× 中位量，价格横盘 < 0.5%', size: '立即减半', sample: 2052, expectancyPct: -0.13, winRate: 52.9, verdict: 'watch', note: '可保留，需结合长上影。' },
  { id: 'S4', side: 'sell', name: '涨停反复打开', window: '盘中', condition: '涨停开板 ≥ 2 次，或开板 5 分钟收不回 VWAP', size: '不碰 / 清仓', sample: null, expectancyPct: null, winRate: null, verdict: 'keep', note: '风控规则，样本不足但逻辑硬。' },
]
