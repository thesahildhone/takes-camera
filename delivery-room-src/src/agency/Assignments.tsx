import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, StatusPill } from '../lib/ui'
import { dueLabel, fmtDate, slotsFor, type Assignment, type AStatus } from '../lib/types'

const FILTERS: { k: string; label: string; match: (s: AStatus) => boolean }[] = [
  { k: 'open', label: 'Open', match: s => ['not_started', 'in_progress', 'revision_requested'].includes(s) },
  { k: 'review', label: 'Waiting for review', match: s => s === 'submitted' || s === 'under_review' },
  { k: 'approved', label: 'Approved', match: s => s === 'approved' },
  { k: 'all', label: 'All', match: s => s !== 'cancelled' },
  { k: 'cancelled', label: 'Cancelled', match: s => s === 'cancelled' },
]

export default function Assignments({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const { ws } = useWs()
  const [f, setF] = useState(reviewOnly ? 'review' : 'open'); const [cat, setCat] = useState('all'); const [who, setWho] = useState('all'); const [q, setQ] = useState('')
  const { data, loading, error } = useAsync(async () => {
    const [a, files] = await Promise.all([
      sb.from('assignments').select('*, profiles(full_name)').eq('workspace_id', ws!.id).order('created_at', { ascending: false }).limit(1000),
      sb.from('submission_files').select('assignment_id,page_id,slot_key').eq('workspace_id', ws!.id).eq('is_current', true).limit(10000),
    ])
    if (a.error) throw a.error
    const got: Record<string, Set<string>> = {}
    ;(files.data || []).forEach((r: { assignment_id: string; page_id: string; slot_key: string }) => (got[r.assignment_id] ||= new Set()).add(r.page_id + ':' + r.slot_key))
    return { rows: (a.data || []) as unknown as (Assignment & { profiles: { full_name: string } | null })[], got }
  }, [ws?.id])
  const rows = useMemo(() => {
    if (!data) return []
    const flt = FILTERS.find(x => x.k === f)!
    let r = data.rows.filter(a => flt.match(a.status) && (cat === 'all' || (a.category_name || 'No label') === cat) && (who === 'all' || a.creator_id === who) && (!q || a.title.toLowerCase().includes(q.toLowerCase())))
    if (f === 'review') r = r.sort((x, y) => (x.submitted_at || '').localeCompare(y.submitted_at || ''))
    return r
  }, [data, f, cat, who, q])
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  const cats = [...new Set(data.rows.map(a => a.category_name || 'No label'))]
  const creators = [...new Map(data.rows.map(a => [a.creator_id, a.profiles?.full_name || 'Creator'])).entries()]
  const progress = (a: Assignment) => { let req = 0, have = 0; a.pages.forEach(p => slotsFor(p).forEach(s => { if (s.required) { req++; if (data.got[a.id]?.has(p.id + ':' + s.key)) have++ } })); return { req, have } }
  return <>
    <div className="page-title"><h1>{reviewOnly ? 'Review' : 'Assignments'}</h1></div>
    <div className="row wrap">
      <div className="chips">{FILTERS.map(x => <button key={x.k} className="chip" aria-pressed={f === x.k} onClick={() => setF(x.k)}>{x.label}</button>)}</div>
      <select className="select" style={{ width: 'auto' }} aria-label="Label" value={cat} onChange={e => setCat(e.target.value)}><option value="all">All labels</option>{cats.map(c => <option key={c}>{c}</option>)}</select>
      <select className="select" style={{ width: 'auto' }} aria-label="Creator" value={who} onChange={e => setWho(e.target.value)}><option value="all">All creators</option>{creators.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      <input className="input" style={{ maxWidth: 220 }} placeholder="Search" aria-label="Search" value={q} onChange={e => setQ(e.target.value)} />
    </div>
    {rows.length === 0 ? <div className="empty"><h3>{f === 'review' ? 'Nothing waiting for review' : 'Nothing here'}</h3><p>{f === 'review' ? 'Submitted work appears here, oldest first.' : 'Send a template to creators from the Templates page.'}</p></div> :
      <div className="card scroll-x"><table className="table"><thead><tr><th>Assignment</th><th>Creator</th><th>Progress</th><th>Status</th><th>{f === 'review' ? 'Submitted' : 'Deadline'}</th></tr></thead><tbody>
        {rows.map(a => { const p = progress(a); return <tr key={a.id}>
          <td><Link className="link" to={'/agency/review/' + a.id}>{a.title}</Link><br /><span className="muted" style={{ fontSize: 12.5 }}>{a.category_name || 'No label'} · sent {fmtDate(a.release_at, false)}</span></td>
          <td>{a.profiles?.full_name || 'Creator'}</td>
          <td style={{ minWidth: 110 }}><div className="bar"><i style={{ width: (p.req ? p.have / p.req * 100 : 100) + '%' }} /></div><span className="mono muted">{p.have}/{p.req}</span></td>
          <td><StatusPill s={a.status} /></td>
          <td className="mono muted">{f === 'review' ? fmtDate(a.submitted_at) : dueLabel(a.due_at)}</td></tr> })}
      </tbody></table></div>}
  </>
}
