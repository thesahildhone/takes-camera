import { useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useToast } from '../lib/ui'

export default function PasswordCard() {
  const toast = useToast(); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true); const { error } = await sb.auth.updateUser({ password: pw }); setBusy(false)
    if (error) toast(errMsg(error)); else { setPw(''); toast('Password changed') }
  }
  return <div className="card stack"><h3>Password</h3>
    <label className="field"><span>New password (at least 8 characters)</span><input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
    <button className="btn ghost" disabled={busy || pw.length < 8} onClick={save}>{busy ? 'Saving…' : 'Change password'}</button></div>
}
