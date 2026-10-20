import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import JSZip from 'jszip'
import { sb, errMsg } from '../lib/supabase'
import { useAsync, Loading, ErrorBox, useToast, StatusPill, Modal } from '../lib/ui'
import { deliveryName, dueLabel, extOf, fmtBytes, fmtDate, slotsFor, type Assignment, type Page, type RevisionReq, type SFile } from '../lib/types'

interface Rev { id: string; action: string; note: string; created_at: string }
function saveBlob(blob: Blob, name: string) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000) }

export default function ReviewDetail() {
  const { id } = useParams(); const toast = useToast()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [redo, setRedo] = useState<Record<string, string> | null>(null); const [msg, setMsg] = useState(''); const [approve, setApprove] = useState(false)
  const [busy, setBusy] = useState(false); const [zipState, setZipState] = useState<string | null>(null); const [cancel, setCancel] = useState(false)
  const { data, loading, error, reload } = useAsync(async () => {
    const [a, f, rr, rv] = await Promise.all([
      sb.from('assignments').select('*, profiles(full_name,email)').eq('id', id!).single(),
      sb.from('submission_files').select('*').eq('assignment_id', id!).order('created_at'),
      sb.from('revision_requests').select('*').eq('assignment_id', id!).order('created_at', { ascending: false }),
      sb.from('reviews').select('*').eq('assignment_id', id!).order('created_at', { ascending: false }),
    ])
    if (a.error) throw a.error
    return { a: a.data as Assignment & { profiles: { full_name: string; email: string } | null }, files: (f.data || []) as SFile[], rr: (rr.data || []) as RevisionReq[], rv: (rv.data || []) as Rev[] }
  }, [id])
  useEffect(() => {
    if (!data) return
    const cur = data.files.filter(f => f.is_current)
    if (!cur.length) return
    sb.storage.from('media').createSignedUrls(cur.map(f => f.storage_path), 3600).then(({ data: s }) => {
      const m: Record<string, string> = {}; (s || []).forEach(x => { if (x.signedUrl && x.path) m[x.path] = x.signedUrl }); setUrls(m)
    })
  }, [data])
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  const { a } = data
  const creator = a.profiles?.full_name || 'Creator'
  const current = data.files.filter(f => f.is_current)
  const fileAt = (p: Page, key: string) => current.find(f => f.page_id === p.id && f.slot_key === key)
  const openRR = data.rr.filter(r => !r.resolved_at)
  const canReview = a.status === 'submitted' || a.status === 'under_review'
  const nameFor = (f: SFile) => { const pi = a.pages.findIndex(p => p.id === f.page_id); return deliveryName(creator, a.title, a.pages[pi], pi, f.slot_key, extOf(f.mime, f.original_name)) }

  async function dl(files: SFile[], label: string) {
    if (!files.length) return toast('No files to download')
    try {
      if (files.length === 1) { setZipState('Downloading…'); const r = await fetch(urls[files[0].storage_path]); saveBlob(await r.blob(), nameFor(files[0])) }
      else {
        const zip = new JSZip(); let i = 0
        for (const f of files) { setZipState(`Packing ${++i} of ${files.length}…`); const r = await fetch(urls[f.storage_path]); if (!r.ok) throw new Error('A file could not be fetched. Refresh and try again.'); zip.file(nameFor(f), await r.blob()) }
        setZipState('Building ZIP…')
        saveBlob(await zip.generateAsync({ type: 'blob' }), `${creator}_${a.title}_${label}.zip`.replace(/[^A-Za-z0-9_.-]+/g, ''))
      }
      sb.rpc('log_download', { a_id: a.id, what: label })
    } catch (e) { toast(errMsg(e)) } finally { setZipState(null) }
  }
  async function doApprove() { setBusy(true); const { error } = await sb.rpc('approve_assignment', { a_id: a.id, msg }); setBusy(false); if (error) return toast(errMsg(error)); toast('Approved'); setApprove(false); setMsg(''); reload() }
  async function doRedo() {
    const items = Object.entries(redo || {}).map(([page_id, note]) => ({ page_id, note }))
    if (!items.length) return toast('Tick at least one page')
    setBusy(true); const { error } = await sb.rpc('request_revisions', { a_id: a.id, items, msg }); setBusy(false)
    if (error) return toast(errMsg(error)); toast('Sent back to ' + creator); setRedo(null); setMsg(''); reload()
  }
  async function doCancel() { const { error } = await sb.rpc('cancel_assignment', { a_id: a.id }); if (error) toast(errMsg(error)); else { toast('Cancelled'); reload() } setCancel(false) }

  return <>
    <div className="page-title"><div><Link className="link" to="/agency/review">← Review</Link>
      <h1 style={{ marginTop: 6 }}>{a.title}</h1>
      <p className="muted" style={{ marginTop: 4 }}>{creator} · {a.category_name || 'No label'} · sent {fmtDate(a.release_at)} · {a.submitted_at ? 'submitted ' + fmtDate(a.submitted_at) : dueLabel(a.due_at)}</p></div>
      <div className="row wrap"><StatusPill s={a.status} />
        <button className="btn ghost" onClick={() => dl(current, 'All')} disabled={!current.length || !!zipState}>{zipState || `Download all (${current.length})`}</button>
        {canReview && <><button className="btn ghost" onClick={() => setRedo({})}>Request redo</button><button className="btn primary" onClick={() => setApprove(true)}>Approve</button></>}</div></div>
    {openRR.length > 0 && <div className="notice">Waiting on the creator to redo {openRR.length} page{openRR.length === 1 ? '' : 's'}.</div>}
    {a.pages.map((p, pi) => {
      const slots = slotsFor(p); const pageFiles = slots.map(s => fileAt(p, s.key)).filter(Boolean) as SFile[]
      const rrs = data.rr.filter(r => r.page_id === p.id)
      return <section key={p.id} className="card stack">
        <div className="between wrap"><div><span className="eyebrow">Page {pi + 1}</span><h3>{p.title}</h3></div>
          {p.kind === 'media' && <button className="btn sm ghost" onClick={() => dl(pageFiles, String(pi + 1).padStart(2, '0') + '-' + p.title)} disabled={!pageFiles.length || !!zipState}>Download page</button>}</div>
        {p.kind === 'info' ? <p className="muted body-text">{p.body || 'Instructions only'}</p> : <>
          <div className="media-grid">{slots.map(s => { const f = fileAt(p, s.key); if (!f) return <div key={s.key} className="mtile empty-slot">{s.label}{s.required ? ' · missing' : ''}</div>
            const u = urls[f.storage_path]
            return <div key={s.key} className="mtile">
              {u ? (f.kind === 'video' ? <video src={u} controls playsInline preload="metadata" /> : <a href={u} target="_blank" rel="noreferrer"><img src={u} alt={s.label} loading="lazy" /></a>) : null}
              <div className="cap"><span>{s.label}</span><span>{fmtBytes(f.size_bytes)}{f.smoothing ? ' · S' + f.smoothing : ''}</span></div>
            </div> })}</div>
          {rrs.map(r => <div key={r.id} className="redo-note"><b>{r.resolved_at ? 'Redo done' : 'Redo requested'}</b> · {fmtDate(r.created_at)}{r.note && <> — {r.note}</>}</div>)}
        </>}
      </section>
    })}
    {data.rv.length > 0 && <section className="stack"><h2 style={{ fontSize: 18 }}>History</h2><div className="list">{data.rv.map(r => <div key={r.id} className="card tight"><b>{r.action === 'approved' ? 'Approved' : r.action === 'revision_requested' ? 'Redo requested' : r.action}</b> <span className="mono muted">{fmtDate(r.created_at)}</span>{r.note && <p className="muted">{r.note}</p>}</div>)}</div></section>}
    <p className="muted" style={{ fontSize: 13 }}>{data.files.length - current.length > 0 ? `${data.files.length - current.length} replaced file version(s) kept for the record. ` : ''}{!['approved', 'cancelled'].includes(a.status) && <button className="link" onClick={() => setCancel(true)}>Cancel this assignment</button>}</p>

    {approve && <Modal center title={`Approve ${a.title}?`} onClose={() => setApprove(false)}>
      <label className="field"><span>Note to {creator} (optional)</span><textarea id="apnote" className="textarea" value={msg} onChange={e => setMsg(e.target.value)} placeholder="Great set, thanks" /></label>
      <button className="btn lg primary block" disabled={busy} onClick={doApprove}>Approve</button></Modal>}
    {redo && <Modal center title="Which pages need redoing?" onClose={() => setRedo(null)}>
      <p className="muted" style={{ fontSize: 13 }}>{creator} can only change the pages you tick. Everything else stays locked as submitted.</p>
      <div className="list" style={{ maxHeight: 320, overflow: 'auto' }}>{a.pages.filter(p => p.kind === 'media').map(p => { const on = redo[p.id] !== undefined
        return <div key={p.id} className="card tight stack" style={{ gap: 8 }}>
          <label className="check"><input type="checkbox" checked={on} onChange={e => { const n = { ...redo }; if (e.target.checked) n[p.id] = ''; else delete n[p.id]; setRedo(n) }} /><b>{p.title}</b></label>
          {on && <input className="input" aria-label={'Note for ' + p.title} placeholder="What to change" value={redo[p.id]} onChange={e => setRedo({ ...redo, [p.id]: e.target.value })} />}</div> })}</div>
      <label className="field"><span>Overall note (optional)</span><input id="redomsg" className="input" value={msg} onChange={e => setMsg(e.target.value)} /></label>
      <button className="btn lg primary block" disabled={busy || !Object.keys(redo).length} onClick={doRedo}>Send back for redo</button></Modal>}
    {cancel && <Modal center title="Cancel this assignment?" onClose={() => setCancel(false)}>
      <p className="muted">The creator won't be able to work on it any more. Files already uploaded are kept.</p>
      <div className="row"><button className="btn ghost grow" onClick={() => setCancel(false)}>Keep</button><button className="btn danger grow" onClick={doCancel}>Cancel assignment</button></div></Modal>}
  </>
}
