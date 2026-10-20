import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb } from './supabase'

export interface Profile { id: string; full_name: string; email: string | null; kind: 'business' | 'creator'; smoothing: number }
export interface StaffWs { id: string; name: string; role: 'owner' | 'admin' | 'reviewer'; status: string }
export interface CreatorWs { id: string; name: string; status: string }
interface Ctx {
  session: Session | null; profile: Profile | null; ready: boolean
  staff: StaffWs[]; creatorOf: CreatorWs[]
  wsId: string | null; setWsId: (id: string) => void
  refresh: () => Promise<void>; signOut: () => Promise<void>
}
const AuthCtx = createContext<Ctx>(null as unknown as Ctx)
const WS_KEY = 'dr.ws'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [staff, setStaff] = useState<StaffWs[]>([])
  const [creatorOf, setCreatorOf] = useState<CreatorWs[]>([])
  const [ready, setReady] = useState(false)
  const [wsId, setWsIdState] = useState<string | null>(() => { try { return localStorage.getItem(WS_KEY) } catch { return null } })

  const load = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); setStaff([]); setCreatorOf([]); setReady(true); return }
    const uid = s.user.id
    const [p, wm, cm] = await Promise.all([
      sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
      sb.from('workspace_members').select('role, workspaces(id,name,status)').eq('user_id', uid),
      sb.from('creator_memberships').select('status, workspaces(id,name)').eq('creator_id', uid).eq('status', 'active'),
    ])
    setProfile((p.data as Profile) || null)
    type WmRow = { role: StaffWs['role']; workspaces: { id: string; name: string; status: string } | null }
    type CmRow = { status: string; workspaces: { id: string; name: string } | null }
    const st = ((wm.data || []) as unknown as WmRow[]).filter(r => r.workspaces).map(r => ({ id: r.workspaces!.id, name: r.workspaces!.name, status: r.workspaces!.status, role: r.role }))
    setStaff(st)
    setCreatorOf(((cm.data || []) as unknown as CmRow[]).filter(r => r.workspaces).map(r => ({ id: r.workspaces!.id, name: r.workspaces!.name, status: r.status })))
    setWsIdState(cur => (cur && st.some(w => w.id === cur)) ? cur : (st[0]?.id ?? null))
    setReady(true)
  }, [])

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); load(data.session) })
    const { data: sub } = sb.auth.onAuthStateChange((ev, s) => { setSession(s); if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') load(s) })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const setWsId = (id: string) => { setWsIdState(id); try { localStorage.setItem(WS_KEY, id) } catch { /* ignore */ } }
  const refresh = useCallback(async () => { const { data } = await sb.auth.getSession(); await load(data.session) }, [load])
  const signOut = async () => { await sb.auth.signOut(); setSession(null); await load(null) }
  return <AuthCtx.Provider value={{ session, profile, ready, staff, creatorOf, wsId, setWsId, refresh, signOut }}>{children}</AuthCtx.Provider>
}
export const useAuth = () => useContext(AuthCtx)
export const useWs = () => { const a = useAuth(); const ws = a.staff.find(w => w.id === a.wsId) || null; return { ws, isAdmin: !!ws && ws.role !== 'reviewer' } }
