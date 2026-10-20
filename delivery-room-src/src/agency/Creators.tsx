import { useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast, copyText, Modal } from '../lib/ui'
import { fmtDate } from '../lib/types'

interface Inv { id: string; email: string | null; kind: string; role: string | null; token: string; status: string; expires_at: string; created_at: string }
const inviteUrl = (t: string) => `${location.origin}${location.pathname}#/invite/${t}`

export default function Creators() {
  const { ws, isAdmin } = useWs(); const toast = useToast()
  const [creating, setCreating] = useState<null | 'creator' | 'staff'>(null)
  const [email, setEmail] = useState(''); const [role, setRole] = useState('reviewer')
  const [newLink, setNewLink] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const [c, i, s, a] = await Promise.all([
      sb.from('creator_memberships').select('creator_id,status,joined_at,profiles(full_name,email)').eq('workspace_id', ws!.id).order('joined_at', { ascending: false }),
      sb.from('invitations').select('*').eq('workspace_id', ws!.id).order('created_at', { ascending: false }).limit(100),
      sb.from('workspace_members').select('user_id,role,profiles(full_name,email)').eq('workspace_id', ws!.id),
      sb.from('assignments').select('creator_id,status').eq('workspace_id', ws!.id),
    ])
    if (c.error) throw c.error
    const counts: Record<string, { open: number; done: number }> = {}
    ;(a.data || []).forEach((r: { creator_id: string; status: string }) => { const k = counts[r.creator_id] ||= { open: 0, done: 0 }; if (['not_started', 'in_progress', 'revision_requested'].includes(r.status)) k.open++; if (r.status === 'approved') k.done++ })
    return { creators: (c.data || []) as unknown as { creator_id: string; status: string; joined_at: string; profiles: { full_name: string; email: string } | null }[], invites: (i.data || []) as Inv[], staff: (s.data || []) as unknown as { user_id: string; role: string; profiles: { full_name: string; email: string } | null }[], counts }
  }, [ws?.id])

  async function createInvite() {
    setErr(null)
    const { data: row, error } = await sb.from('invitations').insert({ workspace_id: ws!.id, email: email.trim() || null, kind: creating, role: creating === 'staff' ? role : null, invited_by: (await sb.auth.getUser()).data.user!.id }).select().single()
    if (error) { setErr(errMsg(error)); return }
    setNewLink(inviteUrl((row as Inv).token)); setEmail(''); reload()
  }
  async function revoke(id: string) { await sb.from('invitations').update({ status: 'revoked' }).eq('id', id); reload() }
  async function resend(inv: Inv) {
    await sb.from('invitations').update({ status: 'revoked' }).eq('id', inv.id)
    const { data: row } = await sb.from('invitations').insert({ workspace_id: ws!.id, email: inv.email, kind: inv.kind, role: inv.role, invited_by: (await sb.auth.getUser()).data.user!.id }).select().single()
    if (row) { setNewLink(inviteUrl((row as Inv).token)); setCreating(inv.kind as 'creator'); reload() }
  }
  async function remove(id: string) {
    const { error } = await sb.from('creator_memberships').update({ status: 'removed' }).eq('workspace_id', ws!.id).eq('creator_id', id)
    if (error) toast(errMsg(error)); else { toast('Creator removed from this workspace'); reload() }
    setConfirmRemove(null)
  }
  async function restore(id: string) { await sb.from('creator_memberships').update({ status: 'active' }).eq('workspace_id', ws!.id).eq('creator_id', id); reload() }

  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  const active = data.creators.filter(c => c.status === 'active'), inactive = data.creators.filter(c => c.status !== 'active')
  const pending = data.invites.filter(i => i.status === 'pending' && new Date(i.expires_at) > new Date())
  return <>
    <div className="page-title"><h1>Creators</h1>
      {isAdmin && <div className="row wrap"><button className="btn ghost" onClick={() => { setCreating('staff'); setNewLink(null) }}>Invite team member</button><button className="btn primary" onClick={() => { setCreating('creator'); setNewLink(null) }}>Invite creator</button></div>}</div>
    {active.length === 0 ? <div className="empty"><h3>No creators yet</h3><p>Create an invite link and send it to a creator on WhatsApp, Telegram or email. They tap it, make an account and appear here.</p>{isAdmin && <button className="btn primary" onClick={() => setCreating('creator')}>Invite creator</button>}</div> :
      <div className="card scroll-x"><table className="table"><thead><tr><th>Creator</th><th>Joined</th><th>Open</th><th>Approved</th><th /></tr></thead><tbody>
        {active.map(c => <tr key={c.creator_id}><td><b>{c.profiles?.full_name || 'Creator'}</b><br /><span className="muted" style={{ fontSize: 13 }}>{c.profiles?.email}</span></td>
          <td className="mono">{fmtDate(c.joined_at, false)}</td><td className="mono">{data.counts[c.creator_id]?.open || 0}</td><td className="mono">{data.counts[c.creator_id]?.done || 0}</td>
          <td style={{ textAlign: 'right' }}>{isAdmin && <button className="btn sm ghost" onClick={() => setConfirmRemove({ id: c.creator_id, name: c.profiles?.full_name || 'this creator' })}>Remove</button>}</td></tr>)}
      </tbody></table></div>}
    {pending.length > 0 && <section className="stack"><h2 style={{ fontSize: 18 }}>Pending invites</h2>
      <div className="list">{pending.map(i => <div key={i.id} className="card tight between wrap">
        <div><b>{i.email || 'Invite link'}</b> <span className="pill todo">{i.kind === 'staff' ? 'Team · ' + i.role : 'Creator'}</span><br /><span className="muted mono">expires {fmtDate(i.expires_at, false)}</span></div>
        <div className="row"><button className="btn sm ghost" onClick={async () => toast(await copyText(inviteUrl(i.token)) ? 'Link copied' : inviteUrl(i.token))}>Copy link</button>
          {isAdmin && <button className="btn sm ghost" onClick={() => resend(i)}>New link</button>}{isAdmin && <button className="btn sm danger" onClick={() => revoke(i.id)}>Cancel</button>}</div></div>)}</div></section>}
    <section className="stack"><h2 style={{ fontSize: 18 }}>Team</h2>
      <div className="list">{data.staff.map(s => <div key={s.user_id} className="card tight between"><span><b>{s.profiles?.full_name || s.profiles?.email}</b> <span className="muted">{s.profiles?.email}</span></span><span className="pill todo">{s.role}</span></div>)}</div></section>
    {inactive.length > 0 && <section className="stack"><h2 style={{ fontSize: 18 }}>Removed or left</h2>
      <div className="list">{inactive.map(c => <div key={c.creator_id} className="card tight between"><span>{c.profiles?.full_name} <span className="muted">· {c.status}</span></span>{isAdmin && c.status === 'removed' && <button className="btn sm ghost" onClick={() => restore(c.creator_id)}>Restore</button>}</div>)}</div></section>}

    {creating && <Modal center title={creating === 'staff' ? 'Invite a team member' : 'Invite a creator'} onClose={() => { setCreating(null); setNewLink(null) }}>
      {newLink ? <div className="stack">
        <p>Send this link. It works for 14 days and only once.</p>
        <div className="card tight mono" style={{ wordBreak: 'break-all' }}>{newLink}</div>
        <button className="btn primary block" onClick={async () => toast(await copyText(newLink) ? 'Link copied' : 'Select the link and copy it')}>Copy link</button>
        <button className="btn ghost block" onClick={() => setNewLink(null)}>Create another</button>
      </div> : <div className="stack">
        <label className="field"><span>Email (optional, just so you remember who it's for)</span><input id="invemail" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        {creating === 'staff' && <label className="field"><span>Role</span><select id="invrole" className="select" value={role} onChange={e => setRole(e.target.value)}><option value="reviewer">Reviewer: builds templates, assigns, reviews</option><option value="admin">Admin: also manages creators, team and settings</option></select></label>}
        <ErrorBox msg={err} />
        <button className="btn primary block" onClick={createInvite}>Create invite link</button>
      </div>}
    </Modal>}
    {confirmRemove && <Modal center title={`Remove ${confirmRemove.name}?`} onClose={() => setConfirmRemove(null)}>
      <p className="muted">They stop seeing this workspace's assignments and won't get new ones. Their past submissions stay here. Other agencies they work with aren't affected.</p>
      <div className="row"><button className="btn ghost grow" onClick={() => setConfirmRemove(null)}>Keep</button><button className="btn danger grow" onClick={() => remove(confirmRemove.id)}>Remove</button></div>
    </Modal>}
  </>
}
