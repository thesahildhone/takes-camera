// Browser-side media helpers: pull the audio track out of a reference video, resample it, encode WAV.

type ACtor = typeof AudioContext
const AC = (): ACtor => (window.AudioContext || (window as unknown as { webkitAudioContext: ACtor }).webkitAudioContext)

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const buf = await blob.arrayBuffer()
  const ctx = new (AC())()
  try {
    return await new Promise<AudioBuffer>((res, rej) => {
      const p = ctx.decodeAudioData(buf, res, e => rej(e || new Error('decode failed')))
      if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(res, rej)
    })
  } catch {
    throw new Error('This video has no readable audio track, or the format is not supported by this browser.')
  } finally { ctx.close().catch(() => {}) }
}

export async function resample(buf: AudioBuffer, rate: number, channels = 1): Promise<AudioBuffer> {
  const len = Math.ceil(buf.duration * rate)
  const off = new OfflineAudioContext(channels, len, rate)
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start()
  return off.startRendering()
}

export function toWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, rate = buf.sampleRate, n = buf.length
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true)
  out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true)
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2 }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

/** Extract a playback-quality WAV (stereo 44.1k) plus a 16 kHz mono buffer for speech-to-text. */
export async function extractAudio(video: Blob) {
  const buf = await decodeAudio(video)
  let peak = 0
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i])) }
  if (peak < 0.002) throw new Error('The reference video is silent.')
  const play = await resample(buf, 44100, Math.min(2, buf.numberOfChannels))
  const speech = await resample(buf, 16000, 1)
  return { wav: toWav(play), pcm16k: speech.getChannelData(0).slice(), duration: buf.duration }
}

export function videoMeta(src: Blob | string, timeoutMs = 15000): Promise<{ width: number; height: number; duration: number }> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src)
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.playsInline = true
    const done = () => { if (typeof src !== 'string') URL.revokeObjectURL(url) }
    v.onloadedmetadata = () => {
      const fin = () => { res({ width: v.videoWidth, height: v.videoHeight, duration: v.duration }); done() }
      if (isFinite(v.duration)) fin()
      else { v.currentTime = 1e7; v.ontimeupdate = () => { v.ontimeupdate = null; fin() } } // webm from MediaRecorder reports Infinity until seeked
    }
    v.onerror = () => { done(); rej(new Error('This file is not a playable video.')) }
    setTimeout(() => { done(); rej(new Error('Timed out reading the video.')) }, timeoutMs)
    v.src = url
  })
}

/** Grab a small JPEG thumbnail from a video blob at time t. */
export function thumbAt(blob: Blob, t = 0.1): Promise<string | null> {
  const url = URL.createObjectURL(blob)
  return new Promise(res => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'
    const fin = (r: string | null) => { URL.revokeObjectURL(url); res(r) }
    v.onloadeddata = () => { try { v.currentTime = Math.min(t, (isFinite(v.duration) ? v.duration : 1) / 2) } catch { fin(null) } }
    v.onseeked = () => {
      const c = document.createElement('canvas'); const s = 160 / Math.max(1, v.videoWidth); c.width = 160; c.height = Math.round(v.videoHeight * s) || 284
      try { c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height); fin(c.toDataURL('image/jpeg', .6)) } catch { fin(null) }
    }
    v.onerror = () => fin(null); setTimeout(() => fin(null), 8000)
    v.src = url
  })
}
