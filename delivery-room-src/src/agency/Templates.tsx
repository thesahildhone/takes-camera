import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast } from '../lib/ui'
import { fmtDate, newPage, type Page } from '../lib/types'
import AssignModal from './AssignModal'

export interface Tpl { id: string; title: string; summary: string; category_id: string | null; pages: Page[]; archived_at: string | null; updated_at: string; current_version_id: string | null }
export interface Cat { id: string; name: string; position: number }

export const AFTER_STREAM: Page[] = [
  { id: 'tips', title: 'General Tips', kind: 'info', body: 'Film in soft, even light, a window or ring light in front of you works best.\nKeep the same outfit for each set unless a page says otherwise.\nShoot vertical (9:16) unless a page asks for something else.\nGo light on smoothing. Around 30 to 50 looks natural.', photos_min: 0, photos_max: 0, videos_min: 0, videos_max: 0, extras: 0, guidance: '' },
  { id: 'teaser', title: 'Free Teaser', kind: 'media', body: 'Three photos for the free page. Use the outfit from your notes, face clearly visible, relaxed expression.', photos_min: 3, photos_max: 3, videos_min: 0, videos_max: 0, extras: 2, guidance: '' },
  { id: 'teaser2', title: 'Free Teaser Part 2', kind: 'media', body: 'Two more photos in the same outfit. Change the angle or the spot in the room.', photos_min: 2, photos_max: 2, videos_min: 0, videos_max: 0, extras: 2, guidance: '' },
  { id: 'ppv1', title: 'PPV 1', kind: 'media', body: 'Two photos and two short videos.', photos_min: 2, photos_max: 2, videos_min: 2, videos_max: 2, extras: 2, guidance: '10 to 30 seconds, vertical' },
  { id: 'ppv2', title: 'PPV 2', kind: 'media', body: 'Three photos and two to three videos.', photos_min: 3, photos_max: 3, videos_min: 2, videos_max: 3, extras: 2, guidance: '10 to 30 seconds, vertical' },
  { id: 'ppv3', title: 'PPV 3', kind: 'media', body: 'Three photos and two videos.', photos_min: 3, photos_max: 3, videos_min: 2, videos_max: 2, extras: 2, guidance: '' },
  { id: 'ppv4', title: 'PPV 4', kind: 'media', body: 'Three to four photos and one to two videos.', photos_min: 3, photos_max: 4, videos_min: 1, videos_max: 2, extras: 2, guidance: '' },
  { id: 'ppv5', title: 'PPV 5', kind: 'media', body: 'Three photos and one video.', photos_min: 3, photos_max: 3, videos_min: 1, videos_max: 1, extras: 2, guidance: '' },
  { id: 'ppv6', title: 'PPV 6', kind: 'media', body: 'Two to three photos and one video.', photos_min: 2, photos_max: 3, videos_min: 1, videos_max: 1, extras: 2, guidance: '' },
  { id: 'bonus', title: 'Bonus Free Video', kind: 'media', body: 'One casual video. This goes out free after the stream.', photos_min: 0, photos_max: 0, videos_min: 1, videos_max: 1, extras: 2, guidance: '15 to 30 seconds' },
]

export function reqSummary(pages: Page[]) {
  const m = pages.filter(p => p.kind === 'media')
  const ph = m.reduce((a, p) => a + p.photos_min, 0), vd = m.reduce((a, p) => a + p.videos_min, 0)
  return `${pages.length} page${pages.length === 1 ? '' : 's'} · ${ph} photo${ph === 1 ? '' : 's'}, ${vd} video${vd === 1 ? '' : 's'}`
}

