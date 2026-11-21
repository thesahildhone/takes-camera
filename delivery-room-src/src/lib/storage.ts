import { sb } from './supabase'

// One place to get viewing/download links. Files may live in Supabase storage (older uploads, agency
// references) or Cloudflare R2 (creator uploads for workspaces switched to R2). The database says which;
// R2 links are signed by the media edge function after the same permission check.
export async function signedUrls(bucket: 'media' | 'social', paths: (string | null | undefined)[], opts: { ttl?: number; names?: Record<string, string> } = {}): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter(Boolean) as string[])]
  if (!list.length) return {}
  const ttl = opts.ttl ?? 1800, m: Record<string, string> = {}
  const { data: rows } = await sb.rpc('r2_readable', { b: bucket, paths: list })
  const inR2 = new Set(((rows || []) as { path: string }[]).map(r => r.path))
  if (inR2.size) {
    const { data } = await sb.functions.invoke('media', { body: { action: 'sign', bucket, paths: [...inR2], names: opts.names, ttl } })
    Object.assign(m, (data as { urls?: Record<string, string> } | null)?.urls || {})
  }
  const rest = list.filter(p => !inR2.has(p))
  if (rest.length && opts.names) {
    await Promise.all(rest.map(async p => {
      const { data } = await sb.storage.from(bucket).createSignedUrl(p, ttl, opts.names![p] ? { download: opts.names![p] } : undefined)
      if (data?.signedUrl) m[p] = data.signedUrl
    }))
  } else if (rest.length) {
    const { data } = await sb.storage.from(bucket).createSignedUrls(rest, ttl)
    ;(data || []).forEach(x => { if (x.path && x.signedUrl) m[x.path] = x.signedUrl })
  }
  return m
}

// ---- uploads straight to R2 (signed URLs; big files in parts, each part retried) ----
type Plan = { use: 'supabase' } | { use: 'r2'; mode: 'single'; url: string } | { use: 'r2'; mode: 'multipart'; uploadId: string; partSize: number; urls: (string | null)[]; done: { n: number; etag: string }[] }

async function fnError(e: unknown): Promise<Error> {
  const ctx = (e as { context?: Response }).context
  try { const j = await ctx?.json?.(); if (j?.error) return Object.assign(new Error(j.error), { status: ctx?.status }) } catch { /* ignore */ }
  return Object.assign(new Error((e as Error)?.message || 'Upload failed'), { status: ctx?.status ?? 0 })
}
async function media<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.functions.invoke('media', { body })
  if (error) throw await fnError(error)
  if ((data as { error?: string })?.error) throw Object.assign(new Error((data as { error: string }).error), { status: 400 })
  return data as T
}

function put(url: string, body: Blob, onBytes: (n: number) => void, type?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('PUT', url)
    if (type) x.setRequestHeader('content-type', type)
    x.upload.onprogress = e => onBytes(e.loaded)
    x.onload = () => x.status >= 200 && x.status < 300 ? resolve(x.getResponseHeader('etag') || '') : reject(Object.assign(new Error(`Storage refused the upload (${x.status})`), { status: x.status }))
    x.onerror = () => reject(new Error('Connection lost while uploading'))
    x.ontimeout = () => reject(new Error('Upload timed out'))
    x.timeout = 10 * 60 * 1000
    x.send(body)
  })
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
async function withRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      const s = (e as { status?: number }).status || 0
      if (i >= tries - 1 || (s >= 400 && s < 500 && s !== 408 && s !== 429)) throw e
      await wait([1000, 3000, 6000, 12000, 20000][i] ?? 20000)
    }
  }
}

/** Upload to R2 if the workspace uses it. Returns false when the file should go to Supabase storage instead. */
export async function uploadToR2(bucket: 'media' | 'social', path: string, blob: Blob, onPct: (n: number) => void): Promise<boolean> {
  const type = (blob.type || 'application/octet-stream').split(';')[0].trim()
  let plan: Plan
  try { plan = await media<Plan>({ action: 'begin', bucket, path, size: blob.size, mime: type }) }
  catch (e) {
    // A definite "no" (not allowed, wrong type, name taken) stops the upload. Anything else means the
    // R2 service is unreachable or missing, and Supabase storage still works, so fall back to it.
    if ([400, 401, 403, 409].includes((e as { status?: number }).status || 0)) throw e
    return false
  }
  if (!plan || plan.use !== 'r2') return false
  if (plan.mode === 'single') {
    await withRetry(() => put(plan.url, blob, n => onPct(Math.min(99, Math.round(n / blob.size * 100))), type))
    await withRetry(() => media({ action: 'complete', bucket, path }))
    onPct(100); return true
  }
  const { partSize, urls, uploadId } = plan
  const parts = new Map<number, string>(plan.done.map(d => [d.n, d.etag]))
  const loaded = new Map<number, number>()
  for (const d of plan.done) loaded.set(d.n, Math.min(partSize, blob.size - (d.n - 1) * partSize))
  const report = () => { let t = 0; loaded.forEach(v => { t += v }); onPct(Math.min(99, Math.round(t / blob.size * 100))) }
  report()
  const queue = urls.map((u, i) => ({ n: i + 1, u })).filter(x => x.u && !parts.has(x.n))
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { n, u } = job
      const chunk = blob.slice((n - 1) * partSize, Math.min(n * partSize, blob.size))
      const etag = await withRetry(() => { loaded.set(n, 0); return put(u!, chunk, b => { loaded.set(n, b); report() }) })
      if (!etag) throw new Error('Storage did not confirm part ' + n + '. Check your connection and send again.')
      parts.set(n, etag); loaded.set(n, chunk.size); report()
    }
  }
  await Promise.all([worker(), worker(), worker()])
  void uploadId
  await withRetry(() => media({ action: 'complete', bucket, path, parts: [...parts].map(([n, etag]) => ({ n, etag })) }))
  onPct(100); return true
}
