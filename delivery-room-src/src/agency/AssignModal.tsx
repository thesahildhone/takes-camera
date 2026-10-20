import { useMemo, useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { Modal, useAsync, Loading, ErrorBox, useToast } from '../lib/ui'
import { fmtDate } from '../lib/types'
import type { Tpl } from './Templates'

export type Cadence = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'custom'
export const CADENCE_LABEL: Record<Cadence, string> = { once: 'Once, at a set time', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', custom: 'Every X days' }
export function previewDates(start: Date, cadence: Cadence, days: number, end: Date | null, max: number | null, count = 6) {
  const out: Date[] = []; let d = new Date(start)
  for (let i = 0; i < count; i++) {
    if (end && d > end) break
    if (max && out.length >= max) break
    out.push(new Date(d))
    if (cadence === 'once') break
    if (cadence === 'weekly') d = new Date(d.getTime() + 7 * 864e5)
    else if (cadence === 'biweekly') d = new Date(d.getTime() + 14 * 864e5)
    else if (cadence === 'custom') d = new Date(d.getTime() + Math.max(1, days) * 864e5)
    else { const n = new Date(d); n.setMonth(n.getMonth() + 1); d = n }
  }
  return out
}
const localInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }

export default function AssignModal({ tpl, onClose, onDone }: { tpl: Tpl; onClose: () => void; onDone: () => void }) {
  const { ws } = useWs(); const toast = useToast()
  const [sel, setSel] = useState<string[]>([]); const [mode, setMode] = useState<'now' | 'schedule'>('now')
  const [due, setDue] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const tomorrow = new Date(Date.now() + 864e5); tomorrow.setHours(10, 0, 0, 0)
  const [start, setStart] = useState(localInput(tomorrow)); const [cadence, setCadence] = useState<Cadence>('biweekly')
  const [days, setDays] = useState(10); const [endMode, setEndMode] = useState<'never' | 'date' | 'count'>('never')
  const [endDate, setEndDate] = useState(''); const [count, setCount] = useState(6); const [dueHours, setDueHours] = useState(72)
  const [skip, setSkip] = useState(false)
  const { data: creators, loading } = useAsync(async () => {
    const { data, error } = await sb.from('creator_memberships').select('creator_id, profiles(full_name,email)').eq('workspace_id', ws!.id).eq('status', 'active')
    if (error) throw error
    return (data || []) as unknown as { creator_id: string; profiles: { full_name: string; email: string } | null }[]
  }, [ws?.id])
  const dates = useMemo(() => start ? previewDates(new Date(start), cadence, days, endMode === 'date' && endDate ? new Date(endDate + 'T23:59') : null, endMode === 'count' ? count : null) : [], [start, cadence, days, endMode, endDate, count])
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  async function go() {
    setErr(null); if (!sel.length) return setErr('Pick at least one creator')
    setBusy(true)
    try {
      if (mode === 'now') {
        const { data, error } = await sb.rpc('issue_assignments', { t_id: tpl.id, creator_ids: sel, due: due ? new Date(due).toISOString() : null })
        if (error) throw error
        toast(`Sent to ${data} creator${data === 1 ? '' : 's'}`)
      } else {
        const uidv = (await sb.auth.getUser()).data.user!.id
        const { error } = await sb.from('schedules').insert({
          workspace_id: ws!.id, template_id: tpl.id, creator_ids: sel, cadence, interval_days: cadence === 'custom' ? days : null,
          start_at: new Date(start).toISOString(), end_at: endMode === 'date' && endDate ? new Date(endDate + 'T23:59').toISOString() : null,
          max_occurrences: endMode === 'count' ? count : null, due_offset_hours: dueHours || null, skip_incomplete: skip,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', created_by: uidv })
        if (error) throw error
        await sb.rpc('publish_template', { t_id: tpl.id })
        if (new Date(start) <= new Date()) await sb.rpc('run_schedules_now', { ws: ws!.id })
        toast('Schedule created')
      }
      onDone()
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  return <Modal center title={`Send "${tpl.title}"`} onClose={onClose}>
    {loading ? <Loading /> : !creators?.length ? <div className="empty"><h3>No creators yet</h3><p>Invite creators first from the Creators page.</p></div> : <div className="stack">
      <div className="between"><span className="eyebrow">Creators · {sel.length} selected</span>
        <button className="link" onClick={() => setSel(sel.length === creators.length ? [] : creators.map(c => c.creator_id))}>{sel.length === creators.length ? 'Clear' : 'Select all'}</button></div>
      <div className="list" style={{ maxHeight: 220, overflow: 'auto' }}>{creators.map(c => <label key={c.creator_id} className="card tight check">
        <input type="checkbox" checked={sel.includes(c.creator_id)} onChange={() => toggle(c.creator_id)} />
        <span><b>{c.profiles?.full_name || 'Creator'}</b> <span className="muted">{c.profiles?.email}</span></span></label>)}</div>
      <div className="seg" role="group" aria-label="When"><button aria-pressed={mode === 'now'} onClick={() => setMode('now')}>Send now</button><button aria-pressed={mode === 'schedule'} onClick={() => setMode('schedule')}>Schedule / repeat</button></div>
      {mode === 'now' ? <label className="field"><span>Deadline (optional)</span><input id="due" className="input" type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label> : <>
        <div className="reqgrid">
          <label className="field"><span>First release</span><input id="start" className="input" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label className="field"><span>Repeat</span><select id="cad" className="select" value={cadence} onChange={e => setCadence(e.target.value as Cadence)}>{(Object.keys(CADENCE_LABEL) as Cadence[]).map(k => <option key={k} value={k}>{CADENCE_LABEL[k]}</option>)}</select></label>
          {cadence === 'custom' && <label className="field"><span>Every how many days</span><input id="days" className="input" type="number" min={1} max={365} value={days} onChange={e => setDays(parseInt(e.target.value || '1', 10))} /></label>}
          <label className="field"><span>Deadline after each release (hours)</span><input id="dueh" className="input" type="number" min={0} value={dueHours} onChange={e => setDueHours(parseInt(e.target.value || '0', 10))} /></label>
        </div>
        {cadence !== 'once' && <div className="field"><span>Stop</span><div className="row wrap">
          <div className="seg" role="group"><button aria-pressed={endMode === 'never'} onClick={() => setEndMode('never')}>Never</button><button aria-pressed={endMode === 'date'} onClick={() => setEndMode('date')}>On a date</button><button aria-pressed={endMode === 'count'} onClick={() => setEndMode('count')}>After</button></div>
          {endMode === 'date' && <input id="enddate" className="input" style={{ maxWidth: 180 }} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />}
          {endMode === 'count' && <><input id="count" className="input num" type="number" min={1} value={count} onChange={e => setCount(parseInt(e.target.value || '1', 10))} /><span className="muted">releases</span></>}
        </div></div>}
        {cadence !== 'once' && <label className="check"><input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} /><span>Skip a creator if they haven't finished the previous one<br /><span className="muted" style={{ fontSize: 13 }}>Otherwise they get the new one anyway.</span></span></label>}
        <div className="card tight"><p className="eyebrow">Next releases</p><p className="mono" style={{ marginTop: 4 }}>{dates.map(d => fmtDate(d.toISOString())).join(' · ') || 'Pick a start time'}</p></div>
      </>}
      <ErrorBox msg={err} />
      <button className="btn lg primary block" onClick={go} disabled={busy || !sel.length}>{busy ? 'Working…' : mode === 'now' ? `Send to ${sel.length || ''} creator${sel.length === 1 ? '' : 's'}` : 'Create schedule'}</button>
    </div>}
  </Modal>
}
