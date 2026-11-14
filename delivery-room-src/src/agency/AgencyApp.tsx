import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
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

export default function AgencyApp() {
  const { staff, wsId, setWsId, profile, signOut } = useAuth()
  const { ws } = useWs()
  const [open, setOpen] = useState(false)
  const [reviewCount, setReviewCount] = useState(0)
  const [socCount, setSocCount] = useState(0)
  const [unread, setUnread] = useState(0)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    if (!wsId) return
    sb.from('assignments').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'submitted').then(r => setReviewCount(r.count || 0))
    sb.from('social_assignments').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'submitted').then(r => setSocCount(r.count || 0))
    sb.from('notifications').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).is('read_at', null).then(r => setUnread(loc.pathname === '/agency/inbox' ? 0 : r.count || 0))
  }, [wsId, loc.pathname])
  if (!staff.length) return <Navigate to="/setup" replace />
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
        : <div className="card tight"><p className="eyebrow">Workspace</p><p style={{ fontWeight: 650 }}>{ws.name}</p></div>}
      <nav>
        <NavLink to="/agency" end>Overview</NavLink>
        <NavLink to="/agency/calendar">Calendar</NavLink>
        <NavLink to="/agency/inbox">Notifications{unread > 0 && <span className="count">{unread}</span>}</NavLink>
        <p className="nav-h">Socials</p>
        <NavLink to="/agency/socials">Sections & shots</NavLink>
        <NavLink to="/agency/social-review">Socials review{socCount > 0 && <span className="count">{socCount}</span>}</NavLink>
        <p className="nav-h">OF</p>
        <NavLink to="/agency/review">OF review{reviewCount > 0 && <span className="count">{reviewCount}</span>}</NavLink>
        <NavLink to="/agency/assignments">Sent sets</NavLink>
        <NavLink to="/agency/templates">Set templates</NavLink>
        <NavLink to="/agency/schedules">Schedules</NavLink>
        <p className="nav-h">Workspace</p>
        <NavLink to="/agency/creators">Creators</NavLink>
        <NavLink to="/agency/settings">Settings</NavLink>
      </nav>
      <div style={{ marginTop: 'auto' }} className="stack">
        <p className="muted" style={{ fontSize: 13 }}>{profile?.full_name || profile?.email}<br /><span className="eyebrow">{ws.role}</span></p>
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
