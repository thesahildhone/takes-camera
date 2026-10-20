import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { sb, APP_NAME } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { IcBell, IcUser } from '../lib/icons'
import Home from './Home'
import Runner from './Runner'
import Inbox from './Inbox'
import Account from './Account'

export function CTop({ title }: { title?: string }) {
  const { session } = useAuth(); const [unread, setUnread] = useState(0); const loc = useLocation()
  useEffect(() => { if (session) sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).then(r => setUnread(r.count || 0)) }, [session, loc.pathname])
  return <header className="ctop">
    <Link to="/creator" className="brand"><span className="mark" />{title || APP_NAME}</Link>
    <div className="row"><Link to="/creator/inbox" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><IcBell />{unread > 0 && <span className="dot" />}</Link>
      <Link to="/creator/account" className="icon-btn" aria-label="Account"><IcUser /></Link></div>
  </header>
}

export default function CreatorApp() {
  const { staff, creatorOf } = useAuth()
  if (staff.length && !creatorOf.length) return <Navigate to="/agency" replace />
  return <Routes>
    <Route index element={<Home />} />
    <Route path="a/:id" element={<Runner />} />
    <Route path="inbox" element={<Inbox />} />
    <Route path="account" element={<Account />} />
    <Route path="*" element={<Navigate to="/creator" replace />} />
  </Routes>
}
