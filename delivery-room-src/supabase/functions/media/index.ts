// Uploads to and downloads from Cloudflare R2, with the same permission rules as Supabase storage.
// Phones upload straight to R2 with short-lived signed URLs; this function only signs and checks.
//   begin    {bucket, path, size, mime}         -> {use:'supabase'} | {use:'r2', mode:'single', url} | {use:'r2', mode:'multipart', uploadId, partSize, urls[], done[]}
//   complete {bucket, path, parts?[{n, etag}]}  -> {ok:true}   (size checked against R2 before the file counts as uploaded)
//   abort    {bucket, path}                     -> {ok:true}
//   sign     {bucket, paths[], names?{path:name}, ttl?} -> {urls:{path:url}}  (only R2 files the caller may read)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const URL_ = Deno.env.get('SUPABASE_URL')!, SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const ACCT = (Deno.env.get('R2_ACCOUNT_ID') || '').trim()
const BUCKET = (Deno.env.get('R2_BUCKET') || 'delivery-room-media').trim()
const aws = new AwsClient({ accessKeyId: (Deno.env.get('R2_ACCESS_KEY_ID') || '').trim(), secretAccessKey: (Deno.env.get('R2_SECRET_ACCESS_KEY') || '').trim(), service: 's3', region: 'auto' })
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })

