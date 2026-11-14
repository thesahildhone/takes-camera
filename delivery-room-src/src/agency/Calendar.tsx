import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, Modal, useToast } from '../lib/ui'
import { IcBack, IcNext } from '../lib/icons'

interface Item { key: string; day: string; creator: string; label: string; n: number; tone: 'todo' | 'wait' | 'ok' | 'bad'; to: string; kind: 'Socials' | 'OF' | 'Scheduled' }
const OPEN = ['not_started', 'in_progress', 'revision_requested']
const dkey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function Calendar() {
  const { ws } = useWs(); const toast = useToast()
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [sel, setSel] = useState(dkey(new Date())); const [who, setWho] = useState('')
  const [setDl, setSetDl] = useState(false); const [secId, setSecId] = useState(''); const [pick, setPick] = useState<Record<string, boolean>>({}); const [busy, setBusy] = useState(false)
  const { data, loading, error, reload } = useAsync(async () => {
    const id = ws!.id
    const [cr, sa, sp, sec, ct, oa, sch] = await Promise.all([
      sb.from('creator_memberships').select('creator_id, profiles(full_name,email)').eq('workspace_id', id).eq('status', 'active'),
      sb.from('social_assignments').select('creator_id,project_id,status,due_at').eq('workspace_id', id).neq('status', 'cancelled').limit(5000),
      sb.from('social_projects').select('id,section_id,publication_status').eq('workspace_id', id).neq('publication_status', 'archived').limit(2000),
      sb.from('social_sections').select('id,title,content_type_id,archived_at').eq('workspace_id', id).order('position'),
      sb.from('social_content_types').select('id,name').eq('workspace_id', id),
      sb.from('assignments').select('id,title,status,due_at,creator_id').eq('workspace_id', id).neq('status', 'cancelled').not('due_at', 'is', null).limit(2000),
      sb.from('schedules').select('id,next_run_at,templates(title)').eq('workspace_id', id).eq('status', 'active').not('next_run_at', 'is', null),
    ])
    if (cr.error) throw cr.error
    const creators = ((cr.data || []) as unknown as { creator_id: string; profiles: { full_name: string; email: string } | null }[]).map(c => ({ id: c.creator_id, name: c.profiles?.full_name || c.profiles?.email || 'Creator' }))
    const cname = Object.fromEntries(creators.map(c => [c.id, c.name]))
    const secOf = Object.fromEntries(((sp.data || []) as { id: string; section_id: string }[]).map(p => [p.id, p.section_id]))
    const sections = ((sec.data || []) as { id: string; title: string; content_type_id: string; archived_at: string | null }[]).filter(s => !s.archived_at)
    const tname = Object.fromEntries(((ct.data || []) as { id: string; name: string }[]).map(t => [t.id, t.name]))
    const stitle = Object.fromEntries(sections.map(s => [s.id, s.title]))
    const now = Date.now(); const groups = new Map<string, Item>(); let noDate = 0
    ;((sa.data || []) as { creator_id: string; project_id: string; status: string; due_at: string | null }[]).forEach(a => {
      const s = secOf[a.project_id]; if (!s || !stitle[s]) return
      if (!a.due_at) { if (OPEN.includes(a.status)) noDate++; return }
      const day = dkey(new Date(a.due_at)), open = OPEN.includes(a.status), k = `${day}|${a.creator_id}|${s}|${open ? 'o' : a.status}`
      const g = groups.get(k) || { key: k, day, creator: a.creator_id, label: stitle[s], n: 0, kind: 'Socials' as const, to: '/agency/socials',
        tone: open ? (new Date(a.due_at).getTime() < now ? 'bad' as const : 'todo' as const) : a.status === 'approved' ? 'ok' as const : 'wait' as const }
      g.n++; groups.set(k, g)
    })
    const items: Item[] = [...groups.values()]
    ;((oa.data || []) as { id: string; title: string; status: string; due_at: string; creator_id: string }[]).forEach(a => items.push({ key: a.id, day: dkey(new Date(a.due_at)), creator: a.creator_id, label: a.title, n: 1, kind: 'OF', to: '/agency/review/' + a.id,
      tone: OPEN.includes(a.status) ? (new Date(a.due_at).getTime() < now ? 'bad' : 'todo') : a.status === 'approved' ? 'ok' : 'wait' }))
    ;((sch.data || []) as unknown as { id: string; next_run_at: string; templates: { title: string } | null }[]).forEach(s => items.push({ key: 's' + s.id, day: dkey(new Date(s.next_run_at)), creator: '', label: (s.templates?.title || 'Set') + ' goes out', n: 1, kind: 'Scheduled', to: '/agency/schedules', tone: 'todo' }))
    return { creators, cname, items, noDate, sections: sections.map(s => ({ id: s.id, label: `${tname[s.content_type_id] || ''} · ${s.title}` })) }
  }, [ws?.id])
  const byDay = useMemo(() => { const m = new Map<string, Item[]>(); (data?.items || []).filter(i => !who || i.creator === who || i.kind === 'Scheduled').forEach(i => m.set(i.day, [...(m.get(i.day) || []), i])); return m }, [data, who])
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />

  const first = new Date(month), lead = (first.getDay() + 6) % 7, days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]
  while (cells.length % 7) cells.push(null)
  const today = dkey(new Date()), list = byDay.get(sel) || []
  const selDate = new Date(sel + 'T12:00:00')
  const worst = (l: Item[]) => l.some(i => i.tone === 'bad') ? 'bad' : l.some(i => i.tone === 'todo') ? 'todo' : l.some(i => i.tone === 'wait') ? 'wait' : 'ok'
  const upcoming = [...byDay.entries()].filter(([d]) => d >= today).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 6)
  function openSet() { setSecId(data!.sections[0]?.id || ''); setPick(Object.fromEntries(data!.creators.map(c => [c.id, !who || c.id === who]))); setSetDl(true) }
  async function saveDl() {
    const ids = Object.keys(pick).filter(k => pick[k]); if (!ids.length || !secId) return
    setBusy(true); const due = new Date(sel + 'T23:59:00')
    const { data: n, error } = await sb.rpc('social_assign_section', { sec: secId, creator_ids: ids, due: due.toISOString() }); setBusy(false)
    if (error) return toast(errMsg(error)); toast(`Deadline set on ${n} shot${n === 1 ? '' : 's'}`); setSetDl(false); reload()
  }

  return <>
    <div className="page-title"><div><h1>Calendar</h1><p className="muted" style={{ marginTop: 4 }}>What's due, and from whom.</p></div>
      <select className="select" style={{ width: 'auto', minWidth: 170 }} aria-label="Creator" value={who} onChange={e => setWho(e.target.value)}><option value="">All creators</option>{data.creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    {data.noDate > 0 && <div className="notice">{data.noDate} assigned shot{data.noDate === 1 ? ' has' : 's have'} no deadline. Pick a day, then "Set a deadline" to give a whole section one.</div>}
    <div className="cal-wrap">
      <section className="card stack">
        <div className="between"><button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><IcBack /></button>
          <h3>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
          <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><IcNext /></button></div>
        <div className="cal" role="grid">
          {WD.map(w => <span key={w} className="wd">{w}</span>)}
          {cells.map((d, i) => { if (!d) return <span key={i} />
            const k = dkey(d), l = byDay.get(k) || [], n = l.reduce((x, y) => x + y.n, 0)
            return <button key={i} className={'day' + (k === sel ? ' sel' : '') + (k === today ? ' today' : '')} onClick={() => setSel(k)} aria-label={`${d.getDate()}, ${n} due`}>
              <b>{d.getDate()}</b>{n > 0 && <span className={'pill ' + worst(l)}>{n}</span>}</button> })}
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}><span className="pill todo">3</span> to film · <span className="pill bad">3</span> overdue · <span className="pill wait">3</span> with you · <span className="pill ok">3</span> approved</p>
      </section>
      <section className="stack">
        <div className="between wrap"><h2 className="h2">{selDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          {data.sections.length > 0 && data.creators.length > 0 && <button className="btn sm ghost" onClick={openSet}>Set a deadline</button>}</div>
        {list.length === 0 ? <p className="muted">Nothing due this day.</p> :
          <div className="list">{list.map(i => <Link key={i.key} to={i.to} className="card click tight between">
            <span style={{ minWidth: 0 }}><b>{i.kind === 'Scheduled' ? i.label : data.cname[i.creator] || 'Creator'}</b><br />
              <span className="muted" style={{ fontSize: 13 }}>{i.kind === 'Scheduled' ? 'Scheduled OF set' : i.kind === 'Socials' ? `${i.label} · ${i.n} shot${i.n === 1 ? '' : 's'}` : i.label}</span></span>
            <span className={'pill ' + i.tone}>{i.tone === 'bad' ? 'Overdue' : i.tone === 'todo' ? 'To film' : i.tone === 'wait' ? 'With you' : 'Approved'}</span></Link>)}</div>}
        {upcoming.length > 0 && <><h2 className="h2" style={{ marginTop: 8 }}>Coming up</h2>
          <div className="list">{upcoming.map(([d, l]) => <button key={d} className="card click tight between" style={{ textAlign: 'left' }} onClick={() => { setSel(d); const x = new Date(d + 'T12:00:00'); setMonth(new Date(x.getFullYear(), x.getMonth(), 1)) }}>
            <b>{d === today ? 'Today' : new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</b>
            <span className="muted" style={{ fontSize: 13 }}>{l.reduce((x, y) => x + y.n, 0)} due · {[...new Set(l.filter(i => i.creator).map(i => data.cname[i.creator]))].slice(0, 3).join(', ')}</span></button>)}</div></>}
      </section>
    </div>
    {setDl && <Modal center title={`Due ${selDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`} onClose={() => setSetDl(false)}>
      <label className="field"><span>Section</span><select className="select" value={secId} onChange={e => setSecId(e.target.value)}>{data.sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <div className="checks">{data.creators.map(c => <label key={c.id} className="check"><input type="checkbox" checked={!!pick[c.id]} onChange={e => setPick({ ...pick, [c.id]: e.target.checked })} />{c.name}</label>)}</div>
      <p className="muted" style={{ fontSize: 13 }}>Every shot in this section becomes due that day for the creators you tick. Anyone not assigned yet gets assigned. They get a reminder 24 hours before.</p>
      <button className="btn lg primary block" disabled={busy || !Object.values(pick).some(Boolean)} onClick={saveDl}>Set deadline</button>
    </Modal>}
  </>
}
