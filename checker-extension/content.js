// 打开作者页时检测一次：显示在页面右上角的小提示条里。
// 只读：不点击、不填写、不修改页面上任何 Fanbox 的内容。
if (window === window.top) {
  const RESERVED = new Set(['www', 'api', 'official', 'official-en'])

  // 是不是作者页：xxx.fanbox.cc，或 www.fanbox.cc/@xxx
  const isCreatorPage = () => {
    const { hostname, pathname } = location
    const sub = hostname.match(/^([a-z0-9-]+)\.fanbox\.cc$/i)?.[1]
    if (sub && !RESERVED.has(sub.toLowerCase())) return true
    return hostname === 'www.fanbox.cc' && /^\/@[^/]+/.test(pathname)
  }

  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      .box{font:14px/1.5 system-ui,"Segoe UI",sans-serif;background:#fff;color:#111;border:1px solid #d4d4d4;
        border-radius:12px;width:400px;height:600px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);
        display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 28px #0004}
      .box[hidden]{display:none}
      .bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px 8px 14px;
        background:#f4f4f5;border-bottom:1px solid #e4e4e7;cursor:grab;user-select:none;touch-action:none}
      .bar.drag{cursor:grabbing}
      .bar .name{font-size:12px;color:#52525b;display:flex;align-items:center;gap:6px}
      .dot{width:10px;height:10px;border-radius:50%;background:#a1a1aa}
      .yes .dot{background:#0ca30c}.no .dot{background:#ec835a}.err .dot{background:#d03b3b}
      .x{background:none;border:0;font-size:20px;line-height:1;cursor:pointer;color:#666;padding:2px 6px;border-radius:6px}
      .x:hover{background:#e4e4e7}
      .body{flex:1;overflow:auto;padding:16px 18px}
      .t{font-weight:700;font-size:18px;line-height:1.35;word-break:break-word}
      .s{font-size:13px;color:#555;margin-top:6px}
      ul{margin:16px 0 0;padding:0;list-style:none;color:#333}
      li{padding:10px 12px;border:1px solid #e4e4e7;border-radius:8px;margin-bottom:8px;background:#fafafa}
      li b{display:block;font-size:14px;color:#111;word-break:break-all}
      li span{display:block;font-size:12px;color:#666;margin-top:2px}
      .box.yes .body{border-top:4px solid #0ca30c}
      .box.no .body{border-top:4px solid #ec835a}
      .box.err .body{border-top:4px solid #d03b3b}
      .foot{padding:8px 14px;font-size:11px;color:#8a8a8f;border-top:1px solid #eee;background:#fafafa}
      a{color:#2563eb}
    </style>
    <div class="box" id="b" hidden>
      <div class="bar" id="bar" title="按住拖动">
        <span class="name"><i class="dot"></i>Fanbox 作者赞助检测</span>
        <button class="x" id="x" title="关闭">×</button>
      </div>
      <div class="body">
        <div class="t" id="t"></div>
        <div class="s" id="s"></div>
        <ul id="l"></ul>
      </div>
      <div class="foot">拖动顶部标题栏可以移动这个框，位置会记住。数据来自各账号最近一次读取的结果。</div>
    </div>`
  const $ = (id) => root.getElementById(id)
  const box = $('b')
  $('x').addEventListener('click', () => (box.hidden = true))
  // 关闭按钮在拖动条上：按下它时不要触发拖动
  $('x').addEventListener('pointerdown', (e) => e.stopPropagation())

  // ---- 位置：left/top，存起来，下次打开还在原处 ----
  const POS_KEY = 'panelPos'
  const MARGIN = 4
  let pos = null // 用户拖过之后的位置 { x, y }；null 表示用默认位置
  let shown = { x: 0, y: 0 } // 当前实际显示的位置
  const size = () => ({ w: Math.min(400, innerWidth - MARGIN * 2), h: Math.min(600, innerHeight - MARGIN * 2) })
  const clamp = (p) => {
    const { w, h } = size()
    return {
      x: Math.min(Math.max(MARGIN, p.x), Math.max(MARGIN, innerWidth - w - MARGIN)),
      y: Math.min(Math.max(MARGIN, p.y), Math.max(MARGIN, innerHeight - h - MARGIN)),
    }
  }
  const place = () => {
    const { w } = size()
    const p = clamp(pos ?? { x: innerWidth - w - 16, y: 16 }) // 默认放右上角
    shown = p
    host.style.transform = `translate(${p.x}px,${p.y}px)`
  }
  const save = () => {
    try {
      chrome.storage.local.set({ [POS_KEY]: pos })
    } catch {}
  }
  chrome.storage.local.get(POS_KEY).then((r) => {
    if (r?.[POS_KEY]) pos = r[POS_KEY]
    place()
  }).catch(place)
  addEventListener('resize', place) // 窗口变小时把面板拉回可视范围

  const bar = $('bar')
  let drag = null
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    drag = { dx: e.clientX - shown.x, dy: e.clientY - shown.y }
    bar.setPointerCapture(e.pointerId) // 鼠标移出面板也不丢事件
    bar.classList.add('drag')
    e.preventDefault()
  })
  bar.addEventListener('pointermove', (e) => {
    if (!drag) return
    pos = clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy })
    shown = pos
    host.style.transform = `translate(${pos.x}px,${pos.y}px)`
  })
  const end = (e) => {
    if (!drag) return
    drag = null
    bar.classList.remove('drag')
    try {
      bar.releasePointerCapture(e.pointerId)
    } catch {}
    if (pos) save()
  }
  bar.addEventListener('pointerup', end)
  bar.addEventListener('pointercancel', end)

  const show = (cls, title, sub, items = []) => {
    box.className = 'box ' + cls
    $('t').textContent = title // 全部用 textContent：作者名、邮箱都是外部数据
    $('s').textContent = sub
    const ul = $('l')
    ul.textContent = ''
    for (const it of items) {
      const li = document.createElement('li')
      const b = document.createElement('b')
      b.textContent = it.main
      const sp = document.createElement('span')
      sp.textContent = it.sub
      li.append(b, sp)
      ul.appendChild(li)
    }
    box.hidden = false
    place()
  }

  let lastKey = ''
  const run = async () => {
    if (!isCreatorPage()) {
      box.hidden = true
      lastKey = ''
      return
    }
    const key = location.hostname + location.pathname.split('/').slice(0, 2).join('/')
    if (key === lastKey) return
    lastKey = key
    box.hidden = true

    const res = await chrome.runtime.sendMessage({ type: 'check', url: location.href }).catch(() => null)
    if (!res?.ok) {
      // 没填密钥 / 后端没开：给个明确提示，但不要一直打扰
      show('err', '作者检测不可用', res?.error || '插件没有响应')
      return
    }
    const d = res.data
    if (!d.is_creator_page) return box.hidden = true

    const notes = d.unread_accounts > 0 ? `（有 ${d.unread_accounts} 个账号还没读取过，结果可能不全）` : ''
    if (d.supported) {
      show(
        'yes',
        `已赞助：${d.matches[0].creator_name || d.creator_id}`,
        `账号池里有 ${d.matches.length} 个账号已赞助，不用再赞助。${notes}`,
        d.matches.map((m) => ({
          main: '赞助账号：' + m.account_email,
          sub: `¥${m.fee_jpy ?? '-'} ${m.plan_title || ''}${m.expires_at ? ' · 到期 ' + m.expires_at : ''}`,
        }))
      )
    } else {
      show('no', `还没有赞助：${d.creator_id}`, `账号池里没有账号赞助过他，可以继续赞助。${notes}`)
    }
  }

  document.documentElement.appendChild(host)
  run()
  // Fanbox 是单页应用，切换页面时不会重新加载：定时看一眼网址有没有变
  setInterval(run, 1500)
}
