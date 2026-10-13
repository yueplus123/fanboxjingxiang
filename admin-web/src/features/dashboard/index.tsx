import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { api, methodName, type DashboardData } from '@/lib/api'
import { PageShell } from '@/components/page-shell'

// 图表色：来自已校验的调色板（蓝 / 橙为分类色 1、2；状态色固定）。
// 浅色 / 深色各取自己的色阶，不是自动反色。
const css = `
.dash {
  --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --track: #cde2fb;
  --s1: #2a78d6; --s2: #eb6834;
  --ok: #006300; --bad: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .dash {
    --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --track: #104281;
    --s1: #3987e5; --s2: #d95926; --ok: #0ca30c; --bad: #d03b3b;
  }
}
:root[data-theme="dark"] .dash {
  --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --track: #104281;
  --s1: #3987e5; --s2: #d95926; --ok: #0ca30c; --bad: #d03b3b;
}
.dash .card { background: var(--surface); border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); border-radius: 12px; padding: 16px 18px; }
.dash h3 { font-size: 14px; font-weight: 600; color: var(--ink); margin: 0 0 2px; }
.dash .sub { font-size: 12px; color: var(--ink2); margin-bottom: 14px; }
.dash .kpi-l { font-size: 12px; color: var(--ink2); }
.dash .kpi-v { font-size: 28px; font-weight: 600; color: var(--ink); line-height: 1.2; margin-top: 4px; }
.dash .hero { font-size: 48px; }
.dash .kpi-n { font-size: 12px; color: var(--muted); margin-top: 4px; }
.dash .legend { display: flex; gap: 16px; font-size: 12px; color: var(--ink2); margin-bottom: 10px; flex-wrap: wrap; }
.dash .key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-inline-end: 6px; vertical-align: -1px; }
.dash .row { display: grid; grid-template-columns: minmax(120px, 200px) 1fr; gap: 12px; align-items: center; padding: 8px 0; border-top: 1px solid var(--grid); }
.dash .row:first-of-type { border-top: 0; }
.dash .name { font-size: 13px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dash .bars { display: grid; gap: 4px; }
.dash .bar-line { display: flex; align-items: center; gap: 8px; }
.dash .bar { height: 10px; border-radius: 0 4px 4px 0; min-width: 2px; }
.dash .bar-val { font-size: 12px; color: var(--ink2); white-space: nowrap; }
.dash .tag { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.dash .tag.ok { color: var(--ok); }
.dash .tag.bad { color: var(--bad); }
.dash .stack { display: flex; height: 22px; gap: 2px; }
.dash .seg { height: 100%; border-radius: 4px; min-width: 6px; }
.dash table { width: 100%; font-size: 13px; border-collapse: collapse; }
.dash th { text-align: start; font-weight: 500; color: var(--ink2); padding: 6px 8px; border-bottom: 1px solid var(--grid); }
.dash td { padding: 6px 8px; border-bottom: 1px solid var(--grid); color: var(--ink); }
.dash td.n, .dash th.n { text-align: end; font-variant-numeric: tabular-nums; }
.dash .hit { cursor: default; border-radius: 4px; transition: opacity .12s; }
.dash .hit:hover, .dash .hit:focus-visible { opacity: .8; outline: 2px solid var(--ink); outline-offset: 1px; }
.dash .tip { position: fixed; z-index: 50; pointer-events: none; background: var(--surface); color: var(--ink); border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent); border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
.dash .tip b { display: block; font-size: 14px; }
.dash .tip span { color: var(--ink2); }
.dash .toggle { font-size: 12px; color: var(--ink2); text-decoration: underline; text-underline-offset: 3px; background: none; border: 0; cursor: pointer; padding: 0; }
`

const yen = (n: number | null | undefined) =>
  n == null ? '-' : `¥${n.toLocaleString()}`

type Tip = { x: number; y: number; title: string; lines: string[] } | null

