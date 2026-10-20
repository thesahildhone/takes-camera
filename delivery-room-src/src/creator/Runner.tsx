import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { sb, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Loading, ErrorBox, useToast, Modal, StatusPill } from '../lib/ui'
import { dueLabel, fmtDate, slotsFor, type Assignment, type Page, type RevisionReq, type SFile, type Slot } from '../lib/types'
import { IcBack, IcCam, IcCheck, IcLib, IcNext, IcPlus, IcTick, IcVid, IcX } from '../lib/icons'
import { dropPending, listPending, mediaMeta, pendingKey, savePending, uploadAndAttach, type PendingRec } from '../lib/upload'
import Camera, { type CamResult } from '../components/Camera'

interface Up { status: 'uploading' | 'saving' | 'failed'; pct: number; url: string; kind: 'photo' | 'video'; err?: string; rec: PendingRec }

export default function Runner() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast()
  const { profile, creatorOf, refresh } = useAuth()
  const [a, setA] = useState<Assignment | null>(null)
  const [files, setFiles] = useState<SFile[]>([]); const [rr, setRr] = useState<RevisionReq[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [ups, setUps] = useState<Record<string, Up>>({})
  const [idx, setIdx] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<{ page: Page; slot: Slot } | null>(null)
  const [viewer, setViewer] = useState<{ page: Page; slot: Slot } | null>(null)
  const [cam, setCam] = useState<{ page: Page; slot: Slot } | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null); const [submitting, setSubmitting] = useState(false)
  const fileIn = useRef<HTMLInputElement>(null); const target = useRef<{ page: Page; slot: Slot } | null>(null)

  const loadFiles = useCallback(async () => {
    const [f, r] = await Promise.all([
      sb.from('submission_files').select('*').eq('assignment_id', id!).eq('is_current', true),
      sb.from('revision_requests').select('*').eq('assignment_id', id!).order('created_at', { ascending: false }),
    ])
    const fl = (f.data || []) as SFile[]; setFiles(fl); setRr((r.data || []) as RevisionReq[])
    if (fl.length) { const { data } = await sb.storage.from('media').createSignedUrls(fl.map(x => x.storage_path), 3600); const m: Record<string, string> = {}; (data || []).forEach(x => { if (x.path && x.signedUrl) m[x.path] = x.signedUrl }); setUrls(m) }
  }, [id])

  const startUpload = useCallback(async (rec: PendingRec) => {
    const url = URL.createObjectURL(rec.blob)
    setUps(u => ({ ...u, [rec.key]: { status: 'uploading', pct: 0, url, kind: rec.kind, rec } }))
    await savePending(rec)
    try {
      await uploadAndAttach(rec, pct => setUps(u => u[rec.key] ? { ...u, [rec.key]: { ...u[rec.key], pct, status: pct >= 100 ? 'saving' : 'uploading' } } : u))
      await dropPending(rec.key); await loadFiles(); setSavedAt(new Date())
      setUps(u => { const n = { ...u }; delete n[rec.key]; return n })
    } catch (e) {
      setUps(u => ({ ...u, [rec.key]: { ...(u[rec.key] || { url, kind: rec.kind, rec, pct: 0 }), status: 'failed', err: errMsg(e) } }))
    }
  }, [loadFiles])

  useEffect(() => {
    let off = false
    ;(async () => {
      setLoading(true)
      const { data, error } = await sb.from('assignments').select('*').eq('id', id!).maybeSingle()
      if (off) return
      if (error || !data) { setErr('This assignment could not be found.'); setLoading(false); return }
      const as = data as Assignment; setA(as)
      await loadFiles()
      const total = as.pages.length
      setIdx(as.status === 'not_started' ? -1 : ['submitted', 'approved', 'under_review'].includes(as.status) ? total : Math.min(as.last_page, total))
      setLoading(false)
      // resume uploads that were interrupted on this device
      const pend = await listPending(as.id)
      if (pend.length && ['not_started', 'in_progress', 'revision_requested'].includes(as.status)) { toast(`Resuming ${pend.length} upload${pend.length > 1 ? 's' : ''}`); pend.forEach(startUpload) }
    })()
    return () => { off = true }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const busyUploads = Object.values(ups).some(u => u.status !== 'failed')
  useEffect(() => { const w = (e: BeforeUnloadEvent) => { if (busyUploads) e.preventDefault() }; window.addEventListener('beforeunload', w); return () => window.removeEventListener('beforeunload', w) }, [busyUploads])

  const openRR = useMemo(() => rr.filter(r => !r.resolved_at), [rr])
  if (loading) return <div className="phone"><Loading /></div>
  if (err || !a || idx === null) return <div className="phone"><ErrorBox msg={err} /><Link className="link" to="/creator">Back to assignments</Link></div>

  const total = a.pages.length
  const wsName = creatorOf.find(w => w.id === a.workspace_id)?.name || 'Your agency'
  const editableStatus = ['not_started', 'in_progress', 'revision_requested'].includes(a.status)
  const pageEditable = (p: Page) => a.status === 'revision_requested' ? openRR.some(r => r.page_id === p.id) : editableStatus
  const fileAt = (p: Page, key: string) => files.find(f => f.page_id === p.id && f.slot_key === key)
  const pageReq = (p: Page) => { const s = slotsFor(p).filter(x => x.required); return { need: s.length, have: s.filter(x => fileAt(p, x.key)).length } }
  const pageDone = (p: Page) => p.kind === 'info' || pageReq(p).have >= pageReq(p).need
  const missing = a.pages.filter(p => !pageDone(p))
  const allReq = a.pages.reduce((n, p) => n + pageReq(p).need, 0)

  function go(i: number) {
    const n = Math.max(-1, Math.min(total, i)); setIdx(n); window.scrollTo(0, 0)
    if (editableStatus && n >= 0 && n < total) sb.rpc('save_progress', { a_id: a!.id, page: n }).then(({ error }) => { if (!error) setSavedAt(new Date()) })
    if (a!.status === 'not_started' && n >= 0) setA({ ...a!, status: 'in_progress' })
  }
  function pick(page: Page, slot: Slot) { target.current = { page, slot }; const inp = fileIn.current!; inp.accept = slot.type === 'photo' ? 'image/*' : slot.type === 'video' ? 'video/*' : 'image/*,video/*'; inp.value = ''; inp.click() }
  async function onPicked(f: File | undefined) {
    const t = target.current; if (!f || !t) return
    const isVid = f.type.startsWith('video') || /\.(mov|mp4|m4v|webm)$/i.test(f.name), isImg = f.type.startsWith('image') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name)
    if (t.slot.type === 'photo' && !isImg) return toast('This slot needs a photo')
    if (t.slot.type === 'video' && !isVid) return toast('This slot needs a video')
    if (f.size > 1024 ** 3) return toast('That file is over 1 GB. Trim it and try again.')
    const meta = await mediaMeta(f)
    queue(t.page, t.slot, f, isVid ? 'video' : 'photo', { smoothing: null, name: f.name, ...meta })
  }
  function queue(page: Page, slot: Slot, blob: Blob, kind: 'photo' | 'video', meta: PendingRec['meta']) {
    const rec: PendingRec = { key: pendingKey(a!.id, page.id, slot.key), assignmentId: a!.id, workspaceId: a!.workspace_id, pageId: page.id, slot: slot.key, kind, blob, meta, createdAt: Date.now() }
    startUpload(rec)
  }
  function onCam(r: CamResult) {
    const t = cam!; setCam(null)
    const ext = r.blob.type.includes('webm') ? 'webm' : r.kind === 'photo' ? 'jpg' : 'mp4'
    queue(t.page, t.slot, r.blob, r.kind, { smoothing: r.smoothing, width: r.width, height: r.height, duration: r.duration, name: `${t.slot.key}.${ext}` })
  }
  async function removeFile(f: SFile) { const { error } = await sb.rpc('remove_file', { f_id: f.id }); if (error) toast(errMsg(error)); else { await loadFiles(); toast('Removed') } }
  async function submit() {
    setSubmitting(true)
    const { error } = await sb.rpc('submit_assignment', { a_id: a!.id })
    setSubmitting(false)
    if (error) return toast(errMsg(error))
    toast('Sent to ' + wsName); setA({ ...a!, status: 'submitted', submitted_at: new Date().toISOString() }); await loadFiles(); refresh()
  }
  const saveSmooth = (v: number) => { if (profile && v !== profile.smoothing) sb.from('profiles').update({ smoothing: v }).eq('id', profile.id).then(() => {}) }

  const header = <div className="row" style={{ paddingBottom: 12 }}>
    <button className="icon-btn" aria-label="Back to assignments" onClick={() => nav('/creator')}><IcX /></button>
    <div className="grow"><p style={{ fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</p>
      <p className="muted" style={{ fontSize: 12.5 }}>{busyUploads ? 'Uploading… keep this page open' : savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : wsName}</p></div>
    <StatusPill s={a.status} />
  </div>
  const segs = <div className="segs" role="navigation" aria-label="Pages" style={{ marginBottom: 20 }}>
    {a.pages.map((p, i) => <button key={p.id} aria-label={p.title} onClick={() => go(i)} className={i === idx ? 'cur' : (a.status === 'revision_requested' && openRR.some(r => r.page_id === p.id)) ? 'redo' : (p.kind === 'media' ? pageDone(p) && (files.some(f => f.page_id === p.id)) : i < (idx ?? 0)) ? 'done' : ''} />)}
    <button aria-label="Review and submit" onClick={() => go(total)} className={idx === total ? 'cur' : ''} />
  </div>

  // OVERVIEW
  if (idx === -1) return <div className="phone">
    {header}
    <div className="stack">
      <p className="eyebrow">{wsName} · {a.category_name || 'Assignment'}</p>
      <h1 className="ph-title">{a.title}</h1>
      {a.summary && <p className="body-text">{a.summary}</p>}
      <div className="card stack" style={{ gap: 6 }}>
        <div className="between"><span className="muted">Pages</span><b>{total}</b></div>
        <div className="between"><span className="muted">Required files</span><b>{allReq}</b></div>
        <div className="between"><span className="muted">Deadline</span><b>{dueLabel(a.due_at)}</b></div>
      </div>
      <p className="muted" style={{ fontSize: 13.5 }}>Go page by page. Everything saves as you go, so you can stop and come back on any device. Nothing reaches {wsName} until you press Submit at the end.</p>
    </div>
    <div className="foot" style={{ gridTemplateColumns: '1fr' }}><button className="btn lg primary" onClick={() => go(0)}>Start: {a.pages[0]?.title}<IcNext /></button></div>
  </div>

  // REVIEW & SUBMIT
  if (idx === total) {
    const locked = !editableStatus
    return <div className="phone">
      {header}{segs}
      <div className="stack" style={{ marginBottom: 14 }}><p className="eyebrow">{locked ? fmtDate(a.submitted_at) : 'Last step'}</p>
        <h1 className="ph-title">{a.status === 'approved' ? 'Approved' : locked ? 'Submitted' : 'Review & submit'}</h1>
        {locked && <p className="muted">{a.status === 'approved' ? `${wsName} approved this. Nice work.` : `${wsName} has it. You'll get a notification if they approve it or ask for a redo.`}</p>}</div>
      <div className="list">{a.pages.map((p, i) => { const r = pageReq(p); const pf = files.filter(f => f.page_id === p.id)
        return <button key={p.id} className="card click tight" onClick={() => go(i)} style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
          <div className="grow"><b>{p.title}</b><p className="muted" style={{ fontSize: 13 }}>{p.kind === 'info' ? 'Instructions' : `${r.have} of ${r.need} required${pf.length > r.have ? ` · ${pf.length - r.have} extra` : ''}`}</p></div>
          {p.kind === 'info' ? <span className="pill todo">Read</span> : openRR.some(x => x.page_id === p.id) && a.status === 'revision_requested' ? <span className="pill bad">Redo</span> : pageDone(p) ? <span className="pill ok">Ready</span> : <span className="pill wait">Missing</span>}
        </button> })}</div>
      <div className="foot" style={{ gridTemplateColumns: '1fr' }}>
        {!locked && <><p className="muted" style={{ textAlign: 'center', fontSize: 13.5 }}>{busyUploads ? 'Wait for uploads to finish.' : missing.length ? `${missing.length} page${missing.length > 1 ? 's' : ''} still need files.` : 'Everything is ready.'} Nothing reaches {wsName} until you submit.</p>
          <button className="btn lg primary" onClick={submit} disabled={submitting || busyUploads || missing.length > 0 || Object.values(ups).some(u => u.status === 'failed')}>{submitting ? 'Sending…' : `Submit to ${wsName}`}</button></>}
        {locked && <Link className="btn lg ghost" to="/creator">Back to assignments</Link>}
      </div>
    </div>
  }

  // PAGE
  const p = a.pages[idx]; const editable = pageEditable(p)
  const slots = slotsFor(p); const req = pageReq(p)
  const pageRR = openRR.filter(r => r.page_id === p.id)
  const next = idx + 1 < total ? 'Next: ' + a.pages[idx + 1].title : 'Review & submit'
  return <div className="phone">
    {header}{segs}
    <div className="stack" style={{ gap: 6, marginBottom: 16 }}>
      <p className="eyebrow">Page {idx + 1} of {total}{p.kind === 'info' ? ' · Read first' : ''}</p>
      <h1 className="ph-title">{p.title}</h1>
      {p.kind === 'media' && <div className="reqs" style={{ marginTop: 4 }}>
        {p.photos_min > 0 && <span className="req">{p.photos_min === p.photos_max ? p.photos_min : `${p.photos_min}–${p.photos_max}`} photo{p.photos_max > 1 ? 's' : ''}</span>}
        {p.videos_min > 0 && <span className="req">{p.videos_min === p.videos_max ? p.videos_min : `${p.videos_min}–${p.videos_max}`} video{p.videos_max > 1 ? 's' : ''}</span>}
        {(p.photos_max > p.photos_min || p.videos_max > p.videos_min) && <span className="req opt">more allowed</span>}
        {p.extras > 0 && <span className="req opt">+{p.extras} extras optional</span>}</div>}
    </div>
    {pageRR.map(r => <div key={r.id} className="redo-note" style={{ marginBottom: 12 }}><b>Redo requested</b>{r.note ? ` — ${r.note}` : ''}</div>)}
    {p.kind === 'info' ? <div className="card"><ul className="tips">{(p.body || 'No instructions.').split('\n').filter(Boolean).map((t, i) => <li key={i}><IcTick /><span>{t}</span></li>)}</ul></div> : <>
      {(p.body || p.guidance) && <div className="card stack" style={{ gap: 6 }}><p className="eyebrow">Instructions</p>{p.body && <p className="body-text">{p.body}</p>}{p.guidance && <p className="muted" style={{ fontSize: 13.5 }}>{p.guidance}</p>}</div>}
      <div className="between" style={{ margin: '20px 0 10px' }}><h2 style={{ fontSize: 17 }}>Your files</h2><span className="mono muted">{req.have} of {req.need} required</span></div>
      <div className="slots">{slots.map(s => {
        const k = pendingKey(a.id, p.id, s.key), up = ups[k], f = fileAt(p, s.key), u = f ? urls[f.storage_path] : undefined
        if (up) return <button key={s.key} className="slot filled" onClick={() => up.status === 'failed' ? startUpload(up.rec) : undefined} aria-label={`${s.label}, ${up.status}`}>
          {up.kind === 'video' ? <video src={up.url} muted playsInline preload="metadata" /> : <img src={up.url} alt="" />}
          <span className={'st ' + (up.status === 'failed' ? 'fail' : 'up')}>{up.status === 'failed' ? 'Retry' : up.status === 'saving' ? 'Saving' : up.pct + '%'}</span>
          {up.status !== 'failed' && <span className="prog"><i style={{ width: up.pct + '%' }} /></span>}
          <span className="tag">{s.label}</span></button>
        if (f) return <button key={s.key} className="slot filled" onClick={() => setViewer({ page: p, slot: s })} aria-label={`${s.label}, saved. Tap to view`}>
          {u && (f.kind === 'video' ? <video src={u + '#t=0.1'} muted playsInline preload="metadata" /> : <img src={u} alt="" />)}
          <span className="st ok"><IcCheck /></span><span className="tag">{f.kind === 'video' ? 'VID' : 'IMG'}{f.smoothing ? ' · S' + f.smoothing : ''}</span></button>
        return <button key={s.key} className={'slot' + (s.required ? ' need' : '') + (editable ? '' : ' locked')} disabled={!editable} onClick={() => setSheet({ page: p, slot: s })}>
          {s.type === 'video' ? <IcVid /> : s.type === 'photo' ? <IcCam /> : <IcPlus />}<span>{s.label}</span></button>
      })}</div>
      <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>{editable ? 'Tap a slot to film or upload. Each file lands in the right place automatically.' : a.status === 'revision_requested' ? 'This page is locked. Only the pages marked Redo can be changed.' : 'Submitted pages are locked.'}</p>
      {Object.values(ups).some(x => x.status === 'failed' && x.rec.pageId === p.id) && <p className="err" style={{ marginTop: 10 }}>An upload failed: {Object.values(ups).find(x => x.status === 'failed' && x.rec.pageId === p.id)?.err}. Tap the slot to retry.</p>}
    </>}
    <div className="foot"><button className="btn lg ghost" aria-label="Previous page" onClick={() => go(idx - 1)}><IcBack /></button>
      <button className="btn lg primary" onClick={() => go(idx + 1)}>{next}<IcNext /></button></div>

    <input ref={fileIn} type="file" hidden onChange={e => onPicked(e.target.files?.[0])} />
    {sheet && <Modal title={`${sheet.page.title} · ${sheet.slot.label}`} onClose={() => setSheet(null)}>
      {sheet.slot.type !== 'video' && <button className="opt" onClick={() => { setCam(sheet); setSheet(null) }}><IcCam /><span>Take photo<small>Camera with skin smoothing</small></span></button>}
      {sheet.slot.type !== 'photo' && <button className="opt" onClick={() => { setCam(sheet); setSheet(null) }}><IcVid /><span>Record video<small>Camera with skin smoothing</small></span></button>}
      <button className="opt" onClick={() => { pick(sheet.page, sheet.slot); setSheet(null) }}><IcLib /><span>Choose from device<small>{sheet.slot.type === 'photo' ? 'A photo you already took' : sheet.slot.type === 'video' ? 'A video you already took' : 'Photo or video'}</small></span></button>
    </Modal>}
    {viewer && (() => { const f = fileAt(viewer.page, viewer.slot.key); if (!f) return null; const u = urls[f.storage_path]; const can = pageEditable(viewer.page)
      return <Modal title={`${viewer.page.title} · ${viewer.slot.label}`} onClose={() => setViewer(null)}>
        {u ? (f.kind === 'video' ? <video className="vmedia" src={u} controls playsInline autoPlay /> : <img className="vmedia" src={u} alt={viewer.slot.label} />) : <Loading />}
        <p className="mono muted">{f.width && f.height ? `${f.width} × ${f.height} · ` : ''}{f.smoothing ? `smoothing ${f.smoothing} · ` : ''}saved {fmtDate(f.created_at)}</p>
        {can && <div className="row"><button className="btn ghost grow" onClick={() => { setSheet(viewer); setViewer(null) }}>Replace</button><button className="btn danger grow" onClick={() => { removeFile(f); setViewer(null) }}>Remove</button></div>}
      </Modal> })()}
    {cam && <Camera accept={cam.slot.type} title={`${cam.page.title} · ${cam.slot.label}`} initialSmooth={profile?.smoothing ?? 45} onSmooth={saveSmooth} onUse={onCam} onClose={() => setCam(null)} />}
  </div>
}
