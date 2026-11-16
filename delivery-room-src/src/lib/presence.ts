import { useEffect, useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { sb } from './supabase'

// Who on the agency team has the app open right now, and which page they're on.
// Live presence comes from a Realtime channel per workspace; a heartbeat also stamps
// last_seen_at so the Team page can say "Active 2h ago" for people who are offline.

export interface Online { user_id: string; name: string; page: string; since: string }

let online: Record<string, Online> = {}
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())
export function useOnline() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => online)
}

const PAGES: [RegExp, string][] = [
  [/^\/agency\/?$/, 'Overview'], [/^\/agency\/calendar/, 'Calendar'], [/^\/agency\/inbox/, 'Notifications'],
  [/^\/agency\/social-review/, 'Socials review'], [/^\/agency\/socials\/p\//, 'Editing a shot'], [/^\/agency\/socials/, 'Socials'],
  [/^\/agency\/review/, 'OF review'], [/^\/agency\/(assignments|templates|schedules)/, 'OF sets'],
  [/^\/agency\/creators/, 'Creators'], [/^\/agency\/team/, 'Team'], [/^\/agency\/settings/, 'Settings'],
]
export const pageName = (path: string) => PAGES.find(([r]) => r.test(path))?.[1] || 'Dashboard'

export function usePresence(wsId: string | null | undefined, me: { id: string; name: string } | null, path: string) {
  // one channel per workspace for as long as the agency app is open
  useEffect(() => {
    if (!wsId || !me) return
    const ch: RealtimeChannel = sb.channel('team:' + wsId, { config: { presence: { key: me.id } } })
    const sync = () => {
      const st = ch.presenceState<Online>(); const next: Record<string, Online> = {}
      for (const [k, metas] of Object.entries(st)) { const m = metas[metas.length - 1]; if (m) next[k] = { user_id: k, name: m.name, page: m.page, since: m.since } }
      online = next; emit()
    }
    ch.on('presence', { event: 'sync' }, sync).subscribe(s => { if (s === 'SUBSCRIBED') ch.track({ name: me.name, page: pageName(location.hash.slice(1) || '/agency'), since: new Date().toISOString() }) })
    const beat = () => { if (document.visibilityState === 'visible') sb.rpc('team_heartbeat', { ws: wsId, page: pageName(location.hash.slice(1) || '/agency') }).then(() => {}) }
    beat(); const t = setInterval(beat, 60_000)
    const vis = () => { if (document.visibilityState === 'visible') { beat(); ch.track({ name: me.name, page: pageName(location.hash.slice(1)), since: new Date().toISOString() }) } else ch.untrack() }
    document.addEventListener('visibilitychange', vis)
    ;(window as unknown as { __drTeam?: RealtimeChannel }).__drTeam = ch
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); sb.removeChannel(ch); online = {}; emit() }
  }, [wsId, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // tell the team when you move between pages
  useEffect(() => {
    const ch = (window as unknown as { __drTeam?: RealtimeChannel }).__drTeam
    if (!ch || !me) return
    ch.track({ name: me.name, page: pageName(path), since: online[me.id]?.since || new Date().toISOString() })
    if (wsId) sb.rpc('team_heartbeat', { ws: wsId, page: pageName(path) }).then(() => {})
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function seenLabel(iso: string | null) {
  if (!iso) return 'Not signed in yet'
  const m = (Date.now() - new Date(iso).getTime()) / 6e4
  if (m < 2) return 'Active just now'
  if (m < 60) return `Active ${Math.round(m)}m ago`
  if (m < 48 * 60) return `Active ${Math.round(m / 60)}h ago`
  return `Active ${Math.round(m / 1440)}d ago`
}