const SINGLE_MAX = 8 * 1024 * 1024
const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/')
const objUrl = (bucket: string, path: string) => `https://${ACCT}.r2.cloudflarestorage.com/${BUCKET}/${enc(bucket + '/' + path)}`
async function presign(url: string, method: string, ttl: number, extra: Record<string, string> = {}) {
  const u = new URL(url)
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v)
  u.searchParams.set('X-Amz-Expires', String(ttl))
  return (await aws.sign(u.toString(), { method, aws: { signQuery: true } })).url
}
const partSizeFor = (size: number) => Math.max(8 * 1024 * 1024, Math.ceil(size / 1000 / (1024 * 1024)) * 1024 * 1024)
const xml = (s: string, tag: string) => [...s.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1])
const okBucket = (b: unknown): b is 'media' | 'social' => b === 'media' || b === 'social'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!ACCT) return json({ error: 'Storage is not configured' }, 500)
  const user = createClient(URL_, ANON, { global: { headers: { authorization: req.headers.get('authorization') || '' } }, auth: { persistSession: false } })
  const { data: u } = await user.auth.getUser()
  if (!u?.user) return json({ error: 'Sign in again, then retry.' }, 401)
  let b: Record<string, unknown> = {}
  try { b = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const action = b.action, bucket = b.bucket, path = typeof b.path === 'string' ? b.path : ''
  if (!okBucket(bucket)) return json({ error: 'Bad bucket' }, 400)

  try {
    if (action === 'begin') {
      const size = Number(b.size), mime = String(b.mime || '')
      const { data: d, error } = await user.rpc('r2_begin', { b: bucket, p: path, sz: size, m: mime })
      if (error) return json({ error: error.message }, 400)
      const r = d as { use: string; resume?: boolean; upload_id?: string | null }
      if (r.use !== 'r2') return json({ use: 'supabase' })
      const url = objUrl(bucket, path)
      if (size <= SINGLE_MAX) return json({ use: 'r2', mode: 'single', url: await presign(url, 'PUT', 3600) })
      const partSize = partSizeFor(size), count = Math.ceil(size / partSize)
      let uploadId = r.resume ? r.upload_id || null : null, done: { n: number; etag: string }[] = []
      if (uploadId) {
        const lp = await aws.fetch(`${url}?uploadId=${encodeURIComponent(uploadId)}&max-parts=1000`)
        if (lp.ok) { const t = await lp.text(); const ns = xml(t, 'PartNumber'), es = xml(t, 'ETag'); done = ns.map((n, i) => ({ n: Number(n), etag: es[i].replace(/&quot;/g, '"') })) }
        else uploadId = null
      }
      if (!uploadId) {
        const c = await aws.fetch(`${url}?uploads`, { method: 'POST', headers: { 'content-type': mime } })
        if (!c.ok) return json({ error: 'Storage did not start the upload. Try again.' }, 502)
        uploadId = xml(await c.text(), 'UploadId')[0]
        await admin.from('r2_objects').update({ upload_id: uploadId }).eq('bucket', bucket).eq('path', path).eq('created_by', u.user.id).eq('status', 'uploading')
      }
      const doneSet = new Set(done.map(x => x.n)), urls: (string | null)[] = []
      for (let n = 1; n <= count; n++) urls.push(doneSet.has(n) ? null : await presign(url, 'PUT', 43200, { partNumber: String(n), uploadId: uploadId! }))
      return json({ use: 'r2', mode: 'multipart', uploadId, partSize, urls, done })
    }

    // complete / abort need the caller to be the uploader
    if (action === 'complete' || action === 'abort') {
      const { data: row } = await admin.from('r2_objects').select('*').eq('bucket', bucket).eq('path', path).maybeSingle()
      if (!row || row.created_by !== u.user.id) return json({ error: 'Upload not found' }, 404)
      const url = objUrl(bucket, path)
      if (action === 'abort') {
        if (row.status === 'ready') return json({ error: 'Already uploaded' }, 400)
        if (row.upload_id) await aws.fetch(`${url}?uploadId=${encodeURIComponent(row.upload_id)}`, { method: 'DELETE' })
        await aws.fetch(url, { method: 'DELETE' })
        await admin.from('r2_objects').delete().eq('bucket', bucket).eq('path', path).eq('status', 'uploading')
        return json({ ok: true })
      }
      if (row.status === 'ready') return json({ ok: true })
      const parts = Array.isArray(b.parts) ? (b.parts as { n: number; etag: string }[]) : null
      if (row.upload_id && parts) {
        const body = '<CompleteMultipartUpload>' + parts.slice().sort((x, y) => x.n - y.n).map(p => `<Part><PartNumber>${Number(p.n)}</PartNumber><ETag>${String(p.etag).replace(/[<>&]/g, '')}</ETag></Part>`).join('') + '</CompleteMultipartUpload>'
        const c = await aws.fetch(`${url}?uploadId=${encodeURIComponent(row.upload_id)}`, { method: 'POST', body, headers: { 'content-type': 'application/xml' } })
        const t = await c.text()
        if (!c.ok || t.includes('<Error>')) return json({ error: 'Upload could not be finished. Send again.', detail: (xml(t, 'Code')[0] || String(c.status)) }, 409)
      }
      const h = await aws.fetch(url, { method: 'HEAD' })
      const len = Number(h.headers.get('content-length') || -1)
      if (!h.ok || len !== Number(row.size)) {
        await aws.fetch(url, { method: 'DELETE' })
        await admin.from('r2_objects').delete().eq('bucket', bucket).eq('path', path).eq('status', 'uploading')
        return json({ error: 'Upload incomplete (size mismatch). Send again.' }, 409)
      }
      const { error } = await admin.rpc('r2_finish', { b: bucket, p: path, sz: len, tag: h.headers.get('etag') || null })
      if (error) return json({ error: error.message }, 409)
      return json({ ok: true })
    }

    if (action === 'sign') {
      const paths = Array.isArray(b.paths) ? (b.paths as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 300) : []
      const names = (b.names && typeof b.names === 'object' ? b.names : {}) as Record<string, string>
      const ttl = Math.min(Math.max(Number(b.ttl) || 1800, 60), 3600)
      const { data, error } = await user.rpc('r2_readable', { b: bucket, paths })
      if (error) return json({ error: error.message }, 400)
      const urls: Record<string, string> = {}
      for (const r of (data || []) as { path: string }[]) {
        const n = names[r.path]
        const extra: Record<string, string> = n ? { 'response-content-disposition': `attachment; filename="${n.replace(/["\\\r\n]/g, '')}"` } : {}
        urls[r.path] = await presign(objUrl(bucket, r.path), 'GET', ttl, extra)
      }
      return json({ urls })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: 'Storage error. Try again.', detail: String(e).slice(0, 200) }, 500)
  }
})
