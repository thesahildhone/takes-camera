// Reference pipeline for Socials shots.
//   {action:'caps'}                       -> which paid services are switched on (booleans only)
//   {action:'import', project_id}         -> fetch the reference video for a link and store it
//   multipart {project_id, file}          -> speech-to-text for the reference's audio (OpenAI)
// Secrets (Supabase > Edge Functions > Secrets): APIFY_TOKEN, OPENAI_API_KEY.
// Optional: APIFY_IG_ACTOR, APIFY_TT_ACTOR to swap the downloader without a code change.
import { createClient } from 'npm:@supabase/supabase-js@2'

const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const APIFY = Deno.env.get('APIFY_TOKEN') || ''
const OPENAI = Deno.env.get('OPENAI_API_KEY') || ''
const IG_ACTOR = Deno.env.get('APIFY_IG_ACTOR') || 'apify~instagram-scraper'
const TT_ACTOR = Deno.env.get('APIFY_TT_ACTOR') || 'clockworks~tiktok-scraper'
const MAX = 500 * 1024 * 1024
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })

function platformOf(u: URL) {
  const h = u.hostname.replace(/^www\.|^m\.|^vm\.|^vt\./, '')
  if (h.endsWith('instagram.com')) return 'instagram'
  if (h.endsWith('tiktok.com')) return 'tiktok'
  if (h === 'youtu.be' || h.endsWith('youtube.com')) return 'youtube'
  return 'other'
}
const NAME: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' }
function blockedHost(h: string) {
  return h === 'localhost' || /^(\d+\.){3}\d+$/.test(h) || h.includes(':') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('supabase.co')
}

// Different downloader actors name the file field differently, so look for the likely ones, then anything that looks like a video file.
function findVideoUrl(items: unknown): string | null {
  const hits: { url: string; score: number }[] = []
  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 6 || v == null) return
    if (typeof v === 'string') {
      if (!/^https?:\/\//.test(v) || /\.(jpe?g|png|webp|heic|gif)(\?|$)/i.test(v)) return
      const k = key.toLowerCase(); let score = 0
      if (/^(videourl|video_url|downloadurl|download_url|videourlnowatermark|downloadaddr|playaddr)$/.test(k)) score += 5
      else if (/video|download|media/.test(k)) score += 2
      if (/\.mp4(\?|$)/i.test(v)) score += 3
      if (/instagram\.com\/(reel|p)\/|tiktok\.com\/@/.test(v)) score = 0 // the post page itself, not a file
      if (score > 0) hits.push({ url: v, score })
    } else if (Array.isArray(v)) v.slice(0, 20).forEach(x => walk(x, key, depth + 1))
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, depth + 1)
  }
  walk(items, '', 0)
  hits.sort((a, b) => b.score - a.score)
  return hits[0]?.url || null
}

