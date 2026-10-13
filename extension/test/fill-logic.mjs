import { chromium } from 'playwright'
import fs from 'node:fs'
const exe = `${process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()
await page.goto('file:///' + 'D:/桌面/fanbox镜像网/extension/test/forms.html')
await page.addScriptTag({ content: fs.readFileSync('../extension/fill.js', 'utf8') })
const card = { number: '4242424242424242', expiry: '12/30', cvv: '987', holder: 'TEST USER' }
const results = []
const check = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

for (const id of ['A', 'B', 'C', 'D']) {
  await page.evaluate((id) => {
    document.querySelectorAll('form').forEach((f) => (f.hidden = f.id !== id))
  }, id)
  const report = await page.evaluate((c) => window.__fanboxFill(c), card)
  const vals = await page.evaluate(
    (id) => [...document.querySelectorAll(`#${id} input, #${id} select`)].map((e) => e.value),
    id
  )
  console.log(id, JSON.stringify(report), JSON.stringify(vals))
  if (id === 'A') check('A 标准 autocomplete 四项都填上', JSON.stringify(vals) === JSON.stringify(['TEST USER', card.number, '12/30', '987']))
  if (id === 'B') check('B 日文标签 + 下拉', vals.join('|') === `${card.number}|12|2030|987|TEST USER`)
  if (id === 'C') check('C placeholder + 4 位有效期', vals.join('|') === `${card.number}|1230|987`)
  if (id === 'D') check('D 识别不到时如实报告 false', !report.number && !report.expiry && !report.cvv && vals.every((v) => v === ''))
}
await browser.close().catch(() => {})
console.log(results.join('\n'))
