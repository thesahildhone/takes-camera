import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { sb, errMsg, APP_NAME } from './lib/supabase'
import { useAuth } from './lib/auth'
import { ErrorBox, Loading } from './lib/ui'

const Brand = () => <Link to="/" className="brand"><span className="mark" />{APP_NAME}</Link>

export function Welcome() {
  return <div className="public"><div className="box">
    <Brand />
    <h1>Briefs out, content in. No Drive links, no editing apps, no chasing.</h1>
    <p className="muted">Agencies send step-by-step scripts. Creators film each section with built-in skin smoothing and every file lands in the right place, named and ready.</p>
    <div className="stack">
      <Link className="btn lg primary block" to="/auth?mode=signup&kind=business">I run an agency</Link>
      <Link className="btn lg ghost block" to="/auth?mode=signup&kind=creator">I'm a creator</Link>
      <p className="muted" style={{ textAlign: 'center' }}>Already have an account? <Link className="link" to="/auth">Sign in</Link></p>
    </div>
  </div></div>
}

export function AuthPage() {
  const [q] = useSearchParams(); const nav = useNavigate(); const { session, refresh } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>(q.get('mode') === 'signup' ? 'signup' : 'signin')
  const [kind, setKind] = useState<'business' | 'creator'>(q.get('kind') === 'business' ? 'business' : 'creator')
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const next = q.get('next') || '/'
  useEffect(() => { if (session) nav(next, { replace: true }) }, [session, next, nav])
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      if (mode === 'signup') {
        if (!name.trim()) throw new Error('Add your name')
        const { error } = await sb.auth.signUp({ email: email.trim(), password: pw, options: { data: { full_name: name.trim(), kind } } })
        if (error) throw error
        const { error: e2 } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw })
        if (e2) throw e2
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw })
        if (error) throw error
      }
      await refresh()
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  return <div className="public"><form className="box" onSubmit={submit}>
    <Brand />
    <h1>{mode === 'signup' ? (kind === 'business' ? 'Set up your agency' : 'Create your creator account') : 'Sign in'}</h1>
    {mode === 'signup' && <div className="seg" role="group" aria-label="Account type">
      <button type="button" aria-pressed={kind === 'business'} onClick={() => setKind('business')}>Agency</button>
      <button type="button" aria-pressed={kind === 'creator'} onClick={() => setKind('creator')}>Creator</button>
    </div>}
    {mode === 'signup' && <label className="field"><span>Your name</span><input id="name" className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>}
    <label className="field"><span>Email</span><input id="email" className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
    <label className="field"><span>Password</span><input id="password" className="input" type="password" required minLength={6} value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>
    <ErrorBox msg={err} />
    <button className="btn lg primary block" disabled={busy}>{busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
    <p className="muted" style={{ textAlign: 'center' }}>
      {mode === 'signup' ? <>Have an account? <button type="button" className="link" onClick={() => setMode('signin')}>Sign in</button></>
        : <>New here? <button type="button" className="link" onClick={() => setMode('signup')}>Create an account</button></>}
    </p>
  </form></div>
}

export function SetupPage() {
  const nav = useNavigate(); const { refresh, setWsId, staff } = useAuth()
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (staff.length) nav('/agency', { replace: true }) }, [staff, nav])
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    const { data, error } = await sb.rpc('create_workspace', { ws_name: name })
    if (error) { setErr(errMsg(error)); setBusy(false); return }
    setWsId(data as string); await refresh(); nav('/agency', { replace: true })
  }
  return <div className="public"><form className="box" onSubmit={submit}>
    <Brand />
    <h1>Name your workspace</h1>
    <p className="muted">Usually your agency's name. Your creators will see it on their assignments.</p>
    <label className="field"><span>Workspace name</span><input id="wsname" className="input" required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Northlight Management" /></label>
    <ErrorBox msg={err} />
    <button className="btn lg primary block" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create workspace'}</button>
  </form></div>
}

export function InvitePage() {
  const { token } = useParams(); const nav = useNavigate(); const { session, refresh, setWsId } = useAuth()
  const [inv, setInv] = useState<{ workspace_name: string; kind: string; status: string; expired: boolean } | null | undefined>(undefined)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  useEffect(() => { sb.rpc('get_invitation', { tok: token }).then(({ data }) => setInv(((data as unknown[]) || [])[0] as typeof inv || null)) }, [token])
  async function accept() {
    setBusy(true); setErr(null)
    const { data, error } = await sb.rpc('accept_invitation', { tok: token })
    if (error) { setErr(errMsg(error)); setBusy(false); return }
    await refresh()
    if (inv?.kind === 'staff') { setWsId(data as string); nav('/agency', { replace: true }) } else nav('/creator', { replace: true })
  }
  async function decline() { await sb.rpc('decline_invitation', { tok: token }); nav('/', { replace: true }) }
  const here = '/invite/' + token
  return <div className="public"><div className="box">
    <Brand />
    {inv === undefined ? <Loading /> : !inv ? <><h1>This invite link isn't valid</h1><p className="muted">Ask the agency to send you a new one.</p></> : <>
      <p className="eyebrow">{inv.kind === 'staff' ? 'Team invite' : 'Creator invite'}</p>
      <h1>{inv.workspace_name} invited you to {inv.kind === 'staff' ? 'help run their workspace' : 'receive scripts and submit content'}</h1>
      {inv.status === 'revoked' ? <div className="err">This invite was cancelled by the agency.</div>
        : (inv.expired && inv.status === 'pending') ? <div className="err">This invite has expired. Ask the agency for a new link.</div>
        : inv.status === 'declined' ? <div className="err">This invite was declined. Ask the agency for a new link.</div>
        : session ? <div className="stack">
          <ErrorBox msg={err} />
          <button className="btn lg primary block" onClick={accept} disabled={busy}>{busy ? 'Joining…' : 'Accept invite'}</button>
          {inv.status === 'pending' && <button className="btn ghost block" onClick={decline}>Decline</button>}
          <p className="muted" style={{ fontSize: 13 }}>If you already work with other agencies, this just adds {inv.workspace_name} to the same account.</p>
        </div> : <div className="stack">
          <Link className="btn lg primary block" to={`/auth?mode=signup&kind=${inv.kind === 'staff' ? 'business' : 'creator'}&next=${encodeURIComponent(here)}`}>Create an account to join</Link>
          <Link className="btn ghost block" to={`/auth?next=${encodeURIComponent(here)}`}>I already have an account</Link>
        </div>}
    </>}
  </div></div>
}
