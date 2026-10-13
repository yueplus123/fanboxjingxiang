// Fanbox 账号管理：这里不再自己打开浏览器登录任何账号。
// 读取发生在使用者自己的 Chrome 里（装了配套的采集插件），由本人亲自登录、过验证码；
// 插件读到数据后只把“结果”（昵称、余额、赞助列表等统计信息）上报到这里保存。
// 账号登录凭证（密码、cookies）不会出现在这个服务器上。
export function registerAccounts(app, { db, log }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fanbox_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', -- new | ok | error
      last_error TEXT DEFAULT '',
      last_sync_at TEXT,
      snapshot TEXT DEFAULT '{}',    -- 插件上报的最近一次读取结果(JSON)
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const view = (r) => ({ ...r, snapshot: JSON.parse(r.snapshot || '{}') })

  app.get('/api/admin/accounts', (c) =>
    c.json(db.prepare('SELECT * FROM fanbox_accounts ORDER BY id DESC').all().map(view))
  )

  // 添加一个要跟踪的账号。只登记邮箱，不保存密码——密码只在使用者自己的浏览器里输入。
  app.post('/api/admin/accounts', async (c) => {
    const b = await c.req.json()
    // 明确拒绝密码类字段：以前的版本会保存密码，现在不会。静默忽略会让人误以为密码已经存好了。
    for (const bad of ['password', 'cookies', 'cookie', 'session']) {
      if (bad in b) return c.json({ error: `这个系统不保存 "${bad}"，请只填邮箱和备注。密码只在你自己的浏览器里输入。` }, 400)
    }
    if (!b.email) return c.json({ error: '请填写账号邮箱' }, 400)
    const r = db
      .prepare('INSERT INTO fanbox_accounts(label, email) VALUES (?,?)')
      .run(b.label || b.email, b.email)
    log('account.add', `id=${r.lastInsertRowid}`)
    return c.json({ id: Number(r.lastInsertRowid) })
  })

  app.delete('/api/admin/accounts/:id', (c) => {
    const id = Number(c.req.param('id'))
    db.prepare('DELETE FROM fanbox_accounts WHERE id=?').run(id)
    log('account.delete', `id=${id}`)
    return c.json({ ok: true })
  })

  // ---- 插件上报接口：挂在 /api/ext/* 下，用插件密钥鉴权（见 index.js） ----
  // 插件在使用者自己的 Chrome 里读到数据后调用这个接口；请求体里不应该、也不会包含密码或 cookies。
  app.post('/api/ext/accounts/:id/report', async (c) => {
    const id = Number(c.req.param('id'))
    const row = db.prepare('SELECT * FROM fanbox_accounts WHERE id=?').get(id)
    if (!row) return c.json({ error: '账号不存在' }, 404)

    const b = await c.req.json().catch(() => null)
    if (!b || typeof b !== 'object') return c.json({ error: '请求体格式不对' }, 400)
    // 防御性检查：确保插件没有不小心把敏感字段带上来
    for (const bad of ['password', 'cookies', 'session', 'cookie']) {
      if (bad in b) return c.json({ error: `不接受包含 "${bad}" 字段的上报` }, 400)
    }
    if (!Array.isArray(b.supporting)) return c.json({ error: '缺少 supporting 字段' }, 400)

    // user_id 跨账号重复：说明插件那边读到的是同一个登录态，直接拒绝，不覆盖已有数据
    if (b.user_id) {
      const clash = db
        .prepare(
          "SELECT id, email FROM fanbox_accounts WHERE id != ? AND json_extract(snapshot, '$.user_id') = ?"
        )
        .get(id, b.user_id)
      if (clash) {
        const msg = `上报的 User ID（${b.user_id}）和账号「${clash.email}」已读到的相同，像是读到了同一个登录态，本次上报已拒绝`
        db.prepare('UPDATE fanbox_accounts SET status=?, last_error=? WHERE id=?').run('error', msg, id)
        log('account.report.reject', `id=${id} clash_with=${clash.id}`)
        return c.json({ error: msg }, 409)
      }
    }

    // 昵称只有在账号设置页上才读得到。这次没读到（空）就沿用上一次读到的，不要把它清空。
    const prev = JSON.parse(row.snapshot || '{}')
    const snapshot = {
      fetched_at: new Date().toISOString(),
      user_id: String(b.user_id || ''),
      nickname: String(b.nickname || '') || prev.nickname || '',
      last_paid_at: String(b.last_paid_at || ''),
      payments_total: Number(b.payments_total || 0),
      supporting: b.supporting,
      payment_methods: [...new Set(b.supporting.map((x) => x.payment_method).filter(Boolean))],
      balance:
        b.balance && typeof b.balance.amount_jpy === 'number'
          ? { available: true, amount_jpy: b.balance.amount_jpy, unit: 'コバン（1コバン=¥1）' }
          : { available: false, note: b.balance?.note || '插件没有上报余额' },
    }
    db.prepare(
      "UPDATE fanbox_accounts SET status='ok', last_error='', last_sync_at=datetime('now'), snapshot=? WHERE id=?"
    ).run(JSON.stringify(snapshot), id)
    log('account.report', `id=${id} supporting=${b.supporting.length}`)
    return c.json({ ok: true })
  })

  // 插件启动时用来拉“要读哪些账号”的列表（邮箱 + 备注），同样走插件密钥
  app.get('/api/ext/accounts', (c) =>
    c.json(
      db
        .prepare('SELECT id, label, email, status, last_sync_at FROM fanbox_accounts ORDER BY id')
        .all()
    )
  )
}
