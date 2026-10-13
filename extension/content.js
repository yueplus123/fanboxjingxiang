// 页面右下角的小面板：输入卡密 -> 确认赞助信息 -> 填卡。不会提交表单。
if (window === window.top) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      .box{font:14px/1.5 system-ui,sans-serif;background:#fff;color:#111;border:1px solid #ccc;
        border-radius:10px;padding:12px;width:260px;box-shadow:0 4px 16px #0003}
      input{width:100%;box-sizing:border-box;padding:6px 8px;margin:6px 0;border:1px solid #bbb;border-radius:6px}
      button{width:100%;padding:7px;border:0;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer}
      button:disabled{opacity:.6;cursor:default}
      .msg{margin-top:8px;font-size:13px;white-space:pre-line}
      .err{color:#b91c1c}
    </style>
    <div class="box">
      <strong>赞助填卡助手</strong>
      <input id="t" placeholder="输入卡密" autocomplete="off" />
      <button id="go">填入卡信息</button>
      <div class="msg" id="m"></div>
    </div>`
  const $ = (id) => root.getElementById(id)
  const say = (text, err = false) => {
    $('m').textContent = text
    $('m').className = 'msg' + (err ? ' err' : '')
  }

  $('go').addEventListener('click', async () => {
    const token = $('t').value.trim()
    if (!token) return say('请先输入卡密', true)
    $('go').disabled = true
    say('正在验证卡密…')
    const res = await chrome.runtime.sendMessage({ type: 'fetch-card', token })
    $('go').disabled = false
    if (!res?.ok) return say(res?.error || '失败', true)

    const { creator, amount_jpy, ...card } = res.data
    const report = window.__fanboxFill(card)
    $('t').value = '' // 卡密用过就清掉；卡信息不在扩展里保留
    const names = {
      number: '卡号',
      expiry: '有效期',
      cvv: 'CVV',
      holder: '持卡人',
    }
    const done = Object.keys(names).filter((k) => report[k]).map((k) => names[k])
    const missing = ['number', 'expiry', 'cvv']
      .filter((k) => !report[k])
      .map((k) => names[k])
    say(
      `这张卡对应：${creator}  ¥${amount_jpy}\n已填入：${done.join('、') || '无'}` +
        (missing.length
          ? `\n没找到：${missing.join('、')}（请手动填写，并反馈给管理员）`
          : '\n请核对金额与作者，再自己点击提交。'),
      missing.length > 0
    )
  })

  document.documentElement.appendChild(host)
}
