import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync, Loading, ErrorBox, StatusPill } from '../lib/ui'
import { dueLabel, slotsFor, type Assignment } from '../lib/types'
import { CTop } from './CreatorApp'

const TABS = [
  { k: 'todo', label: 'To do', m: (s: string) => s === 'not_started' || s === 'in_progress' },
  { k: 'redo', label: 'Redo', m: (s: string) => s === 'revision_requested' },
  { k: 'sub', label: 'Submitted', m: (s: string) => s === 'submitted' || s === 'under_review' },
  { k: 'done', label: 'Approved', m: (s: string) => s === 'approved' },
]

export default function Home() {
  const { profile, creatorOf } = useAuth()
  const [tab, setTab] = useState('todo'); const [wsF, setWsF] = useState('all')
  const { data, loading, error } = useAsync(async () => {
    const [a, f] = await Promise.all([
      sb.from('assignments').select('*').eq('creator_id', profile!.id).neq('status', 'cancelled').order('created_at', { ascending: false }),
      sb.from('submission_files').select('assignment_id,page_id,slot_key').eq('creator_id', profile!.id).eq('is_current', true),
    ])
    if (a.error) throw a.error
    const got: Record<string, Set<string>> = {}
    ;(f.data || []).forEach((r: { assignment_id: string; page_id: string; slot_key: string }) => (got[r.assignment_id] ||= new Set()).add(r.page_id + ':' + r.slot_key))
    return { rows: (a.data || []) as Assignment[], got }
  }, [profile?.id])
  const wsName = (id: string) => creatorOf.find(w => w.id === id)?.name || 'Agency'
  const active = new Set(creatorOf.map(w => w.id))
  const rows = useMemo(() => (data?.rows || []).filter(a => active.has(a.workspace_id) && (wsF === 'all' || a.workspace_id === wsF)), [data, wsF, creatorOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = Object.fromEntries(TABS.map(t => [t.k, rows.filter(a => t.m(a.status)).length]))
  const shown = rows.filter(a => TABS.find(t => t.k === tab)!.m(a.status))
  const groups = useMemo(() => { const g = new Map<string, Assignment[]>(); shown.forEach(a => { const k = a.category_name || 'Other'; g.set(k, [...(g.get(k) || []), a]) }); return [...g.entries()] }, [shown])
  const prog = (a: Assignment) => { let req = 0, have = 0; a.pages.forEach(p => slotsFor(p).forEach(s => { if (s.required) { req++; if (data?.got[a.id]?.has(p.id + ':' + s.key)) have++ } })); return { req, have } }
  const first = (profile?.full_name || '').split(' ')[0]

  return <div className="phone">
    <CTop />
    <div className="stack" style={{ marginBottom: 14 }}>
      <p className="eyebrow">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
      <h1 style={{ fontSize: 28, lineHeight: 1.12 }}>{first ? `Hi ${first}, ` : ''}{counts.todo + counts.redo ? `you have ${counts.todo + counts.redo} to film.` : 'you\'re all caught up.'}</h1>
    </div>
    {creatorOf.length === 0 ? <div className="empty"><h3>You're not part of any agency yet</h3><p>Ask your agency for an invite link. When you open it, their assignments show up here.</p></div> : <>
      {creatorOf.length > 1 && <select className="select" aria-label="Agency" value={wsF} onChange={e => setWsF(e.target.value)} style={{ marginBottom: 10 }}><option value="all">All agencies</option>{creatorOf.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
      <div className="chips" style={{ marginBottom: 14 }}>{TABS.map(t => <button key={t.k} className="chip" aria-pressed={tab === t.k} onClick={() => setTab(t.k)}>{t.label}{counts[t.k] ? ` · ${counts[t.k]}` : ''}</button>)}</div>
      {loading ? <Loading /> : error ? <ErrorBox msg={error} /> : shown.length === 0 ? <div className="empty"><h3>{tab === 'todo' ? 'Nothing to film right now' : tab === 'redo' ? 'No redo requests' : tab === 'sub' ? 'Nothing waiting for review' : 'Nothing approved yet'}</h3>
        <p>{tab === 'todo' ? 'New assignments from your agency appear here.' : ''}</p></div> :
        <div className="stack" style={{ gap: 18 }}>{groups.map(([g, list]) => <div key={g} className="stack" style={{ gap: 10 }}>
          <div className="between"><h2 className="eyebrow">{g}</h2><span className="muted" style={{ fontSize: 13 }}>{list.length}</span></div>
          {list.map(a => { const p = prog(a); return <Link key={a.id} to={'/creator/a/' + a.id} className="card click">
            <div className="between"><h3>{a.title}</h3><StatusPill s={a.status} /></div>
            <p className="muted" style={{ fontSize: 13 }}>{creatorOf.length > 1 ? wsName(a.workspace_id) + ' · ' : ''}{a.pages.length} pages · {dueLabel(a.due_at)}</p>
            <div className="bar"><i style={{ width: (p.req ? p.have / p.req * 100 : 0) + '%' }} /></div>
            <p className="muted" style={{ fontSize: 13 }}>{p.have} of {p.req} required files</p>
          </Link> })}
        </div>)}</div>}
    </>}
  </div>
}