async function viaApify(link: string, plat: string): Promise<{ url?: string; error?: string }> {
  const actor = plat === 'instagram' ? IG_ACTOR : TT_ACTOR
  const input = plat === 'instagram'
    ? { directUrls: [link], resultsType: 'posts', resultsLimit: 1, addParentData: false, url: [link], reelLinks: [link], video_url: link }
    : { postURLs: [link], resultsPerPage: 1, shouldDownloadVideos: true, shouldDownloadCovers: false, shouldDownloadSubtitles: false, url: [link] }
  let r: Response
  try {
    r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=100&format=json`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${APIFY}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(115000) })
  } catch { return { error: `${NAME[plat]} took too long to answer. Try again, or upload the file.` } }
  if (r.status === 401 || r.status === 403) return { error: 'The download service rejected its key. Check APIFY_TOKEN in Supabase.' }
  if (r.status === 402) return { error: 'The download service is out of credit. Top up Apify, or upload the file.' }
  if (r.status === 404) return { error: 'The download service could not find its downloader. Check the actor name.' }
  if (!r.ok) return { error: `The download service returned an error (${r.status}). Try again, or upload the file.` }
  let items: unknown
  try { items = await r.json() } catch { return { error: 'The download service sent back something unreadable.' } }
  const url = findVideoUrl(items)
  if (!url) return { error: `Couldn't get this ${NAME[plat]} video. It may be private, removed, or a photo post. Upload the file instead.` }
  return { url }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('Authorization') || ''
  const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } })
  const admin = createClient(URL_, SERVICE)
  const ctype = req.headers.get('content-type') || ''

  // ---------- speech-to-text
  if (ctype.includes('multipart/form-data')) {
    let form: FormData
    try { form = await req.formData() } catch { return json({ error: 'Bad request' }, 400) }
    const pid = String(form.get('project_id') || ''), file = form.get('file')
    const { data: p } = await user.from('social_projects').select('id, workspace_id').eq('id', pid).maybeSingle()
    if (!p) return json({ error: 'Project not found' }, 404)
    if (!OPENAI) return json({ ok: false, code: 'no_key', error: 'Automatic transcripts are not switched on yet.' })
    if (!(file instanceof File) || !file.size) return json({ ok: false, error: 'No audio received.' })
    if (file.size > 25 * 1024 * 1024) return json({ ok: false, code: 'too_big', error: 'The audio is too long to transcribe automatically (limit is about 12 minutes).' })
    const out = new FormData()
    out.append('file', file, file.name || 'audio.wav'); out.append('model', 'whisper-1'); out.append('response_format', 'verbose_json')
    let r: Response
    try { r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI}` }, body: out, signal: AbortSignal.timeout(120000) }) }
    catch { return json({ ok: false, error: 'The transcript service took too long. Try again.' }) }
    if (r.status === 401) return json({ ok: false, code: 'bad_key', error: 'The transcript service rejected its key. Check OPENAI_API_KEY in Supabase.' })
    if (r.status === 429) return json({ ok: false, error: 'The transcript service is out of credit or busy. Check your OpenAI billing, then try again.' })
    if (!r.ok) return json({ ok: false, error: `The transcript service returned an error (${r.status}).` })
    const d = await r.json() as { text?: string; segments?: { start: number; end: number; text: string }[] }
    await admin.from('audit_events').insert({ workspace_id: p.workspace_id, action: 'social.reference.transcribed', target: pid })
    return json({ ok: true, text: (d.text || '').trim(), segs: (d.segments || []).map(s => ({ start: s.start, end: s.end, text: s.text.trim() })).filter(s => s.text) })
  }

  let body: { action?: string; project_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  if (body.action === 'caps') {
    const { data: u } = await user.auth.getUser()
    if (!u?.user) return json({ error: 'Sign in first' }, 401)
    return json({ ok: true, link_import: !!APIFY, transcripts: !!OPENAI })
  }

  // ---------- import
  const pid = body.project_id || ''
  // RLS on the user's client proves they are staff of this project's workspace
  const { data: p } = await user.from('social_projects').select('id, workspace_id, reference_url').eq('id', pid).maybeSingle()
  if (!p) return json({ error: 'Project not found' }, 404)
  const fail = async (msg: string, status = 'failed') => {
    await admin.from('social_projects').update({ import_status: status, import_error: msg }).eq('id', pid)
    return json({ ok: false, status, error: msg })
  }
  let u: URL
  try { u = new URL((p.reference_url || '').trim()) } catch { return fail('That link is not a valid web address.') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('Only web links can be imported.')
  const plat = platformOf(u)
  await admin.from('social_projects').update({ ref_platform: plat, import_status: 'importing', import_error: null }).eq('id', pid)
  let src = u, fromService = false
  if (plat === 'youtube') return fail("YouTube links show as an embedded player. Upload the file if you need the script or sound pulled out.", 'awaiting_upload')
  if (plat === 'instagram' || plat === 'tiktok') {
    if (!APIFY) return fail(`Automatic ${NAME[plat]} downloads are not switched on yet. The link shows as an embedded player, or upload the video file.`, 'awaiting_upload')
    const got = await viaApify(u.toString(), plat)
    if (!got.url) return fail(got.error || 'Download failed.', 'awaiting_upload')
    try { src = new URL(got.url) } catch { return fail('The download service sent back a bad file link.', 'awaiting_upload') }
    fromService = true
  }
  if (blockedHost(src.hostname)) return fail('This address cannot be imported.')
  let r: Response
  try { r = await fetch(src, { redirect: 'follow', signal: AbortSignal.timeout(25000) }) } catch { return fail('The video file did not download. Try again, or upload the file.', fromService ? 'awaiting_upload' : 'failed') }
  if (r.status === 401 || r.status === 403) return fail(`The site refused access (${r.status}). Upload a copy instead.`, 'awaiting_upload')
  if (!r.ok || !r.body) return fail(`The site returned an error (${r.status}).`, fromService ? 'awaiting_upload' : 'failed')
  const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const len = Number(r.headers.get('content-length') || 0)
  const looksVideo = type.startsWith('video/') || (fromService && (type === 'application/octet-stream' || type === 'binary/octet-stream'))
  if (!looksVideo) { try { await r.body.cancel() } catch { /* */ } return fail('That link opens a web page, not a video file. Upload the video instead.', 'awaiting_upload') }
  if (len > MAX) { try { await r.body.cancel() } catch { /* */ } return fail('The video is over 500 MB. Upload a shorter or compressed copy.', 'awaiting_upload') }
  const ext = type.includes('quicktime') ? 'mov' : type.includes('webm') ? 'webm' : 'mp4'
  const path = `${p.workspace_id}/ref/${p.id}/${crypto.randomUUID()}.${ext}`
  const mime = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'].includes(type) ? type : 'video/mp4'
  const up = await fetch(`${URL_}/storage/v1/object/social/${path}`, {
    method: 'POST', body: r.body, headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'content-type': mime, 'x-upsert': 'false', ...(len ? { 'content-length': String(len) } : {}) },
    // @ts-ignore Deno streaming upload
    duplex: 'half',
  })
  if (!up.ok) return fail('Saving the video failed. Try again, or upload the file.')
  await admin.from('social_projects').update({ ref_video_path: path, ref_mime: mime, import_status: 'ready', import_error: null, audio_status: 'none', ref_audio_path: null, transcript_status: 'none' }).eq('id', pid)
  await admin.from('audit_events').insert({ workspace_id: p.workspace_id, action: 'social.reference.imported', target: pid, meta: { host: u.hostname, via: fromService ? 'service' : 'direct' } })
  return json({ ok: true, status: 'ready', path })
})
