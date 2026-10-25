import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, args:['--no-sandbox'] })
const page = await browser.newPage({viewport:{width:1200,height:800}})
await page.clock.install()
await page.goto('http://127.0.0.1:8787',{waitUntil:'domcontentloaded'})
await page.waitForSelector('.anchor-card',{timeout:20000})
await page.clock.fastForward(30_000)
await page.mouse.move(100,100)
await page.clock.fastForward(15_000)
const afterMove = new URL(page.url()).pathname
await page.clock.fastForward(26_000)
await page.waitForTimeout(100)
const afterIdle = new URL(page.url()).pathname
console.log({afterMove,afterIdle})
await browser.close()
