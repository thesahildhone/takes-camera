import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { sb } from './lib/supabase'

// Email links (password reset, email confirmation) come back as #access_token=...&type=...
// The app uses hash routes, so turn those tokens into a session first, then go to the right page.
async function takeEmailLink() {
  const h = location.hash.slice(1)
  if (!h.includes('access_token=') && !h.includes('error_description=')) return
  const p = new URLSearchParams(h)
  if (p.get('error_description')) { history.replaceState(null, '', location.pathname + '#/auth?linkerr=' + encodeURIComponent(p.get('error_description')!)); return }
  const access_token = p.get('access_token'), refresh_token = p.get('refresh_token')
  if (access_token && refresh_token) await sb.auth.setSession({ access_token, refresh_token }).catch(() => {})
  // after confirming a new account, return to where they signed up from (e.g. an invite link)
  let after = '/'
  try { const n = localStorage.getItem('sr.afterConfirm'); if (n && n.startsWith('/')) after = n; localStorage.removeItem('sr.afterConfirm') } catch { /* storage blocked */ }
  history.replaceState(null, '', location.pathname + (p.get('type') === 'recovery' ? '#/reset' : '#' + after))
}
takeEmailLink().finally(() => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>))
