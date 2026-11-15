import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useWs } from '../lib/auth'
import { sb, APP_NAME } from '../lib/supabase'
import { IcMenu, IcX } from '../lib/icons'
import Overview from './Overview'
import Creators from './Creators'
import Templates from './Templates'
import TemplateEditor from './TemplateEditor'
import Assignments from './Assignments'
import Schedules from './Schedules'
import ReviewDetail from './ReviewDetail'
import Settings from './Settings'
import Socials from './Socials'
import ProjectEditor from './ProjectEditor'
import { SocialInbox, SocialReviewDetail } from './SocialReview'
import AgencyInbox from './AgencyInbox'
import Calendar from './Calendar'

interface TreeType { id: string; name: string }
interface TreeSec { id: string; title: string; content_type_id: string }
const Chev = () => <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>

export default function AgencyApp() {
  const { staff, wsId, setWsId, profile, signOut } = useAuth()
  const { ws } = useWs()
  const [open, setOpen] = useState(false)
  const [reviewCount, setReviewCount] = useState(0)
  const [socCount, setSocCount] = useState(0)
  const [unread, setUnread] = useState(0)
  const loc = useLocation(); const nav = useNavigate()
  const [tree, setTree] = useState<{ types: TreeType[]; sections: TreeSec[] }>({ types: [], sections: [] })
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('dr.nav') || '{}') } catch { return {} } })
  const [adding, setAdding] = useState<string | null>(null); const [newName, setNewName] = useState('')
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    if (!wsId) return
    sb.from('assignments').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'submitted').then(r => setReviewCount(r.count || 0))
    sb.from('social_assignments').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'submitted').then(r => setSocCount(r.count || 0))
    sb.from('notifications').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).is('read_at', null).then(r => setUnread(loc.pathname === '/agency/inbox' ? 0 : r.count || 0))
  }, [wsId, loc.pathname])
  const loadTree = useCallback(async () => {
    if (!wsId) return
    await sb.rpc('social_bootstrap', { ws: wsId })
    const [t, x] = await Promise.all([
      sb.from('social_content_types').select('id,name').eq('workspace_id', wsId).is('archived_at', null).order('position'),
      sb.from('social_sections').select('id,title,content_type_id').eq('workspace_id', wsId).is('archived_at', null).order('position')])
    setTree({ types: (t.data || []) as TreeType[], sections: (x.data || []) as TreeSec[] })
  }, [wsId])
  useEffect(() => { loadTree(); window.addEventListener('dr-structure', loadTree); return () => window.removeEventListener('dr-structure', loadTree) }, [loadTree])
  const isOpen = (k: string) => openKeys[k] ?? k.startsWith('g:')
  const toggle = (k: string, v?: boolean) => setOpenKeys(o => { const n = { ...o, [k]: v ?? !(o[k] ?? k.startsWith('g:')) }; try { localStorage.setItem('dr.nav', JSON.stringify(n)) } catch { /* */ } return n })
  const mSec = loc.pathname.match(/\/socials\/s\/([^/]+)/), mType = loc.pathname.match(/\/socials\/t\/([^/]+)/)
  const activeType = mType?.[1] || tree.sections.find(x => x.id === mSec?.[1])?.content_type_id || null
  async function addSection(typeId: string) {
    const name = newName.trim(); if (!name) return setAdding(null)
    const { data, error } = await sb.from('social_sections').insert({ workspace_id: wsId, content_type_id: typeId, title: name, position: tree.sections.filter(x => x.content_type_id === typeId).length }).select('id').single()
    setAdding(null); setNewName(''); if (error || !data) return
    await loadTree(); nav('/agency/socials/s/' + data.id)
  }
  async function addType() {
    const name = newName.trim(); if (!name) return setAdding(null)
    const { data, error } = await sb.from('social_content_types').insert({ workspace_id: wsId, name, position: tree.types.length }).select('id').single()
    setAdding(null); setNewName(''); if (error || !data) return
    await loadTree(); toggle('t:' + data.id, true); nav('/agency/socials/t/' + data.id)
  }
  if (!staff.length) return <Navigate to={profile?.kind === 'creator' ? '/creator' : '/setup'} replace />
  if (!ws) return null
  return <div className="shell">
    <div className="mobile-top">
      <span className="brand"><span className="mark" />{APP_NAME}</span>
      <button className="icon-btn" aria-label="Menu" onClick={() => setOpen(o => !o)}>{open ? <IcX /> : <IcMenu />}</button>
    </div>
    <aside className={'side' + (open ? ' open' : '')}>
      <span className="brand"><span className="mark" />{APP_NAME}</span>
      {staff.length > 1 ? <select className="select ws-switch" aria-label="Workspace" value={wsId || ''} onChange={e => setWsId(e.target.value)}>
        {staff.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        : <p className="ws-name">{ws.name}</p>}
      <nav>
        <NavLink to="/agency" end>Overview</NavLink>
        <NavLink to="/agency/calendar">Calendar</NavLink>
        <NavLink to="/agency/inbox">Notifications{unread > 0 && <span className="count">{unread}</span>}</NavLink>

        <button className="nav-g" aria-expanded={isOpen('g:soc')} onClick={() => toggle('g:soc')}><Chev />Socials</button>
        {isOpen('g:soc') && <div className="tree">
          <NavLink to="/agency/social-review">Review{socCount > 0 && <span className="count">{socCount}</span>}</NavLink>
          {tree.types.map(t => { const secs = tree.sections.filter(x => x.content_type_id === t.id), on = isOpen('t:' + t.id) || activeType === t.id
            return <div key={t.id}>
              <div className="folder"><button className="tw" aria-label={on ? `Close ${t.name}` : `Open ${t.name}`} aria-expanded={on} onClick={() => toggle('t:' + t.id, !on)}><Chev /></button>
                <NavLink to={'/agency/socials/t/' + t.id} onClick={() => toggle('t:' + t.id, true)}>{t.name}</NavLink></div>
              {on && <div className="tree l2">
                {secs.map(x => <NavLink key={x.id} to={'/agency/socials/s/' + x.id}>{x.title}</NavLink>)}
                {adding === t.id ? <form onSubmit={e => { e.preventDefault(); addSection(t.id) }}><input className="nav-in" autoFocus value={newName} maxLength={60} placeholder="Section name" onChange={e => setNewName(e.target.value)} onBlur={() => { if (!newName.trim()) setAdding(null) }} /></form>
                  : <button className="nav-add" onClick={() => { setNewName(''); setAdding(t.id) }}>+ New section</button>}
              </div>}
            </div> })}
          {ws.role !== 'reviewer' && (adding === 'type' ? <form onSubmit={e => { e.preventDefault(); addType() }}><input className="nav-in" autoFocus value={newName} maxLength={40} placeholder="Folder name" onChange={e => setNewName(e.target.value)} onBlur={() => { if (!newName.trim()) setAdding(null) }} /></form>
            : <button className="nav-add" onClick={() => { setNewName(''); setAdding('type') }}>+ New folder</button>)}
        </div>}

        <button className="nav-g" aria-expanded={isOpen('g:of')} onClick={() => toggle('g:of')}><Chev />OF</button>
        {isOpen('g:of') && <div className="tree">
          <NavLink to="/agency/review">Review{reviewCount > 0 && <span className="count">{reviewCount}</span>}</NavLink>
          <NavLink to="/agency/assignments">Sent sets</NavLink>
          <NavLink to="/agency/templates">Set templates</NavLink>
          <NavLink to="/agency/schedules">Schedules</NavLink>
        </div>}

        <p className="nav-h">Workspace</p>
        <NavLink to="/agency/creators">Creators</NavLink>
        <NavLink to="/agency/settings">Settings</NavLink>
      </nav>
      <div style={{ marginTop: 'auto' }} className="stack">
        <p className="who">{profile?.full_name || profile?.email}<br /><span>{ws.role[0].toUpperCase() + ws.role.slice(1)}</span></p>
        <button className="btn sm ghost" onClick={signOut}>Sign out</button>
      </div>
    </aside>
    <main className="main" key={wsId}>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="review" element={<Assignments reviewOnly />} />
        <Route path="review/:id" element={<ReviewDetail />} />
        <Route path="assignments" element={<Assignments />} />
        <Route path="templates" element={<Templates />} />
        <Route path="templates/:id" element={<TemplateEditor />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="creators" element={<Creators />} />
        <Route path="socials" element={<Socials />} />
        <Route path="socials/t/:typeId" element={<Socials />} />
        <Route path="socials/s/:sectionId" element={<Socials />} />
        <Route path="socials/p/:id" element={<ProjectEditor />} />
        <Route path="social-review" element={<SocialInbox />} />
        <Route path="social-review/:id" element={<SocialReviewDetail />} />
        <Route path="inbox" element={<AgencyInbox />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/agency" replace />} />
      </Routes>
    </main>
  </div>
}
