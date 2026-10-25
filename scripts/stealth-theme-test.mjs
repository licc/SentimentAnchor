import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:8787/docs', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stealth-page', { timeout: 20000 })
const initialDark = await page.locator('.stealth-page.is-dark').count()
await page.getByTitle('切换界面主题').click()
await page.waitForTimeout(250)
const afterClickDark = await page.locator('.stealth-page.is-dark').count()
await page.screenshot({ path: '/tmp/agu-stealth-dark.png', fullPage: false })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.stealth-page', { timeout: 20000 })
const afterReloadDark = await page.locator('.stealth-page.is-dark').count()
const colors = await page.evaluate(() => {
  const page = document.querySelector('.stealth-page')
  return page ? { bg: getComputedStyle(page).backgroundColor, text: getComputedStyle(page).color } : null
})
console.log(JSON.stringify({ initialDark, afterClickDark, afterReloadDark, colors, errors }, null, 2))
await browser.close()
