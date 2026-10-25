export interface Announcement { code: string; title: string; date: string; type: string; risk: boolean }
const cache = new Map<string, { at: number; items: Announcement[] }>()

export async function fetchAnnouncements(symbol: string): Promise<Announcement[]> {
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.items
  const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=20&page_index=1&ann_type=A&client_source=web&stock_list=${encodeURIComponent(symbol)}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://data.eastmoney.com/' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`公告接口 HTTP ${res.status}`)
  const json = await res.json() as { data?: { list?: Array<{ title?: string; notice_date?: string; display_time?: string; columns?: Array<{ column_name?: string }> }> } }
  const items = (json.data?.list ?? []).map((x) => {
    const title = String(x.title ?? '')
    return {
      code: symbol, title,
      date: String(x.notice_date ?? x.display_time ?? '').slice(0, 10),
      type: String(x.columns?.[0]?.column_name ?? ''),
      risk: /减持|立案|调查|退市|风险警示|预亏|亏损|诉讼|质押|违规|问询|监管|冻结|终止|失败/.test(title),
    }
  })
  cache.set(symbol, { at: Date.now(), items })
  return items
}
