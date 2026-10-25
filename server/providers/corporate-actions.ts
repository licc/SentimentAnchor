export interface CorporateAction {
  symbol: string
  exDate: string
  cashPerShare: number
  shareRatio: number
  description: string
}
const cache = new Map<string, { at: number; items: CorporateAction[] }>()

/** Eastmoney dividend / bonus / split history; used to adjust backtest bars. */
export async function fetchCorporateActions(symbol: string): Promise<CorporateAction[]> {
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.at < 6 * 60 * 60_000) return hit.items
  const filter = encodeURIComponent(`(SECURITY_CODE="${symbol}")`)
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=ALL&filter=${filter}&pageNumber=1&pageSize=30&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://data.eastmoney.com/' }, signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`公司行为接口 HTTP ${res.status}`)
  const json = await res.json() as { result?: { data?: Array<Record<string, unknown>> } }
  const items = (json.result?.data ?? []).map((row) => {
    const exDate = String(row.EX_DIVIDEND_DATE ?? '').slice(0, 10)
    const cashPerShare = (Number(row.PRETAX_BONUS_RMB) || 0) / 10
    const shareRatio = ((Number(row.BONUS_RATIO) || 0) + (Number(row.BONUS_IT_RATIO) || 0)) / 10
    return { symbol, exDate, cashPerShare, shareRatio, description: String(row.IMPL_PLAN_PROFILE ?? '') }
  }).filter((x) => x.exDate && (x.cashPerShare > 0 || x.shareRatio > 0))
  cache.set(symbol, { at: Date.now(), items })
  return items
}
