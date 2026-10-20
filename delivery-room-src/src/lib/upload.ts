import * as tus from 'tus-js-client'
import { sb, SUPABASE_URL, SUPABASE_KEY } from './supabase'
import { uid, extOf } from './types'

export interface Meta { smoothing: number | null; width?: number | null; height?: number | null; duration?: number | null; name?: string | null }
export interface PendingRec { key: string; assignmentId: string; workspaceId: string; pageId: string; slot: string; kind: 'photo' | 'video'; blob: Blob; meta: Meta; createdAt: number }

const CHUNK = 6 * 1024 * 1024

async function uploadObject(path: string, blob: Blob, onPct: (n: number) => void) {
  const type = blob.type || 'application/octet-stream'
  if (blob.size <= CHUNK) {
    onPct(10)
    const { error } = await sb.storage.from('media').upload(path, blob, { contentType: type, upsert: false })
    if (error) throw error
    onPct(100); return
  }
  const { data } = await sb.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Signed out. Sign in again to upload.')
  await new Promise<void>((resolve, reject) => {
    const up = new tus.Upload(blob, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'x-upsert': 'false' },
      uploadDataDuringCreation: true, removeFingerprintOnSuccess: true, chunkSize: CHUNK,
      metadata: { bucketName: 'media', objectName: path, contentType: type, cacheControl: '3600' },
      onError: e => reject(e), onProgress: (s, t) => onPct(Math.round(s / t * 100)), onSuccess: () => resolve(),
    })
    up.findPreviousUploads().then(prev => { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start() })
  })
}

export async function uploadAndAttach(p: Omit<PendingRec, 'key' | 'createdAt'>, onPct: (n: number) => void) {
  const ext = extOf(p.blob.type, p.meta.name || null)
  const path = `${p.workspaceId}/${p.assignmentId}/${p.pageId}-${p.slot}-${uid().slice(0, 12)}.${ext}`
  await uploadObject(path, p.blob, onPct)
  const { data, error } = await sb.rpc('attach_file', {
    a_id: p.assignmentId, p_id: p.pageId, slot: p.slot, k: p.kind, path, oname: p.meta.name || `${p.slot}.${ext}`, m: p.blob.type || null,
    sz: p.blob.size, sm: p.meta.smoothing, w: p.meta.width ?? null, h: p.meta.height ?? null, dur: p.meta.duration ?? null })
  if (error) throw error
  return data as string
}

// --- local safety net: pending uploads survive a refresh/app close on this device
const DB = 'dr-pending', STORE = 'uploads'
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}
export async function savePending(rec: PendingRec) { try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(rec); t.oncomplete = res; t.onerror = () => rej(t.error) }) } catch { /* storage unavailable */ } }
export async function dropPending(key: string) { try { const d = await db(); await new Promise(res => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = res; t.onerror = res }) } catch { /* ignore */ } }
export async function listPending(assignmentId: string): Promise<PendingRec[]> {
  try { const d = await db(); return await new Promise(res => { const t = d.transaction(STORE, 'readonly'); const q = t.objectStore(STORE).getAll(); q.onsuccess = () => res((q.result as PendingRec[]).filter(r => r.assignmentId === assignmentId)); q.onerror = () => res([]) }) } catch { return [] }
}
export const pendingKey = (a: string, p: string, s: string) => `${a}|${p}|${s}`

export async function mediaMeta(blob: Blob): Promise<{ width: number | null; height: number | null; duration: number | null }> {
  const url = URL.createObjectURL(blob)
  try {
    if (blob.type.startsWith('image')) {
      return await new Promise(res => { const i = new Image(); i.onload = () => res({ width: i.naturalWidth, height: i.naturalHeight, duration: null }); i.onerror = () => res({ width: null, height: null, duration: null }); i.src = url })
    }
    return await new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.onloadedmetadata = () => res({ width: v.videoWidth || null, height: v.videoHeight || null, duration: isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null }); v.onerror = () => res({ width: null, height: null, duration: null }); setTimeout(() => res({ width: null, height: null, duration: null }), 4000); v.src = url })
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000) }
}
