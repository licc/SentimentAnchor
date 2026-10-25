import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, args:['--no-sandbox'] })
const page = await browser.newPage({viewport:{width:1440,height:1000}})
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
await page.clock.install()
await page.goto('http://127.0.0.1:8787',{waitUntil:'domcontentloaded'})
await page.waitForSelector('.anchor-card',{timeout:20000})
const initial = new URL(page.url()).pathname
await page.clock.fastForward(41_000)
await page.waitForTimeout(100)
const afterIdle = new URL(page.url()).pathname
// reload dashboard and disable
await page.goto('http://127.0.0.1:8787',{waitUntil:'domcontentloaded'})
await page.waitForSelector('.anchor-card',{timeout:20000})
await page.getByRole('button',{name:/工具/}).click()
const toggle = page.locator('.tool-menu button').filter({hasText:'无操作自动阅读'})
const before = await toggle.getAttribute('aria-checked')
await toggle.click()
const after = await toggle.getAttribute('aria-checked')
const stored = await page.evaluate(()=>localStorage.getItem('anchor-auto-stealth'))
await page.clock.fastForward(41_000)
await page.waitForTimeout(100)
const afterOff = new URL(page.url()).pathname
console.log(JSON.stringify({initial,afterIdle,before,after,stored,afterOff,errors},null,2))
await browser.close()
