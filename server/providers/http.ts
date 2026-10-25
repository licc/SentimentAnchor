const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

export interface FetchOptions {
  encoding?: 'utf-8' | 'gbk'
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  retryDelayMs?: number
}

export interface FetchResult {
  text: string
  latencyMs: number
  at: number
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const { encoding = 'utf-8', timeoutMs = 8_000, retries = 2, headers = {}, retryDelayMs = 450 } = opts
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now()
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': UA,
          Accept: '*/*',
          ...headers,
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      if (buf.byteLength === 0) throw new Error('empty response')
      const decoder = new TextDecoder(encoding)
      return { text: decoder.decode(buf), latencyMs: Date.now() - started, at: Date.now() }
    } catch (err) {
      lastError = err
      if (attempt < retries) await sleep(retryDelayMs * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('fetch failed')
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<{ data: T; latencyMs: number; at: number }> {
  const result = await fetchText(url, opts)
  try {
    return { data: JSON.parse(result.text) as T, latencyMs: result.latencyMs, at: result.at }
  } catch {
    throw new Error('invalid JSON response')
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function hostRotate(hosts: string[], index: number) {
  return hosts[index % hosts.length]
}
