import { useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useAuth, useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast, copyText, Modal } from '../lib/ui'
import { fmtDate } from '../lib/types'
import { useOnline, seenLabel } from '../lib/presence'

interface Member { user_id: string; role: string; title: string | null; last_seen_at: string | null; last_page: string | null; profiles: { full_name: string | null; email: string | null } | null }
interface Inv { id: string; email: string | null; role: string | null; title: string | null; token: string; status: string; expires_at: string; kind: string }

export const TITLES = ['Manager', 'Co-manager', 'Content director', 'Editor', 'Chatter', 'Assistant']
const ACCESS: Record<string, { label: string; help: string }> = {
  owner: { label: 'Owner', help: 'Everything, including billing and deleting the workspace' },
  admin: { label: 'Full access', help: 'Shots, reviews, creators, team and settings' },
  reviewer: { label: 'Content only', help: 'Shots, sets and reviews. No team or settings' },
}
const inviteUrl = (t: string) => `${location.origin}${location.pathname}#/invite/${t}`
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'

function TitlePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const custom = value !== '' && !TITLES.includes(value)
  const [other, setOther] = useState(custom)
  return <div className="stack" style={{ gap: 8 }}>
    <div className="chips">{TITLES.map(t => <button type="button" key={t} className="chip" aria-pressed={!other && value === t} onClick={() => { setOther(false); onChange(t) }}>{t}</button>)}
      <button type="button" className="chip" aria-pressed={other} onClick={() => { setOther(true); if (TITLES.includes(value)) onChange('') }}>Other…</button></div>
    {other && <input className="input" autoFocus maxLength={40} placeholder="e.g. Social media lead" value={value} onChange={e => onChange(e.target.value)} aria-label="Job title" />}
  </div>
}