export function Dashboard() {
  const [tip, setTip] = useState<Tip>(null)
  const [table, setTable] = useState(false)
  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () =>
      (await api.get<DashboardData>('/api/admin/dashboard')).data,
  })

  const show = (
    e: React.PointerEvent | React.FocusEvent,
    title: string,
    lines: string[]
  ) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = 'clientX' in e ? e.clientX : r.left + r.width / 2
    const y = 'clientY' in e ? e.clientY : r.top
    setTip({ x, y, title, lines })
  }
  const hide = () => setTip(null)
  const hover = (title: string, lines: string[]) => ({
    tabIndex: 0,
    className: 'hit',
    onPointerMove: (e: React.PointerEvent) => show(e, title, lines),
    onPointerLeave: hide,
    onFocus: (e: React.FocusEvent) => show(e, title, lines),
    onBlur: hide,
  })

  const t = data?.totals
  const empty = !data || data.accounts.length === 0

  // 每个账号：余额 vs 下月要扣的钱，用同一把尺
  const maxAcc = Math.max(
    1,
    ...(data?.accounts ?? []).flatMap((a) => [a.balance ?? 0, a.monthly])
  )
  const maxFee = Math.max(1, ...(data?.top_fees ?? []).map((f) => f.fee_jpy))
  const methodTotal =
    (data?.by_method ?? []).reduce((n, m) => n + m.count, 0) || 1

  return (
    <PageShell
      title='数据大屏'
      desc='账号池的整体情况（数据来自各账号最近一次读取，每 6 小时自动更新）'
    >
      <div className='dash grid gap-4'>
        {empty ? (
          <div className='card text-sm text-muted-foreground'>
            还没有数据，先去“账号”页添加并读取账号。
          </div>
        ) : (
          <>
            {/* 概览数字：一个主数字 + 一排小数字 */}
            <div className='grid gap-4 lg:grid-cols-[1.2fr_2fr]'>
              <div className='card'>
                <div className='kpi-l'>每月赞助支出合计</div>
                <div className='kpi-v hero'>{yen(t?.monthly_jpy)}</div>
                <div className='kpi-n'>
                  {t?.subscriptions} 个赞助 · {t?.creators_unique} 位作者
                  {t?.next_charge ? ` · 下次扣款 ${t.next_charge}` : ''}
                </div>
              </div>
              <div className='grid gap-4 sm:grid-cols-3'>
                <div className='card'>
                  <div className='kpi-l'>账号数</div>
                  <div className='kpi-v'>{t?.accounts}</div>
                </div>
                <div className='card'>
                  <div className='kpi-l'>pixivcoban 余额合计</div>
                  <div className='kpi-v'>{yen(t?.balance_jpy)}</div>
                </div>
                <div className='card'>
                  <div className='kpi-l'>下次扣款缺口</div>
                  <div
                    className='kpi-v'
                    style={{
                      color: t && t.short_jpy > 0 ? 'var(--bad)' : undefined,
                    }}
                  >
                    {yen(t?.short_jpy)}
                  </div>
                  <div className='kpi-n'>
                    {t && t.short_jpy > 0 ? '余额不够，需要充值' : '余额足够'}
                  </div>
                </div>
              </div>
            </div>

            {/* 各账号：余额 vs 月支出 */}
            <div className='card'>
              <h3>各账号：余额与每月支出</h3>
              <div className='sub'>余额不够覆盖每月支出的账号会标出缺口</div>
              <div className='legend'>
                <span>
                  <i className='key' style={{ background: 'var(--s1)' }} />
                  余额
                </span>
                <span>
                  <i className='key' style={{ background: 'var(--s2)' }} />
                  每月支出
                </span>
              </div>
              {data.accounts.map((a) => {
                const short = a.balance != null && a.monthly > a.balance
                return (
                  <div className='row' key={a.id}>
                    <div className='name' title={a.email}>
                      {a.email}
                    </div>
                    <div className='bars'>
                      <div className='bar-line'>
                        <div
                          {...hover(a.email, [
                            `余额 ${yen(a.balance)}`,
                            `每月支出 ${yen(a.monthly)}`,
                          ])}
                          className='bar hit'
                          style={{
                            width: `${((a.balance ?? 0) / maxAcc) * 100}%`,
                            background: 'var(--s1)',
                          }}
                        />
                        <span className='bar-val'>{yen(a.balance)}</span>
                      </div>
                      <div className='bar-line'>
                        <div
                          {...hover(a.email, [
                            `余额 ${yen(a.balance)}`,
                            `每月支出 ${yen(a.monthly)}`,
                          ])}
                          className='bar hit'
                          style={{
                            width: `${(a.monthly / maxAcc) * 100}%`,
                            background: 'var(--s2)',
                          }}
                        />
                        <span className='bar-val'>{yen(a.monthly)}</span>
                        {a.balance == null ? (
                          <span className='tag'>余额未读取</span>
                        ) : short ? (
                          <span className='tag bad'>
                            <AlertTriangle size={14} />缺{' '}
                            {yen(a.monthly - a.balance)}
                          </span>
                        ) : (
                          <span className='tag ok'>
                            <CheckCircle2 size={14} />
                            够用
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              {/* 支付方式占比：分段条，段间 2px 间隙，直接标注 */}
              <div className='card'>
                <h3>赞助的支付方式</h3>
                <div className='sub'>按赞助数量</div>
                <div className='stack' role='img' aria-label='支付方式占比'>
                  {data.by_method.map((m, i) => (
                    <div
                      key={m.method}
                      {...hover(methodName(m.method), [
                        `${m.count} 个赞助`,
                        `${Math.round((m.count / methodTotal) * 100)}%`,
                      ])}
                      className='seg hit'
                      style={{
                        flex: m.count,
                        background: i === 0 ? 'var(--s1)' : 'var(--s2)',
                      }}
                    />
                  ))}
                </div>
                <div className='legend' style={{ marginTop: 10 }}>
                  {data.by_method.map((m, i) => (
                    <span key={m.method}>
                      <i
                        className='key'
                        style={{
                          background: i === 0 ? 'var(--s1)' : 'var(--s2)',
                        }}
                      />
                      {methodName(m.method)} {m.count} 个（
                      {Math.round((m.count / methodTotal) * 100)}%）
                    </span>
                  ))}
                </div>
                {data.duplicated.length > 0 && (
                  <p className='kpi-n' style={{ marginTop: 12 }}>
                    <AlertTriangle
                      size={13}
                      style={{ display: 'inline', verticalAlign: -2 }}
                    />{' '}
                    {data.duplicated.length} 位作者被多个账号重复赞助：
                    {data.duplicated.map((d) => d.creator_id).join('、')}
                  </p>
                )}
              </div>

              {/* 月费最高的作者：单色横条 */}
              <div className='card'>
                <h3>月费最高的作者</h3>
                <div className='sub'>前 {data.top_fees.length} 位</div>
                {data.top_fees.map((f) => (
                  <div className='row' key={f.creator_name + f.account_email}>
                    <div className='name' title={f.creator_name}>
                      {f.creator_name}
                    </div>
                    <div className='bar-line'>
                      <div
                        {...hover(f.creator_name, [
                          `${yen(f.fee_jpy)} / 月`,
                          f.account_email,
                        ])}
                        className='bar hit'
                        style={{
                          width: `${(f.fee_jpy / maxFee) * 100}%`,
                          background: 'var(--s1)',
                        }}
                      />
                      <span className='bar-val'>{yen(f.fee_jpy)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 表格视图：图里的数字都能在这里找到，不依赖悬停和颜色 */}
            <div className='card'>
              <button className='toggle' onClick={() => setTable((v) => !v)}>
                {table ? '收起表格视图' : '查看表格视图'}
              </button>
              {table && (
                <table style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>账号</th>
                      <th className='n'>余额</th>
                      <th className='n'>每月支出</th>
                      <th className='n'>作者数</th>
                      <th>数据更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accounts.map((a) => (
                      <tr key={a.id}>
                        <td>{a.email}</td>
                        <td className='n'>{yen(a.balance)}</td>
                        <td className='n'>{yen(a.monthly)}</td>
                        <td className='n'>{a.creators}</td>
                        <td>
                          {a.synced_at
                            ? a.synced_at.slice(0, 16).replace('T', ' ')
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
      <style>{css}</style>
      {tip && (
        <div className='dash tip' style={{ left: tip.x + 12, top: tip.y + 12 }}>
          <b>{tip.title}</b>
          {tip.lines.map((l, i) => (
            <span key={i} style={{ display: 'block' }}>
              {l}
            </span>
          ))}
        </div>
      )}
    </PageShell>
  )
}
