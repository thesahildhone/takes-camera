// A creator deletes their own account: erase their stored files first, then the account itself.
// If any file can't be removed, nothing else is deleted and the creator can try again.
import { createClient } from 'npm:@supabase/supabase-js@2'

const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const auth = req.headers.get('authorization') || ''
  const user = createClient(URL_, ANON, { global: { headers: { authorization: auth } }, auth: { persistSession: false } })
  const { data: u } = await user.auth.getUser()
  if (!u?.user) return json({ error: 'Sign in again, then retry.' }, 401)
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
  for (const f of (files || []) as { bucket: string; name: string }[]) (byBucket[f.bucket] ||= []).push(f.name)
  let removed = 0
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
