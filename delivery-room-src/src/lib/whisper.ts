import type { Seg } from './social'

export function transcribe(pcm16k: Float32Array, onStatus: (s: string) => void): Promise<{ text: string; segs: Seg[] }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
    const end = () => w.terminate()
    w.onmessage = (e: MessageEvent<{ type: string; pct?: number; text?: string; segs?: Seg[]; message?: string }>) => {
      const d = e.data
      if (d.type === 'load') onStatus(`Downloading speech model (first time only)… ${d.pct ?? 0}%`)
      else if (d.type === 'run') onStatus('Listening to the reference…')
      else if (d.type === 'done') { end(); resolve({ text: d.text || '', segs: d.segs || [] }) }
      else if (d.type === 'error') { end(); reject(new Error(d.message)) }
    }
    w.onerror = e => { end(); reject(new Error(e.message || 'Transcription could not start in this browser')) }
    onStatus('Starting speech-to-text…')
    w.postMessage({ pcm: pcm16k }, [pcm16k.buffer])
  })
}
