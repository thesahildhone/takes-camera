// Clip drafts live on this device (IndexedDB) until the creator submits. Each clip is saved the moment it is recorded.

export interface Clip {
  id: string; blob: Blob; duration: number; width: number; height: number; smoothing: number
  trimIn: number; trimOut: number           // seconds within the clip
  refStart: number | null                   // where in the reference audio this clip starts (dance mode)
  scriptAt: number | null                   // teleprompter restart position (talking mode)
  thumb: string | null; createdAt: number
}
export interface Output {
  subId: string; clean: Blob; mix: Blob | null; mixNote: string | null; duration: number; width: number; height: number
  source: 'camera' | 'upload'; clips: number; smoothing: number | null; uploaded: { clean?: string; mix?: string }
}
export interface Draft { key: string; assignmentId: string; clips: Clip[]; order: string[]; updatedAt: number; out?: Output | null }

const DB = 'dr-social', STORE = 'drafts'
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' })
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
}
export const draftKey = (assignmentId: string) => 'a:' + assignmentId

export async function loadDraft(assignmentId: string): Promise<Draft | null> {
  try {
    const d = await db()
    return await new Promise(res => { const q = d.transaction(STORE, 'readonly').objectStore(STORE).get(draftKey(assignmentId)); q.onsuccess = () => res((q.result as Draft) || null); q.onerror = () => res(null) })
  } catch { return null }
}
/** Returns false if the browser refused to store it (private mode, storage full). */
export async function saveDraft(dr: Draft): Promise<boolean> {
  try {
    const d = await db()
    await new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put({ ...dr, updatedAt: Date.now() }); t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error) })
    return true
  } catch { return false }
}
export async function dropDraft(assignmentId: string) {
  try { const d = await db(); await new Promise(res => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(draftKey(assignmentId)); t.oncomplete = res; t.onerror = res }) } catch { /* ignore */ }
}
export async function persistRequested() { try { if (navigator.storage?.persist) await navigator.storage.persist() } catch { /* ignore */ } }

export const clipLen = (c: Clip) => Math.max(0, c.trimOut - c.trimIn)
export const ordered = (d: Draft) => d.order.map(id => d.clips.find(c => c.id === id)).filter(Boolean) as Clip[]
