// 由后台去请求本地服务：fanbox.cc 是 https 页面，直接请求 http 地址会被浏览器拦截（混合内容）。
const DEFAULT_API = 'http://127.0.0.1:8787'

// 同一个作者短时间内不重复请求（页面是单页应用，会频繁触发）
const cache = new Map() // creator_id -> { at, data }
const TTL_MS = 60 * 1000

async function apiFetch(path, init) {
  const { apiBase = DEFAULT_API, extKey = '' } = await chrome.storage.local.get(['apiBase', 'extKey'])
  if (!extKey) return { ok: false, code: 'NO_KEY', error: '还没有填插件密钥，请在插件选项里设置' }
  try {
    const res = await fetch(apiBase.replace(/\/$/, '') + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${extKey}`, ...init?.headers },
    })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401) return { ok: false, code: 'BAD_KEY', error: '插件密钥不对，请在插件选项里重新填写' }
    if (!res.ok) return { ok: false, error: body.error || `服务器返回 ${res.status}` }
    return { ok: true, data: body }
  } catch {
    return { ok: false, code: 'OFFLINE', error: '连不上本地服务，请确认后端已启动' }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 只接受来自 fanbox.cc 页面内容脚本的请求
  let host = ''
  try {
    host = new URL(sender.url).hostname
  } catch {}
  if (!/(^|\.)fanbox\.cc$/.test(host)) {
    sendResponse({ ok: false, error: '来源不允许' })
    return
  }

  if (msg?.type === 'check') {
    ;(async () => {
      const hit = cache.get(msg.url)
      if (hit && Date.now() - hit.at < TTL_MS) return sendResponse({ ok: true, data: hit.data })
      const r = await apiFetch('/api/ext/check', { method: 'POST', body: JSON.stringify({ url: msg.url }) })
      if (r.ok) cache.set(msg.url, { at: Date.now(), data: r.data })
      sendResponse(r)
    })()
    return true
  }

  if (msg?.type === 'list-accounts') {
    apiFetch('/api/ext/accounts').then(sendResponse)
    return true
  }

  if (msg?.type === 'report') {
    // data 里本来就不应该有密码或 cookies；这里再做一层保险检查，防止意外带出去
    const bad = Object.keys(msg.data || {}).find((k) => /password|cookie|session/i.test(k))
    if (bad) {
      sendResponse({ ok: false, error: `上报数据里不应该出现 "${bad}" 字段，已拒绝发送` })
      return
    }
    apiFetch(`/api/ext/accounts/${msg.accountId}/report`, {
      method: 'POST',
      body: JSON.stringify(msg.data),
    }).then(sendResponse)
    return true
  }
})

