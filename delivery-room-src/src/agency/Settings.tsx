import { useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useAuth, useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast } from '../lib/ui'
import { fmtBytes, fmtDate } from '../lib/types'

export default function Settings() {
  const { ws, isAdmin } = useWs(); const { refresh } = useAuth(); const toast = useToast()
  const [name, setName] = useState(ws?.name || '')
  const { data, loading, error, reload } = useAsync(async () => {
    const [u, c, au, w] = await Promise.all([
      sb.rpc('workspace_usage', { ws: ws!.id }),
      sb.from('categories').select('id,name,position').eq('workspace_id', ws!.id).order('position'),
      sb.from('audit_events').select('*').eq('workspace_id', ws!.id).order('created_at', { ascending: false }).limit(40),
      sb.from('workspaces').select('skip_incomplete_default').eq('id', ws!.id).single(),
    ])
    return { usage: ((u.data as unknown[]) || [])[0] as { files: number; bytes: number; creators: number; assignments_open: number } | undefined, cats: (c.data || []) as { id: string; name: string }[], audit: (au.data || []) as { id: number; action: string; target: string; created_at: string; meta: Record<string, unknown> }[], skip: !!w.data?.skip_incomplete_default }
  }, [ws?.id])
  async function rename() { const { error } = await sb.from('workspaces').update({ name: name.trim() }).eq('id', ws!.id); if (error) toast(errMsg(error)); else { toast('Saved'); refresh() } }
  async function renameCat(id: string, n: string) { if (!n.trim()) return; const { error } = await sb.from('categories').update({ name: n.trim() }).eq('id', id); if (error) toast(errMsg(error)); else reload() }
  async function delCat(id: string) { const { error } = await sb.from('categories').delete().eq('id', id); if (error) toast(errMsg(error)); else { toast('Label removed. Templates using it now have no label.'); reload() } }
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  return <>
    <div className="page-title"><h1>Settings</h1></div>
    <section className="card stack"><h3>Workspace</h3>
      <div className="row wrap"><input id="wsn" className="input" style={{ maxWidth: 320 }} value={name} disabled={!isAdmin} onChange={e => setName(e.target.value)} /><button className="btn ghost" disabled={!isAdmin || !name.trim() || name === ws?.name} onClick={rename}>Rename</button></div>
    </section>
    <section className="card stack"><h3>Usage</h3>
      <div className="stats"><div className="stat"><b>{fmtBytes(Number(data.usage?.bytes || 0))}</b><span>Stored</span></div><div className="stat"><b>{data.usage?.files || 0}</b><span>Files</span></div><div className="stat"><b>{data.usage?.creators || 0}</b><span>Active creators</span></div><div className="stat"><b>{data.usage?.assignments_open || 0}</b><span>Open assignments</span></div></div>
      <p className="muted" style={{ fontSize: 13 }}>Plans and billing aren't switched on in this test build.</p></section>
    <section className="card stack"><h3>Labels</h3><p className="muted" style={{ fontSize: 13 }}>Group templates and assignments, e.g. Scripts, PPV, Reels. Add new ones from any template.</p>
      <div className="list">{data.cats.map(c => <div key={c.id} className="row"><input className="input" aria-label="Label name" defaultValue={c.name} disabled={!isAdmin} onBlur={e => e.target.value !== c.name && renameCat(c.id, e.target.value)} />{isAdmin && <button className="btn sm danger" onClick={() => delCat(c.id)}>Remove</button>}</div>)}</div></section>
    {isAdmin && <section className="card stack"><h3>Activity log</h3>
      {data.audit.length === 0 ? <p className="muted">Nothing yet.</p> : <div className="scroll-x"><table className="table"><tbody>{data.audit.map(e => <tr key={e.id}><td className="mono muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.created_at)}</td><td>{e.action.replace('.', ' · ').replace(/_/g, ' ')}</td><td className="mono muted">{Object.entries(e.meta || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}</td></tr>)}</tbody></table></div>}</section>}
  </>
}
