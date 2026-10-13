import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const exe = `${process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`
const EXT = 'D:/桌面/fanbox镜像网/checker-extension'
const KEY = fs.readFileSync('D:/桌面/fanbox镜像网/server/data/ext.key', 'utf8').trim()
const out = []
const ok = (n, c) => out.push(`${c ? 'PASS' : 'FAIL'} ${n}`)

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'chk-')), {
  executablePath: exe,
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
// 把 fanbox.cc 的请求都换成本地模拟页，不真的访问 Fanbox
await ctx.route(/https:\/\/([a-z0-9-]+\.)?fanbox\.cc\/.*/, (r) =>
  r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><title>mock</title><body style="height:600px">作者页（模拟）</body>' })
)
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
ok('插件已加载', !!sw)

// 读取 closed shadow root 的文字：通过截图人工核对不方便，这里用无障碍快照里的文字
const tip = async (page) => {
  await page.waitForTimeout(2500)
  return page.evaluate(() => {
    // closed shadow 读不到，这里借助插件注入的宿主元素 + 截图判断是否出现
    const h = [...document.documentElement.children].find((e) => e.style?.zIndex === '2147483647')
    return !!h
  })
}

const setKey = async (key) => {
  const opt = await ctx.newPage()
  await opt.goto(`chrome-extension://${sw.url().split('/')[2]}/options.html`)
  await opt.fill('#key', key)
  await opt.click('#save')
  await opt.click('#test')
  await opt.waitForFunction(() => document.querySelector('#msg').textContent !== '', null, { timeout: 8000 })
  const m = await opt.textContent('#msg')
  await opt.close()
  return m
}

// 1 密钥错误
ok('选项页：错误密钥会提示“密钥不对”', (await setKey('wrong-key')).includes('密钥不对'))
// 2 密钥正确
ok('选项页：正确密钥显示“连接正常”', (await setKey(KEY)).includes('连接正常'))

// 3 已赞助作者页
const p = await ctx.newPage()
await p.goto('https://chihiroblood.fanbox.cc/')
await p.waitForTimeout(3000)
await p.screenshot({ path: 'chk-yes.png' })

// 4 没赞助的作者页
await p.goto('https://nobody-xyz.fanbox.cc/')
await p.waitForTimeout(3000)
await p.screenshot({ path: 'chk-no.png' })

// 5 非作者页：不应有提示条可见（用截图对比像素区域）
await p.goto('https://www.fanbox.cc/creators/supporting')
await p.waitForTimeout(3000)
await p.screenshot({ path: 'chk-none.png' })

// 6 单页应用切换：www.fanbox.cc 下从未赞助的作者，切到已赞助的作者（只改网址，不重新加载页面）
await p.goto('https://www.fanbox.cc/@nobody-xyz')
await p.waitForTimeout(2500)
await p.screenshot({ path: 'chk-spa1.png' })
await p.evaluate(() => history.pushState({}, '', '/@chihiroblood'))
await p.waitForTimeout(3000)
await p.screenshot({ path: 'chk-spa2.png' })
// 再切到非作者页：提示应消失
await p.evaluate(() => history.pushState({}, '', '/creators/supporting'))
await p.waitForTimeout(3000)
await p.screenshot({ path: 'chk-spa3.png' })

await ctx.close().catch(() => {})
console.log(out.join('\n'))
