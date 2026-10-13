// 作者相关接口：作者列表（跨账号汇总）、共享号作者检测。
// 数据都来自各账号最近一次读取的快照，不会额外访问 Fanbox。

// 从用户输入里取出作者 id。支持：
//   https://roamer.fanbox.cc/   https://www.fanbox.cc/@roamer   https://www.fanbox.cc/@roamer/posts/123   roamer
export function parseCreatorId(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = u.hostname.toLowerCase()
    const sub = host.match(/^([a-z0-9-]+)\.fanbox\.cc$/)?.[1]
    if (sub && sub !== 'www' && sub !== 'api' && sub !== 'official') return sub
    if (host === 'www.fanbox.cc' || host === 'fanbox.cc') {
      const at = u.pathname.match(/^\/@([^/]+)/)?.[1]
      if (at) return at.toLowerCase()
    }
  } catch {}
  // 只填了 id 本身
  return /^[a-z0-9_-]{2,}$/i.test(raw) ? raw.toLowerCase() : ''
}

export function registerCreators(app, { db }) {
  const accounts = () =>
    db
      .prepare('SELECT id, email, snapshot FROM fanbox_accounts ORDER BY id')
      .all()
      .map((r) => ({ id: r.id, email: r.email, snapshot: JSON.parse(r.snapshot || '{}') }))

  // 所有账号赞助的作者，一行一个“账号 × 作者”
  app.get('/api/admin/creators', (c) => {
    const rows = []
    for (const a of accounts()) {
      for (const s of a.snapshot.supporting ?? []) {
        rows.push({
          account_id: a.id,
          account_email: a.email,
          creator_name: s.creator_name,
          creator_id: s.creator_id,
          url: s.url,
          plan_title: s.plan_title,
          fee_jpy: s.fee_jpy,
          payment_method: s.payment_method,
          started_at: s.first_paid_at || '',
          last_paid_at: s.last_paid_at || '',
          expires_at: s.next_payment_date || '',
        })
      }
    }
    return c.json(rows)
  })

  // 检测一个作者：哪些账号赞助了他。管理端页面和浏览器插件共用这一份逻辑。
  function checkCreator(creator_id) {
    const all = accounts()
    const never = all.filter((a) => !a.snapshot.fetched_at).map((a) => a.email)
    const matches = []
    for (const a of all) {
      const hit = (a.snapshot.supporting ?? []).find((s) => s.creator_id.toLowerCase() === creator_id)
      if (hit)
        matches.push({
          account_id: a.id,
          account_email: a.email,
          creator_name: hit.creator_name,
          plan_title: hit.plan_title,
          fee_jpy: hit.fee_jpy,
          payment_method: hit.payment_method,
          expires_at: hit.next_payment_date || '',
          data_age: a.snapshot.fetched_at || '',
        })
    }
    return {
      creator_id,
      url: `https://${creator_id}.fanbox.cc/`,
      supported: matches.length > 0,
      matches,
      accounts_total: all.length,
      // 这些账号还没读取过，检测结果不包含它们
      unread_accounts: never,
    }
  }

  // 共享号作者检测：输入作者链接，返回哪些账号赞助了他
  app.post('/api/admin/creators/check', async (c) => {
    const { query } = await c.req.json().catch(() => ({}))
    const creator_id = parseCreatorId(query)
    if (!creator_id) return c.json({ error: '没认出作者链接，请填 https://xxx.fanbox.cc/ 或 https://www.fanbox.cc/@xxx' }, 400)
    return c.json(checkCreator(creator_id))
  })

  // 浏览器插件用：只读、只返回“有没有赞助”，不暴露账号邮箱以外的任何敏感数据。
  // 用独立的插件密钥保护（见 index.js 的 /api/ext/* 中间件），不使用管理员密码。
  app.post('/api/ext/check', async (c) => {
    const { url } = await c.req.json().catch(() => ({}))
    const creator_id = parseCreatorId(url)
    // 打开的不是作者页（首页、帖子列表等）：告诉插件“不是作者页”，让它保持安静
    if (!creator_id) return c.json({ is_creator_page: false })
    const r = checkCreator(creator_id)
    return c.json({
      is_creator_page: true,
      creator_id: r.creator_id,
      url: r.url,
      supported: r.supported,
      unread_accounts: r.unread_accounts.length,
      matches: r.matches.map((m) => ({
        account_email: m.account_email,
        creator_name: m.creator_name,
        plan_title: m.plan_title,
        fee_jpy: m.fee_jpy,
        payment_method: m.payment_method,
        expires_at: m.expires_at,
      })),
    })
  })

  // 数据大屏用的汇总
  app.get('/api/admin/dashboard', (c) => {
    const accs = accounts()
    const rows = []
    for (const a of accs)
      for (const s of a.snapshot.supporting ?? []) rows.push({ ...s, account_id: a.id, account_email: a.email })

    const sum = (arr, f) => arr.reduce((n, x) => n + (f(x) || 0), 0)
    const balance = (a) => (a.snapshot.balance?.available ? a.snapshot.balance.amount_jpy : 0)
    const monthly = (a) => sum(a.snapshot.supporting ?? [], (s) => s.fee_jpy)

    // 下个月 1 号会扣多少、账号余额够不够
    const accountsView = accs.map((a) => ({
      id: a.id,
      email: a.email,
      balance: a.snapshot.balance?.available ? a.snapshot.balance.amount_jpy : null,
      monthly: monthly(a),
      creators: (a.snapshot.supporting ?? []).length,
      synced_at: a.snapshot.fetched_at || '',
    }))
    const byMethod = {}
    for (const r of rows) byMethod[r.payment_method || '未知'] = (byMethod[r.payment_method || '未知'] || 0) + 1
    const dup = new Map()
    for (const r of rows) dup.set(r.creator_id, [...(dup.get(r.creator_id) ?? []), r.account_email])
    const next = rows.map((r) => r.next_payment_date).filter(Boolean).sort()[0] || ''

    return c.json({
      accounts: accountsView,
      totals: {
        accounts: accs.length,
        creators_unique: new Set(rows.map((r) => r.creator_id)).size,
        subscriptions: rows.length,
        monthly_jpy: sum(accs, monthly),
        balance_jpy: sum(accs, balance),
        short_jpy: Math.max(0, sum(accs, monthly) - sum(accs, balance)),
        next_charge: next,
      },
      by_method: Object.entries(byMethod).map(([method, count]) => ({ method, count })),
      top_fees: [...rows].sort((a, b) => (b.fee_jpy || 0) - (a.fee_jpy || 0)).slice(0, 8).map((r) => ({
        creator_name: r.creator_name,
        fee_jpy: r.fee_jpy,
        account_email: r.account_email,
      })),
      duplicated: [...dup.entries()]
        .filter(([, emails]) => emails.length > 1)
        .map(([creator_id, emails]) => ({ creator_id, emails })),
    })
  })
}
