// Live camera with the skin-smoothing shader drawn into a canvas. Recording captures the canvas, so the
// smoothing is baked into the saved clip, not just the preview. Same shader as the OF camera.
import { VS, FS } from '../components/Camera'
import { recorderMime } from './assemble'

export interface EngineState { amt: number; cmp: boolean; facing: 'user' | 'environment' }
export interface RecOut { blob: Blob; duration: number; width: number; height: number; smoothing: number; startedAt: number }
export interface Engine {
  startRec: () => { startedAt: number } | null
  stopRec: () => Promise<RecOut | null>
  flip: () => Promise<void>
  recording: () => boolean
  size: () => { w: number; h: number }
  stop: () => void
}

export async function startEngine(cv: HTMLCanvasElement, st: EngineState, onMsg: (m: string) => void): Promise<Engine> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open the camera. On iPhone, use Safari.')
  const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false })
  if (!gl) throw new Error('This phone cannot run the smoothing filter. Use Choose from camera roll instead.')
  const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); return o }
  const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('The smoothing filter could not start on this phone.')
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
    const v = { facingMode: st.facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
    try { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) }
    catch (e) { if ((e as Error).name === 'NotAllowedError') { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); onMsg('No microphone access. Clips will record without sound.') } else throw e }
    vid.srcObject = new MediaStream(stream.getVideoTracks()); await vid.play().catch(() => {})
  }
  try { await openCam() } catch (e) {
    vid.remove()
    const n = (e as Error).name
    throw new Error(n === 'NotAllowedError' ? 'Camera access was blocked. In Safari, tap aA in the address bar, then Website Settings, and allow Camera and Microphone. Or use Choose from camera roll.'
      : n === 'NotFoundError' ? 'No camera was found on this device.' : n === 'NotReadableError' ? 'The camera is being used by another app. Close it and try again.' : 'Could not start the camera.')
  }

  let recorder: MediaRecorder | null = null, chunks: Blob[] = [], recStart = 0, sm = 0
  let alive = true, raf = 0, lastFrame = 0, frameCost = 16, gen = 0
  function frame() {
    if (!alive) return
    const t0 = performance.now(); lastFrame = t0
    if (vid.paused && !document.hidden) vid.play().catch(() => {})
    if (vid.readyState >= 2 && vid.videoWidth) {
      const w = vid.videoWidth, h = vid.videoHeight
      if (!recorder && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h }
      gl!.bindTexture(gl!.TEXTURE_2D, tex); gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGB, gl!.RGB, gl!.UNSIGNED_BYTE, vid)
      gl!.viewport(0, 0, cv.width, cv.height)
      gl!.uniform1f(U.amt, st.cmp ? 0 : st.amt); gl!.uniform2f(U.px, 1 / w, 1 / h); gl!.uniform1f(U.rad, Math.max(1, Math.max(w, h) / 700)); gl!.uniform1f(U.mir, st.facing === 'user' ? 1 : 0)
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4)
    }
    const now = performance.now(); frameCost = frameCost * .8 + (now - t0) * .2; lastFrame = now
    schedule()
  }
  function schedule() { const g = gen; const rv = vid as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }; if (rv.requestVideoFrameCallback) rv.requestVideoFrameCallback(() => { if (g === gen) frame() }); else raf = requestAnimationFrame(() => { if (g === gen) frame() }) }
  const watchdog = setInterval(() => { if (alive && !document.hidden && performance.now() - lastFrame > Math.max(1000, frameCost * 6)) { gen++; frame() } }, 500)
  gen++; frame()

  const mime = recorderMime()
  function startRec() {
    if (!window.MediaRecorder || !(cv as HTMLCanvasElement & { captureStream?: unknown }).captureStream) { onMsg('This phone cannot record from the filtered camera. Use Choose from camera roll instead.'); return null }
    st.cmp = false
    const out = (cv as HTMLCanvasElement & { captureStream(f?: number): MediaStream }).captureStream(30)
    const all = stream!.getAudioTracks(), aud = all.filter(t => t.readyState === 'live' && !t.muted)
    aud.forEach(t => { t.enabled = true; out.addTrack(t) })
    if (all.length && !aud.length) onMsg('Microphone is busy (a call?). Recording without sound.')
    try { recorder = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : {}) } catch { onMsg('Recording could not start on this phone.'); return null }
    chunks = []; recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data) }
    sm = Math.round(st.amt * 100)
    recorder.start(1000); recStart = performance.now()
    return { startedAt: recStart }
  }
  function stopRec(): Promise<RecOut | null> {
    const r = recorder; if (!r) return Promise.resolve(null)
    const stopAt = performance.now(), w = cv.width, h = cv.height
    return new Promise(res => {
      let done = false
      const fin = () => {
        if (done) return; done = true; recorder = null
        const blob = new Blob(chunks, { type: ((r.mimeType || mime || 'video/mp4').split(';')[0]) || 'video/mp4' })
        if (!blob.size) { onMsg('Nothing was recorded. If you are on a call, iPhone blocks recording until it ends.'); return res(null) }
        res({ blob, duration: (stopAt - recStart) / 1000, width: w, height: h, smoothing: sm, startedAt: recStart })
      }
      r.onstop = () => setTimeout(fin, 120); r.onerror = fin
      try { if (r.state !== 'inactive') r.stop(); else fin() } catch { fin() }
      setTimeout(fin, 10000)
    })
  }
  async function flip() {
    if (recorder) return
    st.facing = st.facing === 'user' ? 'environment' : 'user'
    try { await openCam() } catch { st.facing = st.facing === 'user' ? 'environment' : 'user'; try { await openCam() } catch { /* */ } onMsg('Could not switch camera') }
  }
  return {
    startRec, stopRec, flip, recording: () => !!recorder, size: () => ({ w: cv.width, h: cv.height }),
    stop: () => {
      alive = false; clearInterval(watchdog); cancelAnimationFrame(raf)
      try { if (recorder && recorder.state !== 'inactive') recorder.stop() } catch { /* */ }
      stream?.getTracks().forEach(t => t.stop()); vid.removeEventListener('pause', onPause); vid.remove()
    },
  }
}
