import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, fmtDate, methodName, type CreatorRow } from '@/lib/api'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageShell } from '@/components/page-shell'

export function Creators() {
  const [q, setQ] = useState('')
  const { data } = useQuery({
    queryKey: ['creators'],
    queryFn: async () =>
      (await api.get<CreatorRow[]>('/api/admin/creators')).data,
  })

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase()
    return (data ?? []).filter(
      (r) =>
        !k ||
        [r.creator_name, r.creator_id, r.account_email].some((v) =>
          v.toLowerCase().includes(k)
        )
    )
  }, [data, q])

  return (
    <PageShell
      title='作者'
      desc={`所有账号赞助的作者，共 ${data?.length ?? 0} 条（同一作者被多个账号赞助会分别列出）`}
      actions={
        <Input
          className='w-64'
          placeholder='搜索作者名 / 链接 id / 账号邮箱'
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>作者名字</TableHead>
            <TableHead>作者链接 ID</TableHead>
            <TableHead>方案金额</TableHead>
            <TableHead>所属账号</TableHead>
            <TableHead>赞助时间</TableHead>
            <TableHead>赞助到期时间</TableHead>
            <TableHead>支付方式</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((r) => (
              <TableRow key={`${r.account_id}-${r.creator_id}`}>
                <TableCell className='font-medium'>{r.creator_name}</TableCell>
                <TableCell>
                  <a
                    href={r.url}
                    target='_blank'
                    rel='noreferrer noopener'
                    className='underline underline-offset-4'
                  >
                    {r.creator_id}
                  </a>
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {r.fee_jpy != null ? `¥${r.fee_jpy.toLocaleString()}` : '-'}
                  <span className='ms-2 text-xs text-muted-foreground'>
                    {r.plan_title}
                  </span>
                </TableCell>
                <TableCell>{r.account_email}</TableCell>
                <TableCell className='whitespace-nowrap'>
                  {fmtDate(r.started_at)}
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {r.expires_at || '-'}
                </TableCell>
                <TableCell>{methodName(r.payment_method)}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={7}
                className='h-24 text-center text-muted-foreground'
              >
                {data?.length
                  ? '没有匹配的作者'
                  : '还没有数据，先去“账号”页读取账号'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <p className='text-xs text-muted-foreground'>
        “赞助时间”是该账号在扣款记录里最早一次向这位作者付款的时间；“到期时间”是下次扣款日，支付成功后会顺延。
      </p>
    </PageShell>
  )
}
