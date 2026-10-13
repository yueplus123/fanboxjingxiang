import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'

type Props = {
  title: string
  url: string
  // 启动方式提示：服务没开时显示给使用者
  howToStart: string
}

// 嵌入一个独立运行的子项目。顶栏只放标题和两个按钮，其余空间全部留给嵌入的页面。
export function EmbeddedModule({ title, url, howToStart }: Props) {
  const [state, setState] = useState<'checking' | 'up' | 'down'>('checking')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setState('checking')
    // no-cors：只关心“连得上还是连不上”，不读内容
    fetch(url, { mode: 'no-cors', cache: 'no-store' })
      .then(() => alive && setState('up'))
      .catch(() => alive && setState('down'))
    return () => {
      alive = false
    }
  }, [url, nonce])

  return (
    <>
      <Header fixed>
        <h1 className='me-auto text-base font-semibold'>{title}</h1>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setNonce((n) => n + 1)}
        >
          <RefreshCw /> 刷新
        </Button>
        <Button variant='outline' size='sm' asChild>
          <a href={url} target='_blank' rel='noreferrer noopener'>
            <ExternalLink /> 新窗口打开
          </a>
        </Button>
      </Header>
      {/* fixed：撑满剩余高度；fluid：取消最大宽度；p-0：去掉内边距 */}
      <Main fixed fluid className='p-0'>
        {state === 'down' ? (
          <div className='m-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm'>
            <p className='font-medium'>连不上 {url}</p>
            <p className='mt-1 text-muted-foreground'>
              这个子项目的服务还没启动。{howToStart}
            </p>
          </div>
        ) : (
          <iframe
            key={nonce}
            src={url}
            title={title}
            className='h-full w-full flex-1 border-0 bg-background'
          />
        )}
      </Main>
    </>
  )
}
