import { EmbeddedModule } from './embedded-module'

export const PICTSPACE_URL =
  import.meta.env.VITE_PICTSPACE_URL ?? 'http://127.0.0.1:8765/'
export const AUTHOR_STATS_URL =
  import.meta.env.VITE_AUTHOR_STATS_URL ?? 'http://127.0.0.1:8766/'

export function Pictspace() {
  return (
    <EmbeddedModule
      title='pict加购助手'
      url={PICTSPACE_URL}
      howToStart='运行项目根目录的 start-modules.bat，或在 modules/pictspace 里执行 python web_app.py（需要先 pip install -r requirements.txt）。'
    />
  )
}

export function AuthorStats() {
  return (
    <EmbeddedModule
      title='作者投稿统计'
      url={AUTHOR_STATS_URL}
      howToStart='运行项目根目录的 start-modules.bat，或在 modules/author-stats 里执行 python server.py（不需要安装依赖）。'
    />
  )
}
