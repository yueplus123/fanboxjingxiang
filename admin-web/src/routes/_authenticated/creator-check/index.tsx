import { createFileRoute } from '@tanstack/react-router'
import { CreatorCheck } from '@/features/creator-check'

export const Route = createFileRoute('/_authenticated/creator-check/')({
  component: CreatorCheck,
})
