import { useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useToast, Modal } from '../lib/ui'
import { CTop } from './CreatorApp'
import PasswordCard from '../components/PasswordCard'

export default function Account() {
  const { profile, creatorOf, refresh, signOut } = useAuth(); const toast = useToast()
  const [name, setName] = useState(profile?.full_name || ''); const [leave, setLeave] = useState<{ id: string; name: string } | null>(null)
  const [del, setDel] = useState(false); const [confirm, setConfirm] = useState(''); const [delErr, setDelErr] = useState<string | null>(null)
  async function save() { const { error } = await sb.from('profiles').update({ full_name: name.trim() }).eq('id', profile!.id); if (error) toast(errMsg(error)); else { toast('Saved'); refresh() } }
  async function doDelete() {
    setDelErr(null)
    const { data, error: fe } = await sb.functions.invoke('account-delete', { body: { confirm: confirm.trim() } })
    const error = fe ? new Error(await fe.context?.json?.().then((j: { error?: string }) => j.error).catch(() => null) || fe.message) : (data?.error ? new Error(data.error) : null)
    if (error) return setDelErr(errMsg(error))
    await sb.auth.signOut().catch(() => {}); location.hash = '#/'; location.reload()
  }
  async function doLeave() { const { error } = await sb.rpc('leave_workspace', { ws: leave!.id }); if (error) toast(errMsg(error)); else { toast('You left ' + leave!.name); refresh() } setLeave(null) }
  return <div className="phone soc"><CTop />
    <h1 style={{ fontSize: 26, marginBottom: 14 }}>Account</h1>
    <div className="stack">
      <div className="card stack"><label className="field"><span>Your name (agencies see this)</span><input id="cname" className="input" value={name} onChange={e => setName(e.target.value)} /></label>
        <p className="muted" style={{ fontSize: 13 }}>{profile?.email}</p>
        <button className="btn ghost" disabled={!name.trim() || name === profile?.full_name} onClick={save}>Save</button></div>
      <div className="card stack"><h3>Your agencies</h3>
        {creatorOf.length === 0 ? <p className="muted">None yet. Open an invite link from your agency to join.</p> :
          creatorOf.map(w => <div key={w.id} className="between"><b>{w.name}</b><button className="btn sm ghost" onClick={() => setLeave({ id: w.id, name: w.name })}>Leave</button></div>)}
        <p className="muted" style={{ fontSize: 13 }}>Each agency only sees its own assignments and your work for them, never your other agencies.</p></div>
      <PasswordCard />
      <button className="btn ghost" onClick={signOut}>Sign out</button>
      <button className="link" style={{ justifySelf: 'center', color: 'var(--bad)', fontSize: 14 }} onClick={() => { setDel(true); setConfirm(''); setDelErr(null) }}>Delete my account</button>
    </div>
    {del && <Modal center title="Delete your account?" onClose={() => setDel(false)}>
      <p className="muted">This removes your login, your assignments and your submission history, and takes you out of every agency, straight away. It can't be undone. Every video and photo you sent is erased from our storage too. Agencies keep copies they already downloaded to their own devices.</p>
      <label className="field"><span>Type DELETE to confirm</span><input className="input" value={confirm} onChange={e => setConfirm(e.target.value)} autoCapitalize="characters" /></label>
      {delErr && <p role="alert" style={{ color: 'var(--bad)' }}>{delErr}</p>}
      <div className="row"><button className="btn ghost grow" onClick={() => setDel(false)}>Keep my account</button><button className="btn danger grow" disabled={confirm.trim() !== 'DELETE'} onClick={doDelete}>Delete</button></div></Modal>}
    {leave && <Modal center title={`Leave ${leave.name}?`} onClose={() => setLeave(null)}>
      <p className="muted">You'll stop seeing their assignments and won't get new ones. Work you already submitted stays with them.</p>
      <div className="row"><button className="btn ghost grow" onClick={() => setLeave(null)}>Stay</button><button className="btn danger grow" onClick={doLeave}>Leave</button></div></Modal>}
  </div>
}
