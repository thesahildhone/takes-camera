import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox } from '../lib/ui'
import { fmtDate } from '../lib/types'

export default function AgencyInbox() {
  const { ws } = useWs()
  const { data, loading, error } = useAsync(async () => {
    const { data, error } = await sb.from('notifications').select('*').eq('workspace_id', ws!.id).order('created_at', { ascending: false }).limit(80)
    if (error) throw error
    return data as { id: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }[]
  }, [ws?.id])
  useEffect(() => { if (data?.some(n => !n.read_at)) sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('workspace_id', ws!.id).is('read_at', null).then(() => {}) }, [data, ws])
  return <>
    <div className="page-title"><h1>Notifications</h1></div>
    {loading ? <Loading /> : error ? <ErrorBox msg={error} /> : !data?.length ? <div className="empty"><h3>Nothing yet</h3><p>You'll see it here when a creator joins or sends a video.</p></div> :
      <div className="list">{data.map(n => { const inner = <><div className="between"><b>{n.title}</b>{!n.read_at && <span className="pill prog">New</span>}</div><span className="muted" style={{ fontSize: 13.5 }}>{n.body} · <span className="mono">{fmtDate(n.created_at)}</span></span></>
        return n.link?.startsWith('/agency') ? <Link key={n.id} to={n.link} className="card click tight">{inner}</Link> : <div key={n.id} className="card tight">{inner}</div> })}</div>}
  </>
}
