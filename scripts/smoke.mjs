const base = process.env.BASE_URL || 'http://127.0.0.1:8787'
const failures = []

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    failures.push(name)
  }
}

console.log(`smoke: ${base}`)
const health = await fetch(`${base}/api/health`).then((r) => r.json())
assert('health ok', health.ok === true)
assert('10s cadence', health.refreshMs === 10_000, String(health.refreshMs))
assert('core sources online', health.sources.filter((s) => s.state === 'live').length >= 4)

const snapshot = await fetch(`${base}/api/snapshot`).then((r) => r.json())
assert('snapshot date', /^\d{4}-\d{2}-\d{2}$/.test(snapshot.tradingDate))
assert('indices', snapshot.indices.length >= 6)
assert('breadth', snapshot.breadth.rise > 0 && snapshot.breadth.fall > 0)
assert('sentiment score 0-100', snapshot.sentiment.score >= 0 && snapshot.sentiment.score <= 100)
assert('anchors', snapshot.anchors.length >= 6, String(snapshot.anchors.length))
assert('chart points', snapshot.chart.length >= (snapshot.marketStatus === '盘中' ? 10 : 1), String(snapshot.chart.length))
assert('rules', snapshot.rules.stage.length + snapshot.rules.newCycle.length >= 8)
assert('sources', snapshot.sources.length >= 5)

const etf = await fetch(`${base}/api/etf`).then((r) => r.json())
assert('ETF broker status', etf.broker && typeof etf.broker.ok === 'boolean')
assert('ETF quotes', Array.isArray(etf.quotes) && etf.quotes.length >= 4, String(etf.quotes?.length))
assert('ETF signal', ['risk-on', 'neutral', 'risk-off'].includes(etf.signal?.regime))

const ai = await fetch(`${base}/api/ai`).then((r) => r.json())
assert('AI insight', ai.insight && ai.insight.conclusions.length >= 3)
assert('AI mode declared', ai.insight.mode === 'local' || ai.insight.mode === 'llm')
assert('AI llm flag', typeof ai.llmConfigured === 'boolean')

const calendar = await fetch(`${base}/api/calendar`).then((r) => r.json())
assert('cycle calendar', Array.isArray(calendar.days) && calendar.days.length >= 5)

const alertCenter = await fetch(`${base}/api/alerts`).then((r) => r.json())
assert('alert rules', alertCenter.config.rules.length === 5)
assert('alert unread flag', typeof alertCenter.unread === 'number')

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 6000)
const res = await fetch(`${base}/api/stream`, { signal: controller.signal })
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let gotSnapshot = false
try {
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    if (buffer.includes('event: snapshot') && buffer.includes('"tradingDate"')) {
      gotSnapshot = true
      break
    }
  }
} catch (err) {
  if (err.name !== 'AbortError') throw err
} finally {
  clearTimeout(timer)
  controller.abort()
}
assert('SSE snapshot frame', gotSnapshot)

if (failures.length) {
  console.error(`smoke failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('smoke passed')