export default function Team() {
  const { ws, isAdmin } = useWs(); const { profile } = useAuth(); const toast = useToast(); const online = useOnline()
  const [inviting, setInviting] = useState(false); const [link, setLink] = useState<string | null>(null)
  const [email, setEmail] = useState(''); const [title, setTitle] = useState('Manager'); const [role, setRole] = useState('reviewer')
  const [editing, setEditing] = useState<Member | null>(null); const [eTitle, setETitle] = useState(''); const [eRole, setERole] = useState('reviewer')
  const [removing, setRemoving] = useState<Member | null>(null); const [err, setErr] = useState<string | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const [m, i] = await Promise.all([
      sb.from('workspace_members').select('user_id,role,title,last_seen_at,last_page,profiles(full_name,email)').eq('workspace_id', ws!.id),
      sb.from('invitations').select('id,email,role,title,token,status,expires_at,kind').eq('workspace_id', ws!.id).eq('kind', 'staff').eq('status', 'pending').order('created_at', { ascending: false })])
    if (m.error) throw m.error
    return { members: (m.data || []) as unknown as Member[], invites: ((i.data || []) as Inv[]).filter(x => new Date(x.expires_at) > new Date()) }
  }, [ws?.id])

  async function invite() {
    setErr(null)
    const { data: row, error } = await sb.from('invitations').insert({ workspace_id: ws!.id, email: email.trim() || null, kind: 'staff', role, title: title.trim() || null, invited_by: profile!.id }).select().single()
    if (error) return setErr(errMsg(error))
    setLink(inviteUrl((row as Inv).token)); setEmail(''); reload()
  }
  async function save() {
    const { error } = await sb.rpc('team_update', { ws: ws!.id, uid: editing!.user_id, new_role: eRole, new_title: eTitle })
    if (error) return toast(errMsg(error))
    toast('Saved'); setEditing(null); reload()
  }
  async function remove(m: Member) {
    const { error } = await sb.from('workspace_members').delete().eq('workspace_id', ws!.id).eq('user_id', m.user_id)
    setRemoving(null); if (error) toast(errMsg(error)); else { toast('Removed from the team'); reload() }
  }

  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  const rank = (m: Member) => (online[m.user_id] ? 0 : 1) * 10 + (m.role === 'owner' ? 0 : m.role === 'admin' ? 1 : 2)
  const members = [...data.members].sort((a, b) => rank(a) - rank(b) || (b.last_seen_at || '').localeCompare(a.last_seen_at || ''))
  const liveCount = members.filter(m => online[m.user_id] && m.user_id !== profile?.id).length

  return <>
    <div className="page-title"><div><h1>Team</h1><p className="muted">{liveCount ? <><span className="live-dot" /> {liveCount} online now</> : 'Nobody else is online right now'} · {members.length} {members.length === 1 ? 'person' : 'people'}</p></div>
      {isAdmin && <button className="btn primary" onClick={() => { setInviting(true); setLink(null); setErr(null) }}>Invite teammate</button>}</div>

    <div className="team-grid">{members.map(m => { const me0 = m.user_id === profile?.id, live = online[m.user_id] || (me0 ? { page: 'Team' } as { page: string } : undefined), name = m.profiles?.full_name || m.profiles?.email || 'Teammate', me = m.user_id === profile?.id
      return <div key={m.user_id} className={'card team-card' + (live ? ' live' : '')}>
        <div className="avatar" aria-hidden="true">{initials(name)}{live && <i />}</div>
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="ellip">{name}{me && <span className="muted"> (you)</span>}</b>
          <span className="team-title">{m.title || (m.role === 'owner' ? 'Owner' : 'No title yet')}</span>
          <span className={'team-seen' + (live ? ' on' : '')}>{live ? `Online now · ${live.page}` : seenLabel(m.last_seen_at) + (m.last_seen_at && m.last_page ? ` · ${m.last_page}` : '')}</span>
        </div>
        <div className="team-side">
          <span className="pill todo" title={ACCESS[m.role]?.help}>{ACCESS[m.role]?.label || m.role}</span>
          {isAdmin && !me && <div className="row" style={{ gap: 4 }}>
            <button className="btn sm ghost" onClick={() => { setEditing(m); setETitle(m.title || ''); setERole(m.role) }}>Edit</button>
            {m.role !== 'owner' && <button className="btn sm ghost" onClick={() => setRemoving(m)}>Remove</button>}</div>}
          {me && <button className="btn sm ghost" onClick={() => { setEditing(m); setETitle(m.title || ''); setERole(m.role) }} hidden={!isAdmin}>Edit my title</button>}
        </div>
      </div> })}</div>

    {data.invites.length > 0 && <section className="stack"><h2 style={{ fontSize: 18 }}>Invited, not joined yet</h2>
      <div className="list">{data.invites.map(i => <div key={i.id} className="card tight between wrap">
        <div><b>{i.email || 'Invite link'}</b> <span className="muted">· {i.title || 'Teammate'} · {ACCESS[i.role || 'reviewer']?.label}</span><br /><span className="muted mono">expires {fmtDate(i.expires_at, false)}</span></div>
        <div className="row"><button className="btn sm ghost" onClick={async () => toast(await copyText(inviteUrl(i.token)) ? 'Link copied' : inviteUrl(i.token))}>Copy link</button>
          {isAdmin && <button className="btn sm danger" onClick={async () => { await sb.from('invitations').update({ status: 'revoked' }).eq('id', i.id); reload() }}>Cancel</button>}</div></div>)}</div></section>}

    <p className="muted" style={{ fontSize: 13 }}>Everyone on the team logs in with their own email and sees the same shots, reviews and creators. <b>Full access</b> can also manage the team and settings; <b>Content only</b> can't.</p>

    {inviting && <Modal center title="Invite a teammate" onClose={() => setInviting(false)}>
      {link ? <div className="stack">
        <p>Send them this link. It works once, for 14 days. They make their own login and land straight in {ws!.name}.</p>
        <div className="card tight mono" style={{ wordBreak: 'break-all' }}>{link}</div>
        <button className="btn primary block" onClick={async () => toast(await copyText(link) ? 'Link copied' : 'Select the link and copy it')}>Copy link</button>
        <button className="btn ghost block" onClick={() => setLink(null)}>Invite someone else</button>
      </div> : <div className="stack">
        <div className="field"><span>Their job</span><TitlePicker value={title} onChange={setTitle} /></div>
        <label className="field"><span>What they can do</span><select className="select" value={role} onChange={e => setRole(e.target.value)}>
          <option value="reviewer">Content only: shots, sets and reviews</option><option value="admin">Full access: also team, creators and settings</option></select></label>
        <label className="field"><span>Email (optional). If you add one, we email them the invite too</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <ErrorBox msg={err} />
        <button className="btn primary block" onClick={invite}>Create invite link</button>
      </div>}
    </Modal>}

    {editing && <Modal center title={editing.profiles?.full_name || 'Teammate'} onClose={() => setEditing(null)}>
      <div className="stack">
        <div className="field"><span>Job title</span><TitlePicker value={eTitle} onChange={setETitle} /></div>
        {editing.role !== 'owner' && <label className="field"><span>What they can do</span><select className="select" value={eRole} onChange={e => setERole(e.target.value)}>
          <option value="reviewer">Content only</option><option value="admin">Full access</option></select></label>}
        <button className="btn primary block" onClick={save}>Save</button>
      </div>
    </Modal>}
    {removing && <Modal center title={`Remove ${removing.profiles?.full_name || 'this teammate'}?`} onClose={() => setRemoving(null)}>
      <p className="muted">They lose access to {ws!.name} straight away. Anything they reviewed or wrote stays.</p>
      <div className="row"><button className="btn ghost grow" onClick={() => setRemoving(null)}>Keep</button><button className="btn danger grow" onClick={() => remove(removing)}>Remove</button></div>
    </Modal>}
  </>
}
