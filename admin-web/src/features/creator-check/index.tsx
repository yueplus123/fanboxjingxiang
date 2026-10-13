import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ExternalLink, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  apiErrorMessage,
  fmtDate,
  methodName,
  type CheckResult,
} from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

export function CreatorCheck() {
  const [query, setQuery] = useState('')
  const check = useMutation({
    mutationFn: async () =>
      (await api.post<CheckResult>('/api/admin/creators/check', { query }))
        .data,
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const r = check.data

  return (
    <PageShell
      title='共享号检测'
      desc='粘贴作者链接，检查账号池里有没有账号已经赞助了他；没有的话，就可以去赞助。'
    >
      <form
        className='flex max-w-2xl gap-2'
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) check.mutate()
        }}
      >
        <Input
          placeholder='例如 https://roamer.fanbox.cc/ 或 https://www.fanbox.cc/@roamer'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button disabled={!query.trim() || check.isPending}>
          <Search /> 检测
        </Button>
      </form>

      {r && (
        <>
          {r.supported ? (
            <Alert>
              <AlertTitle>
                有 {r.matches.length} 个账号已经赞助了 {r.creator_id}
              </AlertTitle>
              <AlertDescription className='flex flex-col gap-1'>
                <span>不需要再赞助，直接用下面的账号即可。</span>
                <span className='font-medium text-foreground'>
                  赞助账号：{r.matches.map((m) => m.account_email).join('、')}
                </span>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>账号池里还没有账号赞助 {r.creator_id}</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                可以去赞助。
                <a
                  href={r.url}
                  target='_blank'
                  rel='noreferrer noopener'
                  className='inline-flex items-center gap-1 underline underline-offset-4'
                >
                  打开作者主页 <ExternalLink className='size-3.5' />
                </a>
              </AlertDescription>
            </Alert>
          )}

          {r.unread_accounts.length > 0 && (
            <p className='text-sm text-amber-600'>
              注意：有 {r.unread_accounts.length}{' '}
              个账号还没读取过，结果不包含它们（
              {r.unread_accounts.join('、')}）。请先去“账号”页读取。
            </p>
          )}

          {r.matches.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号邮箱</TableHead>
                  <TableHead>作者</TableHead>
                  <TableHead>方案</TableHead>
                  <TableHead>支付方式</TableHead>
                  <TableHead>赞助到期</TableHead>
                  <TableHead>数据更新于</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.matches.map((m) => (
                  <TableRow key={m.account_id}>
                    <TableCell className='font-medium'>
                      {m.account_email}
                    </TableCell>
                    <TableCell>{m.creator_name}</TableCell>
                    <TableCell className='whitespace-nowrap'>
                      ¥{m.fee_jpy?.toLocaleString()}
                      <span className='ms-2 text-xs text-muted-foreground'>
                        {m.plan_title}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant='secondary'>
                        {methodName(m.payment_method)}
                      </Badge>
                    </TableCell>
                    <TableCell>{m.expires_at || '-'}</TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground'>
                      {fmtDate(m.data_age)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className='text-xs text-muted-foreground'>
            检测的是各账号最近一次读取的数据（每 6
            小时自动更新），不是实时查询。
          </p>
        </>
      )}
    </PageShell>
  )
}
