// Drains email_outbox: one email per person per run (several notifications become one digest),
// one email per invite. Sends through Resend from noreply@submitreel.com.
// Takes no input and only sends what is already queued, so calling it is harmless; it is pinged by
// pg_cron every 2 minutes when something is pending.
// OF-side items never put titles or messages in the email; they only say there is an update.
import { createClient } from 'npm:@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const RESEND = Deno.env.get('RESEND_API_KEY')
const FROM = 'SubmitReel <noreply@submitreel.com>'
const APP = 'https://www.submitreel.com/#'

interface Row {
  id: string; kind: 'notification' | 'invite'; to_email: string
  n_type: string | null; n_title: string | null; n_body: string | null; n_link: string | null; n_created: string | null
  ws_name: string | null; inv_kind: string | null; inv_role: string | null; inv_token: string | null; inv_expires: string | null; inviter: string | null
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
// OF work (scripted sets) is private: no titles or notes in inboxes or lock-screen previews.
const isPrivate = (r: Row) => /^\/(creator\/a|agency\/review)\//.test(r.n_link || '') || r.n_type === 'submitted'
const safeLink = (l: string | null) => (l && l.startsWith('/') && !l.startsWith('//') ? l : '/')
const line = (r: Row) => isPrivate(r)
  ? { title: `New update from ${r.ws_name || 'your agency'}`, body: 'Open SubmitReel to see it.' }
  : { title: r.n_title || 'New update', body: r.n_body || '' }

function layout(heading: string, inner: string, cta: { label: string; href: string }, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f2f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1822">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#110C15;padding:18px 24px;color:#E9C9A1;font-size:18px;font-weight:700;letter-spacing:-.2px">SubmitReel</td></tr>
<tr><td style="padding:28px 24px 8px"><h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${heading}</h1>${inner}</td></tr>
<tr><td style="padding:12px 24px 28px"><a href="${cta.href}" style="display:inline-block;background:#110C15;color:#E9C9A1;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:10px">${esc(cta.label)}</a></td></tr>
</table>
<p style="max-width:520px;font-size:12px;line-height:1.5;color:#7a7184;margin:16px auto 0">${footer}</p>
</td></tr></table></body></html>`
}
const P = (s: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3b3442">${s}</p>`
const NOTIF_FOOTER = 'You get these because you use SubmitReel. Turn emails off any time under Account in the app.'

function notificationEmail(rows: Row[]) {
  if (rows.length === 1) {
    const r = rows[0], l = line(r)
    return {
      subject: l.title,
      html: layout(esc(l.title), l.body ? P(esc(l.body)) : '', { label: 'Open in SubmitReel', href: APP + safeLink(r.n_link) }, NOTIF_FOOTER),
      text: `${l.title}\n\n${l.body}\n\nOpen: ${APP + safeLink(r.n_link)}\n\n${NOTIF_FOOTER}`,
    }
  }
  const items = rows.map(line)
  const subject = `${rows.length} updates in SubmitReel`
  const list = items.map(l => `<li style="margin:0 0 10px"><strong>${esc(l.title)}</strong>${l.body ? `<br><span style="color:#6b6274">${esc(l.body)}</span>` : ''}</li>`).join('')
  return {
    subject,
    html: layout(subject, `<ul style="margin:0 0 8px;padding-left:18px;font-size:15px;line-height:1.5;color:#3b3442">${list}</ul>`, { label: 'Open SubmitReel', href: APP + '/' }, NOTIF_FOOTER),
    text: `${subject}\n\n${items.map(l => `- ${l.title}${l.body ? ` (${l.body})` : ''}`).join('\n')}\n\nOpen: ${APP}/\n\n${NOTIF_FOOTER}`,
  }
}

function inviteEmail(r: Row) {
  const ws = r.ws_name || 'An agency'
  const who = r.inviter ? `${r.inviter} at ${ws}` : ws
  const href = `${APP}/invite/${r.inv_token}`
  const exp = r.inv_expires ? new Date(r.inv_expires).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const staff = r.inv_kind === 'staff'
  const subject = staff ? `Join ${ws} on SubmitReel` : `${ws} invited you to SubmitReel`
  const body = staff
    ? `${who} added you to their team as ${r.inv_role === 'admin' ? 'an admin' : 'a reviewer'}. Accept to review and approve what creators send in.`
    : `${who} wants you to film content for them. SubmitReel shows you each shot with its reference and script, records it on your phone and sends it straight to them.`
  const foot = `${exp ? `This invite works until ${exp}. ` : ''}If you weren't expecting it, ignore this email.`
  return {
    subject,
    html: layout(esc(subject), P(esc(body)), { label: 'Accept invite', href }, esc(foot)),
    text: `${subject}\n\n${body}\n\nAccept: ${href}\n\n${foot}`,
  }
}

async function send(to: string, m: { subject: string; html: string; text: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject: m.subject, html: m.html, text: m.text }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

Deno.serve(async () => {
  if (!RESEND) return new Response(JSON.stringify({ error: 'RESEND_API_KEY missing' }), { status: 500 })
  const { data, error } = await admin.rpc('email_outbox_claim', { n: 50 })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  const rows = (data || []) as Row[]
  const jobs: { ids: string[]; to: string; msg: () => ReturnType<typeof inviteEmail> }[] = []
  const byPerson = new Map<string, Row[]>()
  for (const r of rows) {
    if (r.kind === 'invite') jobs.push({ ids: [r.id], to: r.to_email, msg: () => inviteEmail(r) })
    else if (r.n_title !== null || r.n_type !== null) (byPerson.get(r.to_email) || byPerson.set(r.to_email, []).get(r.to_email)!).push(r)
    else jobs.push({ ids: [r.id], to: '', msg: () => ({ subject: '', html: '', text: '' }) }) // notification deleted: drop
  }
  for (const [to, rs] of byPerson) {
    rs.sort((a, b) => (a.n_created || '').localeCompare(b.n_created || ''))
    jobs.push({ ids: rs.map(r => r.id), to, msg: () => notificationEmail(rs) })
  }
  let sent = 0, failed = 0
  for (const j of jobs) {
    if (!j.to) { await admin.rpc('email_outbox_done', { ids: j.ids, ok: true }); continue }
    try { await send(j.to, j.msg()); sent++; await admin.rpc('email_outbox_done', { ids: j.ids, ok: true }) }
    catch (e) { failed++; await admin.rpc('email_outbox_done', { ids: j.ids, ok: false, err: String(e) }) }
    await new Promise(r => setTimeout(r, 550)) // Resend allows ~2 requests/second
  }
  return new Response(JSON.stringify({ claimed: rows.length, sent, failed }), { headers: { 'content-type': 'application/json' } })
})
