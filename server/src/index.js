import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { registerAccounts } from './accounts.js'
import { registerCreators } from './creators.js'

fs.mkdirSync('data', { recursive: true })
const db = new DatabaseSync('data/app.db')
db.exec(`
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT DEFAULT CURRENT_TIMESTAMP,
  action TEXT, detail TEXT
);
`)
const log = (action, detail = '') =>
  db.prepare('INSERT INTO audit(action,detail) VALUES (?,?)').run(action, detail)

// ---- 密钥：优先环境变量，否则在 data/ 下生成并持久化 ----
function loadSecret(name, env) {
  if (process.env[env]) return Buffer.from(process.env[env], 'hex')
  const f = `data/${name}.key`
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 })
  return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex')
}
const SESSION_KEY = loadSecret('session', 'SESSION_KEY')
// 浏览器插件专用密钥：插件在使用者自己的电脑上读取 Fanbox 数据后，用这把密钥把结果上报到这里。
// 泄露了也只能读/写账号的统计数据，拿不到管理员权限，这个服务器上本来就不存密码和 cookies。
const EXT_KEY = process.env.EXT_KEY || (() => {
  const f = 'data/ext.key'
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(24).toString('base64url'), { mode: 0o600 })
  return fs.readFileSync(f, 'utf8').trim()
})()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me'
if (ADMIN_PASSWORD === 'change-me') console.warn('[warn] 请设置环境变量 ADMIN_PASSWORD')

// ---- 会话：HMAC 签名的 token，12 小时有效 ----
const sign = (p) => crypto.createHmac('sha256', SESSION_KEY).update(p).digest('base64url')
const issueToken = () => {
  const p = String(Date.now() + 12 * 3600e3)
  return `${p}.${sign(p)}`
}
const validToken = (t = '') => {
  const [p, s] = t.split('.')
  if (!p || !s) return false
  const a = Buffer.from(s), b = Buffer.from(sign(p))
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(p) > Date.now()
}
const safeEq = (x, y) => {
  const a = crypto.createHash('sha256').update(x).digest()
  const b = crypto.createHash('sha256').update(y).digest()
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const app = new Hono()
app.use('/api/*', cors({ origin: (o) => o || '*', allowHeaders: ['Authorization', 'Content-Type'] }))

// 登录限速：每个 IP 每分钟最多 5 次
const attempts = new Map()
app.post('/api/login', async (c) => {
  const ip = c.req.header('x-forwarded-for') || 'local'
  const now = Date.now()
  const rec = (attempts.get(ip) || []).filter((t) => now - t < 60e3)
  if (rec.length >= 5) return c.json({ error: '尝试过多，请稍后再试' }, 429)
  const { password = '' } = await c.req.json().catch(() => ({}))
  if (!safeEq(password, ADMIN_PASSWORD)) {
    attempts.set(ip, [...rec, now])
    return c.json({ error: '密码错误' }, 401)
  }
  log('login')
  return c.json({ token: issueToken() })
})

// ---- 浏览器插件接口：需要插件密钥 ----
app.use('/api/ext/*', async (c, next) => {
  const k = (c.req.header('Authorization') || '').replace(/^Bearer /, '')
  if (!k || !safeEq(k, EXT_KEY)) return c.json({ error: '插件密钥不对' }, 401)
  await next()
})

// ---- 以下均需管理员登录 ----
app.use('/api/admin/*', async (c, next) => {
  const t = (c.req.header('Authorization') || '').replace(/^Bearer /, '')
  if (!validToken(t)) return c.json({ error: '未登录' }, 401)
  await next()
})

app.get('/api/admin/audit', (c) => c.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all()))

registerAccounts(app, { db, log })
registerCreators(app, { db })

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () =>
  console.log(`API listening on http://127.0.0.1:${port}`)
)
