import { useState } from 'react'
import { Link } from 'react-router-dom'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast } from '../lib/ui'
import { fmtDate } from '../lib/types'
import { readyProblem, type Project } from '../lib/social'

type Row = { creator_id: string; status: string; due_at: string | null }
const OPEN = ['not_started', 'in_progress', 'revision_requested']
const ago = (s: string) => { const h = (Date.now() - new Date(s).getTime()) / 36e5; return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago` }

export default function Overview() {
  const { ws } = useWs(); const toast = useToast(); const [nudged, setNudged] = useState<Record<string, boolean>>({})
  const { data, loading, error } = useAsync(async () => {
    const id = ws!.id
    const [cr, sa, sp, ss, oa, sec, sch] = await Promise.all([
      sb.from('creator_memberships').select('creator_id, profiles(full_name,email)').eq('workspace_id', id).eq('status', 'active'),
      sb.from('social_assignments').select('creator_id,project_id,status,due_at').eq('workspace_id', id).neq('status', 'cancelled').limit(5000),
      sb.from('social_projects').select('*').eq('workspace_id', id).neq('publication_status', 'archived').limit(2000),
      sb.from('social_submissions').select('id,creator_id,project_id,version,status,created_at,reviewed_at').eq('workspace_id', id).order('created_at', { ascending: false }).limit(1000),
      sb.from('assignments').select('id,title,status,due_at,creator_id,submitted_at,reviewed_at,release_at').eq('workspace_id', id).neq('status', 'cancelled').limit(2000),
      sb.from('social_sections').select('id', { count: 'exact', head: true }).eq('workspace_id', id),
      sb.from('schedules').select('id,next_run_at,templates(title)').eq('workspace_id', id).eq('status', 'active').order('next_run_at').limit(4),
    ])
    if (cr.error) throw cr.error
    const projects = (sp.data || []) as Project[]
    const live = new Set(projects.filter(p => p.publication_status === 'published').map(p => p.id))
    return {
      creators: ((cr.data || []) as unknown as { creator_id: string; profiles: { full_name: string; email: string } | null }[]).map(c => ({ id: c.creator_id, name: c.profiles?.full_name || c.profiles?.email || 'Creator' })),
      soc: ((sa.data || []) as (Row & { project_id: string })[]).filter(a => live.has(a.project_id)),
      projects, subs: (ss.data || []) as { id: string; creator_id: string; project_id: string; version: number; status: string; created_at: string; reviewed_at: string | null }[],
      of: (oa.data || []) as (Row & { id: string; title: string; submitted_at: string | null; reviewed_at: string | null; release_at: string })[],
      sections: sec.count || 0, sch: (sch.data || []) as unknown as { id: string; next_run_at: string; templates: { title: string } | null }[],
    }
  }, [ws?.id])
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />

  const name = (id: string) => data.creators.find(c => c.id === id)?.name || 'Creator'
  const title = (id: string) => data.projects.find(p => p.id === id)?.title || 'Shot'
  const seen = new Set<string>()
  const waitingSoc = data.subs.filter(s => { const k = s.creator_id + s.project_id; if (seen.has(k)) return false; seen.add(k); return s.status === 'submitted' })
  const waitingOf = data.of.filter(a => a.status === 'submitted')
  const queue = [
    ...waitingSoc.map(s => ({ key: s.id, to: '/agency/social-review/' + s.id, what: title(s.project_id), who: name(s.creator_id), at: s.created_at, tag: 'Socials' })),
    ...waitingOf.map(a => ({ key: a.id, to: '/agency/review/' + a.id, what: a.title, who: name(a.creator_id), at: a.submitted_at || '', tag: 'OF' })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  const now = Date.now(), week = now - 7 * 864e5
  const all: Row[] = [...data.soc, ...data.of.filter(a => new Date(a.release_at).getTime() <= now)]
  const toFilm = all.filter(a => OPEN.includes(a.status)).length
  const approvedWeek = data.subs.filter(s => s.status === 'approved' && s.reviewed_at && new Date(s.reviewed_at).getTime() > week).length
    + data.of.filter(a => a.status === 'approved' && a.reviewed_at && new Date(a.reviewed_at).getTime() > week).length
  const drafts = data.projects.filter(p => p.publication_status === 'draft')
  const toCheck = drafts.filter(p => p.transcript_status === 'ready' && !p.transcript_approved).length
  const needFile = drafts.filter(p => p.import_status === 'awaiting_upload' || p.import_status === 'failed').length
  const readyDrafts = drafts.filter(p => !readyProblem(p)).length
  const lastSent: Record<string, string> = {}
  data.subs.forEach(s => { if (!lastSent[s.creator_id] || s.created_at > lastSent[s.creator_id]) lastSent[s.creator_id] = s.created_at })
  data.of.forEach(a => { if (a.submitted_at && (!lastSent[a.creator_id] || a.submitted_at > lastSent[a.creator_id])) lastSent[a.creator_id] = a.submitted_at })
  const per = data.creators.map(c => { const mine = all.filter(a => a.creator_id === c.id)
    return { ...c, film: mine.filter(a => a.status === 'not_started' || a.status === 'in_progress').length, redo: mine.filter(a => a.status === 'revision_requested').length,
      wait: mine.filter(a => a.status === 'submitted').length, ok: mine.filter(a => a.status === 'approved').length,
      late: mine.filter(a => OPEN.includes(a.status) && a.due_at && new Date(a.due_at).getTime() < now).length, last: lastSent[c.id] } })
    .sort((a, b) => b.late - a.late || (b.film + b.redo) - (a.film + a.redo))
  const steps = [
    { done: data.projects.length > 0, text: 'Add your first shots. Paste a list of reel links and each one becomes a shot.', to: '/agency/socials', cta: 'Sections & shots' },
    { done: data.creators.length > 0, text: 'Invite your creators with a link they open on their phone.', to: '/agency/creators', cta: 'Creators' },
    { done: data.soc.length > 0 || data.of.length > 0, text: 'Assign a section to them and publish. They get notified and can start filming.', to: '/agency/socials', cta: 'Assign' },
  ]
  async function nudge(id: string, who: string) {
    const { data: r, error } = await sb.rpc('nudge_creator', { ws: ws!.id, creator: id })
    if (error) return toast(errMsg(error))
    setNudged(n => ({ ...n, [id]: true })); toast(r === 'already' ? `${who} was already reminded in the last few hours` : r === 'nothing' ? `${who} has nothing to film` : `Reminder sent to ${who}`)
  }

  return <>
    <div className="page-title"><div><p className="eyebrow">{ws!.name}</p><h1>Overview</h1></div>
      <div className="row wrap"><Link className="btn ghost" to="/agency/creators">Invite creator</Link><Link className="btn primary" to="/agency/socials">Add shots</Link></div></div>
    {steps.some(s => !s.done) && <div className="card stack">
      <h3>Get your first videos in</h3>
      <ol className="steps">{steps.map((s, i) => <li key={i} className={s.done ? 'done' : ''}><span className="n">{s.done ? '✓' : i + 1}</span><span className="grow">{s.text}</span>{!s.done && <Link className="link" to={s.to}>{s.cta}</Link>}</li>)}</ol>
    </div>}
    <div className="stats">
      <Link to={waitingSoc.length || !waitingOf.length ? '/agency/social-review' : '/agency/review'} className={'stat' + (queue.length ? ' hot' : '')}><b>{queue.length}</b><span>Waiting for your review</span></Link>
      <div className="stat"><b>{toFilm}</b><span>Still to film</span></div>
      <div className="stat"><b>{approvedWeek}</b><span>Approved this week</span></div>
      <Link to="/agency/creators" className="stat"><b>{data.creators.length}</b><span>Creators</span></Link>
    </div>
    {(toCheck > 0 || needFile > 0 || readyDrafts > 0) && <div className="notice row wrap" style={{ gap: '4px 18px' }}>
      <b>Drafts:</b>
      {toCheck > 0 && <span>{toCheck} script{toCheck === 1 ? '' : 's'} to check</span>}
      {needFile > 0 && <span>{needFile} reference{needFile === 1 ? ' needs' : 's need'} a file</span>}
      {readyDrafts > 0 && <span>{readyDrafts} ready to publish</span>}
      <Link className="link" to="/agency/socials">Open shots</Link></div>}

    <section className="stack">
      <div className="between"><h2 className="h2">Review queue</h2>{queue.length > 6 && <Link className="link" to="/agency/social-review">See all {queue.length}</Link>}</div>
      {queue.length === 0 ? <p className="muted">Nothing waiting. Videos show up here the moment a creator sends them.</p> :
        <div className="list">{queue.slice(0, 6).map(q => <Link key={q.key} to={q.to} className="card click tight between">
          <span style={{ minWidth: 0 }}><b>{q.what}</b><br /><span className="muted" style={{ fontSize: 13 }}>{q.who} · sent {q.at ? ago(q.at) : ''}</span></span>
          <span className="pill todo">{q.tag}</span></Link>)}</div>}
    </section>

    <section className="stack">
      <h2 className="h2">Creators</h2>
      {per.length === 0 ? <p className="muted">No creators yet. <Link className="link" to="/agency/creators">Invite one</Link></p> :
        <div className="card scroll-x"><table className="table"><thead><tr><th>Creator</th><th>To film</th><th>Redo</th><th>With you</th><th>Approved</th><th>Last sent</th><th /></tr></thead><tbody>
          {per.map(c => <tr key={c.id}>
            <td><b>{c.name}</b>{c.late > 0 && <> <span className="pill bad">{c.late} overdue</span></>}</td>
            <td className="mono">{c.film}</td><td className="mono">{c.redo || '–'}</td><td className="mono">{c.wait || '–'}</td><td className="mono">{c.ok || '–'}</td>
            <td className="muted" style={{ whiteSpace: 'nowrap' }}>{c.last ? ago(c.last) : 'Never'}</td>
            <td style={{ textAlign: 'right' }}><button className="btn sm ghost" disabled={!(c.film + c.redo) || nudged[c.id]} onClick={() => nudge(c.id, c.name)}>{nudged[c.id] ? 'Reminded' : 'Remind'}</button></td></tr>)}
        </tbody></table></div>}
    </section>

    {data.sch.length > 0 && <section className="stack">
      <div className="between"><h2 className="h2">Next scheduled OF sets</h2><Link className="link" to="/agency/schedules">Schedules</Link></div>
      <div className="list">{data.sch.map(s => <div key={s.id} className="card tight between"><b>{s.templates?.title}</b><span className="mono muted">{fmtDate(s.next_run_at)}</span></div>)}</div>
    </section>}
  </>
}
