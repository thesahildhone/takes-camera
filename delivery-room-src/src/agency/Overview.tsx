import { Link } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, StatusPill } from '../lib/ui'
import { dueLabel, fmtDate, type Assignment } from '../lib/types'

export default function Overview() {
  const { ws } = useWs()
  const { data, loading, error } = useAsync(async () => {
    const id = ws!.id
    const [asg, creators, tpls, sch] = await Promise.all([
      sb.from('assignments').select('id,title,status,due_at,creator_id,category_name,submitted_at,created_at').eq('workspace_id', id).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(400),
      sb.from('creator_memberships').select('creator_id, profiles(full_name)').eq('workspace_id', id).eq('status', 'active'),
      sb.from('templates').select('id', { count: 'exact', head: true }).eq('workspace_id', id).is('archived_at', null),
      sb.from('schedules').select('id,next_run_at,template_id,templates(title)').eq('workspace_id', id).eq('status', 'active').order('next_run_at').limit(5),
    ])
    if (asg.error) throw asg.error
    const names: Record<string, string> = {}
    ;((creators.data || []) as unknown as { creator_id: string; profiles: { full_name: string } | null }[]).forEach(c => names[c.creator_id] = c.profiles?.full_name || 'Creator')
    return { asg: (asg.data || []) as Assignment[], names, creators: creators.data?.length || 0, templates: tpls.count || 0, sch: (sch.data || []) as unknown as { id: string; next_run_at: string; templates: { title: string } | null }[] }
  }, [ws?.id])
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  const open = data.asg.filter(a => ['not_started', 'in_progress', 'revision_requested'].includes(a.status))
  const review = data.asg.filter(a => a.status === 'submitted')
  const overdue = open.filter(a => a.due_at && new Date(a.due_at) < new Date())
  const done = data.asg.filter(a => a.status === 'approved')
  const firstRun = data.templates === 0 || data.creators === 0
  return <>
    <div className="page-title"><div><p className="eyebrow">{ws!.name}</p><h1>Overview</h1></div>
      <Link className="btn primary" to="/agency/templates">New template</Link></div>
    {firstRun && <div className="card stack">
      <h3>Get your first content in</h3>
      <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        <li style={{ color: data.templates ? 'var(--ok)' : undefined }}>Build a template: your script, page by page. <Link className="link" to="/agency/templates">Templates</Link></li>
        <li style={{ color: data.creators ? 'var(--ok)' : undefined }}>Invite your creators with a link. <Link className="link" to="/agency/creators">Creators</Link></li>
        <li>Send the template to them, once or on repeat.</li>
      </ol>
    </div>}
    <div className="stats">
      <Link to="/agency/creators" className="stat"><b>{data.creators}</b><span>Creators</span></Link>
      <Link to="/agency/assignments" className="stat"><b>{open.length}</b><span>Active assignments</span></Link>
      <Link to="/agency/review" className="stat"><b>{review.length}</b><span>Waiting for review</span></Link>
      <div className="stat"><b>{done.length}</b><span>Approved</span></div>
    </div>
    <section className="stack">
      <div className="between"><h2 style={{ fontSize: 19 }}>Review queue</h2><Link className="link" to="/agency/review">See all</Link></div>
      {review.length === 0 ? <p className="muted">Nothing waiting. Submissions show up here as creators finish.</p> :
        <div className="list">{review.slice(0, 6).map(a => <Link key={a.id} to={'/agency/review/' + a.id} className="card click tight">
          <div className="between"><b>{a.title}</b><StatusPill s={a.status} /></div>
          <span className="muted" style={{ fontSize: 13 }}>{data.names[a.creator_id] || 'Creator'} · submitted {fmtDate(a.submitted_at)}</span></Link>)}</div>}
    </section>
    {overdue.length > 0 && <section className="stack">
      <h2 style={{ fontSize: 19 }}>Overdue</h2>
      <div className="list">{overdue.slice(0, 6).map(a => <Link key={a.id} to={'/agency/review/' + a.id} className="card click tight">
        <div className="between"><b>{a.title}</b><span className="pill bad">{dueLabel(a.due_at)}</span></div>
        <span className="muted" style={{ fontSize: 13 }}>{data.names[a.creator_id] || 'Creator'} · <StatusPill s={a.status} /></span></Link>)}</div>
    </section>}
    {data.sch.length > 0 && <section className="stack">
      <div className="between"><h2 style={{ fontSize: 19 }}>Next scheduled releases</h2><Link className="link" to="/agency/schedules">Schedules</Link></div>
      <div className="list">{data.sch.map(s => <div key={s.id} className="card tight between"><b>{s.templates?.title}</b><span className="mono muted">{fmtDate(s.next_run_at)}</span></div>)}</div>
    </section>}
  </>
}
