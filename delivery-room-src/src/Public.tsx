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
    <p className="muted">Agencies set up shots with a reference, a script and notes. Creators film them in the app, clip by clip, with built-in skin smoothing. Every video lands in one review queue, named and ready.</p>
    <div className="stack">
      <Link className="btn lg primary block" to="/auth?mode=signup&kind=business">I run an agency</Link>
      <Link className="btn lg ghost block" to="/auth?mode=signup&kind=creator">I'm a creator</Link>
      <p className="muted" style={{ textAlign: 'center' }}>Already have an account? <Link className="link" to="/auth">Sign in</Link></p>
    </div>
  </div></div>
}

export function AuthPage() {
  const [q] = useSearchParams(); const nav = useNavigate(); const { session, refresh } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(q.get('mode') === 'signup' ? 'signup' : 'signin')
  const [sent, setSent] = useState(false)
  const [kind, setKind] = useState<'business' | 'creator'>(q.get('kind') === 'business' ? 'business' : 'creator')
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(q.get('linkerr') ? 'That email link has expired or was already used. Ask for a new one.' : null)
  const next = q.get('next') || '/'
  useEffect(() => { if (session) nav(next, { replace: true }) }, [session, next, nav])
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname })
        if (error && !/rate|too many/i.test(error.message)) throw error
        if (error) throw new Error('Too many reset emails. Wait a few minutes and try again.')
        setSent(true); return
      }
      if (mode === 'signup') {
        if (!name.trim()) throw new Error('Add your name')
        const { data: su, error } = await sb.auth.signUp({ email: email.trim(), password: pw, options: { data: { full_name: name.trim(), kind } } })
        if (error) throw error
        // an email that already has an account comes back with no identities and no error
        if (su.user && !su.user.identities?.length) throw new Error('An account with this email already exists. Sign in instead, or use a different email.')
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
    <h1>{mode === 'forgot' ? 'Reset your password' : mode === 'signup' ? (kind === 'business' ? 'Set up your agency' : 'Create your creator account') : 'Sign in'}</h1>
    {mode === 'forgot' && sent && <p role="status">If there's an account for <b>{email}</b>, a reset link is on its way. Open it on this device. Check spam if it isn't there in a few minutes.</p>}
    {mode === 'signup' && <div className="seg" role="group" aria-label="Account type">
      <button type="button" aria-pressed={kind === 'business'} onClick={() => setKind('business')}>Agency</button>
      <button type="button" aria-pressed={kind === 'creator'} onClick={() => setKind('creator')}>Creator</button>
    </div>}
    {mode === 'signup' && <label className="field"><span>Your name</span><input id="name" className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>}
    <label className="field"><span>Email</span><input id="email" className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
    {mode !== 'forgot' && <label className="field"><span>Password</span><input id="password" className="input" type="password" required minLength={mode === 'signup' ? 8 : undefined} value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>}
    {mode === 'signin' && <button type="button" className="link" style={{ justifySelf: 'start', fontSize: 14 }} onClick={() => { setMode('forgot'); setErr(null); setSent(false) }}>Forgot your password?</button>}
    <ErrorBox msg={err} />
    {!(mode === 'forgot' && sent) && <button className="btn lg primary block" disabled={busy}>{busy ? 'One moment…' : mode === 'forgot' ? 'Email me a reset link' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>}
    <p className="muted" style={{ textAlign: 'center' }}>
      {mode === 'signup' || mode === 'forgot' ? <>{mode === 'forgot' ? 'Remembered it?' : 'Have an account?'} <button type="button" className="link" onClick={() => setMode('signin')}>Sign in</button></>
        : <>New here? <button type="button" className="link" onClick={() => setMode('signup')}>Create an account</button></>}
    </p>
  </form></div>
}

export function ResetPage() {
  const nav = useNavigate(); const { session, ready } = useAuth()
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null)
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    if (pw !== pw2) return setErr('The two passwords are different.')
    setBusy(true)
    const { error } = await sb.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    nav('/', { replace: true })
  }
  if (!ready) return <div className="public"><Loading /></div>
  if (!session) return <div className="public"><div className="box"><Brand /><h1>Link expired</h1><p className="muted">This reset link has expired or was already used.</p><button className="btn primary block" onClick={() => nav('/auth')}>Ask for a new link</button></div></div>
  return <div className="public"><form className="box" onSubmit={submit}>
    <Brand /><h1>Choose a new password</h1>
    <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={e => setPw(e.target.value)} /></label>
    <label className="field"><span>Type it again</span><input className="input" type="password" autoComplete="new-password" required value={pw2} onChange={e => setPw2(e.target.value)} /></label>
    <ErrorBox msg={err} />
    <button className="btn lg primary block" disabled={busy}>{busy ? 'Saving…' : 'Save and sign in'}</button>
  </form></div>
}

export function SetupPage() {
  const nav = useNavigate(); const { refresh, setWsId, staff, profile } = useAuth()
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (staff.length) nav('/agency', { replace: true }); else if (profile?.kind === 'creator') nav('/creator', { replace: true }) }, [staff, profile, nav])
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
