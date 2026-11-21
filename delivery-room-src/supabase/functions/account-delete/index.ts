// A creator deletes their own account: erase their stored files first, then the account itself.
// If any file can't be removed, nothing else is deleted and the creator can try again.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const R2_ACCT = (Deno.env.get('R2_ACCOUNT_ID') || '').trim(), R2_BUCKET = (Deno.env.get('R2_BUCKET') || 'delivery-room-media').trim()
const aws = new AwsClient({ accessKeyId: (Deno.env.get('R2_ACCESS_KEY_ID') || '').trim(), secretAccessKey: (Deno.env.get('R2_SECRET_ACCESS_KEY') || '').trim(), service: 's3', region: 'auto' })
const r2Url = (bucket: string, path: string) => `https://${R2_ACCT}.r2.cloudflarestorage.com/${R2_BUCKET}/${(bucket + '/' + path).split('/').map(encodeURIComponent).join('/')}`
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const auth = req.headers.get('authorization') || ''
  const user = createClient(URL_, ANON, { global: { headers: { authorization: auth } }, auth: { persistSession: false } })
  // The gateway (verify_jwt) has already checked this token's signature and expiry; Postgres checks it again on every query.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  let claims: { sub?: string; role?: string; exp?: number } = {}
  try { const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); claims = JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4))) } catch { /* invalid */ }
  if (!claims.sub || claims.role !== 'authenticated' || (claims.exp || 0) * 1000 < Date.now()) return json({ error: 'Sign in again, then retry.' }, 401)
  const u = { user: { id: claims.sub } }
  let body: { confirm?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  if ((body.confirm || '').trim() !== 'DELETE') return json({ error: 'Type DELETE to confirm' }, 400)

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })
  const me = u.user.id
  const { count: staff } = await admin.from('workspace_members').select('user_id', { count: 'exact', head: true }).eq('user_id', me)
  if (staff) return json({ error: 'Agency accounts are closed by support so shared work is not lost. Email support to close this account.' }, 400)

  const { data: files, error: le } = await admin.rpc('account_media_paths', { u: me })
  if (le) return json({ error: 'Could not list your files. Nothing was deleted. Try again.' }, 500)
  const byBucket: Record<string, string[]> = {}
  // Files in Cloudflare R2 (newer uploads): erase them there first, including unfinished uploads.
  const { data: r2, error: re } = await admin.rpc('account_r2_paths', { u: me })
  if (re) return json({ error: 'Could not list your files. Nothing was deleted. Try again.' }, 500)
  const r2List = (r2 || []) as { bucket: string; path: string; status: string; upload_id: string | null }[]
  const inR2 = new Set(r2List.map(f => f.bucket + '/' + f.path))
  let removed = 0
  if (r2List.length && !R2_ACCT) return json({ error: 'Storage is not configured. Nothing was deleted. Contact support.' }, 500)
  for (const f of r2List) {
    const url = r2Url(f.bucket, f.path)
    if (f.upload_id && f.status !== 'ready') await aws.fetch(`${url}?uploadId=${encodeURIComponent(f.upload_id)}`, { method: 'DELETE' }).catch(() => null)
    const d = await aws.fetch(url, { method: 'DELETE' }).catch(() => null)
    if (!d || !(d.ok || d.status === 404)) return json({ error: `Some files could not be erased (${removed} done). Your account was not deleted. Try again.` }, 500)
    await admin.from('r2_objects').delete().eq('bucket', f.bucket).eq('path', f.path)
    removed++
  }
  for (const f of (files || []) as { bucket: string; name: string }[]) if (!inR2.has(f.bucket + '/' + f.name)) (byBucket[f.bucket] ||= []).push(f.name)
  for (const [bucket, names] of Object.entries(byBucket)) {
    for (let i = 0; i < names.length; i += 100) {
      const { data, error } = await admin.storage.from(bucket).remove(names.slice(i, i + 100))
      if (error) return json({ error: `Some files could not be erased (${removed} done). Your account was not deleted. Try again.` }, 500)
      removed += data?.length || 0
    }
  }
  const { error: de } = await user.rpc('delete_my_account', { confirm: 'DELETE' })
  if (de) return json({ error: de.message, files_removed: removed }, 400)
  return json({ ok: true, files_removed: removed })
})
