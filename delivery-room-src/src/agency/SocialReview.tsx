import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast, Modal } from '../lib/ui'
import { fmtBytes, fmtDate } from '../lib/types'
import { fmtDur, signed, type ContentType, type Project, type Section, type Submission } from '../lib/social'

type Row = Submission & { profiles: { full_name: string; email: string } | null }
const ST: Record<string, [string, string]> = { submitted: ['Waiting for review', 'wait'], revision_requested: ['Redo requested', 'bad'], approved: ['Approved', 'ok'] }

function useStructure(wsId: string) {
  return useAsync(async () => {
    const [t, s, p] = await Promise.all([
      sb.from('social_content_types').select('*').eq('workspace_id', wsId).order('position'),
      sb.from('social_sections').select('*').eq('workspace_id', wsId).order('position'),
      sb.from('social_projects').select('id,title,section_id,workspace_id,mode,rights_status').eq('workspace_id', wsId),
    ])
    return { types: (t.data || []) as ContentType[], sections: (s.data || []) as Section[], projects: (p.data || []) as Pick<Project, 'id' | 'title' | 'section_id' | 'mode' | 'rights_status'>[] }
  }, [wsId])
}

export function SocialInbox() {
  const { ws } = useWs()
  const st = useStructure(ws!.id)
  const [fl, setFl] = useState({ creator: '', type: '', section: '', project: '', status: 'submitted', latest: true })
  const { data, loading, error } = useAsync(async () => {
    const { data, error } = await sb.from('social_submissions').select('*, profiles!social_submissions_profile_fk(full_name,email)').eq('workspace_id', ws!.id).order('created_at', { ascending: false }).limit(500)
    if (error) {
      // profiles join through auth.users isn't exposed; fall back to a second query
      const r = await sb.from('social_submissions').select('*').eq('workspace_id', ws!.id).order('created_at', { ascending: false }).limit(500)
      if (r.error) throw r.error
      const ids = [...new Set((r.data || []).map(x => x.creator_id))]
      const pr = ids.length ? await sb.from('profiles').select('id,full_name,email').in('id', ids) : { data: [] }
      const pm = Object.fromEntries((pr.data || []).map((x: { id: string; full_name: string; email: string }) => [x.id, x]))
      return (r.data || []).map(x => ({ ...x, profiles: pm[x.creator_id] || null })) as Row[]
    }
    return data as Row[]
  }, [ws?.id])
  const S = st.data
  const proj = (id: string) => S?.projects.find(p => p.id === id)
  const sec = (id?: string) => S?.sections.find(s => s.id === id)
  const rows = useMemo(() => {
    let r = data || []
    if (fl.latest) { const seen = new Set<string>(); r = r.filter(x => { if (seen.has(x.assignment_id)) return false; seen.add(x.assignment_id); return true }) }
    return r.filter(x => {
      const p = proj(x.project_id), s = sec(p?.section_id)
      return (!fl.creator || x.creator_id === fl.creator) && (!fl.project || x.project_id === fl.project) && (!fl.section || p?.section_id === fl.section)
        && (!fl.type || s?.content_type_id === fl.type) && (!fl.status || x.status === fl.status)
    })
  }, [data, fl, S]) // eslint-disable-line react-hooks/exhaustive-deps
  const creators = useMemo(() => { const m = new Map<string, string>(); (data || []).forEach(x => m.set(x.creator_id, x.profiles?.full_name || x.profiles?.email || 'Creator')); return [...m.entries()] }, [data])
  if (loading || st.loading) return <Loading />
  if (error) return <ErrorBox msg={error} />
  const set = (k: keyof typeof fl, v: string | boolean) => setFl(x => ({ ...x, [k]: v }))

  return <>
    <div className="page-title"><div><h1>Socials review</h1><p className="muted" style={{ marginTop: 4 }}>Every video creators send for your Socials shots.</p></div><Link className="btn ghost" to="/agency/socials">Sections & shots</Link></div>
    <div className="filters">
      <select className="select" aria-label="Status" value={fl.status} onChange={e => set('status', e.target.value)}><option value="">Any status</option><option value="submitted">Waiting for review</option><option value="revision_requested">Redo requested</option><option value="approved">Approved</option></select>
      <select className="select" aria-label="Creator" value={fl.creator} onChange={e => set('creator', e.target.value)}><option value="">All creators</option>{creators.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      <select className="select" aria-label="Content type" value={fl.type} onChange={e => setFl(x => ({ ...x, type: e.target.value, section: '', project: '' }))}><option value="">All content types</option>{S?.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select className="select" aria-label="Section" value={fl.section} onChange={e => setFl(x => ({ ...x, section: e.target.value, project: '' }))}><option value="">All sections</option>{S?.sections.filter(s => !fl.type || s.content_type_id === fl.type).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
      <select className="select" aria-label="Shot" value={fl.project} onChange={e => set('project', e.target.value)}><option value="">All shots</option>{S?.projects.filter(p => (!fl.section || p.section_id === fl.section) && (!fl.type || sec(p.section_id)?.content_type_id === fl.type)).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
      <label className="check"><input type="checkbox" checked={fl.latest} onChange={e => set('latest', e.target.checked)} />Latest version only</label>
    </div>
    {rows.length === 0 ? <div className="empty"><h3>Nothing here</h3><p>{fl.status === 'submitted' ? 'No videos are waiting for review.' : 'Try different filters.'}</p></div> :
      <div className="scroll-x"><table className="table"><thead><tr><th>Creator</th><th>Shot</th><th>Section</th><th>Version</th><th>Files</th><th>Sent</th><th>Status</th></tr></thead><tbody>
        {rows.map(r => { const p = proj(r.project_id), s = sec(p?.section_id), t = S?.types.find(x => x.id === s?.content_type_id)
          return <tr key={r.id}><td><Link className="link" to={'/agency/social-review/' + r.id}><b>{r.profiles?.full_name || 'Creator'}</b></Link></td>
            <td>{p?.title || '—'}</td><td className="muted">{t?.name} · {s?.title}</td><td className="mono">v{r.version}</td>
            <td className="muted">{r.mix_path ? 'Clean + music' : 'Clean'}</td><td className="mono">{fmtDate(r.created_at)}</td>
            <td><span className={'pill ' + ST[r.status][1]}>{ST[r.status][0]}</span></td></tr> })}
      </tbody></table></div>}
  </>
}

function saveFrom(url: string, name: string) { const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noreferrer'; document.body.appendChild(a); a.click(); a.remove() }
const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '').slice(0, 40) || 'Item'

export function SocialReviewDetail() {
  const { id } = useParams(); const { ws } = useWs(); const toast = useToast(); const nav = useNavigate()
  const st = useStructure(ws!.id)
  const [urls, setUrls] = useState<Record<string, string>>({}); const [act, setAct] = useState<null | 'approve' | 'revise'>(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false)
  const { data, loading, error, reload } = useAsync(async () => {
    const { data: s, error } = await sb.from('social_submissions').select('*').eq('id', id!).single()
    if (error) throw error
    const [h, pr] = await Promise.all([
      sb.from('social_submissions').select('*').eq('assignment_id', s.assignment_id).order('version', { ascending: false }),
      sb.from('profiles').select('full_name,email').eq('id', s.creator_id).maybeSingle(),
    ])
    const q = await sb.from('social_submissions').select('id,assignment_id,created_at').eq('workspace_id', s.workspace_id).eq('status', 'submitted').order('created_at').limit(300)
    const queue = ((q.data || []) as { id: string }[]).map(x => x.id)
    return { s: s as Submission, history: (h.data || []) as Submission[], creator: pr.data?.full_name || pr.data?.email || 'Creator', queue }
  }, [id])
  useEffect(() => { if (data) signed(data.history.flatMap(h => [h.clean_path, h.mix_path])).then(setUrls) }, [data])
  if (loading || st.loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  const { s, history, creator, queue } = data
  const qi = queue.indexOf(s.id), nextId = queue.find((x, i) => x !== s.id && i > qi) || queue.find(x => x !== s.id) || null
  const cnote = typeof s.meta?.note === 'string' ? s.meta.note : ''
  const p = st.data?.projects.find(x => x.id === s.project_id), sec = st.data?.sections.find(x => x.id === p?.section_id), type = st.data?.types.find(x => x.id === sec?.content_type_id)
  const latest = history[0]?.id === s.id
  const base = `${clean(creator)}_${clean(type?.name || '')}_${clean(sec?.title || '')}_${clean(p?.title || '')}_v${s.version}`
  const ext = (path: string) => path.split('.').pop() || 'mp4'
  async function go() {
    setBusy(true); const { error } = await sb.rpc('social_review', { sub: s.id, act, note }); setBusy(false)
    if (error) return toast(errMsg(error)); toast(act === 'approve' ? 'Approved' : 'Sent back to ' + creator); setAct(null); setNote('')
    if (nextId) nav('/agency/social-review/' + nextId); else reload()
  }
  return <>
    <div className="page-title"><div><Link className="link" to="/agency/social-review">← Socials review</Link>
      <h1 style={{ marginTop: 6 }}>{p?.title || 'Submission'}</h1>
      <p className="muted" style={{ marginTop: 4 }}>{creator} · {type?.name} › {sec?.title} · version {s.version} · sent {fmtDate(s.created_at)}</p></div>
      <div className="row wrap"><span className={'pill ' + ST[s.status][1]}>{ST[s.status][0]}</span>
        {latest && s.status === 'submitted' && <><button className="btn ghost" onClick={() => setAct('revise')}>Request redo</button><button className="btn primary" onClick={() => setAct('approve')}>Approve</button></>}
        {latest && s.status !== 'submitted' && <button className="btn ghost" onClick={() => setAct(s.status === 'approved' ? 'revise' : 'approve')}>{s.status === 'approved' ? 'Request redo instead' : 'Approve instead'}</button>}</div></div>
    {!latest && <div className="notice">This is an older version. <Link className="link" to={'/agency/social-review/' + history[0].id}>Open the latest (v{history[0].version})</Link></div>}
    {queue.length > 1 && s.status === 'submitted' && <p className="muted" style={{ fontSize: 13.5 }}>{qi + 1} of {queue.length} waiting. After you approve or send back, the next one opens. {nextId && <Link className="link" to={'/agency/social-review/' + nextId}>Skip</Link>}</p>}
    {cnote && <div className="notice"><b>Note from {creator}:</b> {cnote}</div>}
    {s.review_note && <div className="notice"><b>{s.status === 'approved' ? 'Approval note' : 'Redo note'}:</b> {s.review_note}</div>}
    <div className="vgrid">
      <section className="card stack"><div className="between"><h3>Clean video</h3><span className="muted" style={{ fontSize: 13 }}>{p?.mode === 'dance' || p?.mode === 'both' ? 'No backing music' : 'As filmed'}</span></div>
        {urls[s.clean_path] ? <video className="rvid" src={urls[s.clean_path]} controls playsInline preload="metadata" /> : <Loading />}
        <p className="mono muted">{s.width && s.height ? `${s.width}×${s.height} · ` : ''}{fmtDur(s.duration_s)} · {fmtBytes(s.size_bytes)}{s.smoothing != null ? ` · smoothing ${s.smoothing}` : ''}{s.clip_count ? ` · ${s.clip_count} clip${s.clip_count > 1 ? 's' : ''}` : ''} · {s.source === 'upload' ? 'camera roll' : 'filmed in app'}</p>
        <button className="btn ghost" disabled={!urls[s.clean_path]} onClick={() => saveFrom(urls[s.clean_path], `${base}_clean.${ext(s.clean_path)}`)}>Download clean</button></section>
      {s.mix_path ? <section className="card stack"><div className="between"><h3>With reference music</h3><span className="pill ok">Licensed</span></div>
        {urls[s.mix_path] ? <video className="rvid" src={urls[s.mix_path]} controls playsInline preload="metadata" /> : <Loading />}
        <button className="btn ghost" disabled={!urls[s.mix_path]} onClick={() => saveFrom(urls[s.mix_path!], `${base}_music.${ext(s.mix_path!)}`)}>Download with music</button></section>
        : (p?.mode === 'dance' || p?.mode === 'both') && <section className="card stack"><h3>With reference music</h3><p className="muted">{s.mix_note || (p?.rights_status === 'licensed' ? 'Not made for this submission.' : 'Not made, because the music rights for this shot are not set to Licensed.')}</p></section>}
    </div>
    <section className="stack"><h2 style={{ fontSize: 18 }}>All versions</h2><div className="list">{history.map(h => <Link key={h.id} to={'/agency/social-review/' + h.id} className="card tight click between" aria-current={h.id === s.id}>
      <span><b>v{h.version}</b> <span className="mono muted">{fmtDate(h.created_at)}</span>{h.review_note && <span className="muted"> · {h.review_note}</span>}</span><span className={'pill ' + ST[h.status][1]}>{ST[h.status][0]}</span></Link>)}</div>
      <p className="muted" style={{ fontSize: 13 }}>New attempts are added as new versions. Nothing older is overwritten.</p></section>
    {act && <Modal center title={act === 'approve' ? 'Approve this video?' : 'Ask for a redo?'} onClose={() => setAct(null)}>
      <label className="field"><span>{act === 'approve' ? `Note to ${creator} (optional)` : `What should ${creator} change?`}</span><textarea id="rv-note" className="textarea" value={note} onChange={e => setNote(e.target.value)} /></label>
      <button className="btn lg primary block" disabled={busy || (act === 'revise' && !note.trim())} onClick={go}>{act === 'approve' ? 'Approve' : 'Send back for redo'}</button></Modal>}
  </>
}
