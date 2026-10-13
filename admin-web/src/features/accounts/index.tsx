import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, apiErrorMessage, fmtDate, type FanboxAccount } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageShell } from '@/components/page-shell'

const statusView: Record<
  FanboxAccount['status'],
  { text: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  new: { text: '等插件读取', variant: 'secondary' },
  ok: { text: '正常', variant: 'default' },
  error: { text: '读取失败', variant: 'destructive' },
}

const emptyForm = { label: '', email: '' }

export function Accounts() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [deleting, setDeleting] = useState<FanboxAccount | null>(null)

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () =>
      (await api.get<FanboxAccount[]>('/api/admin/accounts')).data,
    // 数据由采集插件异步上报，这里定时轮询一下，不用手动刷新页面
    refetchInterval: 15000,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['accounts'] })
    qc.invalidateQueries({ queryKey: ['creators'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const add = useMutation({
    mutationFn: () => api.post('/api/admin/accounts', form),
    onSuccess: () => {
      toast.success('已添加，请在装了采集插件的 Chrome 里登录这个账号来读取数据')
      setAdding(false)
      setForm(emptyForm)
      refresh()
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/accounts/${id}`),
    onSuccess: refresh,
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  return (
    <PageShell
      title='账号'
      desc='账号池里的 Fanbox 账号。数据由采集插件在你自己的浏览器里读取后上报，这台服务器不保存密码或登录状态。'
      actions={
        <Button onClick={() => setAdding(true)}>
          <Plus /> 添加账号
        </Button>
      }
    >
      <p className='rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-300'>
        添加账号后，请在装了采集插件的 Chrome
        里，亲自登录这个账号打开支援中页面，插件会自动把读到的数据发到这里。本服务器不会、也不需要知道你的密码。
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>账号邮箱</TableHead>
            <TableHead>账号昵称</TableHead>
            <TableHead>User ID</TableHead>
            <TableHead>余额</TableHead>
            <TableHead>最后赞助支付时间</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className='text-end'>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts?.length ? (
            accounts.map((a) => {
              const s = a.snapshot
              return (
                <TableRow key={a.id}>
                  <TableCell className='font-medium'>
                    {a.email}
                    {a.label && a.label !== a.email && (
                      <div className='text-xs text-muted-foreground'>
                        {a.label}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{s.nickname || '-'}</TableCell>
                  <TableCell>{s.user_id || '-'}</TableCell>
                  <TableCell className='whitespace-nowrap'>
                    {s.balance?.available
                      ? `${s.balance.amount_jpy?.toLocaleString()} コバン`
                      : '-'}
                  </TableCell>
                  <TableCell className='whitespace-nowrap'>
                    {fmtDate(s.last_paid_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusView[a.status].variant}>
                      {statusView[a.status].text}
                    </Badge>
                    <div className='mt-1 text-xs text-muted-foreground'>
                      {a.last_sync_at
                        ? `读取于 ${fmtDate(a.last_sync_at.replace(' ', 'T') + 'Z')}`
                        : '还没读取过'}
                    </div>
                    {a.last_error && a.status !== 'ok' && (
                      <div className='mt-1 max-w-64 text-xs text-destructive'>
                        {a.last_error}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className='text-end whitespace-nowrap'>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setDeleting(a)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })
          ) : (
            <TableRow>
              <TableCell
                colSpan={7}
                className='h-24 text-center text-muted-foreground'
              >
                还没有账号，点右上角“添加账号”
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>添加 Fanbox 账号</DialogTitle>
            <DialogDescription>
              只需要登记邮箱，用来和插件上报的数据对应。密码请只在你自己的浏览器里输入，不要填在这里。
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor='acc-label'>备注名（可选）</Label>
              <Input
                id='acc-label'
                placeholder='例如：主号'
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='acc-email'>pixiv 账号（邮箱）</Label>
              <Input
                id='acc-email'
                placeholder='name@example.com'
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!form.email || add.isPending} onClick={() => add.mutate()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title='删除这个账号？'
        desc='会删除已读取的统计信息，不会影响 Fanbox 上的账号本身。'
        confirmText='删除'
        cancelBtnText='取消'
        destructive
        handleConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
          setDeleting(null)
        }}
      />
    </PageShell>
  )
}
