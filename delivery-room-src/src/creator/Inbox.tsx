import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useAsync, Loading, ErrorBox } from '../lib/ui'
import { fmtDate } from '../lib/types'
import { CTop } from './CreatorApp'

export default function Inbox() {
  const { data, loading, error } = useAsync(async () => { const { data, error } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60); if (error) throw error; return data as { id: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }[] }, [])
  useEffect(() => { if (data?.some(n => !n.read_at)) sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).then(() => {}) }, [data])
  return <div className="phone"><CTop />
    <h1 style={{ fontSize: 26, marginBottom: 14 }}>Notifications</h1>
    {loading ? <Loading /> : error ? <ErrorBox msg={error} /> : !data?.length ? <div className="empty"><h3>No notifications</h3><p>New assignments, redo requests and approvals show up here.</p></div> :
      <div className="list">{data.map(n => { const inner = <><div className="between"><b>{n.title}</b>{!n.read_at && <span className="pill prog">New</span>}</div><p className="muted" style={{ fontSize: 13.5 }}>{n.body}</p><span className="mono muted">{fmtDate(n.created_at)}</span></>
        return n.link?.startsWith('/creator') ? <Link key={n.id} to={n.link} className="card click">{inner}</Link> : <div key={n.id} className="card stack" style={{ gap: 6 }}>{inner}</div> })}</div>}
  </div>
}
