import { useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useAuth, useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast } from '../lib/ui'
import { fmtBytes, fmtDate } from '../lib/types'
import PasswordCard from '../components/PasswordCard'
import { TwoStepCard } from '../components/TwoStep'
import EmailPrefCard from '../components/EmailPrefCard'

export default function Settings() {
  const { ws, isAdmin } = useWs(); const { refresh } = useAuth(); const toast = useToast()
  const [name, setName] = useState(ws?.name || '')
  const { data, loading, error, reload } = useAsync(async () => {
    const [u, c, au, w, pl] = await Promise.all([
      sb.rpc('workspace_usage', { ws: ws!.id }),
      sb.from('categories').select('id,name,position').eq('workspace_id', ws!.id).order('position'),
      sb.from('audit_events').select('*').eq('workspace_id', ws!.id).order('created_at', { ascending: false }).limit(40),
      sb.from('workspaces').select('skip_incomplete_default,require_mfa,reminder_settings').eq('id', ws!.id).single(),
      sb.rpc('workspace_plan_usage', { ws: ws!.id }),
    ])
    return { usage: ((u.data as unknown[]) || [])[0] as { files: number; bytes: number; creators: number; assignments_open: number } | undefined, cats: (c.data || []) as { id: string; name: string }[], audit: (au.data || []) as { id: number; action: string; target: string; created_at: string; meta: Record<string, unknown> }[], skip: !!w.data?.skip_incomplete_default, requireMfa: !!w.data?.require_mfa, reminders: (w.data?.reminder_settings || null) as Reminders | null, plan: (pl.data || null) as PlanUsage | null }
  }, [ws?.id])
  async function rename() { const { error } = await sb.from('workspaces').update({ name: name.trim() }).eq('id', ws!.id); if (error) toast(errMsg(error)); else { toast('Saved'); refresh() } }
  async function renameCat(id: string, n: string) { if (!n.trim()) return; const { error } = await sb.from('categories').update({ name: n.trim() }).eq('id', id); if (error) toast(errMsg(error)); else reload() }
  async function delCat(id: string) { const { error } = await sb.from('categories').delete().eq('id', id); if (error) toast(errMsg(error)); else { toast('Label removed. Templates using it now have no label.'); reload() } }
  async function setReq(v: boolean) { const { error } = await sb.rpc('set_require_mfa', { ws: ws!.id, req: v }); if (error) toast(errMsg(error)); else { toast(v ? 'Two-step login is now required for your team' : 'Two-step login is now optional'); reload() } }
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  return <>
    <div className="page-title"><h1>Settings</h1></div>
    <section className="card stack"><h3>Workspace</h3>
      <div className="row wrap"><input id="wsn" className="input" style={{ maxWidth: 320 }} value={name} disabled={!isAdmin} onChange={e => setName(e.target.value)} /><button className="btn ghost" disabled={!isAdmin || !name.trim() || name === ws?.name} onClick={rename}>Rename</button></div>
    </section>
    <EmailPrefCard section />
    <TwoStepCard />
    {isAdmin && <section className="card stack"><h3>Team security</h3>
      <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={data.requireMfa} onChange={e => setReq(e.target.checked)} />
        <span>Require two-step login for everyone on the team</span></label>
      <p className="muted" style={{ fontSize: 13 }}>Teammates without it are asked to set it up the next time they open the app, and can't see any agency data until they do. Turn it on for your own account first. Creators aren't affected.</p></section>}
    {data.reminders && <RemindersCard ws={ws!.id} initial={data.reminders} isAdmin={isAdmin} onSaved={reload} />}
    {data.plan && <PlanCard p={data.plan} />}
    <section className="card stack"><h3>Usage</h3>
      <div className="stats"><div className="stat"><b>{fmtBytes(Number(data.usage?.bytes || 0))}</b><span>Stored</span></div><div className="stat"><b>{data.usage?.files || 0}</b><span>Files</span></div><div className="stat"><b>{data.usage?.creators || 0}</b><span>Active creators</span></div><div className="stat"><b>{data.usage?.assignments_open || 0}</b><span>Open assignments</span></div></div>
      <p className="muted" style={{ fontSize: 13 }}>Free during the trial.</p></section>
    <PasswordCard />
    <section className="card stack"><h3>Labels</h3><p className="muted" style={{ fontSize: 13 }}>Group templates and assignments, e.g. Scripts, PPV, Reels. Add new ones from any template.</p>
      <div className="list">{data.cats.map(c => <div key={c.id} className="row"><input className="input" aria-label="Label name" defaultValue={c.name} disabled={!isAdmin} onBlur={e => e.target.value !== c.name && renameCat(c.id, e.target.value)} />{isAdmin && <button className="btn sm danger" onClick={() => delCat(c.id)}>Remove</button>}</div>)}</div></section>
    {isAdmin && <section className="card stack"><h3>Activity log</h3>
      {data.audit.length === 0 ? <p className="muted">Nothing yet.</p> : <div className="scroll-x"><table className="table"><tbody>{data.audit.map(e => <tr key={e.id}><td className="mono muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.created_at)}</td><td>{e.action.replace('.', ' · ').replace(/_/g, ' ')}</td><td className="mono muted">{Object.entries(e.meta || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}</td></tr>)}</tbody></table></div>}</section>}
  </>
}

type PlanUsage = { plan: string; plan_name: string; price_usd: number | null; price_aud: number | null; period_start: string; active_creators: number; creator_limit: number | null; staff: number; staff_limit: number | null; storage_bytes: number; storage_limit_gb: number | null; extra_storage_gb: number }
function Meter({ label, used, limit, fmt, note }: { label: string; used: number; limit: number | null; fmt: (n: number) => string; note: string }) {
  const pct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0
  const tone = !limit ? '' : used > limit ? 'bad' : pct >= 80 ? 'wait' : 'ok'
  return <div className="stack" style={{ gap: 6 }}>
    <div className="between"><b>{label}</b><span className="mono">{fmt(used)}{limit ? ' of ' + fmt(limit) : ' (no limit)'}</span></div>
    {limit ? <div className={'bar meter ' + tone}><i style={{ width: pct + '%' }} /></div> : null}
    <span className="muted" style={{ fontSize: 12.5 }}>{tone === 'bad' ? 'Over your plan. Nothing is blocked; we will contact you about an upgrade or add-on. ' : tone === 'wait' ? 'Getting close to your plan limit. ' : ''}{note}</span>
  </div>
}
function PlanCard({ p }: { p: PlanUsage }) {
  const month = new Date(p.period_start).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  return <section className="card stack" id="plan"><div className="between"><div><h3>Plan: {p.plan_name}</h3>
      <p className="muted" style={{ fontSize: 13 }}>{p.price_usd ? `$${p.price_usd} USD / A$${p.price_aud} per month` : 'Custom pricing'} · usage for {month}</p></div>
      <span className="muted" style={{ fontSize: 13 }}>To change plan or add storage, message us.</span></div>
    <Meter label="Active creators" used={p.active_creators} limit={p.creator_limit} fmt={n => String(n)} note="Counted when a creator is assigned or sends work this month. Creators with no activity are free." />
    <Meter label="Staff seats" used={p.staff} limit={p.staff_limit} fmt={n => String(n)} note="Includes the owner. Pending staff invitations also use a seat." />
    <Meter label="Storage" used={p.storage_bytes / 1e9} limit={p.storage_limit_gb} fmt={n => n >= 1000 ? (n / 1000).toFixed(2) + ' TB' : n >= 1 ? n.toFixed(1) + ' GB' : Math.round(n * 1000) + ' MB'} note={`Original footage, joined copies and references. ${p.extra_storage_gb ? `Includes ${p.extra_storage_gb} GB add-on. ` : ''}Extra 1 TB: $25 / A$36 per month.`} />
  </section>
}

interface Reminders { due_soon_hours: number; overdue: boolean; overdue_repeat_hours: number; escalate_after_hours: number }
const hrs = (n: number, off = 'Off') => n === 0 ? off : `${n} hours`
function RemindersCard({ ws, initial, isAdmin, onSaved }: { ws: string; initial: Reminders; isAdmin: boolean; onSaved: () => void }) {
  const toast = useToast(); const [r, setR] = useState<Reminders>(initial); const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(r) !== JSON.stringify(initial)
  async function save() {
    setBusy(true); const { error } = await sb.rpc('set_reminder_settings', { ws, s: r }); setBusy(false)
    if (error) toast(errMsg(error)); else { toast('Reminders saved'); onSaved() }
  }
  const sel = (id: string, label: string, val: number, opts: number[], set: (n: number) => void, off?: string) =>
    <label className="field"><span>{label}</span><select id={id} className="input" disabled={!isAdmin} value={val} onChange={e => set(Number(e.target.value))}>
      {opts.map(o => <option key={o} value={o}>{o === 0 ? (off || 'Off') : `${o} hours ${id === 'rm-escalate' ? 'after the deadline' : id === 'rm-due' ? 'before' : ''}`.trim()}</option>)}</select></label>
  return <section className="card stack"><h3>Reminders</h3>
    {sel('rm-due', 'Remind creators before a deadline', r.due_soon_hours, [0, 2, 6, 12, 24, 48], n => setR({ ...r, due_soon_hours: n }))}
    <label className="row" style={{ gap: 10 }}><input id="rm-overdue" type="checkbox" disabled={!isAdmin} checked={r.overdue} onChange={e => setR({ ...r, overdue: e.target.checked })} />
      <span>Remind creators when they miss a deadline</span></label>
    {r.overdue && sel('rm-repeat', 'Repeat the missed-deadline reminder every', r.overdue_repeat_hours, [0, 12, 24, 48], n => setR({ ...r, overdue_repeat_hours: n }), "Don't repeat")}
    {sel('rm-escalate', 'Alert your team when a creator is late', r.escalate_after_hours, [0, 6, 12, 24, 48, 72], n => setR({ ...r, escalate_after_hours: n }))}
    <p className="muted" style={{ fontSize: 13 }}>Creators get at most 3 missed-deadline reminders per shot. Changing a due date starts its reminders again.{r.due_soon_hours > 0 ? ` Right now creators hear from you ${hrs(r.due_soon_hours)} before each deadline.` : ''}</p>
    {isAdmin && <button className="btn ghost" disabled={!dirty || busy} onClick={save}>Save reminders</button>}
  </section>
}
