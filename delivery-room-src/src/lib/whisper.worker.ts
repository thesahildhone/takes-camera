/// <reference lib="webworker" />
// Speech-to-text runs on the agency's own device. No audio leaves the browser and no API key is needed.
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false
type Asr = (a: Float32Array, o: Record<string, unknown>) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>
let asr: Asr | null = null

self.onmessage = async (e: MessageEvent<{ pcm: Float32Array; lang?: string }>) => {
  try {
    if (!asr) {
      const hasGPU = 'gpu' in navigator
      asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', {
        device: hasGPU ? 'webgpu' : 'wasm', dtype: hasGPU ? 'fp32' : 'q8',
        progress_callback: (p: { status: string; progress?: number; file?: string }) => {
          if (p.status === 'progress' && typeof p.progress === 'number') self.postMessage({ type: 'load', pct: Math.round(p.progress), file: p.file })
        },
      }) as unknown as Asr
    }
    self.postMessage({ type: 'run' })
    const out = await asr(e.data.pcm, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, ...(e.data.lang ? { language: e.data.lang } : {}) })
    const segs = (out.chunks || []).map(c => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0, text: c.text.trim() })).filter(s => s.text)
    self.postMessage({ type: 'done', text: out.text.trim(), segs })
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message || 'Transcription failed' })
  }
}
