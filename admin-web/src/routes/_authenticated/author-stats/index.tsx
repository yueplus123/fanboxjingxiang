import { createFileRoute } from '@tanstack/react-router'
import { AuthorStats } from '@/features/modules'

export const Route = createFileRoute('/_authenticated/author-stats/')({
  component: AuthorStats,
})
