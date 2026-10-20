import { useEffect, useRef, useState } from 'react'
import { IcFlip, IcX } from '../lib/icons'

export interface CamResult { blob: Blob; kind: 'photo' | 'video'; smoothing: number; width: number; height: number; duration: number | null }
interface Props { accept: 'photo' | 'video' | 'any'; title: string; initialSmooth: number; onSmooth: (v: number) => void; onUse: (r: CamResult) => void; onClose: () => void }

const VS = 'attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}'
const FS = `precision highp float;uniform sampler2D u_img;uniform vec2 u_px;uniform float u_amt,u_rad,u_mir;varying vec2 v;
float skin(vec3 c){float y=dot(c,vec3(.299,.587,.114));float cb=(c.b-y)*.564+.5;float cr=(c.r-y)*.713+.5;
 return smoothstep(.49,.53,cr)*(1.-smoothstep(.67,.72,cr))*smoothstep(.26,.30,cb)*(1.-smoothstep(.51,.56,cb));}
void main(){vec2 uv=vec2(u_mir>.5?1.-v.x:v.x,v.y);vec3 c=texture2D(u_img,uv).rgb;
 if(u_amt<.001){gl_FragColor=vec4(c,1.);return;}
 vec3 sum=vec3(0.);float ws=0.;
 for(int i=-3;i<=3;i++){for(int j=-3;j<=3;j++){vec2 o=vec2(float(i),float(j))*1.35;
  vec3 s=texture2D(u_img,uv+o*u_px*u_rad).rgb;float d=distance(s,c);
  float w=exp(-dot(o,o)/16.)*exp(-d*d/.010);sum+=s*w;ws+=w;}}
 vec3 b=sum/ws;float m=skin(c)*u_amt;vec3 r=mix(c,b,m);r+=(c-b)*.12*m;gl_FragColor=vec4(clamp(r,0.,1.),1.);}`

