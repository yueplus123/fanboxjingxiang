import {
  BarChart3,
  BookUser,
  Command,
  ScanSearch,
  ShoppingBag,
  UserRound,
  Users,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: { name: '管理员', email: 'admin', avatar: '' },
  teams: [{ name: 'Fanbox 管理', logo: Command, plan: '内部使用' }],
  navGroups: [
    {
      title: '管理',
      items: [
        { title: '数据大屏', url: '/dashboard', icon: BarChart3 },
        { title: '账号', url: '/accounts', icon: Users },
        { title: '作者', url: '/creators', icon: UserRound },
        { title: '共享号检测', url: '/creator-check', icon: ScanSearch },
      ],
    },
    {
      title: '子项目',
      items: [
        { title: 'pict加购助手', url: '/pictspace', icon: ShoppingBag },
        { title: '作者投稿统计', url: '/author-stats', icon: BookUser },
      ],
    },
  ],
}