export default function Templates() {
  const { ws } = useWs(); const nav = useNavigate(); const toast = useToast()
  const [q, setQ] = useState(''); const [cat, setCat] = useState<string>('all'); const [showArchived, setShowArchived] = useState(false)
  const [assign, setAssign] = useState<Tpl | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const [t, c] = await Promise.all([
      sb.from('templates').select('id,title,summary,category_id,pages,archived_at,updated_at,current_version_id').eq('workspace_id', ws!.id).order('updated_at', { ascending: false }),
      sb.from('categories').select('id,name,position').eq('workspace_id', ws!.id).order('position'),
    ])
    if (t.error) throw t.error
    return { tpls: (t.data || []) as Tpl[], cats: (c.data || []) as Cat[] }
  }, [ws?.id])
  const shown = useMemo(() => (data?.tpls || []).filter(t => (showArchived ? !!t.archived_at : !t.archived_at) && (cat === 'all' || t.category_id === cat) && (!q || t.title.toLowerCase().includes(q.toLowerCase()))), [data, q, cat, showArchived])

  async function create(example = false) {
    const uidv = (await sb.auth.getUser()).data.user!.id
    const catId = data?.cats.find(c => c.name === 'Scripts')?.id || data?.cats[0]?.id || null
    const { data: row, error } = await sb.from('templates').insert({ workspace_id: ws!.id, title: example ? 'After Stream Script' : 'Untitled template', summary: example ? 'Ten-page after-stream set: tips, free teasers, six PPV sets and a bonus video.' : '', category_id: catId, pages: example ? AFTER_STREAM : [newPage('info'), newPage('media')], created_by: uidv }).select('id').single()
    if (error) return toast(errMsg(error))
    nav('/agency/templates/' + row!.id)
  }
  async function duplicate(t: Tpl) {
    const uidv = (await sb.auth.getUser()).data.user!.id
    const { error } = await sb.from('templates').insert({ workspace_id: ws!.id, title: t.title + ' (copy)', summary: t.summary, category_id: t.category_id, pages: t.pages, created_by: uidv })
    if (error) toast(errMsg(error)); else { toast('Duplicated'); reload() }
  }
  async function setArchived(t: Tpl, on: boolean) { await sb.from('templates').update({ archived_at: on ? new Date().toISOString() : null }).eq('id', t.id); toast(on ? 'Archived' : 'Restored'); reload() }

  if (loading) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />
  const catName = (id: string | null) => data.cats.find(c => c.id === id)?.name || 'No label'
  return <>
    <div className="page-title"><h1>Templates</h1><div className="row wrap">
      <button className="btn ghost" onClick={() => create(true)}>Start from example</button>
      <button className="btn primary" onClick={() => create(false)}>New template</button></div></div>
    <div className="row wrap">
      <input id="tplsearch" className="input" style={{ maxWidth: 260 }} placeholder="Search templates" value={q} onChange={e => setQ(e.target.value)} />
      <div className="chips"><button className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All</button>
        {data.cats.map(c => <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}</div>
      <label className="check" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /><span className="muted">Archived</span></label>
    </div>
    {shown.length === 0 ? <div className="empty"><h3>{showArchived ? 'No archived templates' : 'No templates yet'}</h3>
      {!showArchived && <><p>A template is your script, built once and sent as many times as you like. Start from the After Stream example to see how it works.</p>
        <button className="btn primary" onClick={() => create(true)}>Start from example</button></>}</div> :
      <div className="list">{shown.map(t => <div key={t.id} className="card stack">
        <div className="between wrap"><div><span className="pill todo">{catName(t.category_id)}</span><h3 style={{ marginTop: 6 }}>{t.title}</h3></div>
          <span className="muted mono">edited {fmtDate(t.updated_at, false)}</span></div>
        {t.summary && <p className="muted">{t.summary}</p>}
        <p className="mono muted">{reqSummary(t.pages)}</p>
        <div className="row wrap">
          {!t.archived_at && <button className="btn sm primary" onClick={() => setAssign(t)}>Send to creators</button>}
          <Link className="btn sm ghost" to={'/agency/templates/' + t.id}>Edit</Link>
          <button className="btn sm ghost" onClick={() => duplicate(t)}>Duplicate</button>
          <button className="btn sm ghost" onClick={() => setArchived(t, !t.archived_at)}>{t.archived_at ? 'Restore' : 'Archive'}</button>
        </div></div>)}</div>}
    {assign && <AssignModal tpl={assign} onClose={() => setAssign(null)} onDone={() => { setAssign(null); reload() }} />}
  </>
}
