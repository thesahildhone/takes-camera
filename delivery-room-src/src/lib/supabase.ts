import { createClient } from '@supabase/supabase-js'
export const SUPABASE_URL = 'https://qchxfwoaaoslipwkdqep.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_U7Ivi0etHC-PPVYvQgfATA_P10c7vlK'
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
export const APP_NAME = 'Delivery Room'

export function errMsg(e: unknown): string {
  if (!e) return 'Something went wrong'
  if (typeof e === 'string') return e
  const m = (e as { message?: string }).message || 'Something went wrong'
  if (/Invalid login credentials/i.test(m)) return 'That email and password do not match.'
  if (/User already registered/i.test(m)) return 'An account with this email already exists. Sign in instead.'
  if (/Password should be/i.test(m)) return 'Use a password with at least 6 characters.'
  return m
}
