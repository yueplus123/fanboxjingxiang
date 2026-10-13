import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
const exe = `${process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`
const EXT = 'D:/桌面/fanbox镜像网/extension'
const API = 'http://127.0.0.1:8787'
const out = []
const ok = (n, c) => out.push(`${c ? 'PASS' : 'FAIL'} ${n}`)

// 1. 通过后台接口准备一张卡 + 一条赞助
const J = { 'Content-Type': 'application/json' }
const { token: jwt } = await (await fetch(API + '/api/login', { method: 'POST', headers: J, body: JSON.stringify({ password: 'test123' }) })).json()
const H = { ...J, Authorization: 'Bearer ' + jwt }
await fetch(API + '/api/admin/cards', { method: 'POST', headers: H, body: JSON.stringify({ alias: 'ext', number: '4242424242424242', cvv: '321', expiry: '09/31', holder: 'EXT USER' }) })
const sp = await (await fetch(API + '/api/admin/sponsorships', { method: 'POST', headers: H, body: JSON.stringify({ friend: 'f', creator: '某作者', amount_jpy: 500, card_id: 1, fill_uses: 1 }) })).json()

// 2. 带扩展启动 Chromium；把 payment.pixiv.net 路由到本地模拟页
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ext-')), {
  executablePath: exe,
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
await ctx.route('https://payment.pixiv.net/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset=utf-8>
    <form id=f><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc"><input autocomplete="cc-name"></form>
    <script>window.submitted=false;document.getElementById('f').addEventListener('submit',()=>window.submitted=true)</script>` }))

const useToken = async (page, t) => {
  const vp = page.viewportSize() || { width: 1280, height: 720 }
  await page.mouse.click(vp.width - 16 - 130, vp.height - 16 - 74) // 卡密输入框
  await page.keyboard.type(t)
  await page.mouse.click(vp.width - 16 - 130, vp.height - 16 - 36) // 填入按钮
}
const page = await ctx.newPage()
page.on('console', m => console.log('page:', m.text()))
ctx.on('serviceworker', w => w.on('console', m => console.log('sw:', m.text())))
await page.goto('https://payment.pixiv.net/card')
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
ok('扩展已加载', !!sw)

// Shadow DOM 是 closed，用键盘走：聚焦面板里的输入框
await page.waitForTimeout(500)
await useToken(page, sp.fill_token)
await page.waitForTimeout(2000)
await page.waitForFunction(() => document.querySelectorAll('input')[0].value !== '', null, { timeout: 8000 }).catch(() => {})
const vals = await page.$$eval('input', (els) => els.map((e) => e.value))
ok('卡信息被填入', vals.join('|') === '4242424242424242|09/31|321|EXT USER')
ok('没有自动提交表单', (await page.evaluate(() => window.submitted)) === false)

// 3. 同一卡密第二次应失败（fill_uses=1）
await page.reload()
await page.waitForTimeout(500)
await useToken(page, sp.fill_token)
await page.waitForTimeout(1500)
const vals2 = await page.$$eval('input', (els) => els.map((e) => e.value))
ok('卡密用完后不能再填', vals2.every((v) => v === ''))

await ctx.close().catch(() => {})
console.log(out.join('\n'))
