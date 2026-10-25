/**
 * 前端 CPU profiler：用 CDP Profiler 采样 12 秒，按"自身耗时"排序输出热点函数。
 *
 * 用法：node scripts/perf-profile.cjs [url] [--view=pro|decision] [--top=15]
 */
const { chromium } = require('playwright-core')

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173/'
const viewArg = process.argv.find((a) => a.startsWith('--view='))
const view = viewArg ? viewArg.split('=')[1] : 'pro'
const topArg = process.argv.find((a) => a.startsWith('--top='))
const TOP = topArg ? Number(topArg.split('=')[1]) : 15

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const client = await page.context().newCDPSession(page)

  await page.addInitScript((v) => localStorage.setItem('anchor-view', v), view)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-shell, .etf-page', { timeout: 30_000 })
  await page.waitForTimeout(4_000)

  await client.send('Profiler.enable')
  await client.send('Profiler.setSamplingInterval', { interval: 200 })
  await client.send('Profiler.start')
  await page.waitForTimeout(12_000)
  const { profile } = await client.send('Profiler.stop')

  // 把采样时间累加到"自身"节点
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const self = new Map()
  const total = profile.timeDeltas.reduce((a, b) => a + b, 0)
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i] ?? 0
    const node = byId.get(id)
    if (!node) return
    const f = node.callFrame
    const key = `${f.functionName || '(anonymous)'} @ ${(f.url || '').replace(/^https?:\/\/[^/]+/, '')}:${f.lineNumber + 1}`
    self.set(key, (self.get(key) || 0) + dt)
  })

  const rows = [...self.entries()]
    .map(([key, us]) => ({ key, ms: us / 1000, pct: (us / total) * 100 }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, TOP)

  console.log(`采样时长 ${(total / 1_000_000).toFixed(1)}s · view=${view}`)
  for (const r of rows) {
    console.log(`${r.ms.toFixed(1).padStart(8)}ms ${r.pct.toFixed(1).padStart(5)}%  ${r.key}`)
  }

  await browser.close()
}

main().catch((err) => {
  console.error('profile failed:', err && err.message ? err.message : err)
  process.exit(1)
})
