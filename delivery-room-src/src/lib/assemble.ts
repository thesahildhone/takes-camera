// Joins the creator's clips into one video on the phone, by playing each trimmed clip into a canvas and
// re-recording it. Runs in real time (a 40 s video takes about 40 s), but needs no server and no big download,
// and it keeps trims frame-accurate. When the agency has the rights, a second copy is recorded in the same pass
// with the reference audio laid under each clip at the exact point it was filmed against.
import { clipLen, type Clip } from './drafts'

export interface AssembleOpts {
  clips: Clip[]
  keepMic: boolean
  music: AudioBuffer | null           // only passed when rights are 'licensed'
  musicGain?: number
  onPct: (p: number, label: string) => void
}
export interface Assembled { clean: Blob; mix: Blob | null; duration: number; width: number; height: number; mixNote: string | null }

const AC = () => (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)

export function recorderMime() {
  const apple = /Apple/.test(navigator.vendor || '')
  const prefs = apple ? ['video/mp4', 'video/mp4;codecs=avc1'] : ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return prefs.find(m => { try { return MediaRecorder.isTypeSupported(m) } catch { return false } }) || ''
}

/** Call synchronously inside the tap that starts submission, so iOS lets the hidden player make sound. */
export function primeAssembler() {
  const ctx = new (AC())(); ctx.resume().catch(() => {})
  const v = document.createElement('video'); v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'
  v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0'; document.body.appendChild(v)
  v.play().catch(() => {})
  return { ctx, v }
}

export function canSkipRender(clips: Clip[], keepMic: boolean) {
  return clips.length === 1 && keepMic && clips[0].trimIn < 0.05 && clips[0].duration - clips[0].trimOut < 0.05
}

export async function assemble(o: AssembleOpts, primed: { ctx: AudioContext; v: HTMLVideoElement }): Promise<Assembled> {
  const { clips } = o
  if (!clips.length) throw new Error('No clips to join')
  const total = clips.reduce((n, c) => n + clipLen(c), 0)
  const W = clips[0].width || 1080, H = clips[0].height || 1920
  const { ctx, v } = primed
  const cleanup: (() => void)[] = [() => v.remove(), () => ctx.close().catch(() => {})]
  try {
    if (!o.music && canSkipRender(clips, o.keepMic)) {
      o.onPct(100, 'Ready')
      return { clean: clips[0].blob, mix: null, duration: clipLen(clips[0]), width: W, height: H, mixNote: null }
    }
    await ctx.resume()
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const g = cv.getContext('2d')!
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
    const vstream = (cv as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30)
    const src = ctx.createMediaElementSource(v)
    const micGain = ctx.createGain(); micGain.gain.value = o.keepMic ? 1 : 0
    src.connect(micGain)
    const dClean = ctx.createMediaStreamDestination(); micGain.connect(dClean)
    let dMix: MediaStreamAudioDestinationNode | null = null, musicBus: GainNode | null = null
    if (o.music) {
      dMix = ctx.createMediaStreamDestination(); micGain.connect(dMix)
      musicBus = ctx.createGain(); musicBus.gain.value = o.musicGain ?? 1; musicBus.connect(dMix)
    }
    const mime = recorderMime()
    const mk = (audio: MediaStreamAudioDestinationNode) => {
      const s = new MediaStream([vstream.getVideoTracks()[0].clone(), ...audio.stream.getAudioTracks()])
      const r = new MediaRecorder(s, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : {})
      const chunks: Blob[] = []; r.ondataavailable = e => { if (e.data?.size) chunks.push(e.data) }
      const done = new Promise<Blob>((res, rej) => { r.onstop = () => res(new Blob(chunks, { type: (r.mimeType || mime || 'video/mp4').split(';')[0] })); r.onerror = () => rej(new Error('Recorder failed')) })
      return { r, done }
    }
    const recs = [mk(dClean), ...(dMix ? [mk(dMix)] : [])]
    const canPause = typeof recs[0].r.pause === 'function'

    let drawing = true
    const draw = () => {
      if (!drawing) return
      if (v.readyState >= 2 && v.videoWidth) {
        const s = Math.min(W / v.videoWidth, H / v.videoHeight), dw = v.videoWidth * s, dh = v.videoHeight * s
        g.fillRect(0, 0, W, H); g.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh)
      }
      requestAnimationFrame(draw)
    }
    cleanup.push(() => { drawing = false })
    requestAnimationFrame(draw)

    let doneSecs = 0, started = false
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i], url = URL.createObjectURL(c.blob); cleanup.push(() => URL.revokeObjectURL(url))
      o.onPct(Math.round(doneSecs / total * 100), `Joining clip ${i + 1} of ${clips.length}`)
      v.src = url
      await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error(`Clip ${i + 1} could not be read`)); v.load() })
      await new Promise<void>(res => { v.onseeked = () => res(); v.currentTime = Math.max(0, c.trimIn); setTimeout(res, 1500) })
      await new Promise(r => setTimeout(r, 60)) // let the first frame land on the canvas
      if (!started) { recs.forEach(x => x.r.start(500)); started = true } else if (canPause) recs.forEach(x => x.r.state === 'paused' && x.r.resume())
      let music: AudioBufferSourceNode | null = null
      if (o.music && musicBus && c.refStart != null) {
        music = ctx.createBufferSource(); music.buffer = o.music; music.connect(musicBus)
        const off = c.refStart + c.trimIn // can be slightly negative: the clip began just before the sound did
        const delay = Math.max(0, -off), from = Math.max(0, off)
        if (from < o.music.duration && delay < clipLen(c)) music.start(ctx.currentTime + delay, from, clipLen(c) - delay)
      }
      await v.play()
      await new Promise<void>(res => {
        const t = setInterval(() => {
          o.onPct(Math.min(99, Math.round((doneSecs + Math.max(0, v.currentTime - c.trimIn)) / total * 100)), `Joining clip ${i + 1} of ${clips.length}`)
          if (v.currentTime >= c.trimOut - 0.02 || v.ended) { clearInterval(t); res() }
        }, 15)
      })
      v.pause(); try { music?.stop() } catch { /* already stopped */ }
      if (canPause && i < clips.length - 1) recs.forEach(x => x.r.state === 'recording' && x.r.pause())
      doneSecs += clipLen(c)
    }
    recs.forEach(x => { if (x.r.state !== 'inactive') x.r.stop() })
    const [clean, mix] = await Promise.all(recs.map(x => x.done))
    o.onPct(100, 'Ready')
    if (!clean.size) throw new Error('Joining produced an empty video')
    return { clean, mix: mix && mix.size ? mix : null, duration: total, width: W, height: H, mixNote: o.music && !(mix && mix.size) ? 'Music version could not be made on this phone' : null }
  } finally { cleanup.forEach(f => { try { f() } catch { /* ignore */ } }) }
}
