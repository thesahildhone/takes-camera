import { useState } from 'react'
import { Link } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox } from '../lib/ui'
import { fmtDate } from '../lib/types'

type M = { creator_id: string; name: string; tasks: number; submitted: number; approved: number; on_time: number; with_due: number
  avg_turnaround_h: number | null; avg_review_h: number | null; reviews: number; revisions: number; overdue_now: number; open_now: number; last_sent: string | null }

const MIN = 3   // below this many, a percentage says more about luck than about the creator
const pct = (a: number, b: number) => b >= MIN ? Math.round(a / b * 100) + '%' : '—'
const hrs = (h: number | null) => h == null ? '—' : h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? h.toFixed(h < 10 ? 1 : 0) + ' h' : (h / 24).toFixed(1) + ' days'

export default function Performance() {
  const { ws } = useWs()
  const [days, setDays] = useState(30)
  const { data, loading, error } = useAsync(async () => {
    const { data, error } = await sb.rpc('creator_ops_metrics', { ws: ws!.id, since: new Date(Date.now() - days * 864e5).toISOString() })
    if (error) throw error
    return (data || []) as M[]
  }, [ws?.id, days])
  if (loading) return <Loading />
  if (error) return <ErrorBox msg={error} />
  const rows = data || []
  const sum = (k: keyof M) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0)
  const wavg = (k: 'avg_turnaround_h' | 'avg_review_h', w: 'submitted' | 'reviews') => {
    const xs = rows.filter(r => r[k] != null && r[w] > 0); const n = xs.reduce((a, r) => a + r[w], 0)
    return n ? xs.reduce((a, r) => a + (r[k] as number) * r[w], 0) / n : null
  }
  const T = { tasks: sum('tasks'), sub: sum('submitted'), ot: sum('on_time'), due: sum('with_due'), rev: sum('reviews'), redo: sum('revisions'), over: sum('overdue_now'), open: sum('open_now') }
  return <>
    <div className="page-title"><div><h1>Creator performance</h1>
      <p className="muted" style={{ marginTop: 4 }}>From real work in this agency: shots and sets assigned or due in the period. Percentages appear once there are at least {MIN} items.</p></div>
      <select className="select" style={{ width: "auto" }} aria-label="Period" value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></div>
    <div className="stats perf-stats">
      <div className="stat"><b>{T.sub}/{T.tasks}</b><span>Sent</span></div>
      <div className="stat"><b>{pct(T.ot, T.due)}</b><span>On time{T.due ? ` (${T.ot} of ${T.due})` : ''}</span></div>
      <div className="stat"><b>{hrs(wavg('avg_turnaround_h', 'submitted'))}</b><span>Avg time to send</span></div>
      <div className="stat"><b>{hrs(wavg('avg_review_h', 'reviews'))}</b><span>Avg review wait (your team)</span></div>
      <div className="stat"><b>{pct(T.redo, T.rev)}</b><span>Sent back for redo</span></div>
      <div className="stat"><b className={T.over ? 'bad-t' : ''}>{T.over}</b><span>Overdue now ({T.open} open)</span></div>
    </div>
    {rows.length === 0 ? <div className="empty"><h3>No work in this period</h3><p>Assign shots or sets and this fills in as creators send them.</p></div> :
    <div className="scroll-x"><table className="table"><thead><tr>
      <th>Creator</th><th>Sent</th><th>On time</th><th>Avg time to send</th><th>Avg review wait</th><th>Redo rate</th><th>Approved</th><th>Overdue now</th><th>Last sent</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.creator_id}>
        <td><Link className="link" to={'/agency/social-review'}><b>{r.name}</b></Link></td>
        <td className="mono">{r.submitted}/{r.tasks}</td>
        <td className="mono" title={`${r.on_time} of ${r.with_due} with a due date`}>{pct(r.on_time, r.with_due)}</td>
        <td className="mono">{hrs(r.avg_turnaround_h)}</td>
        <td className="mono">{hrs(r.avg_review_h)}</td>
        <td className="mono" title={`${r.revisions} of ${r.reviews} reviews`}>{pct(r.revisions, r.reviews)}</td>
        <td className="mono">{r.approved}</td>
        <td>{r.overdue_now ? <span className="pill bad">{r.overdue_now}</span> : <span className="muted">0</span>}</td>
        <td className="mono muted">{r.last_sent ? fmtDate(r.last_sent) : '—'}</td></tr>)}
    </tbody></table></div>}
    <p className="muted" style={{ fontSize: 12.5 }}>"Avg review wait" is how long your team took to review, not the creator. These figures describe workflow only; they are not a rating of anyone's content.</p>
  </>
}
