import { sb } from './supabase'

export type Mode = 'talking' | 'dance' | 'both' | 'reference'
export type ImportStatus = 'none' | 'importing' | 'failed' | 'awaiting_upload' | 'uploading' | 'processing' | 'ready' | 'link_only'
export type Rights = 'licensed' | 'unknown' | 'not_permitted'
export type SAStatus = 'not_started' | 'in_progress' | 'submitted' | 'revision_requested' | 'approved' | 'cancelled'

export interface ContentType { id: string; workspace_id: string; name: string; position: number; archived_at: string | null }
export interface Section { id: string; workspace_id: string; content_type_id: string; title: string; description: string; position: number; archived_at: string | null }
export interface Seg { start: number; end: number; text: string }
export interface Project {
  id: string; workspace_id: string; section_id: string; title: string; description: string; position: number; mode: Mode
  instructions: string; script: string; transcript_raw: Seg[] | null; transcript_approved: boolean
  transcript_status: 'none' | 'processing' | 'ready' | 'failed'; transcript_error: string | null
  reference_url: string | null; ref_platform: string | null; ref_video_path: string | null; ref_mime: string | null; ref_audio_path: string | null; ref_duration: number | null
  import_status: ImportStatus; import_error: string | null
  audio_status: 'none' | 'processing' | 'ready' | 'failed'; audio_error: string | null
  rights_status: Rights; keep_mic: boolean
  publication_status: 'draft' | 'published' | 'archived'; published_at: string | null; created_at: string; updated_at: string
}
export interface SAssignment { id: string; workspace_id: string; project_id: string; creator_id: string; status: SAStatus; due_at: string | null; created_at: string; updated_at: string }
export interface Submission {
  id: string; assignment_id: string; workspace_id: string; project_id: string; creator_id: string; version: number
  clean_path: string; mix_path: string | null; mix_note: string | null; mime: string | null; size_bytes: number; duration_s: number | null
  width: number | null; height: number | null; smoothing: number | null; clip_count: number | null; source: 'camera' | 'upload'
  meta: Record<string, unknown>; status: 'submitted' | 'revision_requested' | 'approved'; review_note: string | null; reviewed_at: string | null; created_at: string
}

export const MODE_LABEL: Record<Mode, string> = { talking: 'Talking (script)', dance: 'Dance / lip-sync (audio)', both: 'Talking + audio', reference: 'Reference only' }
export const RIGHTS_LABEL: Record<Rights, string> = { licensed: 'Licensed / we have the rights', unknown: 'Unknown', not_permitted: 'Not permitted' }
export const SA_LABEL: Record<SAStatus, string> = { not_started: 'Not filmed yet', in_progress: 'In progress', submitted: 'Sent', revision_requested: 'Redo requested', approved: 'Approved', cancelled: 'Cancelled' }
export const SA_TONE: Record<SAStatus, string> = { not_started: 'todo', in_progress: 'prog', submitted: 'wait', revision_requested: 'bad', approved: 'ok', cancelled: 'todo' }
/** "Sent" = submitted or approved. "Approved" is counted separately. Used everywhere so labels stay consistent. */
export const isSent = (s: SAStatus) => s === 'submitted' || s === 'approved'
export const isToFilm = (s: SAStatus) => s === 'not_started' || s === 'in_progress' || s === 'revision_requested'
export const usesScript = (m: Mode) => m === 'talking' || m === 'both'
export const usesAudio = (m: Mode) => m === 'dance' || m === 'both'

/** Mirrors social_project_ready() in the database. */
export function readyProblem(p: Project): string | null {
  if (usesScript(p.mode) && (!p.transcript_approved || !p.script.trim())) return 'Approve the script first'
  if (usesAudio(p.mode) && p.audio_status !== 'ready' && p.rights_status !== 'not_permitted') return 'Reference audio is not ready'
  if (!p.ref_video_path && !(p.reference_url || '').trim()) return 'Add a reference video or link'
  return null
}

export interface Ref { platform: 'instagram' | 'tiktok' | 'youtube' | 'file' | 'other'; embed: string | null; label: string }
export function parseRef(url: string | null): Ref | null {
  if (!url) return null
  let u: URL
  try { u = new URL(url.trim()) } catch { return null }
  const h = u.hostname.replace(/^www\.|^m\./, '')
  if (h.endsWith('instagram.com')) {
    const m = u.pathname.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/)
    return { platform: 'instagram', embed: m ? `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed/` : null, label: 'Instagram' }
  }
  if (h.endsWith('tiktok.com')) {
    const m = u.pathname.match(/\/video\/(\d+)/)
    return { platform: 'tiktok', embed: m ? `https://www.tiktok.com/embed/v2/${m[1]}` : null, label: 'TikTok' }
  }
  if (h === 'youtu.be' || h.endsWith('youtube.com')) {
    const id = h === 'youtu.be' ? u.pathname.slice(1) : (u.searchParams.get('v') || u.pathname.match(/\/(shorts|embed)\/([A-Za-z0-9_-]+)/)?.[2] || '')
    return { platform: 'youtube', embed: id ? `https://www.youtube.com/embed/${id}` : null, label: 'YouTube' }
  }
  if (/\.(mp4|mov|m4v|webm)$/i.test(u.pathname)) return { platform: 'file', embed: null, label: 'Video file' }
  return { platform: 'other', embed: null, label: h }
}

export async function signed(paths: (string | null | undefined)[], bucket = 'social'): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter(Boolean) as string[])]
  if (!list.length) return {}
  const { data } = await sb.storage.from(bucket).createSignedUrls(list, 3600)
  const m: Record<string, string> = {}
  ;(data || []).forEach(x => { if (x.path && x.signedUrl) m[x.path] = x.signedUrl })
  return m
}

export const fmtDur = (s: number | null | undefined) => {
  if (s == null || !isFinite(s)) return '–'
  const t = Math.max(0, Math.round(s * 10) / 10), m = Math.floor(t / 60), r = t - m * 60
  return m ? `${m}:${r.toFixed(0).padStart(2, '0')}` : `${r.toFixed(1)}s`
}
export const pad2 = (n: number) => String(n).padStart(2, '0')
export const instructionLines = (t: string) => t.split('\n').map(x => x.trim()).filter(Boolean)
