// 提示框：尺寸、拖动、边界、记住位置、关闭按钮
import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const exe = `${process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`
const EXT = 'D:/桌面/fanbox镜像网/checker-extension'
const KEY = fs.readFileSync('D:/桌面/fanbox镜像网/server/data/ext.key', 'utf8').trim()
const out = []
const ok = (n, c, extra = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n} ${extra}`)

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pnl-')), {
  executablePath: exe,
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
await ctx.route(/https:\/\/([a-z0-9-]+\.)?fanbox\.cc\/.*/, (r) =>
  r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><body style="margin:0;height:3000px">作者页（模拟）</body>' }))
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
await sw.evaluate((x) => chrome.storage.local.set(x), { apiBase: 'http://127.0.0.1:8787', extKey: KEY })
await sw.evaluate(() => chrome.storage.local.remove('panelPos'))

// 面板在 closed shadow root 里，脚本读不到内部；宿主元素的 transform 就是面板位置。
// 面板左上角 = 宿主 transform，尺寸用截图量。
const hostPos = (p) =>
  p.evaluate(() => {
    const h = [...document.documentElement.children].find((e) => e.style?.zIndex === '2147483647')
    const m = h?.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
    return m ? { x: +m[1], y: +m[2] } : null
  })

const p = await ctx.newPage()
await p.goto('https://chihiroblood.fanbox.cc/')
await p.waitForTimeout(3000)
const start = await hostPos(p)
ok('默认位置在右上角', start && start.x > 1280 - 400 - 40 && start.y <= 20, JSON.stringify(start))
await p.screenshot({ path: 'panel-1-default.png' })

// 尺寸：用截图里面板的像素边界量（面板白底、带边框，从背景里找）
const png = await p.screenshot()
// 直接在页面里量宿主内第一个子元素不可行（closed），改用 getBoundingClientRect 的宿主：宿主没有尺寸，
// 所以用 elementsFromPoint 命中宿主，再看截图。这里只验证位置，尺寸看截图。

// 拖动：按住标题栏（面板左上 + (200, 18)）拖到左下方
const grab = { x: start.x + 200, y: start.y + 18 }
await p.mouse.move(grab.x, grab.y)
await p.mouse.down()
await p.mouse.move(grab.x - 400, grab.y + 100, { steps: 8 })
await p.mouse.up()
await p.waitForTimeout(300)
const moved = await hostPos(p)
ok('拖动后位置跟着变', moved && Math.abs(moved.x - (start.x - 400)) <= 2 && Math.abs(moved.y - (start.y + 100)) <= 2, `${JSON.stringify(start)} -> ${JSON.stringify(moved)}`)
await p.screenshot({ path: 'panel-2-moved.png' })

// 边界：往窗口外拖，不能出屏
await p.mouse.move(moved.x + 200, moved.y + 18)
await p.mouse.down()
await p.mouse.move(-500, -500, { steps: 6 })
await p.mouse.up()
const topLeft = await hostPos(p)
ok('拖到左上角外也被限制在窗口内', topLeft.x >= 0 && topLeft.y >= 0, JSON.stringify(topLeft))
await p.mouse.move(topLeft.x + 200, topLeft.y + 18)
await p.mouse.down()
await p.mouse.move(5000, 5000, { steps: 6 })
await p.mouse.up()
const botRight = await hostPos(p)
ok('拖到右下角外也被限制在窗口内', botRight.x + 400 <= 1280 && botRight.y + 600 <= 800, JSON.stringify(botRight))

// 记住位置：放到一个明确的位置，刷新页面
await p.mouse.move(botRight.x + 200, botRight.y + 18)
await p.mouse.down()
await p.mouse.move(300 + 200, 100 + 18, { steps: 8 })
await p.mouse.up()
const placed = await hostPos(p)
await p.waitForTimeout(500)
await p.goto('https://nobody-xyz.fanbox.cc/')
await p.waitForTimeout(3000)
const after = await hostPos(p)
ok('换一个作者页后位置保持不变', after && placed && Math.abs(after.x - placed.x) <= 2 && Math.abs(after.y - placed.y) <= 2, `${JSON.stringify(placed)} -> ${JSON.stringify(after)}`)
await p.screenshot({ path: 'panel-3-remembered.png' })

// 关闭按钮：点 × 面板消失，且不会触发拖动
await p.mouse.click(after.x + 400 - 20, after.y + 18)
await p.waitForTimeout(400)
await p.screenshot({ path: 'panel-4-closed.png' })
const afterClose = await hostPos(p)
ok('点 × 不会让面板位移', afterClose && Math.abs(afterClose.x - after.x) <= 1 && Math.abs(afterClose.y - after.y) <= 1)

// 小窗口：缩小窗口后面板仍在可视范围内
await p.setViewportSize({ width: 700, height: 500 })
await p.goto('https://chihiroblood.fanbox.cc/')
await p.waitForTimeout(3000)
const small = await hostPos(p)
ok('窗口缩小后面板仍在可视范围内', small && small.x >= 0 && small.y >= 0 && small.x < 700 && small.y < 500, JSON.stringify(small))
await p.screenshot({ path: 'panel-5-small.png' })

await ctx.close().catch(() => {})
console.log(out.join('\n'))
