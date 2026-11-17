// Writing help for agencies: draft shots for a section, tighten a script, draft an OF set outline.
// Secret: ANTHROPIC_API_KEY (Supabase > Edge Functions > Secrets). Optional: ANTHROPIC_MODEL.
import { createClient } from 'npm:@supabase/supabase-js@2'

const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const MODELS = [Deno.env.get('ANTHROPIC_MODEL') || 'claude-haiku-5-5', 'claude-sonnet-5-5']
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)

const SYSTEM = `You help a creator-management agency plan short-form content. You write in a natural, spoken, social-media voice: short sentences, no hashtags, no emojis, no stage directions inside scripts.
Keep everything suitable for mainstream social platforms: flirty and playful is fine, explicit sexual wording is not. If the brief asks for explicit content, write a suggestive, non-explicit version instead.
Reply with one JSON object only, no prose before or after it.`

async function ask(prompt: string, maxTokens: number): Promise<{ text?: string; error?: string; code?: string }> {
  for (const model of MODELS) {
    let r: Response
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }) })
    } catch { return { error: 'The writing service took too long. Try again.' } }
    if (r.status === 404) continue // model name not available on this key: try the next one
    if (r.status === 401 || r.status === 403) return { code: 'bad_key', error: 'The writing service rejected its key. Check ANTHROPIC_API_KEY in Supabase.' }
    if (r.status === 429 || r.status === 529) return { error: 'The writing service is busy or out of credit. Try again in a minute.' }
    if (!r.ok) return { error: `The writing service returned an error (${r.status}).` }
    const d = await r.json() as { content?: { type: string; text?: string }[] }
    return { text: (d.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('') }
  }
  return { error: 'The writing service has no model available. Set ANTHROPIC_MODEL in Supabase.' }
}
function parse(text: string): Record<string, unknown> | null {
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return null }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const user = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
  const admin = createClient(URL_, SERVICE)
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const ws = clip(b.workspace_id, 40)
  const { data: staff } = await user.rpc('is_staff', { ws })
  if (!staff) return json({ error: 'Not allowed' }, 403)
  if (b.action === 'caps') return json({ ok: true, ai: !!KEY })
  if (!KEY) return json({ ok: false, code: 'no_key', error: 'Write with AI is not switched on yet.' })
  const since = new Date(Date.now() - 3600e3).toISOString()
  const { count } = await admin.from('audit_events').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).eq('action', 'ai.write').gte('created_at', since)
  if ((count || 0) >= 40) return json({ ok: false, error: 'That is a lot of AI writing in one hour. Try again a little later.' })
  const brief = clip(b.brief, 1500).trim()

  let out: Record<string, unknown> | null = null, res: { text?: string; error?: string; code?: string }
  if (b.action === 'shots') {
    const n = Math.max(1, Math.min(15, Number(b.count) || 5)), kind = b.kind === 'reference' ? 'reference' : 'talking'
    if (!brief) return json({ ok: false, error: 'Describe what you want first.' })
    res = await ask(`Write ${n} different short-form video ideas for the section "${clip(b.section, 60)}".\nBrief from the agency: ${brief}\n\n${kind === 'talking'
      ? 'Each one is a talking-to-camera video. "script" is exactly what the creator says, 1 to 4 short sentences, with a strong first line.'
      : 'Each one has no spoken script. Leave "script" as an empty string and describe the action in the notes.'}
"title" is a 3 to 7 word label for the idea. "notes" is 2 or 3 lines separated by \\n, each starting with Hook:, Setup: or Delivery:, telling the creator how to film it.
JSON shape: {"shots":[{"title":"","script":"","notes":""}]}`, 3500)
    out = res.text ? parse(res.text) : null
    if (out && Array.isArray(out.shots)) out = { shots: (out.shots as Record<string, unknown>[]).slice(0, n).map(s => ({ title: clip(s.title, 150), script: kind === 'talking' ? clip(s.script, 1200) : '', notes: clip(s.notes, 1200) })).filter(s => s.title) }
    else out = null
  } else if (b.action === 'polish') {
    const script = clip(b.script, 4000).trim()
    if (!script) return json({ ok: false, error: 'There is no script to work on yet.' })
    res = await ask(`Tighten this script for a short-form video. Keep the meaning and the creator's voice, cut filler and repeated words, fix obvious speech-to-text mistakes, and keep it about the same length or shorter.${brief ? `\nExtra direction from the agency: ${brief}` : ''}\n\nScript:\n${script}\n\nJSON shape: {"script":""}`, 2000)
    out = res.text ? parse(res.text) : null
    out = out && typeof out.script === 'string' && out.script.trim() ? { script: clip(out.script, 4000).trim() } : null
  } else if (b.action === 'set') {
    if (!brief) return json({ ok: false, error: 'Describe the set first.' })
    res = await ask(`Plan a themed photo and video set a creator films in one session.\nBrief from the agency: ${brief}\n\nGive 4 to 7 parts in the order they are filmed, going from a free teaser to the main parts and a short bonus. For each part: "title" (short), "body" (2 to 4 lines separated by \\n covering Outfit:, Action:, Expression: and a one-line caption idea), "photos" and "videos" (how many of each, 0 to 5).\nAlso give a short "title" and one-sentence "summary" for the whole set, and "tips": 3 to 5 general filming tips separated by \\n.\nJSON shape: {"title":"","summary":"","tips":"","parts":[{"title":"","body":"","photos":0,"videos":0}]}`, 3000)
    out = res.text ? parse(res.text) : null
    if (out && Array.isArray(out.parts)) out = { title: clip(out.title, 110), summary: clip(out.summary, 300), tips: clip(out.tips, 1200),
      parts: (out.parts as Record<string, unknown>[]).slice(0, 8).map(p => ({ title: clip(p.title, 100), body: clip(p.body, 1200), photos: Math.max(0, Math.min(5, Number(p.photos) || 0)), videos: Math.max(0, Math.min(5, Number(p.videos) || 0)) })).filter(p => p.title) }
    else out = null
  } else return json({ error: 'Bad request' }, 400)

  if (res.error) return json({ ok: false, code: res.code, error: res.error })
  if (!out) return json({ ok: false, error: 'The writing service sent back something unusable. Try again, or reword the brief.' })
  await admin.from('audit_events').insert({ workspace_id: ws, action: 'ai.write', target: String(b.action) })
  return json({ ok: true, ...out })
})
