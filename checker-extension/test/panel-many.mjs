import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
const exe = `${process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`
const EXT = 'D:/桌面/fanbox镜像网/checker-extension'
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'many-')), {
  executablePath: exe, headless: false, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
await ctx.route(/https:\/\/([a-z0-9-]+\.)?fanbox\.cc\/.*/, (r) =>
  r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><body>作者页（模拟）</body>' }))
// 模拟 25 个账号都赞助了同一位作者，其中一个邮箱带 <img> 之类的恶意字符，检查不会被当成 HTML
const matches = Array.from({ length: 25 }, (_, i) => ({
  account_email: i === 3 ? '<img src=x onerror=alert(1)>@evil.test' : `user${i + 1}@example.com`,
  creator_name: '高山千尋', plan_title: '100円', fee_jpy: 100, payment_method: 'COBAN', expires_at: '2026-11-01',
}))
await ctx.route('http://127.0.0.1:8787/api/ext/check', (r) =>
  r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ is_creator_page: true, creator_id: 'chihiroblood', url: 'https://chihiroblood.fanbox.cc/', supported: true, unread_accounts: 2, matches }) }))
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
await sw.evaluate((x) => chrome.storage.local.set(x), { apiBase: 'http://127.0.0.1:8787', extKey: 'x' })
const p = await ctx.newPage()
let dialog = false
p.on('dialog', async (d) => { dialog = true; await d.dismiss() })
await p.goto('https://chihiroblood.fanbox.cc/')
await p.waitForTimeout(3000)
await p.screenshot({ path: 'many-top.png' })
// 在面板内滚动（鼠标放到面板中部滚轮）
await p.mouse.move(1060, 350)
await p.mouse.wheel(0, 2000)
await p.waitForTimeout(500)
await p.screenshot({ path: 'many-bottom.png' })
await ctx.close().catch(() => {})
console.log('script-injection dialog fired:', dialog)
