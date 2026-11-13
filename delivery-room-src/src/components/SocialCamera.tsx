import { useEffect, useMemo, useRef, useState } from 'react'
import { IcFlip, IcX, IcBack, IcNext, IcTrash } from '../lib/icons'
import { startEngine, type Engine, type EngineState } from '../lib/camEngine'
import { clipLen, loadDraft, ordered, persistRequested, saveDraft, type Clip, type Draft, draftKey } from '../lib/drafts'
import { thumbAt, videoMeta } from '../lib/media'
import { fmtDur, usesAudio, usesScript, type Project } from '../lib/social'
import { uid } from '../lib/types'

interface Props {
  project: Project; assignmentId: string; audio: AudioBuffer | null
  initialSmooth: number; onSmooth: (v: number) => void
  onClose: () => void; onSend: (d: Draft) => void
}
type TP = 'still' | 'scroll' | 'hide'
const TIMERS = [0, 3, 10]

export function sentences(s: string) { return s.split(/(?<=[.!?…])\s+|\n+/).map(x => x.trim()).filter(Boolean) }

export default function SocialCamera({ project, assignmentId, audio, initialSmooth, onSmooth, onClose, onSend }: Props) {
  const talking = usesScript(project.mode), dance = usesAudio(project.mode) && !!audio
  const cvRef = useRef<HTMLCanvasElement>(null)
  const st = useRef<EngineState>({ amt: initialSmooth / 100, cmp: false, facing: 'user' })
  const eng = useRef<Engine | null>(null)
  const actx = useRef<AudioContext | null>(null); const asrc = useRef<AudioBufferSourceNode | null>(null)
  const [phase, setPhase] = useState<'gate' | 'live' | 'edit'>('gate')
  const [gateErr, setGateErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ key: draftKey(assignmentId), assignmentId, clips: [], order: [], updatedAt: Date.now() })
  const [loaded, setLoaded] = useState(false)
  const [rec, setRec] = useState<'idle' | 'count' | 'rec' | 'saving'>('idle')
  const [count, setCount] = useState(0); const [secs, setSecs] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [smooth, setSmooth] = useState(initialSmooth)
  const [timer, setTimer] = useState(0)
  const [tp, setTp] = useState<TP>('still'); const [tpSize, setTpSize] = useState(34); const [tpSpeed, setTpSpeed] = useState(28); const [tpAt, setTpAt] = useState(0)
  const [cueAt, setCueAt] = useState(0)
  const [retakeOf, setRetakeOf] = useState<string | null>(null)
  const [pendingNew, setPendingNew] = useState<Clip | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; ok: string; run: () => void } | null>(null)
  const [undo, setUndo] = useState<{ clip: Clip; index: number } | null>(null)
  const [quality, setQuality] = useState('')
  const sents = useMemo(() => sentences(project.script || ''), [project.script])
  const clips = ordered(draft)
  const total = clips.reduce((n, c) => n + clipLen(c), 0)
  const refDur = audio?.duration || 0

  useEffect(() => { loadDraft(assignmentId).then(d => { if (d) { setDraft(d); const cs = ordered(d); const last = cs[cs.length - 1]; if (last?.refStart != null) setCueAt(Math.min(refDur, last.refStart + last.trimOut)); if (cs.length) { setPhase('edit'); setSel(cs[0].id) } } setLoaded(true) }) }, [assignmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { eng.current?.stop(); try { asrc.current?.stop() } catch { /* */ } actx.current?.close().catch(() => {}) }, [])
  useEffect(() => { const t = setTimeout(() => onSmooth(smooth), 600); return () => clearTimeout(t) }, [smooth, onSmooth])
  useEffect(() => { if (rec !== 'rec') return; const t0 = Date.now(); const i = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 250); return () => clearInterval(i) }, [rec])
  useEffect(() => { const v = () => { if (document.hidden && eng.current?.recording()) stop() }; document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v) })

  async function persist(d0: Draft) { const d = { ...d0, out: null }; setDraft(d); const ok = await saveDraft(d); if (!ok) setMsg("This browser couldn't save your clips on the phone (private browsing or storage full). Don't leave this screen until you've sent them.") }

  async function openCamera() {
    setGateErr(null)
    try {
      if (dance && !actx.current) { const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; actx.current = new AC(); await actx.current.resume() }
      eng.current = await startEngine(cvRef.current!, st.current, setMsg)
      persistRequested()
      setPhase('live')
      setTimeout(() => { const s = eng.current?.size(); if (s) setQuality(Math.min(s.w, s.h) >= 1000 ? '1080p' : Math.min(s.w, s.h) >= 700 ? '720p' : Math.min(s.w, s.h) + 'p') }, 800)
    } catch (e) { setGateErr((e as Error).message) }
  }
  function toLive(retake: string | null) {
    setRetakeOf(retake)
    if (retake) { const c = draft.clips.find(x => x.id === retake); if (c?.refStart != null) setCueAt(Math.max(0, c.refStart)); if (c?.scriptAt != null) setTpAt(c.scriptAt) }
    if (!eng.current) { openCamera(); return } // permission already granted: reopen straight away
    setPhase('live')
  }

  async function begin() {
    if (rec !== 'idle' || !eng.current) return
    if (dance && cueAt >= refDur - 0.5) { setMsg('You have reached the end of the sound. Drag the slider to choose where the next clip starts, or tap Done.'); return }
    const n = dance ? Math.max(3, timer) : timer
    if (n) { setRec('count'); for (let i = n; i > 0; i--) { setCount(i); await new Promise(r => setTimeout(r, 1000)) } }
    const started = eng.current.startRec(); if (!started) { setRec('idle'); return }
    let refStart: number | null = null
    if (dance && audio && actx.current) {
      const ctx = actx.current; await ctx.resume().catch(() => {})
      const src = ctx.createBufferSource(); src.buffer = audio; src.connect(ctx.destination)
      src.start(0, Math.min(cueAt, Math.max(0, refDur - 0.05)))
      const audioAt = performance.now()
      const lat = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0
      refStart = cueAt - (audioAt - started.startedAt) / 1000 - lat
      src.onended = () => { if (asrc.current === src && eng.current?.recording()) stop() } // the take ends with the sound
      asrc.current = src
    }
    pending.current = { refStart, scriptAt: talking ? tpAt : null }
    setSecs(0); setRec('rec')
  }
  const pending = useRef<{ refStart: number | null; scriptAt: number | null }>({ refStart: null, scriptAt: null })

  async function stop() {
    if (!eng.current?.recording()) return
    setRec('saving')
    const a = asrc.current; asrc.current = null; try { a?.stop() } catch { /* */ }
    const out = await eng.current.stopRec()
    if (!out) { setRec('idle'); return }
    // use the recorded file's real length; wall-clock time can run ahead of the encoder on a busy phone
    const real = await videoMeta(out.blob, 3000).then(m => m.duration).catch(() => NaN)
    const dur = isFinite(real) && real > 0.2 ? real : out.duration
    const clip: Clip = { id: uid().slice(0, 12), blob: out.blob, duration: dur, width: out.width, height: out.height, smoothing: out.smoothing,
      trimIn: 0, trimOut: dur, refStart: pending.current.refStart, scriptAt: pending.current.scriptAt, thumb: await thumbAt(out.blob), createdAt: Date.now() }
    setRec('idle')
    if (retakeOf) { setPendingNew(clip); return }
    const d = { ...draft, clips: [...draft.clips, clip], order: [...draft.order, clip.id] }
    await persist(d)
    if (clip.refStart != null) setCueAt(Math.min(refDur, Math.max(0, clip.refStart + clip.trimOut)))
  }
  async function acceptRetake(keepNew: boolean) {
    const nc = pendingNew!; setPendingNew(null)
    if (keepNew && retakeOf) {
      const d = { ...draft, clips: [...draft.clips.filter(c => c.id !== retakeOf), nc], order: draft.order.map(id => id === retakeOf ? nc.id : id) }
      await persist(d); setSel(nc.id)
    }
    setRetakeOf(null); toEdit()
  }
  function toEdit(id?: string | null) { eng.current?.stop(); eng.current = null; if (id !== undefined) setSel(id); setPhase('edit') }
  function shutter() { if (rec === 'rec') stop(); else if (rec === 'idle') begin() }

  async function setTrim(id: string, a: number, b: number) {
    const d = { ...draft, out: null, clips: draft.clips.map(c => c.id === id ? { ...c, trimIn: Math.max(0, Math.min(a, b - 0.3)), trimOut: Math.min(c.duration, Math.max(b, a + 0.3)) } : c) }
    setDraft(d); clearTimeout(trimSave.current); trimSave.current = window.setTimeout(() => saveDraft(d), 400)
  }
  const trimSave = useRef(0)
  async function del(id: string) {
    const index = draft.order.indexOf(id), clip = draft.clips.find(c => c.id === id)!
    const d = { ...draft, clips: draft.clips.filter(c => c.id !== id), order: draft.order.filter(x => x !== id) }
    await persist(d); setUndo({ clip, index }); setSel(d.order[Math.min(index, d.order.length - 1)] || null)
    if (!d.order.length) setPhase(eng.current ? 'live' : 'gate')
  }
  async function doUndo() { if (!undo) return; const order = [...draft.order]; order.splice(undo.index, 0, undo.clip.id); await persist({ ...draft, clips: [...draft.clips, undo.clip], order }); setSel(undo.clip.id); setUndo(null); setPhase('edit') }
  async function move(id: string, dir: -1 | 1) {
    const i = draft.order.indexOf(id), j = i + dir; if (j < 0 || j >= draft.order.length) return
    const run = async () => { const order = [...draft.order]; [order[i], order[j]] = [order[j], order[i]]; await persist({ ...draft, order }) }
    if (dance) setConfirm({ text: 'Moving clips changes the order of the music in the final video. Each clip keeps its own part of the sound.', ok: 'Move clip', run }); else run()
  }
  function close() { eng.current?.stop(); eng.current = null; onClose() }

  // ---------- preview player for the edit view
  const pv = useRef<HTMLVideoElement>(null); const [playAll, setPlayAll] = useState<number | null>(null)
  const selClip = clips.find(c => c.id === sel) || clips[0]
  const urlCache = useRef(new Map<string, string>())
  const urlOf = (c: Clip) => { let u = urlCache.current.get(c.id); if (!u) { u = URL.createObjectURL(c.blob); urlCache.current.set(c.id, u) } return u }
  useEffect(() => () => { urlCache.current.forEach(u => URL.revokeObjectURL(u)) }, [])
  const playing = playAll !== null ? clips[playAll] : selClip
  useEffect(() => {
    const v = pv.current; if (!v || !playing) return
    const onTime = () => { if (v.currentTime >= playing.trimOut - 0.03) { v.pause(); if (playAll !== null) setPlayAll(playAll + 1 < clips.length ? playAll + 1 : null) } }
    const onLoad = () => { v.currentTime = playing.trimIn; if (playAll !== null) v.play().catch(() => {}) }
    v.addEventListener('timeupdate', onTime); v.addEventListener('loadedmetadata', onLoad)
    if (v.readyState >= 1) onLoad()
    return () => { v.removeEventListener('timeupdate', onTime); v.removeEventListener('loadedmetadata', onLoad) }
  }, [playing?.id, playing?.trimIn, playing?.trimOut, playAll]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- teleprompter scroll
  const tpBox = useRef<HTMLDivElement>(null); const tpY = useRef(0)
  useEffect(() => {
    if (tp !== 'scroll') return
    tpY.current = 0; if (tpBox.current) tpBox.current.style.transform = 'translateY(0px)'
    if (rec !== 'rec') return
    let raf = 0, last = performance.now()
    const tick = (t: number) => { tpY.current -= (t - last) / 1000 * tpSpeed; last = t; if (tpBox.current) tpBox.current.style.transform = `translateY(${tpY.current}px)`; raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [tp, rec, tpSpeed, tpAt])

  if (!loaded) return <div className="cam" />
  const showTP = talking && tp !== 'hide' && sents.length > 0 && phase === 'live'
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return <div className="cam scam" role="dialog" aria-label="Camera">
    <canvas ref={cvRef} className="view" style={{ visibility: phase === 'edit' ? 'hidden' : 'visible' }} />
    {phase === 'gate' && <div className="gate" style={{ background: '#05081a' }}><div>
      <h2 style={{ fontSize: 22 }}>{project.title}</h2>
      <p style={{ color: '#aab3d6' }}>Record in as many clips as you like. Stop whenever, then carry on. You can redo any single clip later. Clips stay on this phone until you send them.</p>
      {dance && <p style={{ color: '#aab3d6' }}>The sound plays while you record. Headphones keep it out of your mic.</p>}
      <button className="cbtn primary" style={{ padding: '0 28px' }} onClick={openCamera}>Turn on camera</button>
      {gateErr && <p style={{ color: '#ff8fb8' }} role="alert">{gateErr}</p>}
      <button className="cbtn ghost" style={{ padding: '0 22px', height: 44 }} onClick={close}>{gateErr ? 'Back (use camera roll instead)' : 'Cancel'}</button>
    </div></div>}

    {phase === 'live' && <>
      <div className="top">
        <button className="cround" aria-label="Close camera" onClick={() => rec === 'idle' && (clips.length ? toEdit() : close())}><IcX /></button>
        {talking && sents.length > 0 && <div className="cmodes" role="group" aria-label="Script">
          {(['still', 'scroll'] as TP[]).map(m => <button key={m} aria-pressed={tp === m} onClick={() => setTp(m)}>{m === 'still' ? 'Still' : 'Scroll'}</button>)}
          <button aria-pressed={tp === 'hide'} onClick={() => setTp(tp === 'hide' ? 'still' : 'hide')}>{tp === 'hide' ? 'Show script' : 'Hide script'}</button></div>}
        {!talking && <span className="cpill">{retakeOf ? `Redoing clip ${draft.order.indexOf(retakeOf) + 1}` : `Clip ${clips.length + 1}`}</span>}
        <button className="cround" aria-label="Switch camera" disabled={rec !== 'idle'} onClick={() => eng.current?.flip()}><IcFlip /></button>
      </div>
      {showTP && <div className="tp" style={{ fontSize: tpSize }}>
        <div className="tp-in" ref={tpBox}>{sents.slice(tpAt).map((s, i) => <p key={i} className={i === 0 ? 'cur' : ''} onClick={() => rec === 'idle' && setTpAt(tpAt + i)}>{s}</p>)}</div>
      </div>}
      {showTP && rec === 'idle' && <div className="tp-tools">
        <button className="cpill" onClick={() => setTpSize(s => Math.max(20, s - 4))} aria-label="Smaller script">A−</button>
        <button className="cpill" onClick={() => setTpSize(s => Math.min(56, s + 4))} aria-label="Bigger script">A+</button>
        {tp === 'scroll' && <><button className="cpill" onClick={() => setTpSpeed(s => Math.max(8, s - 8))} aria-label="Slower">Slower</button><button className="cpill" onClick={() => setTpSpeed(s => Math.min(90, s + 8))} aria-label="Faster">Faster</button></>}
        {tpAt > 0 && <button className="cpill" onClick={() => setTpAt(0)}>From the top</button>}
        <span className="cpill muted-pill">Tap a line to start there</span>
      </div>}
      {rec === 'count' && <div className="countdown" aria-live="assertive">{count}</div>}
      {msg && <div className="msg" role="alert">{msg}<br /><button style={{ fontWeight: 700, textDecoration: 'underline', marginTop: 6 }} onClick={() => setMsg(null)}>OK</button></div>}
      <div className="bottom">
        {dance && rec === 'idle' && <div className="cue"><span>Sound starts at <b className="mono">{mm(cueAt)}</b> of {mm(refDur)}</span>
          <input type="range" min={0} max={Math.max(0, refDur - 1)} step={0.1} value={cueAt} onChange={e => setCueAt(Number(e.target.value))} aria-label="Where the sound starts" /></div>}
        {rec === 'idle' && <div className="smooth"><span style={{ fontSize: 13, fontWeight: 700 }}>Smooth</span>
          <input type="range" min={0} max={100} value={smooth} onChange={e => { const v = Number(e.target.value); st.current.amt = v / 100; setSmooth(v) }} aria-label="Skin smoothing" />
          <span className="val">{smooth}</span>
          <button className="cmp" onPointerDown={e => { e.preventDefault(); st.current.cmp = true }} onPointerUp={() => { st.current.cmp = false }} onPointerLeave={() => { st.current.cmp = false }} onContextMenu={e => e.preventDefault()}>Hold: original</button></div>}
        <div className="pills">
          <span className="cpill mono">{rec === 'rec' ? <span className="rdot" /> : <span className="idot" />}{rec === 'saving' ? 'Saving…' : mm(rec === 'rec' ? secs : total)}</span>
          {quality && <span className="cpill">{quality}</span>}
          <button className="cpill" disabled={rec !== 'idle'} onClick={() => setTimer(t => TIMERS[(TIMERS.indexOf(t) + 1) % TIMERS.length])}>{timer ? `Timer ${timer}s` : dance ? 'Countdown 3s' : 'Timer off'}</button>
        </div>
        <div className="crow">
          <button className="cthumbs" disabled={rec !== 'idle' || !clips.length || !!retakeOf} onClick={() => toEdit(clips[clips.length - 1]?.id || null)} aria-label="Review clips">
            {clips.length ? <>{clips[clips.length - 1].thumb && <img src={clips[clips.length - 1].thumb!} alt="" />}<b>{clips.length}</b></> : null}</button>
          <button className={'shutter video' + (rec === 'rec' ? ' recording' : '') + (rec === 'saving' || rec === 'count' ? ' busy' : '')} aria-label={rec === 'rec' ? 'Stop clip' : 'Record clip'} onClick={e => { e.preventDefault(); shutter() }}><i /></button>
          {clips.length && !retakeOf && rec === 'idle' ? <button className="cbtn primary done" onClick={() => toEdit(clips[0].id)}>Done<IcNext /></button> : retakeOf && rec === 'idle' ? <button className="cbtn ghost done" onClick={() => { setRetakeOf(null); toEdit() }}>Cancel</button> : <span />}
        </div>
        <p className="hint">{rec === 'rec' ? 'Tap to stop this clip' : retakeOf ? 'Recording a new take. The old one is kept until you choose.' : clips.length ? 'Tap to record the next clip' : 'Tap to record'}</p>
      </div>
    </>}

    {pendingNew && <div className="review"><h2 style={{ fontSize: 20 }}>Keep the new take?</h2>
      <div className="media"><video src={urlOf(pendingNew)} controls playsInline autoPlay /></div>
      <p className="mono" style={{ textAlign: 'center', color: '#aab3d6' }}>New take · {fmtDur(pendingNew.duration)}. Your other clips are unchanged.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 10 }}><button className="cbtn ghost" onClick={() => acceptRetake(false)}>Keep old take</button><button className="cbtn primary" onClick={() => acceptRetake(true)}>Use new take</button></div></div>}

    {phase === 'edit' && !pendingNew && <div className="edit">
      <div className="etop"><button className="cround" aria-label="Back to camera" onClick={() => toLive(null)}><IcBack /></button>
        <div className="grow"><b>{clips.length} clip{clips.length === 1 ? '' : 's'} · {fmtDur(total)}</b><p style={{ color: '#aab3d6', fontSize: 12.5 }}>Saved on this phone</p></div>
        <button className="cround" aria-label="Close" onClick={close}><IcX /></button></div>
      <div className="eplayer">{playing && <video ref={pv} key={playing.id} src={urlOf(playing)} playsInline controls={playAll === null} />}
        {playAll !== null && <span className="cpill playing">Playing all · clip {playAll + 1}</span>}</div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="cpill" onClick={() => setPlayAll(playAll === null ? 0 : null)}>{playAll === null ? '▶ Play all in order' : 'Stop'}</button></div>
      <div className="strip" role="listbox" aria-label="Clips">{clips.map((c, i) => <button key={c.id} role="option" aria-selected={c.id === selClip?.id} className="sclip" onClick={() => { setPlayAll(null); setSel(c.id) }}>
        {c.thumb ? <img src={c.thumb} alt="" /> : <span className="ph" />}<span className="n">{i + 1}</span><span className="d">{fmtDur(clipLen(c))}</span></button>)}
        <button className="sclip add" onClick={() => toLive(null)} aria-label="Record another clip">+</button></div>
      {selClip && playAll === null && <div className="eclip">
        <div className="between"><b>Clip {clips.indexOf(selClip) + 1}</b><span className="mono" style={{ color: '#aab3d6' }}>{fmtDur(selClip.trimIn)} – {fmtDur(selClip.trimOut)} · smoothing {selClip.smoothing}</span></div>
        <label className="trim"><span>Start</span><input type="range" min={0} max={selClip.duration} step={0.05} value={selClip.trimIn} onChange={e => setTrim(selClip.id, Number(e.target.value), selClip.trimOut)} /></label>
        <label className="trim"><span>End</span><input type="range" min={0} max={selClip.duration} step={0.05} value={selClip.trimOut} onChange={e => setTrim(selClip.id, selClip.trimIn, Number(e.target.value))} /></label>
        <div className="ebtns">
          <button className="cpill" onClick={() => move(selClip.id, -1)} disabled={clips.indexOf(selClip) === 0}><IcBack />Earlier</button>
          <button className="cpill" onClick={() => move(selClip.id, 1)} disabled={clips.indexOf(selClip) === clips.length - 1}>Later<IcNext /></button>
          <button className="cpill" onClick={() => toLive(selClip.id)}>Redo this clip</button>
          <button className="cpill" onClick={() => setConfirm({ text: `Delete clip ${clips.indexOf(selClip) + 1}? You can undo straight after.`, ok: 'Delete', run: () => del(selClip.id) })}><IcTrash />Delete</button>
        </div></div>}
      {undo && <div className="undo">Clip deleted <button onClick={doUndo}>Undo</button></div>}
      <button className="cbtn primary" disabled={!clips.length} onClick={() => { eng.current?.stop(); eng.current = null; onSend(draft) }}>Use these {clips.length} clip{clips.length === 1 ? '' : 's'}<IcNext /></button>
    </div>}

    {confirm && <div className="confirm" role="alertdialog"><div><p>{confirm.text}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><button className="cbtn ghost" onClick={() => setConfirm(null)}>Cancel</button><button className="cbtn primary" onClick={() => { const r = confirm.run; setConfirm(null); r() }}>{confirm.ok}</button></div></div></div>}
  </div>
}
