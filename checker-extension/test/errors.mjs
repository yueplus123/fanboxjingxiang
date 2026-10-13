import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
const exe = `${process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`
const EXT = 'D:/桌面/fanbox镜像网/checker-extension'
const KEY = fs.readFileSync('D:/桌面/fanbox镜像网/server/data/ext.key', 'utf8').trim()
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'chk2-')), {
  executablePath: exe, headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
await ctx.route(/https:\/\/([a-z0-9-]+\.)?fanbox\.cc\/.*/, (r) =>
  r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><body>作者页（模拟）</body>' }))
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
const id = sw.url().split('/')[2]
const set = async (v) => { await sw.evaluate((x) => chrome.storage.local.set(x), v) }
const p = await ctx.newPage()
const shot = async (name, url) => { await p.goto(url); await p.waitForTimeout(2800); await p.screenshot({ path: name, clip: { x: 900, y: 0, width: 380, height: 160 } }) }

await set({ apiBase: 'http://127.0.0.1:8787', extKey: '' })          // 没填密钥
await shot('err-nokey.png', 'https://a1.fanbox.cc/')
await set({ apiBase: 'http://127.0.0.1:8787', extKey: 'bad' })       // 密钥错
await shot('err-badkey.png', 'https://a2.fanbox.cc/')
await set({ apiBase: 'http://127.0.0.1:59999', extKey: KEY })        // 后端没开
await shot('err-offline.png', 'https://a3.fanbox.cc/')
await ctx.close().catch(() => {})
console.log('done')
