export type PageKind = 'info' | 'media'
export interface Page {
  id: string; title: string; body: string; kind: PageKind
  photos_min: number; photos_max: number; videos_min: number; videos_max: number
  extras: number; guidance: string
}
export interface Slot { key: string; type: 'photo' | 'video' | 'any'; label: string; required: boolean; n: number }
export type AStatus = 'not_started' | 'in_progress' | 'submitted' | 'under_review' | 'revision_requested' | 'approved' | 'cancelled'
export interface Assignment {
  id: string; workspace_id: string; creator_id: string; template_id: string | null; schedule_id: string | null
  title: string; category_name: string | null; summary: string; pages: Page[]; status: AStatus
  release_at: string; due_at: string | null; last_page: number; submitted_at: string | null; reviewed_at: string | null; created_at: string
}
export interface SFile {
  id: string; assignment_id: string; page_id: string; slot_key: string; kind: 'photo' | 'video'
  storage_path: string; original_name: string | null; mime: string | null; size_bytes: number; smoothing: number | null
  width: number | null; height: number | null; duration_s: number | null; is_current: boolean; created_at: string
}
export interface RevisionReq { id: string; page_id: string; slot_key: string | null; note: string; resolved_at: string | null; created_at: string }

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))

export function newPage(kind: PageKind = 'media'): Page {
  return { id: uid().slice(0, 8), title: kind === 'info' ? 'General Tips' : 'New section', body: '', kind,
    photos_min: kind === 'media' ? 1 : 0, photos_max: kind === 'media' ? 1 : 0, videos_min: 0, videos_max: 0, extras: kind === 'media' ? 2 : 0, guidance: '' }
}

export function slotsFor(p: Page): Slot[] {
  if (p.kind !== 'media') return []
  const s: Slot[] = []
  for (let i = 1; i <= Math.max(p.photos_max, p.photos_min); i++) s.push({ key: `photo-${i}`, type: 'photo', label: `Photo ${i}`, required: i <= p.photos_min, n: i })
  for (let i = 1; i <= Math.max(p.videos_max, p.videos_min); i++) s.push({ key: `video-${i}`, type: 'video', label: `Video ${i}`, required: i <= p.videos_min, n: i })
  for (let i = 1; i <= p.extras; i++) s.push({ key: `extra-${i}`, type: 'any', label: `Extra ${i}`, required: false, n: i })
  return s
}

export const STATUS_LABEL: Record<AStatus, string> = {
  not_started: 'To do', in_progress: 'In progress', submitted: 'Submitted', under_review: 'In review',
  revision_requested: 'Redo requested', approved: 'Approved', cancelled: 'Cancelled'
}
export const STATUS_TONE: Record<AStatus, string> = {
  not_started: 'todo', in_progress: 'prog', submitted: 'wait', under_review: 'wait', revision_requested: 'bad', approved: 'ok', cancelled: 'todo'
}

const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '').slice(0, 40) || 'Item'
export function deliveryName(creator: string, title: string, page: Page, pageIndex: number, slotKey: string, ext: string) {
  const [t, n] = slotKey.split('-')
  const tail = t === 'photo' ? `Photo${n.padStart(2, '0')}` : t === 'video' ? `Video${n.padStart(2, '0')}` : `Extra${n.padStart(2, '0')}`
  return `${clean(creator)}_${clean(title)}_${String(pageIndex + 1).padStart(2, '0')}-${clean(page.title)}_${tail}.${ext}`
}
export function extOf(mime: string | null, name: string | null) {
  const fromName = name && name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (fromName && fromName.length <= 5) return fromName
  if (!mime) return 'bin'
  if (mime.includes('jpeg')) return 'jpg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('heic')) return 'heic'
  if (mime.includes('quicktime')) return 'mov'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mp4')) return 'mp4'
  return 'bin'
}
export function fmtBytes(b: number) {
  if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB'
  if (b < 1024 ** 3) return (b / 1024 / 1024).toFixed(1) + ' MB'
  return (b / 1024 ** 3).toFixed(2) + ' GB'
}
export function fmtDate(s: string | null, withTime = true) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleString('en-GB', withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' })
}
export function dueLabel(s: string | null) {
  if (!s) return 'No deadline'
  const ms = new Date(s).getTime() - Date.now()
  if (ms < 0) return 'Overdue · ' + fmtDate(s)
  const h = ms / 36e5
  if (h < 24) return `Due in ${Math.max(1, Math.round(h))}h`
  return 'Due ' + fmtDate(s, false)
}
