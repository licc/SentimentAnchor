import { chromium } from 'playwright-core'

const url = process.argv[2] || 'http://127.0.0.1:5173'
const out = process.argv[3] || '/tmp/agu-shot.png'
const width = Number(process.argv[4] || 1440)
const height = Number(process.argv[5] || 2200)
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
if (process.env.THEME) {
  await page.addInitScript((theme) => localStorage.setItem('anchor-theme', theme), process.env.THEME)
}
if (process.env.STEALTH_THEME) {
  await page.addInitScript((theme) => localStorage.setItem('stealth-theme', theme), process.env.STEALTH_THEME)
}
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector(process.env.WAIT_SELECTOR || '.hero', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(2500)
if (process.env.STATIC_HEADER === '1') {
  await page.addStyleTag({ content: '.topbar { position: static !important; }' })
}
await page.screenshot({ path: out, fullPage: true })
const title = await page.title()
const body = await page.locator('body').innerText().catch(() => '')
console.log(JSON.stringify({ title, errors, body: body.slice(0, 600), bodyLength: body.length }, null, 2))
await browser.close()
