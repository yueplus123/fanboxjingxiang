// 采集面板：在你自己已登录的 Fanbox 页面里，读取赞助列表、余额等统计信息，上报给服务器。
// 只读 Fanbox 自己的接口（用浏览器里已有的登录 cookie），不读取、不上传密码或 cookies 本身。
// 只有你主动点“读取并上报”才会发生，不会自动触发。
if (window === window.top && /(^|\.)fanbox\.cc$/.test(location.hostname)) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      .box{font:14px/1.5 system-ui,"Segoe UI",sans-serif;background:#fff;color:#111;border:1px solid #d4d4d4;
        border-radius:12px;width:320px;padding:14px;box-shadow:0 8px 28px #0004}
      .box[hidden]{display:none}
      .title{font-weight:700;font-size:15px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;white-space:nowrap}
      .x{background:none;border:0;font-size:18px;line-height:1;cursor:pointer;color:#666;padding:0 4px}
      .box select,.box #go{display:block;width:100%;box-sizing:border-box;padding:7px 8px;margin-top:6px;border-radius:7px;border:1px solid #d4d4d4;font:inherit}
      .box #go{background:#2563eb;color:#fff;border:0;cursor:pointer}
      .box #go:disabled{opacity:.6;cursor:default}
      .hint{margin-top:6px;font-size:11px;color:#8a8a8f}
      .msg{margin-top:8px;font-size:12px;color:#555;white-space:pre-line}
      .msg.err{color:#b91c1c}
      .msg.ok{color:#166534}
      .toggle{position:fixed;left:0;bottom:0;width:auto;background:#2563eb;color:#fff;border:0;border-radius:10px;
        padding:8px 12px;font:13px system-ui;cursor:pointer;box-shadow:0 4px 14px #0004}
    </style>
    <button class="toggle" id="toggle">读取 Fanbox 数据</button>
    <div class="box" id="box" hidden>
      <div class="title">采集并上报<button class="x" id="x" title="关闭">×</button></div>
      <select id="acc"><option value="">加载账号列表…</option></select>
      <button id="go" disabled>读取并上报</button>
      <div class="hint">想连昵称一起读：在“账号设置”页（右上角头像 → 账号设置）上点这个按钮。</div>
      <div class="msg" id="msg"></div>
    </div>`
  const $ = (id) => root.getElementById(id)
  const box = $('box')
  $('toggle').addEventListener('click', () => {
    box.hidden = !box.hidden
    if (!box.hidden) loadAccounts()
  })
  $('x').addEventListener('click', () => (box.hidden = true))

  const say = (text, cls = '') => {
    $('msg').textContent = text
    $('msg').className = 'msg ' + cls
  }

  async function loadAccounts() {
    const res = await chrome.runtime.sendMessage({ type: 'list-accounts' }).catch(() => null)
    const sel = $('acc')
    if (!res?.ok) {
      sel.innerHTML = '<option value="">加载失败</option>'
      say(res?.error || '插件没有响应', 'err')
      return
    }
    sel.innerHTML =
      '<option value="">请选择要上报到哪个账号…</option>' +
      res.data
        .map((a) => `<option value="${a.id}">${a.label}${a.label !== a.email ? ' · ' + a.email : ''}</option>`)
        .join('')
    $('go').disabled = false
    if (!res.data.length) say('后台还没有登记任何账号，请先在管理后台的“账号”页添加一个。', 'err')
    else say('')
  }

  // ---- 采集逻辑：和原来服务器端读取使用同一套 Fanbox 接口 ----
  async function call(name) {
    const r = await fetch('https://api.fanbox.cc/' + name, { credentials: 'include' })
    return { status: r.status, json: r.ok ? await r.json().catch(() => null) : null }
  }

  // 账号昵称（Fanbox 的“用户名/ユーザー名”）只显示在账号设置页的输入框里，接口里没有。
  // 所以只有当前就停在设置页（/user/settings）时才读得到；其它页面返回空字符串，服务器会沿用上次的昵称。
  function readNickname() {
    if (!location.pathname.startsWith('/user/settings')) return ''
    const el = [...document.querySelectorAll('input[type="text"]')].find((i) => !i.placeholder)
    return el && el.value ? el.value : ''
  }

  async function collect() {
    const sup = await call('plan.listSupporting')
    if (sup.status !== 200 || !sup.json) {
      throw Object.assign(new Error('没能读到赞助列表，请确认这个标签页已经登录 Fanbox'), { code: 'NOT_LOGGED_IN' })
    }

    // 当前登录账号的 userId：页面埋点数据里带着，接口不返回
    const user_id = (() => {
      for (const s of document.querySelectorAll('script')) {
        const m = (s.textContent || '').match(/"userId"\s*:\s*"(\d+)"/)
        if (m) return m[1]
      }
      return ''
    })()

    const body = sup.json.body
    const list = Array.isArray(body) ? body : (body?.plans ?? body?.creators ?? [])
    const supporting = list.map((p) => ({
      plan_id: String(p.id ?? ''),
      creator_id: p.creatorId ?? '',
      creator_name: p.user?.name ?? '',
      plan_title: p.title ?? '',
      fee_jpy: p.fee ?? null,
      payment_method: p.paymentMethod ?? '',
      url: p.creatorId ? `https://${p.creatorId}.fanbox.cc/` : '',
    }))

    let balance = null
    for (const p of list) {
      const st = await call(`support.getSupportActionStatus?planId=${encodeURIComponent(p.id)}`)
      const b = st.json?.body
      if (!b) continue
      const s = supporting.find((x) => x.plan_id === String(p.id))
      if (s) {
        s.next_payment_date = b.nextPaymentDate ?? ''
        s.payment_required = !!b.paymentRequired
      }
      for (const o of b.paymentOptions ?? []) {
        if (o.paymentMethod === 'COBAN' && typeof o.balance === 'number') balance = o.balance
      }
    }

    const paid = await call('payment.listPaid')
    const allPayments = (paid.json?.body?.payments ?? []).map((x) => ({
      creator_id: x.creator?.creatorId ?? '',
      amount_jpy: x.paidAmount ?? null,
      method: x.paymentMethod ?? '',
      paid_at: x.paymentDatetime ?? '',
    }))
    const byCreator = new Map()
    for (const x of allPayments) {
      if (!x.creator_id || !x.paid_at) continue
      const cur = byCreator.get(x.creator_id) ?? { first: x.paid_at, last: x.paid_at }
      if (x.paid_at < cur.first) cur.first = x.paid_at
      if (x.paid_at > cur.last) cur.last = x.paid_at
      byCreator.set(x.creator_id, cur)
    }
    for (const s of supporting) {
      const c = byCreator.get(s.creator_id)
      s.last_paid_at = c?.last ?? ''
      s.first_paid_at = c?.first ?? ''
    }

    return {
      user_id,
      nickname: readNickname(),
      last_paid_at: allPayments[0]?.paid_at ?? '',
      payments_total: allPayments.length,
      supporting,
      balance: balance == null ? { available: false, note: '没有读到 pixivcoban 余额（界面语言不是日语时接口不返回这一项）' } : { amount_jpy: balance },
    }
  }

  $('go').addEventListener('click', async () => {
    const accountId = $('acc').value
    if (!accountId) return say('请先选择账号', 'err')
    $('go').disabled = true
    say('正在读取…')
    try {
      const data = await collect()
      say(`读到 ${data.supporting.length} 个赞助，正在上报…`)
      const res = await chrome.runtime.sendMessage({ type: 'report', accountId, data }).catch(() => null)
      if (!res?.ok) {
        say(res?.error || '上报失败', 'err')
      } else {
        say(`上报成功：${data.supporting.length} 个赞助，User ID ${data.user_id || '未读到'}`, 'ok')
      }
    } catch (e) {
      say(e.message || '读取失败', 'err')
    } finally {
      $('go').disabled = false
    }
  })

  document.documentElement.appendChild(host)
}
