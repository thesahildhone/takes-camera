import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { sb, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Loading, ErrorBox, useToast, Modal } from '../lib/ui'
import { uploadObject } from '../lib/upload'
import { decodeAudio, videoMeta } from '../lib/media'
import { assemble, primeAssembler } from '../lib/assemble'
import { dropDraft, loadDraft, ordered, saveDraft, clipLen, type Draft, draftKey } from '../lib/drafts'
import { fmtDate } from '../lib/types'
import { fmtDur, isToFilm, signed, usesAudio, type Project, type SAssignment, type Section, type Submission } from '../lib/social'
import ShotView from '../components/ShotView'
import SocialCamera from '../components/SocialCamera'
import { loadSocial, shotsIn } from './SocialHome'
import { CTop } from './CreatorApp'

const MAX_UP = 1024 ** 3
type Sending = { stage: string; pct: number; err?: string }

export default function SocialProject() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast()
  const { profile } = useAuth()
  const [p, setP] = useState<Project | null>(null); const [a, setA] = useState<SAssignment | null>(null); const [sec, setSec] = useState<Section | null>(null)
  const [pos, setPos] = useState({ i: 0, n: 1 }); const [subs, setSubs] = useState<Submission[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({}); const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [cam, setCam] = useState(false); const [audio, setAudio] = useState<AudioBuffer | null>(null); const [opening, setOpening] = useState(false)
  const [review, setReview] = useState<Draft | null>(null); const [sending, setSending] = useState<Sending | null>(null)
  const fileIn = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const d = await loadSocial(profile!.id)
    const proj = d.projects.find(x => x.id === id), asg = d.asg.find(x => x.project_id === id)
    if (!proj || !asg) { setErr("This shot isn't available. It may have been unpublished or removed by your agency."); return }
    const list = shotsIn(d, proj.section_id)
    setP(proj); setA(asg); setSec(d.sections.find(s => s.id === proj.section_id) || null); setPos({ i: Math.max(0, list.findIndex(x => x.p.id === proj.id)), n: list.length })
    const s = await sb.from('social_submissions').select('*').eq('assignment_id', asg.id).order('version', { ascending: false })
    setSubs((s.data || []) as Submission[])
    setUrls(await signed([proj.ref_video_path, proj.ref_audio_path]))
    setDraft(await loadDraft(asg.id))
  }, [id, profile])
  useEffect(() => { load() }, [load])
  useEffect(() => { const w = (e: BeforeUnloadEvent) => { if (sending && !sending.err) e.preventDefault() }; window.addEventListener('beforeunload', w); return () => window.removeEventListener('beforeunload', w) }, [sending])

  if (err) return <div className="phone soc"><CTop /><ErrorBox msg={err} /><Link className="link" to="/creator">Back</Link></div>
  if (!p || !a) return <div className="phone soc"><Loading /></div>
  const editable = isToFilm(a.status)
  const latest = subs[0]
  const dance = usesAudio(p.mode) && p.audio_status === 'ready' && !!p.ref_audio_path
  const draftClips = draft ? ordered(draft) : []

  async function openCam() {
    if (dance && !audio) {
      setOpening(true)
      try { const r = await fetch(urls[p!.ref_audio_path!]); setAudio(await decodeAudio(await r.blob())) }
      catch { toast("The sound couldn't load. Check your connection and try again."); setOpening(false); return }
      setOpening(false)
    }
    sb.rpc('social_start', { asg: a!.id }).then(() => {})
    setCam(true)
  }
  async function onPicked(f: File | undefined) {
    if (!f) return
    if (!(f.type.startsWith('video') || /\.(mov|mp4|m4v|webm)$/i.test(f.name))) return toast('Choose a video')
    if (f.size > MAX_UP) return toast('That video is over 1 GB. Trim it and try again.')
    let m: { width: number; height: number; duration: number }
    try { m = await videoMeta(f) } catch (e) { return toast(errMsg(e)) }
    const d: Draft = { key: draftKey(a!.id), assignmentId: a!.id, clips: [], order: [], updatedAt: Date.now(),
      out: { subId: crypto.randomUUID(), clean: f, mix: null, mixNote: null, duration: m.duration, width: m.width, height: m.height, source: 'upload', clips: 0, smoothing: null, uploaded: {} } }
    setReview(d)
  }

  async function send(d: Draft) {
    const primed = d.out ? null : primeAssembler() // must run inside the tap on iPhone
    let cur = d
    try {
      if (!cur.out) {
        const clips = ordered(cur)
        const licensed = p!.rights_status === 'licensed' && dance && !!audio
        setSending({ stage: 'Joining your clips…', pct: 0 })
        const res = await assemble({ clips, keepMic: p!.keep_mic, music: licensed ? audio : null, onPct: (pct, stage) => setSending({ stage, pct }) }, primed!)
        const sm = clips.length ? Math.round(clips.reduce((n, c) => n + c.smoothing, 0) / clips.length) : null
        cur = { ...cur, out: { subId: crypto.randomUUID(), clean: res.clean, mix: res.mix, mixNote: res.mixNote ?? (usesAudio(p!.mode) && !licensed ? (p!.rights_status === 'licensed' ? 'Sound unavailable' : 'Music not licensed, clean version only') : null),
          duration: res.duration, width: res.width, height: res.height, source: 'camera', clips: clips.length, smoothing: sm, uploaded: {} } }
        await saveDraft(cur)
      } else if (cur.out.source === 'upload') await saveDraft(cur)
      const o = cur.out!
      const base = `${a!.workspace_id}/sub/${p!.id}/${profile!.id}/${o.subId}`
      const ext = (b: Blob) => b.type.includes('webm') ? 'webm' : b.type.includes('quicktime') ? 'mov' : 'mp4'
      const put = async (key: 'clean' | 'mix', blob: Blob, label: string) => {
        if (o.uploaded[key]) return o.uploaded[key]!
        const path = `${base}-${key}.${ext(blob)}`
        const type = blob.type && ['video/mp4', 'video/quicktime', 'video/webm'].includes(blob.type.split(';')[0]) ? blob.type.split(';')[0] : 'video/mp4'
        try { await uploadObject(path, new Blob([blob], { type }), pct => setSending({ stage: label, pct }), 'social') }
        catch (e) { if (!/exists|duplicate/i.test(errMsg(e))) throw e } // already uploaded on an earlier try
        o.uploaded[key] = path; await saveDraft(cur); return path
      }
      const clean = await put('clean', o.clean, o.mix ? 'Uploading video 1 of 2…' : 'Uploading…')
      const mix = o.mix ? await put('mix', o.mix, 'Uploading video 2 of 2 (with music)…') : null
      setSending({ stage: 'Confirming with your agency…', pct: 100 })
      const { error } = await sb.rpc('social_submit', { sub_id: o.subId, asg: a!.id, clean, mix, mix_note: o.mixNote, m: o.clean.type || 'video/mp4', sz: o.clean.size,
        dur: Math.round(o.duration * 10) / 10, w: o.width || null, h: o.height || null, sm: o.smoothing, clips: o.clips || null, src: o.source, meta: { mix_size: o.mix?.size ?? null } })
      if (error) throw error
      await dropDraft(a!.id)
      setSending(null); setReview(null); setDraft(null); toast('Sent to your agency'); load()
    } catch (e) {
      setSending({ stage: 'Not sent', pct: 0, err: errMsg(e) })
      setDraft(cur); setReview(cur)
    }
  }

  const status = latest?.status === 'revision_requested' && a.status === 'revision_requested'
    ? <div className="redo-note soc-note"><b>Redo requested</b>{latest.review_note ? ` — ${latest.review_note}` : ''}</div>
    : a.status === 'submitted' ? <div className="soc-note ok">Sent {fmtDate(latest?.created_at || null)}. Waiting for review.</div>
    : a.status === 'approved' ? <div className="soc-note ok"><b>Approved</b>{latest?.review_note ? ` — ${latest.review_note}` : ''}</div> : null

  return <div className="phone soc">
    <ShotView p={p} sectionName={sec?.title || 'Back'} index={pos.i} total={pos.n} status={a.status}
      refUrl={p.ref_video_path ? urls[p.ref_video_path] || null : null} audioUrl={p.ref_audio_path ? urls[p.ref_audio_path] : null}
      onBack={() => nav('/creator')} notice={status}
      below={subs.length > 0 && <details className="versions"><summary>Your versions ({subs.length})</summary>
        {subs.map(s => <div key={s.id} className="between"><span>v{s.version} · {fmtDate(s.created_at)}</span><span className="smuted">{s.status === 'approved' ? 'Approved' : s.status === 'revision_requested' ? 'Redo asked' : 'Sent'}</span></div>)}</details>}
      actions={editable ? <>
        {draftClips.length > 0 || draft?.out ? <button className="sbtn primary" onClick={() => draft?.out && !draftClips.length ? setReview(draft) : setCam(true)}>{draft?.out && !draftClips.length ? 'Send your video' : `Continue · ${draftClips.length} clip${draftClips.length === 1 ? '' : 's'} saved`}</button>
          : <button className="sbtn primary" disabled={opening} onClick={openCam}>{opening ? 'Loading sound…' : 'Film it'}</button>}
        <button className="sbtn ghost" onClick={() => { if (fileIn.current) { fileIn.current.value = ''; fileIn.current.click() } }}>Choose from camera roll</button></>
        : <Link className="sbtn ghost" to="/creator">Back to shots</Link>} />
    <input ref={fileIn} type="file" accept="video/*" hidden onChange={e => onPicked(e.target.files?.[0])} />

    {cam && <SocialCamera project={p} assignmentId={a.id} audio={dance ? audio : null} initialSmooth={profile?.smoothing ?? 45}
      onSmooth={v => { if (profile && v !== profile.smoothing) sb.from('profiles').update({ smoothing: v }).eq('id', profile.id).then(() => {}) }}
      onClose={async () => { setCam(false); setDraft(await loadDraft(a.id)) }}
      onSend={d => { setCam(false); setDraft(d); setReview(d) }} />}

    {review && <Modal title="Send to your agency" onClose={() => { if (!sending || sending.err) { setReview(null); setSending(null) } }}>
      <ReviewMedia d={review} />
      <p className="smuted" style={{ fontSize: 13.5 }}>{review.out?.source === 'upload' ? 'From your camera roll.' : `${ordered(review).length} clip${ordered(review).length === 1 ? '' : 's'} joined in order · ${fmtDur(ordered(review).reduce((n, c) => n + clipLen(c), 0))}.`}
        {usesAudio(p.mode) && (p.rights_status === 'licensed' && dance ? ' Your agency gets a clean copy and one with the music.' : ' Your agency gets a clean copy without the music.')}</p>
      {sending && <div className="stack" style={{ gap: 6 }} role="status">
        <div className="between"><b>{sending.err ? "Didn't send" : sending.stage}</b>{!sending.err && <span className="mono">{sending.pct}%</span>}</div>
        {!sending.err && <div className="bar"><i style={{ width: sending.pct + '%' }} /></div>}
        {sending.err ? <p className="err">{sending.err}. Your video is still saved on this phone. Try again when you have a connection.</p> : <p className="smuted" style={{ fontSize: 13 }}>Keep this screen open until it says sent.</p>}</div>}
      <button className="sbtn primary" disabled={!!sending && !sending.err} onClick={() => send(review)}>{sending?.err ? 'Try again' : 'Send'}</button>
      {review.out?.source !== 'upload' && (!sending || sending.err) && <button className="sbtn ghost" onClick={() => { setReview(null); setSending(null); setCam(true) }}>Back to my clips</button>}
    </Modal>}
  </div>
}

function ReviewMedia({ d }: { d: Draft }) {
  const [u, setU] = useState<string | null>(null)
  useEffect(() => { const b = d.out?.clean || ordered(d)[0]?.blob; if (!b) return; const x = URL.createObjectURL(b); setU(x); return () => URL.revokeObjectURL(x) }, [d])
  return u ? <video className="vmedia" src={u} controls playsInline /> : null
}
