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

export default function AgencyApp() {
  const { staff, wsId, setWsId, profile, signOut } = useAuth()
  const { ws } = useWs()
  const [open, setOpen] = useState(false)
  const [reviewCount, setReviewCount] = useState(0)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    if (!wsId) return
    sb.from('assignments').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'submitted').then(r => setReviewCount(r.count || 0))
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
        <NavLink to="/agency/review">Review{reviewCount > 0 && <span className="count">{reviewCount}</span>}</NavLink>
        <NavLink to="/agency/assignments">Assignments</NavLink>
        <NavLink to="/agency/templates">Templates</NavLink>
        <NavLink to="/agency/schedules">Schedules</NavLink>
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
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/agency" replace />} />
      </Routes>
    </main>
  </div>
}
