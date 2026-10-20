import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider, Loading } from './lib/ui'
import { AuthPage, InvitePage, SetupPage, Welcome } from './Public'
import AgencyApp from './agency/AgencyApp'
import CreatorApp from './creator/CreatorApp'

function Home() {
  const { session, profile, staff, ready } = useAuth()
  if (!ready) return <div className="public"><Loading /></div>
  if (!session) return <Welcome />
  if (staff.length) return <Navigate to="/agency" replace />
  if (profile?.kind === 'business') return <Navigate to="/setup" replace />
  return <Navigate to="/creator" replace />
}
function Guard({ children }: { children: JSX.Element }) {
  const { session, ready } = useAuth(); const loc = useLocation()
  if (!ready) return <div className="public"><Loading /></div>
  if (!session) return <Navigate to={'/auth?next=' + encodeURIComponent(loc.pathname)} replace />
  return children
}
export default function App() {
  return <AuthProvider><ToastProvider>
    <div className="banner">Test build. Please don't upload real client content yet.</div>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/setup" element={<Guard><SetupPage /></Guard>} />
        <Route path="/agency/*" element={<Guard><AgencyApp /></Guard>} />
        <Route path="/creator/*" element={<Guard><CreatorApp /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  </ToastProvider></AuthProvider>
}
