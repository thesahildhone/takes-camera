import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { Loading, ErrorBox, useToast, Modal } from '../lib/ui'
import { uploadObject } from '../lib/upload'
import { videoMeta } from '../lib/media'
import { aiWrite } from '../lib/ai'
import { getCaps, importReference, processReference, PLACEHOLDER_TITLES, type Caps } from '../lib/refpipe'
import { uid, fmtDate } from '../lib/types'
import { fmtDur, MODE_LABEL, parseRef, readyProblem, RIGHTS_LABEL, SA_LABEL, SA_TONE, signed, usesAudio, usesScript, type Mode, type Project, type Rights, type SAssignment, type Section, type ContentType } from '../lib/social'
import ShotView from '../components/ShotView'

interface CreatorRow { creator_id: string; profiles: { full_name: string; email: string } | null }
const MAX_REF = 500 * 1024 * 1024, MAX_SECS = 600
const OK_EXT = /\.(mp4|mov|m4v|webm)$/i

export default function ProjectEditor() {
  const { id } = useParams(); const { ws } = useWs(); const toast = useToast(); const nav = useNavigate()
  const [p, setP] = useState<Project | null>(null); const [err, setErr] = useState<string | null>(null)
  const [sections, setSections] = useState<(Section & { typeName: string })[]>([])
  const [creators, setCreators] = useState<CreatorRow[]>([]); const [asg, setAsg] = useState<SAssignment[]>([])
  const [f, setF] = useState({ title: '', description: '', mode: 'talking' as Mode, instructions: '', script: '', rights: 'unknown' as Rights, keep_mic: true, url: '', section_id: '' })
  const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [stage, setStage] = useState<string | null>(null); const [upPct, setUpPct] = useState<number | null>(null)
  const [pick, setPick] = useState<Record<string, boolean>>({}); const [due, setDue] = useState('')
  const [preview, setPreview] = useState(false); const [confirmReplace, setConfirmReplace] = useState<null | (() => void)>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileIn = useRef<HTMLInputElement>(null); const processing = useRef(false)
  const [caps, setCaps] = useState<Caps | null>(null); const [polishing, setPolishing] = useState(false)
  useEffect(() => { getCaps().then(setCaps) }, [])

  const load = useCallback(async () => {
    const [r, s, t, c, a] = await Promise.all([
      sb.from('social_projects').select('*').eq('id', id!).maybeSingle(),
      sb.from('social_sections').select('*').eq('workspace_id', ws!.id).order('position'),
      sb.from('social_content_types').select('*').eq('workspace_id', ws!.id).order('position'),
      sb.from('creator_memberships').select('creator_id,profiles(full_name,email)').eq('workspace_id', ws!.id).eq('status', 'active'),
      sb.from('social_assignments').select('*').eq('project_id', id!),
    ])
    if (r.error || !r.data) { setErr('This shot could not be found.'); return null }
    const proj = r.data as Project; setP(proj)
    const tn = Object.fromEntries(((t.data || []) as ContentType[]).map(x => [x.id, x.name]))
    setSections(((s.data || []) as Section[]).filter(x => !x.archived_at || x.id === proj.section_id).map(x => ({ ...x, typeName: tn[x.content_type_id] || '' })))
    setCreators((c.data || []) as unknown as CreatorRow[]); setAsg((a.data || []) as SAssignment[])
    setUrls(await signed([proj.ref_video_path, proj.ref_audio_path]))
    return proj
  }, [id, ws])

  useEffect(() => { load().then(proj => { if (proj) { setF({ title: proj.title, description: proj.description, mode: proj.mode, instructions: proj.instructions, script: proj.script, rights: proj.rights_status, keep_mic: proj.keep_mic, url: proj.reference_url || '', section_id: proj.section_id }); setDirty(false) } }) }, [load])
  useEffect(() => { const w = (e: BeforeUnloadEvent) => { if (dirty || stage || upPct !== null) e.preventDefault() }; window.addEventListener('beforeunload', w); return () => window.removeEventListener('beforeunload', w) }, [dirty, stage, upPct])

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF(x => ({ ...x, [k]: v })); setDirty(true) }
  async function patch(fields: Partial<Project>) {
    const { data, error } = await sb.from('social_projects').update(fields).eq('id', id!).select('*').single()
    if (error) throw error; setP(data as Project); return data as Project
  }

  // pull the sound out of the stored reference, and the script for talking shots
  const processRef = useCallback(async (proj: Project, blob?: Blob) => {
    if (processing.current || !proj.ref_video_path) return
    processing.current = true
    try {
      const done = await processReference(proj, setStage, blob)
      setP(done); setUrls(await signed([done.ref_video_path, done.ref_audio_path]))
      if (usesScript(done.mode)) {
        setF(x => ({ ...x, script: done.script, title: PLACEHOLDER_TITLES.includes(x.title) ? done.title : x.title }))
        toast(done.transcript_status === 'ready' ? 'Script is in. Check it, then approve it.' : done.transcript_error || 'Transcript failed. You can type the script.')
      } else if (done.audio_status === 'failed') toast(done.audio_error || 'Could not pull out the sound.')
    } catch (e) { toast(errMsg(e)) } finally { processing.current = false; setStage(null) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <><Link className="link" to="/agency/socials">← Socials</Link><ErrorBox msg={err} /></>
  if (!p) return <Loading />
  const ref = parseRef(f.url)
  const resetsWork = p.transcript_approved || p.audio_status === 'ready'
  const why = readyProblem({ ...p })
  const sectionName = sections.find(s => s.id === p.section_id)?.title || ''

  async function save() {
    setSaving(true)
    try {
      const scriptChanged = f.script !== p!.script
      const urlChanged = (f.url.trim() || null) !== p!.reference_url
      await patch({ title: f.title.trim() || 'Untitled shot', description: f.description, mode: f.mode, instructions: f.instructions, script: f.script, section_id: f.section_id,
        rights_status: f.rights, keep_mic: f.keep_mic, ...(scriptChanged ? { transcript_approved: false } : {}),
        ...(urlChanged ? { reference_url: f.url.trim() || null, ref_platform: parseRef(f.url)?.platform || null, ...(p!.ref_video_path ? {} : { import_status: f.url.trim() ? 'link_only' : 'none', import_error: null }) } : {}) } as Partial<Project>)
      setDirty(false); toast(scriptChanged && p!.transcript_approved ? 'Saved. Script changed, so approve it again.' : 'Saved')
    } catch (e) { toast(errMsg(e)) } finally { setSaving(false) }
  }
  async function runImport() {
    const url = f.url.trim(); if (!url) return toast('Paste a link first')
    if (!parseRef(url)) return toast('That is not a valid link')
    const go = async () => {
      setStage('Saving the link…')
      try {
        // the link and every field are saved before any import attempt, so a failure never loses work
        await patch({ title: f.title.trim() || 'Untitled shot', description: f.description, mode: f.mode, instructions: f.instructions, script: f.script, section_id: f.section_id, rights_status: f.rights, keep_mic: f.keep_mic,
          reference_url: url, ref_platform: parseRef(url)?.platform || null } as Partial<Project>)
        setDirty(false); setStage(parseRef(url)?.platform === 'file' || parseRef(url)?.platform === 'other' ? 'Importing the video…' : 'Downloading the video from the link. This can take up to a minute…')
        const proj = await importReference(id!)
        setP(proj); setUrls(await signed([proj.ref_video_path, proj.ref_audio_path])); setStage(null)
        if (proj.import_status === 'ready') { toast('Video imported'); processRef(proj) }
      } catch (e) { setStage(null); toast(errMsg(e)) }
    }
    if (resetsWork && p!.ref_video_path) setConfirmReplace(() => go); else go()
  }
  function chooseFile() { const go = () => { if (fileIn.current) { fileIn.current.value = ''; fileIn.current.click() } }; if (resetsWork) setConfirmReplace(() => go); else go() }
  async function onFile(file: File | undefined) {
    if (!file) return
    const isVid = file.type.startsWith('video/') || OK_EXT.test(file.name)
    if (!isVid) return toast('Choose an MP4, MOV or WEBM video')
    if (file.size > MAX_REF) return toast('That video is over 500 MB. Upload a shorter or compressed copy.')
    if (!file.size) return toast('That file is empty')
    let meta: { duration: number }
    try { meta = await videoMeta(file) } catch (e) { return toast(errMsg(e)) }
    if (meta.duration > MAX_SECS) return toast('Reference videos can be up to 10 minutes')
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace('m4v', 'mp4')
    const mime = file.type && ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'].includes(file.type) ? file.type : ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4'
    const path = `${p!.workspace_id}/ref/${p!.id}/${uid()}.${ext}`
    try {
      await patch({ import_status: 'uploading', import_error: null } as Partial<Project>)
      setUpPct(0)
      await uploadObject(path, new Blob([file], { type: mime }), setUpPct, 'social')
      const proj = await patch({ ref_video_path: path, ref_mime: mime, import_status: 'ready', import_error: null, ref_duration: Math.round(meta.duration * 100) / 100,
        audio_status: 'none', ref_audio_path: null, transcript_status: 'none', transcript_approved: false } as Partial<Project>)
      setUrls(await signed([path])); setUpPct(null); toast('Uploaded')
      processRef(proj, file)
    } catch (e) {
      setUpPct(null); await patch({ import_status: p!.ref_video_path ? 'ready' : 'awaiting_upload', import_error: 'Upload failed: ' + errMsg(e) } as Partial<Project>).catch(() => {})
      toast('Upload failed. Your shot details are safe. Try again.')
    }
  }
  async function polish() {
    setPolishing(true)
    try { const r = await aiWrite<{ script: string }>(p!.workspace_id, 'polish', { script: f.script }); set('script', r.script); toast('Tightened. Read it, then approve.') }
    catch (e) { toast(errMsg(e)) } finally { setPolishing(false) }
  }
  async function approveScript() {
    if (!f.script.trim()) return toast('The script is empty')
    try { await patch({ script: f.script, transcript_approved: true } as Partial<Project>); setDirty(false); toast('Script approved') } catch (e) { toast(errMsg(e)) }
  }
  async function publish(on: boolean) {
    if (dirty) await save()
    const { error } = await sb.rpc('social_publish', { prj: id, on_off: on })
    if (error) return toast(errMsg(error)); toast(on ? 'Published. Assigned creators were notified.' : 'Back to draft. Creators no longer see it.'); load()
  }
  async function assign() {
    const ids = Object.keys(pick).filter(k => pick[k]); if (!ids.length) return
    const { error } = await sb.rpc('social_assign', { prj: id, creator_ids: ids, due: due ? new Date(due).toISOString() : null })
    if (error) return toast(errMsg(error)); setPick({}); toast(p!.publication_status === 'published' ? 'Assigned and notified' : 'Assigned. They get notified when you publish.'); load()
  }
  async function unassign(a: SAssignment) { const { error } = await sb.rpc('social_unassign', { asg: a.id }); if (error) toast(errMsg(error)); else load() }
  async function del() {
    const { error } = await sb.from('social_projects').delete().eq('id', id!)
    if (error) { toast('This shot has videos sent for it, so it was archived instead.'); await patch({ publication_status: 'archived' } as Partial<Project>) }
    nav('/agency/socials')
  }

  const name = (cid: string) => { const c = creators.find(x => x.creator_id === cid); return c?.profiles?.full_name || c?.profiles?.email || 'Creator' }
  const assignedIds = new Set(asg.filter(a => a.status !== 'cancelled').map(a => a.creator_id))
  const showWarning = p.import_status === 'failed' || p.import_status === 'awaiting_upload'
  const busy = !!stage || upPct !== null

  return <>
    <div className="page-title"><div><Link className="link" to="/agency/socials">← Socials</Link>
      <h1 style={{ marginTop: 6 }}>{p.title}</h1>
      <p className="muted" style={{ marginTop: 4 }}>{sectionName} · {MODE_LABEL[p.mode]} · {p.publication_status === 'published' ? `published ${fmtDate(p.published_at)}` : p.publication_status}</p></div>
      <div className="row wrap">
        <button className="btn ghost" onClick={() => setPreview(true)}>Preview creator view</button>
        <button className="btn ghost" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}</button>
        {p.publication_status === 'published' ? <button className="btn ghost" onClick={() => publish(false)}>Unpublish</button>
          : <button className="btn primary" disabled={!!why || busy} title={why || ''} onClick={() => publish(true)}>Publish</button>}
      </div></div>
    {p.publication_status === 'published' && <div className="notice">This shot is live. Changes you save show to assigned creators straight away.</div>}
    {p.publication_status !== 'published' && why && <div className="notice">Before publishing: {why}.</div>}
    {stage && <div className="notice" role="status"><b>Working:</b> {stage} Keep this tab open.</div>}

    <section className="card stack"><h3>Basics</h3>
      <label className="field"><span>Title (creators see this)</span><input id="pj-title" className="input" value={f.title} maxLength={160} onChange={e => set('title', e.target.value)} /></label>
      <div className="grid2">
        <label className="field"><span>Section</span><select className="select" value={f.section_id} onChange={e => set('section_id', e.target.value)}>{sections.map(s => <option key={s.id} value={s.id}>{s.typeName} · {s.title}</option>)}</select></label>
        <label className="field"><span>Type</span><select className="select" value={f.mode} disabled={p.publication_status === 'published'} onChange={e => set('mode', e.target.value as Mode)}>{(Object.keys(MODE_LABEL) as Mode[]).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></label>
      </div>
      {p.publication_status === 'published' && <p className="muted" style={{ fontSize: 13 }}>Unpublish to change the type.</p>}
      <label className="field"><span>Short description (optional, creators see this)</span><input id="pj-desc" className="input" value={f.description} onChange={e => set('description', e.target.value)} /></label>
    </section>

    <section className="card stack"><h3>Reference video</h3>
      <label className="field"><span>Instagram, TikTok, YouTube or direct video link</span>
        <div className="row"><input id="pj-url" className="input grow" value={f.url} onChange={e => set('url', e.target.value)} placeholder="https://www.instagram.com/reel/…" inputMode="url"
            onBlur={() => { const u = f.url.trim(); if (u && u !== (p.reference_url || '') && parseRef(u) && !p.ref_video_path && !busy) runImport() }} />
          <button className="btn ghost" disabled={busy || !f.url.trim()} onClick={runImport}>{p.import_status === 'importing' ? 'Importing…' : 'Import'}</button></div></label>
      <div className="row wrap"><button className="btn sm ghost" disabled={busy} onClick={chooseFile}>{p.ref_video_path ? 'Replace with a file' : 'Upload video file'}</button>
        <span className="muted" style={{ fontSize: 13 }}>MP4, MOV or WEBM · up to 500 MB and 10 minutes</span></div>
      {caps && <p className="muted" style={{ fontSize: 13 }}>{caps.link_import ? 'Instagram and TikTok links download automatically.' : 'Instagram and TikTok links show as an embedded player. Upload the file to get the script and sound.'} {caps.transcripts ? 'Scripts are written out automatically.' : 'Scripts are written out on a computer, not on a phone.'}</p>}
      {upPct !== null && <div className="stack" style={{ gap: 4 }}><div className="bar"><i style={{ width: upPct + '%' }} /></div><span className="mono muted">Uploading {upPct}%</span></div>}

      {showWarning && <div className="warnbox" role="alert">
        <b>Unable to import reference video</b>
        <p>We could not import this video automatically. You can upload a video file you have permission to use, and the app will still process it for your assignment.</p>
        {p.import_error && <p className="muted" style={{ fontSize: 13 }}>Reason: {p.import_error}</p>}
        {p.reference_url && <p className="mono" style={{ wordBreak: 'break-all' }}>{p.reference_url}</p>}
        <div className="row wrap"><button className="btn primary" onClick={chooseFile}>Upload Video File</button>
          <button className="btn ghost" onClick={runImport}>Retry Import</button>
          <button className="btn ghost" onClick={async () => { await patch({ import_status: 'link_only' } as Partial<Project>); toast(ref?.embed ? 'Saved. Creators will see the embedded player.' : 'Saved as a link only.') }}>Keep Link Only / Save Draft</button></div>
        {usesAudio(p.mode) && <p className="muted" style={{ fontSize: 13 }}>Dance and lip-sync shots need an uploaded file to play the sound during recording.</p>}
      </div>}

      {(p.ref_video_path || ref?.embed) && <div className="refprev"><ShotRefPreview p={p} url={p.ref_video_path ? urls[p.ref_video_path] : null} /></div>}
      {p.ref_video_path && <div className="statusgrid">
        <span>Video</span><b className="ok-t">Stored{p.ref_duration ? ` · ${fmtDur(p.ref_duration)}` : ''}</b>
        <span>Sound</span><b className={p.audio_status === 'ready' ? 'ok-t' : p.audio_status === 'failed' ? 'bad-t' : ''}>{p.audio_status === 'ready' ? 'Extracted' : p.audio_status === 'processing' ? 'Extracting…' : p.audio_status === 'failed' ? 'Failed: ' + (p.audio_error || '') : 'Not extracted'}</b>
        <span>Transcript</span><b className={p.transcript_status === 'ready' ? 'ok-t' : p.transcript_status === 'failed' ? 'bad-t' : ''}>{!usesScript(p.mode) ? 'Not needed' : p.transcript_status === 'ready' ? (p.transcript_approved ? 'Approved' : 'Needs your review') : p.transcript_status === 'processing' ? 'Working…' : p.transcript_status === 'failed' ? 'Failed: ' + (p.transcript_error || '') : 'Not started'}</b>
      </div>}
      {p.ref_video_path && !busy && (p.audio_status !== 'ready' || (usesScript(p.mode) && p.transcript_status !== 'ready')) &&
        <button className="btn sm ghost" onClick={() => processRef(p)}>{p.audio_status === 'failed' || p.transcript_status === 'failed' ? 'Retry processing' : 'Process reference'}</button>}
    </section>

    {usesScript(f.mode) && <section className="card stack">
      <div className="between wrap"><h3>Script</h3>{p.transcript_approved && f.script === p.script ? <span className="pill ok">Approved</span> : <span className="pill wait">Not approved</span>}</div>
      <p className="muted" style={{ fontSize: 13.5 }}>{p.transcript_status === 'ready' ? 'Written out from the reference. Speech-to-text makes mistakes, so read it and fix anything before approving.' : p.transcript_status === 'failed' ? (p.transcript_error || 'The script could not be written out automatically.') + ' You can type it here.' : 'Type the lines the creator should say, or add the reference video to have them written out for you.'}</p>
      <textarea id="pj-script" className="textarea" rows={5} value={f.script} onChange={e => set('script', e.target.value)} />
      {p.transcript_raw && p.transcript_raw.length > 0 && <details><summary className="link">Timestamps from the reference</summary>
        <div className="segs-list">{p.transcript_raw.map((s, i) => <div key={i}><span className="mono muted">{fmtDur(s.start)}</span> {s.text}</div>)}</div></details>}
      <div className="row wrap"><button className="btn ghost" disabled={polishing || !f.script.trim()} onClick={polish}>{polishing ? 'Working…' : 'Tighten with AI'}</button><button className="btn primary" disabled={!f.script.trim() || (p.transcript_approved && f.script === p.script)} onClick={approveScript}>Approve script</button></div>
    </section>}

    {usesAudio(f.mode) && <section className="card stack"><h3>Sound for recording</h3>
      {p.ref_audio_path && urls[p.ref_audio_path] ? <audio src={urls[p.ref_audio_path]} controls preload="none" /> : <p className="muted">No sound yet. Upload the reference video to extract it.</p>}
      <label className="field"><span>Music rights</span><select className="select" value={f.rights} onChange={e => set('rights', e.target.value as Rights)}>{(Object.keys(RIGHTS_LABEL) as Rights[]).map(r => <option key={r} value={r}>{RIGHTS_LABEL[r]}</option>)}</select></label>
      <p className="muted" style={{ fontSize: 13 }}>Creators always film against the sound and you always get a clean video without the music. A second copy with the music laid in is only made when this is set to Licensed. Extracting audio doesn't give you the right to reuse it.</p>
      <label className="check"><input type="checkbox" checked={f.keep_mic} onChange={e => set('keep_mic', e.target.checked)} />Keep the creator's microphone audio in the videos</label>
    </section>}

    <section className="card stack"><h3>Before you film</h3>
      <p className="muted" style={{ fontSize: 13.5 }}>Anything the creator should know. Each line shows as its own point. Hook, setup, delivery, links, whatever you like.</p>
      <textarea id="pj-ins" className="textarea" rows={7} value={f.instructions} onChange={e => set('instructions', e.target.value)} placeholder={'Hook: start talking while you sit down\nSetup: bedroom or gaming desk, face well lit\nDelivery: playful, eye contact'} />
      {dirty && <button className="btn primary" style={{ justifySelf: 'start' }} disabled={saving} onClick={save}>Save changes</button>}
    </section>

    <section className="card stack"><h3>Creators</h3>
      {asg.length > 0 && <div className="list">{asg.map(a => <div key={a.id} className="between card tight">
        <div><b>{name(a.creator_id)}</b><div className="muted" style={{ fontSize: 12.5 }}>{a.due_at ? 'Due ' + fmtDate(a.due_at) : 'No deadline'}</div></div>
        <div className="row"><span className={'pill ' + SA_TONE[a.status]}>{SA_LABEL[a.status]}</span>{a.status !== 'cancelled' && <button className="btn sm ghost" onClick={() => unassign(a)}>Remove</button>}</div></div>)}</div>}
      {creators.filter(c => !assignedIds.has(c.creator_id)).length === 0 ? <p className="muted">{creators.length ? 'Every creator in this workspace is assigned.' : 'No creators yet. Invite them from Creators.'}</p> : <>
        <div className="checks">{creators.filter(c => !assignedIds.has(c.creator_id)).map(c => <label key={c.creator_id} className="check"><input type="checkbox" checked={!!pick[c.creator_id]} onChange={e => setPick({ ...pick, [c.creator_id]: e.target.checked })} />{c.profiles?.full_name || c.profiles?.email}</label>)}</div>
        <div className="row wrap"><label className="field" style={{ minWidth: 220 }}><span>Deadline (optional)</span><input type="datetime-local" className="input" value={due} onChange={e => setDue(e.target.value)} /></label>
          <button className="btn primary" style={{ alignSelf: 'end' }} disabled={!Object.values(pick).some(Boolean)} onClick={assign}>Assign selected</button></div></>}
      <p className="muted" style={{ fontSize: 13 }}>Each creator gets their own progress and submissions. They only see this once it's published.</p>
    </section>

    <p className="muted" style={{ fontSize: 13 }}><button className="link" onClick={() => setConfirmDelete(true)}>Delete this shot</button></p>
    <input ref={fileIn} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm" hidden onChange={e => onFile(e.target.files?.[0])} />

    {confirmReplace && <Modal center title="Replace the reference?" onClose={() => setConfirmReplace(null)}>
      <p className="muted">The approved script and extracted sound come from the current reference. Replacing it means processing again and re-approving the script.</p>
      <div className="row"><button className="btn ghost grow" onClick={() => setConfirmReplace(null)}>Keep current</button><button className="btn primary grow" onClick={() => { const fn = confirmReplace; setConfirmReplace(null); fn() }}>Replace</button></div></Modal>}
    {confirmDelete && <Modal center title="Delete this shot?" onClose={() => setConfirmDelete(false)}>
      <p className="muted">If creators already sent videos for it, it's archived instead so nothing they sent is lost.</p>
      <div className="row"><button className="btn ghost grow" onClick={() => setConfirmDelete(false)}>Keep</button><button className="btn danger grow" onClick={del}>Delete</button></div></Modal>}
    {preview && <Modal title="What creators see" onClose={() => setPreview(false)}>
      <div className="soc preview-frame"><ShotView preview p={{ ...p, title: f.title, instructions: f.instructions, description: f.description, script: f.script, mode: f.mode, rights_status: f.rights }} sectionName={sectionName} index={0} total={1} status={null}
        refUrl={p.ref_video_path ? urls[p.ref_video_path] || null : null} audioUrl={p.ref_audio_path ? urls[p.ref_audio_path] : null}
        actions={<><button className="sbtn primary" disabled>Film it</button><button className="sbtn ghost" disabled>Choose from camera roll</button></>} /></div>
    </Modal>}
  </>
}

function ShotRefPreview({ p, url }: { p: Project; url: string | null }) {
  const ref = parseRef(p.reference_url)
  if (url) return <video src={url} controls playsInline preload="metadata" />
  if (ref?.embed) return <iframe src={ref.embed} title="Reference" allow="encrypted-media" loading="lazy" />
  return null
}
