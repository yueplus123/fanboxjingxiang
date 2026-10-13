const $ = (id) => document.getElementById(id)
const msg = (t, bad) => {
  $('msg').textContent = t
  $('msg').style.color = bad ? '#b91c1c' : '#166534'
}

chrome.storage.local.get(['apiBase', 'extKey']).then(({ apiBase, extKey }) => {
  $('api').value = apiBase || 'http://127.0.0.1:8787'
  $('key').value = extKey || ''
})

const save = () =>
  chrome.storage.local.set({ apiBase: $('api').value.trim(), extKey: $('key').value.trim() })

$('save').addEventListener('click', async () => {
  await save()
  msg('已保存')
})

// 用一个固定的作者链接试一下：能返回结果就说明地址和密钥都对
$('test').addEventListener('click', async () => {
  await save()
  try {
    const res = await fetch($('api').value.trim().replace(/\/$/, '') + '/api/ext/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${$('key').value.trim()}` },
      body: JSON.stringify({ url: 'https://example.fanbox.cc/' }),
    })
    if (res.status === 401) return msg('密钥不对', true)
    if (!res.ok) return msg(`服务器返回 ${res.status}`, true)
    msg('连接正常')
  } catch {
    msg('连不上服务，请确认后端已启动、地址没填错', true)
  }
})
