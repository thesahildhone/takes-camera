import { useEffect, useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/ui'

type Factor = { id: string; friendly_name?: string; factor_type: string; status: string; created_at: string }
const codeOk = (c: string) => /^\d{6}$/.test(c.trim())

async function verifiedFactors(): Promise<Factor[]> {
  const { data } = await sb.auth.mfa.listFactors()
  return ((data?.totp || []) as Factor[]).filter(f => f.status === 'verified')
}

/** Scan a QR code with an authenticator app, then type the 6-digit code to switch two-step login on. */
export function EnrollTotp({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [f, setF] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => {
    let id: string | null = null
    ;(async () => {
      // clear half-finished attempts so a fresh QR code can be made
      const { data: l } = await sb.auth.mfa.listFactors()
      for (const x of ((l?.all || []) as Factor[]).filter(x => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id })
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + new Date().toISOString().slice(0, 10) })
      if (error || !data || data.type !== 'totp') return setErr(errMsg(error) || 'Could not start two-step setup')
      id = data.id; setF({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    })()
    return () => { void id }
  }, [])
  async function verify() {
    if (!f) return
    setBusy(true); setErr(null)
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: code.trim() })
    setBusy(false)
    if (error) return setErr('That code did not match. Check the time on your phone and try the newest code.')
    onDone()
  }
  async function cancel() { if (f) await sb.auth.mfa.unenroll({ factorId: f.id }); onCancel?.() }
  return <div className="stack">
    <ol className="muted" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
      <li>Open an authenticator app (Google Authenticator, 1Password, Authy or the iPhone Passwords app).</li>
      <li>Scan this code, or type the key below.</li>
      <li>Enter the 6-digit code it shows.</li></ol>
    {f ? <><img src={f.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ background: '#fff', borderRadius: 12, padding: 8 }} />
      <p className="mono muted" style={{ wordBreak: 'break-all', fontSize: 13 }}>Key: {f.secret}</p></> : !err && <p className="muted">Making your code…</p>}
    <label className="field"><span>6-digit code</span><input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
    {err && <div className="err" role="alert">{err}</div>}
    <div className="row wrap"><button className="btn primary" disabled={!f || busy || !codeOk(code)} onClick={verify}>{busy ? 'Checking…' : 'Turn on two-step login'}</button>
      {onCancel && <button className="btn ghost" onClick={cancel}>Cancel</button>}</div>
  </div>
}

/** Card for a staff member's own account. */
export function TwoStepCard() {
  const toast = useToast(); const { refresh } = useAuth()
  const [factors, setFactors] = useState<Factor[] | null>(null); const [adding, setAdding] = useState(false)
  const load = () => verifiedFactors().then(setFactors)
  useEffect(() => { load() }, [])
  async function remove(id: string) {
    const { error } = await sb.auth.mfa.unenroll({ factorId: id })
    if (error) return toast(/aal2/i.test(errMsg(error)) ? 'Sign out and back in with your code first, then remove it.' : errMsg(error))
    toast('Two-step login removed'); await sb.auth.refreshSession(); load(); refresh()
  }
  return <section className="card stack" id="two-step"><h3>Two-step login</h3>
    <p className="muted">After your password, you'll also type a code from an app on your phone. Stops someone with your password from opening your agency's content.</p>
    {factors === null ? <p className="muted">Checking…</p> : factors.length ? <>
      <p><span className="pill ok">On</span> <span className="muted">since {new Date(factors[0].created_at).toLocaleDateString()}</span></p>
      <div><button className="btn ghost" onClick={() => remove(factors[0].id)}>Remove two-step login</button></div></>
      : adding ? <EnrollTotp onDone={() => { setAdding(false); toast('Two-step login is on'); load(); refresh() }} onCancel={() => setAdding(false)} />
      : <div><button className="btn primary" onClick={() => setAdding(true)}>Set up two-step login</button></div>}
  </section>
}

/** Shown instead of the app until the second step is done. */
export function MfaGate() {
  const { mfa, refresh, signOut, session } = useAuth()
  const [code, setCode] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  async function verify() {
    setBusy(true); setErr(null)
    const f = (await verifiedFactors())[0]
    if (!f) { setBusy(false); return setErr('No authenticator found on this account.') }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: code.trim() })
    setBusy(false)
    if (error) return setErr('That code did not match. Try the newest code in your app.')
    await refresh()
  }
  return <div className="public"><div className="card stack" style={{ maxWidth: 420, margin: '8vh auto' }}>
    {mfa === 'challenge' ? <>
      <h2>Enter your code</h2>
      <p className="muted">Open your authenticator app and type the 6-digit code for {session?.user.email}.</p>
      <label className="field"><span>6-digit code</span><input className="input" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && codeOk(code)) verify() }} /></label>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn lg primary block" disabled={busy || !codeOk(code)} onClick={verify}>{busy ? 'Checking…' : 'Continue'}</button>
      <p className="muted" style={{ fontSize: 13 }}>Lost your phone? Ask your agency owner to contact support to reset it.</p>
    </> : <>
      <h2>Set up two-step login</h2>
      <p className="muted">Your agency requires it for everyone on the team. It takes about a minute.</p>
      <EnrollTotp onDone={() => refresh()} />
    </>}
    <button className="btn ghost" onClick={signOut}>Sign out</button>
  </div></div>
}