export default function Camera({ accept, title, initialSmooth, onSmooth, onUse, onClose }: Props) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const st = useRef({ amt: initialSmooth / 100, cmp: false, facing: 'user' as 'user' | 'environment' })
  const eng = useRef<{ takePhoto: () => void; startRec: () => void; stopRec: (force?: boolean) => void; flip: () => void; recording: () => boolean } | null>(null)
  const [phase, setPhase] = useState<'gate' | 'live' | 'review'>('gate')
  const [mode, setMode] = useState<'photo' | 'video'>(accept === 'video' ? 'video' : 'photo')
  const [smooth, setSmooth] = useState(initialSmooth)
  const [cmp, setCmp] = useState(false)
  const [rec, setRec] = useState<'idle' | 'rec' | 'saving'>('idle')
  const [secs, setSecs] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [result, setResult] = useState<(CamResult & { url: string }) | null>(null)
  const [gateErr, setGateErr] = useState<string | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => { cleanup.current?.() }, [])
  const cleanup = useRef<(() => void) | null>(null)

  async function start() {
    setGateErr(null)
    const cv = cvRef.current!
    if (!navigator.mediaDevices?.getUserMedia) return setGateErr('This browser cannot open the camera. On iPhone, use Safari.')
    const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false })
    if (!gl) return setGateErr('This phone cannot run the smoothing filter.')
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); return o }
    const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return setGateErr('The smoothing filter could not start on this phone.')
    gl.useProgram(prog)
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const al = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0)
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex)
    ;[gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE))
    ;[gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR))
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    const U = { amt: gl.getUniformLocation(prog, 'u_amt'), px: gl.getUniformLocation(prog, 'u_px'), rad: gl.getUniformLocation(prog, 'u_rad'), mir: gl.getUniformLocation(prog, 'u_mir') }

    let stream: MediaStream | null = null
    const vid = document.createElement('video'); vid.muted = true; vid.playsInline = true; vid.setAttribute('playsinline', ''); vid.setAttribute('muted', '')
    vid.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0'; document.body.appendChild(vid)
    const onPause = () => { if (!document.hidden) vid.play().catch(() => {}) }; vid.addEventListener('pause', onPause)
    async function openCam() {
      stream?.getTracks().forEach(t => t.stop())
      const v = { facingMode: st.current.facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
      try { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: { echoCancellation: true, noiseSuppression: true } }) }
      catch (e) { if ((e as Error).name === 'NotAllowedError') { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); setMsg('No microphone access. Videos will record without sound.') } else throw e }
      vid.srcObject = new MediaStream(stream.getVideoTracks()); await vid.play().catch(() => {})
    }
    try { await openCam() } catch (e) {
      return setGateErr((e as Error).name === 'NotAllowedError' ? 'Camera access was blocked. In Safari, tap aA in the address bar, then Website Settings, and allow Camera.' : 'Could not start the camera.')
    }
    setPhase('live')

    let raf = 0, lastFrame = 0, frameCost = 16, gen = 0, alive = true
    function frame() {
      if (!alive) return
      const t0 = performance.now(); lastFrame = t0
      if (vid.paused && !document.hidden) vid.play().catch(() => {})
      if (vid.readyState >= 2 && vid.videoWidth) {
        const w = vid.videoWidth, h = vid.videoHeight
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
        gl!.bindTexture(gl!.TEXTURE_2D, tex); gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGB, gl!.RGB, gl!.UNSIGNED_BYTE, vid)
        gl!.viewport(0, 0, w, h)
        gl!.uniform1f(U.amt, st.current.cmp ? 0 : st.current.amt); gl!.uniform2f(U.px, 1 / w, 1 / h); gl!.uniform1f(U.rad, Math.max(1, Math.max(w, h) / 700)); gl!.uniform1f(U.mir, st.current.facing === 'user' ? 1 : 0)
        gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4)
      }
      const now = performance.now(); frameCost = frameCost * .8 + (now - t0) * .2; lastFrame = now
      schedule()
    }
    function schedule() { const g = gen; const rv = vid as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }; if (rv.requestVideoFrameCallback) rv.requestVideoFrameCallback(() => { if (g === gen) frame() }); else raf = requestAnimationFrame(() => { if (g === gen) frame() }) }
    const watchdog = setInterval(() => { if (alive && !document.hidden && performance.now() - lastFrame > Math.max(1000, frameCost * 6)) { gen++; frame() } }, 500)
    gen++; frame()

    let recorder: MediaRecorder | null = null, chunks: Blob[] = [], recStart = 0, stopping = false, tInt = 0, stopT = 0, finish: (why: string) => void = () => {}
    function startRec() {
      if (!window.MediaRecorder || !cv.captureStream) { setMsg('This phone cannot record from the filtered camera.'); return }
      st.current.cmp = false; setCmp(false)
      const out = cv.captureStream(30)
      const all = stream!.getAudioTracks(), aud = all.filter(t => t.readyState === 'live' && !t.muted)
      aud.forEach(t => { t.enabled = true; out.addTrack(t) })
      if (all.length && !aud.length) setMsg('Microphone is busy (a call?). Recording without sound.')
      const apple = /Apple/.test(navigator.vendor || '')
      const prefs = apple ? ['video/mp4', 'video/mp4;codecs=avc1'] : ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      const mime = prefs.find(m => { try { return MediaRecorder.isTypeSupported(m) } catch { return false } }) || ''
      try { recorder = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : {}) } catch { setMsg('Recording could not start on this phone.'); return }
      chunks = []; let bytes = 0, done = false
      recorder.ondataavailable = e => { if (e.data && e.data.size) { chunks.push(e.data); bytes += e.data.size } }
      const r = recorder, w = cv.width, h = cv.height, sm = Math.round(st.current.amt * 100)
      finish = (why: string) => {
        if (done) return; done = true; clearTimeout(stopT); clearInterval(tInt)
        const dur = ((stopAt || Date.now()) - recStart) / 1000
        const type = ((r.mimeType || mime || 'video/mp4').split(';')[0]) || 'video/mp4'
        const blob = new Blob(chunks, { type }); recorder = null; stopping = false; setRec('idle')
        if (!blob.size) { setMsg(bytes === 0 && /timeout|stop/.test(why) ? 'Nothing was recorded. If you are on a phone or FaceTime call, iPhone blocks video recording until the call ends.' : 'Recording came out empty. Try again.'); return }
        const res = { blob, kind: 'video' as const, smoothing: sm, width: w, height: h, duration: Math.round(dur * 10) / 10 }
        setResult({ ...res, url: URL.createObjectURL(blob) }); setPhase('review')
      }
      let stopAt = 0
      r.onstop = () => setTimeout(() => finish('stop'), 150)
      r.onerror = () => finish('error')
      r.start(); recStart = Date.now(); setRec('rec'); setSecs(0)
      tInt = window.setInterval(() => setSecs(Math.floor((Date.now() - recStart) / 1000)), 250)
      stopRecRef = (force?: boolean) => {
        if (!recorder || stopping) return; if (!force && Date.now() - recStart < 800) return
        stopping = true; stopAt = Date.now(); clearInterval(tInt); setRec('saving')
        try { if (recorder.state !== 'inactive') recorder.stop(); else finish('inactive') } catch { finish('stopfail') }
        stopT = window.setTimeout(() => finish('timeout'), 10000)
      }
    }
    let stopRecRef: (force?: boolean) => void = () => {}
    function takePhoto() {
      cv.toBlob(bl => { if (!bl) return setMsg('Could not take the photo')
        setResult({ blob: bl, kind: 'photo', smoothing: Math.round(st.current.amt * 100), width: cv.width, height: cv.height, duration: null, url: URL.createObjectURL(bl) }); setPhase('review') }, 'image/jpeg', .95)
    }
    async function flip() {
      if (recorder) return
      st.current.facing = st.current.facing === 'user' ? 'environment' : 'user'
      try { await openCam() } catch { st.current.facing = st.current.facing === 'user' ? 'environment' : 'user'; try { await openCam() } catch { /* ignore */ } setMsg('Could not switch camera') }
    }
    const onVis = () => { if (document.hidden && recorder) stopRecRef(true) }
    document.addEventListener('visibilitychange', onVis)
    eng.current = { takePhoto, startRec, stopRec: f => stopRecRef(f), flip, recording: () => !!recorder }
    cleanup.current = () => {
      alive = false; clearInterval(watchdog); cancelAnimationFrame(raf); clearInterval(tInt); clearTimeout(stopT)
      try { recorder?.state !== 'inactive' && recorder?.stop() } catch { /* ignore */ }
      stream?.getTracks().forEach(t => t.stop()); vid.removeEventListener('pause', onPause); vid.remove()
      document.removeEventListener('visibilitychange', onVis)
    }
  }

  function setAmt(v: number) { v = Math.max(0, Math.min(100, Math.round(v))); st.current.amt = v / 100; setSmooth(v) }
  const fromX = (x: number) => { const r = trackRef.current!.getBoundingClientRect(); setAmt((x - r.left) / r.width * 100) }
  const dragging = useRef(false)
  useEffect(() => { const t = setTimeout(() => onSmooth(smooth), 600); return () => clearTimeout(t) }, [smooth, onSmooth])

  function shutter() { if (!eng.current) return; if (mode === 'photo') eng.current.takePhoto(); else if (rec === 'rec') eng.current.stopRec(); else if (rec === 'idle') eng.current.startRec() }
  function retake() { if (result) URL.revokeObjectURL(result.url); setResult(null); setPhase('live') }
  function close() { cleanup.current?.(); onClose() }
  function use() { if (!result) return; const { url: _u, ...r } = result; void _u; cleanup.current?.(); onUse(r) }

  return <div className="cam" role="dialog" aria-label="Camera">
    <canvas ref={cvRef} className="view" />
    {phase === 'gate' && <div className="gate" style={{ background: '#09080a' }}><div>
      <h2 style={{ fontSize: 22 }}>{title}</h2>
      <p style={{ color: '#a59eab' }}>Your camera opens with skin smoothing on. Adjust it before you shoot. Nothing is uploaded until you tap Use.</p>
      <button className="cbtn primary" style={{ padding: '0 28px' }} onClick={start}>Turn on camera</button>
      {gateErr && <p style={{ color: '#ff8a95' }}>{gateErr}</p>}
      <button className="cbtn ghost" style={{ padding: '0 22px', height: 44 }} onClick={close}>Cancel</button>
    </div></div>}
    {phase !== 'gate' && <>
      <div className="top">
        <button className="cround" aria-label="Close camera" onClick={close}><IcX /></button>
        {rec !== 'idle' ? <span className="cpill mono"><span className="rdot" />{rec === 'saving' ? 'Saving…' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</span> : <span className="cpill">{title}</span>}
        <button className="cround" aria-label="Switch camera" onClick={() => eng.current?.flip()}><IcFlip /></button>
      </div>
      {cmp && <span className="badge">ORIGINAL</span>}
      {msg && <div className="msg" role="alert">{msg}<br /><button style={{ fontWeight: 700, textDecoration: 'underline', marginTop: 6 }} onClick={() => setMsg(null)}>OK</button></div>}
      <div className="bottom">
        <div className="smooth">
          <span style={{ fontSize: 13, fontWeight: 700 }} id="smooth-l">Smooth</span>
          <div className="slider" role="slider" tabIndex={0} aria-labelledby="smooth-l" aria-valuemin={0} aria-valuemax={100} aria-valuenow={smooth}
            onPointerDown={e => { e.preventDefault(); dragging.current = true; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* */ } fromX(e.clientX) }}
            onPointerMove={e => { if (dragging.current) fromX(e.clientX) }} onPointerUp={() => dragging.current = false} onPointerCancel={() => dragging.current = false}
            onKeyDown={e => { if (e.key === 'ArrowRight') setAmt(smooth + 5); if (e.key === 'ArrowLeft') setAmt(smooth - 5) }}>
            <div className="track" ref={trackRef}><div className="fill" style={{ width: smooth + '%' }} /><div className="thumb" style={{ left: smooth + '%' }} /></div>
          </div>
          <span className="val">{smooth}</span>
          <button className="cmp" disabled={rec !== 'idle'} onPointerDown={e => { e.preventDefault(); st.current.cmp = true; setCmp(true) }}
            onPointerUp={() => { st.current.cmp = false; setCmp(false) }} onPointerLeave={() => { st.current.cmp = false; setCmp(false) }} onPointerCancel={() => { st.current.cmp = false; setCmp(false) }} onContextMenu={e => e.preventDefault()}>Hold to compare</button>
        </div>
        <div className="crow">
          {accept === 'any' ? <div className="cmodes" role="group" aria-label="Mode">
            <button aria-pressed={mode === 'photo'} onClick={() => rec === 'idle' && setMode('photo')}>Photo</button>
            <button aria-pressed={mode === 'video'} onClick={() => rec === 'idle' && setMode('video')}>Video</button></div> : <span className="cpill" style={{ justifySelf: 'start' }}>{accept === 'video' ? 'Video' : 'Photo'}</span>}
          <button className={'shutter' + (mode === 'video' ? ' video' : '') + (rec === 'rec' ? ' recording' : '') + (rec === 'saving' ? ' busy' : '')} aria-label={mode === 'photo' ? 'Take photo' : rec === 'rec' ? 'Stop recording' : 'Start recording'} onClick={e => { e.preventDefault(); shutter() }}><i /></button>
          <span />
        </div>
      </div>
    </>}
    {phase === 'review' && result && <div className="review">
      <div className="media">{result.kind === 'photo' ? <img src={result.url} alt="Your photo" /> : <video src={result.url} controls playsInline autoPlay loop />}</div>
      <p className="mono" style={{ textAlign: 'center', color: '#a59eab' }}>{result.width} × {result.height} · smoothing {result.smoothing}{result.duration ? ` · ${result.duration}s` : ''}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
        <button className="cbtn ghost" onClick={retake}>Retake</button>
        <button className="cbtn primary" onClick={use}>Use {result.kind}</button>
      </div>
    </div>}
  </div>
}
