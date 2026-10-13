import { createFileRoute } from '@tanstack/react-router'
import { Pictspace } from '@/features/modules'

export const Route = createFileRoute('/_authenticated/pictspace/')({
  component: Pictspace,
})
