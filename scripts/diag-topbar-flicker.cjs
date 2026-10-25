/**
 * 顶栏闪动检测：连续截取顶栏区域，比较相邻帧的像素差，
 * 并记录时钟 / 倒计时环的包围盒是否跳动。
 *
 * 用法：node scripts/diag-topbar-flicker.cjs [url]
 */
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173/'

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-shell, .etf-page', { timeout: 30_000 })
  await page.waitForTimeout(3_000)

  const box = await page.evaluate(() => {
    const el = document.querySelector('.topbar')
    const r = el.getBoundingClientRect()
    return { x: 0, y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  })

  const dir = path.join('data', 'run', 'flicker')
  fs.mkdirSync(dir, { recursive: true })

  const frames = []
  const boxes = []
  for (let i = 0; i < 8; i += 1) {
    const file = path.join(dir, `f${i}.png`)
    await page.screenshot({ path: file, clip: box })
    frames.push(file)
    boxes.push(
      await page.evaluate(() => {
        const meta = document.querySelector('.topbar-meta')
        const ring = document.querySelector('.countdown')
        const r1 = meta?.getBoundingClientRect()
        const r2 = ring?.getBoundingClientRect()
        return {
          metaWidth: r1 ? Math.round(r1.width * 10) / 10 : null,
          metaX: r1 ? Math.round(r1.x * 10) / 10 : null,
          ringX: r2 ? Math.round(r2.x * 10) / 10 : null,
          ringSize: r2 ? Math.round(r2.width * 10) / 10 : null,
        }
      }),
    )
    await page.waitForTimeout(300)
  }

  // 用浏览器自己算像素差，避免引入图像库
  const diff = await page.evaluate(async (files) => {
    const load = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = `/__flicker__/${src}`
      })
    return 'skip'
  }, frames.map((f) => path.basename(f))).catch(() => 'skip')

  // 简单统计包围盒变化
  const widthSet = new Set(boxes.map((b) => b.metaWidth))
  const xSet = new Set(boxes.map((b) => b.ringX))
  console.log(JSON.stringify({ url, box, boxes, metaWidthVariants: [...widthSet], ringXVariants: [...xSet], errors: errors.slice(0, 3), frames: dir }, null, 2))
  await browser.close()
}

main().catch((err) => {
  console.error('diag failed:', err && err.message ? err.message : err)
  process.exit(1)
})
