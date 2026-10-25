/**
 * 前端渲染性能测量（无头 Chromium + CDP Performance 域）。
 *
 * 用法：
 *   node scripts/perf-frontend.cjs [url] [--view=pro|decision]
 *
 * 输出：DOM 节点数、JS 堆、以及 15 秒空闲窗口内的
 *   TaskDuration / ScriptDuration / LayoutDuration / RecalcStyleCount
 * 这些是浏览器自己统计的 CPU 时间，比"感觉快了"可靠。
 */
const { chromium } = require('playwright-core')

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173/'
const viewArg = process.argv.find((a) => a.startsWith('--view='))
const view = viewArg ? viewArg.split('=')[1] : 'pro'

async function main() {
  // 用系统已装的 Edge（channel: msedge），避免下载 Chromium 二进制
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const client = await page.context().newCDPSession(page)
  await client.send('Performance.enable')

  const read = async () => {
    const { metrics } = await client.send('Performance.getMetrics')
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
  }

  // 指定视图（pro 才有情绪曲线那张 243 点的大图）
  await page.addInitScript((v) => {
    localStorage.setItem('anchor-view', v)
  }, view)

  // SSE 长连接会让 networkidle 永远不满足，用 domcontentloaded + 等根节点
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-shell, .etf-page', { timeout: 30_000 })
  await page.waitForTimeout(4_000) // 等首屏 + 第一帧快照

  const nodes = await page.evaluate(() => document.getElementsByTagName('*').length)
  const sections = await page.evaluate(() => document.querySelectorAll('section').length)

  const before = await read()
  await page.waitForTimeout(15_000) // 覆盖 1~2 个快照周期
  const after = await read()

  const d = (k) => +(after[k] - before[k]).toFixed(3)
  const out = {
    view,
    domNodes: nodes,
    sections,
    jsHeapMB: +(after.JSHeapUsedSize / 1048576).toFixed(1),
    taskDurationSec: d('TaskDuration'),
    scriptDurationSec: d('ScriptDuration'),
    layoutDurationSec: d('LayoutDuration'),
    recalcStyleCount: Math.round(after.RecalcStyleCount - before.RecalcStyleCount),
    layoutCount: Math.round(after.LayoutCount - before.LayoutCount),
  }
  console.log(JSON.stringify(out, null, 2))

  await browser.close()
}

main().catch((err) => {
  console.error('perf failed:', err && err.message ? err.message : err)
  process.exit(1)
})
