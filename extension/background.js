// 由后台去请求服务器：避免 https 页面直接请求 http 地址时的混合内容限制
const DEFAULT_API = 'http://127.0.0.1:8787'

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'fetch-card') return
  // 只接受来自支付页内容脚本的请求
  if (!sender.url?.startsWith('https://payment.pixiv.net/')) {
    sendResponse({ ok: false, error: '来源不允许' })
    return
  }
  ;(async () => {
    const { apiBase = DEFAULT_API } = await chrome.storage.local.get('apiBase')
    try {
      const res = await fetch(apiBase.replace(/\/$/, '') + '/api/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: String(msg.token || '').trim() }),
      })
      const body = await res.json().catch(() => ({}))
      sendResponse(
        res.ok
          ? { ok: true, data: body }
          : { ok: false, error: body.error || `服务器返回 ${res.status}` }
      )
    } catch {
      sendResponse({ ok: false, error: '无法连接服务器，请检查服务器地址' })
    }
  })()
  return true // 异步响应
})
