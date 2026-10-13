import axios from 'axios'
import { useAuthStore } from '@/stores/auth-store'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8787',
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().auth.accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const apiErrorMessage = (e: unknown) =>
  axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : '操作失败'

export type SupportingItem = {
  plan_id?: string
  creator_id: string
  creator_name: string
  plan_title: string
  fee_jpy: number | null
  payment_method: string
  next_payment_date?: string
  first_paid_at?: string
  last_paid_at?: string
  url: string
}

export type FanboxAccount = {
  id: number
  label: string
  email: string
  status: 'new' | 'ok' | 'error'
  last_error: string
  last_sync_at: string | null
  created_at: string
  snapshot: {
    fetched_at?: string
    user_id?: string
    nickname?: string
    last_paid_at?: string
    supporting?: SupportingItem[]
    balance?: {
      available: boolean
      amount_jpy?: number
      unit?: string
      note?: string
    }
  }
}

export type CreatorRow = {
  account_id: number
  account_email: string
  creator_name: string
  creator_id: string
  url: string
  plan_title: string
  fee_jpy: number | null
  payment_method: string
  started_at: string
  last_paid_at: string
  expires_at: string
}

export type CheckResult = {
  creator_id: string
  url: string
  supported: boolean
  matches: {
    account_id: number
    account_email: string
    creator_name: string
    plan_title: string
    fee_jpy: number | null
    payment_method: string
    expires_at: string
    data_age: string
  }[]
  accounts_total: number
  unread_accounts: string[]
}

export type DashboardData = {
  accounts: {
    id: number
    email: string
    balance: number | null
    monthly: number
    creators: number
    synced_at: string
  }[]
  totals: {
    accounts: number
    creators_unique: number
    subscriptions: number
    monthly_jpy: number
    balance_jpy: number
    short_jpy: number
    next_charge: string
  }
  by_method: { method: string; count: number }[]
  top_fees: { creator_name: string; fee_jpy: number; account_email: string }[]
  duplicated: { creator_id: string; emails: string[] }[]
}

export const methodName = (m: string) =>
  m === 'COBAN'
    ? 'pixivcoban'
    : m === 'CARD'
      ? '信用卡'
      : m === 'CVS'
        ? '便利店'
        : m || '-'

export const fmtDate = (iso?: string) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleString('zh-CN', { hour12: false }).replace(/:\d{2}$/, '')
}
