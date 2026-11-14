// Turns a stored reference video into what creators need: the sound (always) and a script (talking shots).
// Sound is pulled out in the browser. The script comes from the server when transcripts are switched on,
// otherwise from an on-device model on computers. Phones can't run that model reliably.
import { sb, errMsg } from './supabase'
import { uploadObject } from './upload'
import { extractAudio, pcmToWav } from './media'
import { signed, usesScript, type Project, type Seg } from './social'
import { uid } from './types'

export interface Caps { link_import: boolean; transcripts: boolean }
let capsP: Promise<Caps> | null = null
export function getCaps(): Promise<Caps> {
  capsP ||= sb.functions.invoke('social-import', { body: { action: 'caps' } })
    .then(({ data }) => ({ link_import: !!data?.link_import, transcripts: !!data?.transcripts }))
    .catch(() => ({ link_import: false, transcripts: false }))
  return capsP
}
export const isPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))
export const PLACEHOLDER_TITLES = ['New shot', 'Untitled shot']

async function patch(id: string, fields: Partial<Project>): Promise<Project> {
  const { data, error } = await sb.from('social_projects').update(fields).eq('id', id).select('*').single()
  if (error) throw error
  return data as Project
}
function titleFrom(text: string) {
  const first = text.split(/(?<=[.!?])\s+/)[0].trim().replace(/[.!?]+$/, '')
  const t = first.length > 64 ? first.slice(0, 61).replace(/\s+\S*$/, '') + '…' : first
  return t ? `“${t}”` : null
}

async function serverTranscript(projectId: string, pcm16k: Float32Array): Promise<{ text: string; segs: Seg[] } | { code: string; error: string }> {
  const fd = new FormData(); fd.append('project_id', projectId); fd.append('file', pcmToWav(pcm16k, 16000), 'speech.wav')
  const { data, error } = await sb.functions.invoke('social-import', { body: fd })
  if (error) return { code: 'unreachable', error: 'The transcript service did not respond.' }
  if (data?.ok) return { text: data.text || '', segs: data.segs || [] }
  return { code: data?.code || 'failed', error: data?.error || 'Transcript failed.' }
}

/** Ask the server to download the reference for the project's saved link. Returns the refreshed project. */
export async function importReference(projectId: string): Promise<Project> {
  await patch(projectId, { import_status: 'importing', import_error: null } as Partial<Project>)
  const { error } = await sb.functions.invoke('social-import', { body: { action: 'import', project_id: projectId } })
  if (error) await patch(projectId, { import_status: 'failed', import_error: 'The import service did not respond. Try again, or upload the file.' } as Partial<Project>)
  const { data } = await sb.from('social_projects').select('*').eq('id', projectId).single()
  return data as Project
}

export async function processReference(proj: Project, onStage: (s: string) => void, blob?: Blob): Promise<Project> {
  if (!proj.ref_video_path) return proj
  const needScript = usesScript(proj.mode)
  let cur = await patch(proj.id, { audio_status: 'processing', audio_error: null, ...(needScript ? { transcript_status: 'processing', transcript_error: null } : {}) } as Partial<Project>)
  onStage('Reading the reference video…')
  if (!blob) {
    const u = (await signed([proj.ref_video_path]))[proj.ref_video_path]
    const r = u ? await fetch(u) : null
    if (!r?.ok) { return patch(proj.id, { audio_status: 'failed', audio_error: 'Could not open the stored reference.', ...(needScript ? { transcript_status: 'failed', transcript_error: 'Could not open the stored reference.' } : {}) } as Partial<Project>) }
    blob = await r.blob()
  }
  let ex: Awaited<ReturnType<typeof extractAudio>>
  try { onStage('Pulling out the sound…'); ex = await extractAudio(blob) }
  catch (e) { return patch(proj.id, { audio_status: 'failed', audio_error: errMsg(e), ...(needScript ? { transcript_status: 'failed', transcript_error: 'No sound to transcribe. Type the script yourself.' } : {}) } as Partial<Project>) }
  const apath = `${proj.workspace_id}/ref/${proj.id}/audio-${uid().slice(0, 12)}.wav`
  onStage('Saving the sound…')
  try { await uploadObject(apath, ex.wav, () => {}, 'social') }
  catch (e) { return patch(proj.id, { audio_status: 'failed', audio_error: 'Saving the sound failed: ' + errMsg(e), ...(needScript ? { transcript_status: 'none' } : {}) } as Partial<Project>) }
  cur = await patch(proj.id, { ref_audio_path: apath, audio_status: 'ready', ref_duration: Math.round(ex.duration * 100) / 100 } as Partial<Project>)
  if (!needScript) return cur

  onStage('Writing out the script…')
  let out: { text: string; segs: Seg[] } | null = null, why = ''
  const srv = await serverTranscript(proj.id, ex.pcm16k)
  if ('text' in srv) out = srv
  else if (srv.code === 'no_key' || srv.code === 'unreachable') {
    if (isPhone()) why = 'Automatic transcripts are not switched on yet. Type the script here, or open this shot on a computer.'
    else { try { const { transcribe } = await import('./whisper'); out = await transcribe(ex.pcm16k, onStage) } catch (e) { why = errMsg(e) } }
  } else why = srv.error
  if (!out) return patch(proj.id, { transcript_status: 'failed', transcript_error: why || 'Transcript failed.' } as Partial<Project>)
  if (!out.text.trim()) return patch(proj.id, { transcript_status: 'failed', transcript_error: 'No speech was found in this video. Type the script, or switch the shot to Reference only.' } as Partial<Project>)
  const keepScript = cur.transcript_approved && cur.script.trim()
  const newTitle = PLACEHOLDER_TITLES.includes(cur.title) ? titleFrom(out.text) : null
  return patch(proj.id, { transcript_raw: out.segs, transcript_status: 'ready', ...(keepScript ? {} : { script: out.text, transcript_approved: false }), ...(newTitle ? { title: newTitle } : {}) } as Partial<Project>)
}
