import { useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast, Modal } from '../lib/ui'
import { fmtDate } from '../lib/types'
import { CADENCE_LABEL, previewDates, type Cadence } from './AssignModal'

interface Sch { id: string; template_id: string; creator_ids: string[]; cadence: Cadence; interval_days: number | null; start_at: string; end_at: string | null; max_occurrences: number | null; due_offset_hours: number | null; skip_incomplete: boolean; status: string; next_run_at: string | null; occurrences: number; templates: { title: string } | null }
interface Run { id: string; occurrence_at: string; issued: number; skipped: { creator?: string; reason: string }[] }
const REASON: Record<string, string> = { not_a_member: 'no longer a member', previous_incomplete: 'previous one unfinished', workspace_suspended: 'workspace suspended' }

export default function Schedules() {
  const { ws } = useWs(); const toast = useToast()
  const [runsFor, setRunsFor] = useState<Sch | null>(null); const [runs, setRuns] = useState<Run[] | null>(null)
  const [confirm, setConfirm] = useState<Sch | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const [s, c] = await Promise.all([
      sb.from('schedules').select('*, templates(title)').eq('workspace_id', ws!.id).order('created_at', { ascending: false }),
      sb.from('creator_memberships').select('creator_id, profiles(full_name)').eq('workspace_id', ws!.id),
    ])
    if (s.error) throw s.error
    const names: Record<string, string> = {}
    ;((c.data || []) as unknown as { creator_id: string; profiles: { full_name: string } | null }[]).forEach(r => names[r.creator_id] = r.profiles?.full_name || 'Creator')
    return { sch: (s.data || []) as unknown as Sch[], names }
  }, [ws?.id])
  async function setStatus(s: Sch, status: string) {
    const patch: Record<string, unknown> = { status }
    if (status === 'active' && s.next_run_at && new Date(s.next_run_at) < new Date()) patch.next_run_at = new Date().toISOString()
    const { error } = await sb.from('schedules').update(patch).eq('id', s.id)
    if (error) toast(errMsg(error)); else { toast(status === 'paused' ? 'Paused' : status === 'active' ? 'Resumed' : 'Cancelled. Past assignments are kept.'); reload() }
    setConfirm(null)
  }
  async function openRuns(s: Sch) { setRunsFor(s); setRuns(null); const { data } = await sb.from('schedule_runs').select('*').eq('schedule_id', s.id).order('occurrence_at', { ascending: false }).limit(50); setRuns((data || []) as Run[]) }
  async function runNow() { const { data, error } = await sb.rpc('run_schedules_now', { ws: ws!.id }); if (error) toast(errMsg(error)); else { toast(`${data} assignment${data === 1 ? '' : 's'} released`); reload() } }

  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  return <>
    <div className="page-title"><div><h1>Schedules</h1><p className="muted" style={{ marginTop: 4 }}>Repeat a template automatically. Each release creates fresh assignments and never overwrites old work.</p></div>
      <button className="btn ghost" onClick={runNow}>Check for due releases</button></div>
    {data.sch.length === 0 ? <div className="empty"><h3>No schedules yet</h3><p>Open a template, choose Send to creators, then Schedule / repeat.</p></div> :
      <div className="list">{data.sch.map(s => {
        const upcoming = s.status === 'active' && s.next_run_at ? previewDates(new Date(s.next_run_at), s.cadence, s.interval_days || 7, s.end_at ? new Date(s.end_at) : null, s.max_occurrences ? s.max_occurrences - s.occurrences : null, 3) : []
        return <div key={s.id} className="card stack">
          <div className="between wrap"><div><h3>{s.templates?.title || 'Template'}</h3><p className="muted" style={{ fontSize: 13 }}>{CADENCE_LABEL[s.cadence].replace('X', String(s.interval_days || ''))} · {s.creator_ids.length} creator{s.creator_ids.length === 1 ? '' : 's'}{s.due_offset_hours ? ` · due ${s.due_offset_hours}h after release` : ''}{s.skip_incomplete ? ' · skips unfinished' : ''}</p></div>
            <span className={'pill ' + (s.status === 'active' ? 'ok' : s.status === 'paused' ? 'wait' : 'todo')}>{s.status}</span></div>
          <p className="muted" style={{ fontSize: 13 }}>{s.creator_ids.map(id => data.names[id] || 'Removed creator').join(', ')}</p>
          <p className="mono">{upcoming.length ? 'Next: ' + upcoming.map(d => fmtDate(d.toISOString())).join(' · ') : s.status === 'completed' ? `Finished after ${s.occurrences} releases` : `${s.occurrences} release${s.occurrences === 1 ? '' : 's'} so far`}</p>
          <div className="row wrap">
            {s.status === 'active' && <button className="btn sm ghost" onClick={() => setStatus(s, 'paused')}>Pause</button>}
            {s.status === 'paused' && <button className="btn sm ghost" onClick={() => setStatus(s, 'active')}>Resume</button>}
            <button className="btn sm ghost" onClick={() => openRuns(s)}>History</button>
            {['active', 'paused'].includes(s.status) && <button className="btn sm danger" onClick={() => setConfirm(s)}>Cancel future releases</button>}
          </div></div>
      })}</div>}
    {runsFor && <Modal center title={`Release history · ${runsFor.templates?.title}`} onClose={() => setRunsFor(null)}>
      {!runs ? <Loading /> : !runs.length ? <p className="muted">Nothing released yet.</p> : <div className="list">{runs.map(r => <div key={r.id} className="card tight">
        <div className="between"><b className="mono">{fmtDate(r.occurrence_at)}</b><span className="pill ok">{r.issued} sent</span></div>
        {r.skipped.length > 0 && <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Skipped: {r.skipped.map(k => (k.creator ? (data.names[k.creator] || 'creator') + ' — ' : '') + (REASON[k.reason] || k.reason)).join('; ')}</p>}
      </div>)}</div>}
    </Modal>}
    {confirm && <Modal center title="Cancel future releases?" onClose={() => setConfirm(null)}>
      <p className="muted">No more assignments will be created from this schedule. Everything already sent stays as it is.</p>
      <div className="row"><button className="btn ghost grow" onClick={() => setConfirm(null)}>Keep it</button><button className="btn danger grow" onClick={() => setStatus(confirm, 'cancelled')}>Cancel releases</button></div>
    </Modal>}
  </>
}
