import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast } from '../lib/ui'
import { newPage, uid, type Page } from '../lib/types'
import { IcUp, IcDown, IcCopy, IcTrash } from '../lib/icons'
import type { Cat, Tpl } from './Templates'
import { reqSummary } from './Templates'
import AssignModal from './AssignModal'

function Num({ id, value, onChange, min = 0, max = 20 }: { id: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return <input id={id} className="input num" type="number" inputMode="numeric" min={min} max={max} value={value} onChange={e => onChange(Math.max(min, Math.min(max, parseInt(e.target.value || '0', 10) || 0)))} />
}

export default function TemplateEditor() {
  const { id } = useParams(); const { ws } = useWs(); const toast = useToast()
  const [t, setT] = useState<Tpl | null>(null); const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false)
  const [assign, setAssign] = useState(false); const [newCat, setNewCat] = useState('')
  const { data, loading, error, reload } = useAsync(async () => {
    const [tp, c, used] = await Promise.all([
      sb.from('templates').select('*').eq('id', id!).single(),
      sb.from('categories').select('id,name,position').eq('workspace_id', ws!.id).order('position'),
      sb.from('assignments').select('id', { count: 'exact', head: true }).eq('template_id', id!),
    ])
    if (tp.error) throw tp.error
    return { tpl: tp.data as Tpl, cats: (c.data || []) as Cat[], used: used.count || 0 }
  }, [id])
  useEffect(() => { if (data) { setT(data.tpl); setDirty(false) } }, [data])
  const tRef = useRef(t); tRef.current = t
  useEffect(() => { // autosave the draft every few seconds while editing
    if (!dirty) return
    const h = setTimeout(() => save(true), 1500); return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, dirty])
  useEffect(() => { const w = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault() } }; window.addEventListener('beforeunload', w); return () => window.removeEventListener('beforeunload', w) }, [dirty])

  if (loading || !t) return error ? <ErrorBox msg={error} /> : <Loading />
  const upd = (patch: Partial<Tpl>) => { setT({ ...t, ...patch }); setDirty(true) }
  const updPage = (i: number, patch: Partial<Page>) => { const pages = t.pages.slice(); pages[i] = fixRanges({ ...pages[i], ...patch }); upd({ pages }) }
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= t.pages.length) return; const pages = t.pages.slice();[pages[i], pages[j]] = [pages[j], pages[i]]; upd({ pages }) }
  const dup = (i: number) => { const pages = t.pages.slice(); pages.splice(i + 1, 0, { ...pages[i], id: uid().slice(0, 8), title: pages[i].title + ' (copy)' }); upd({ pages }) }
  const del = (i: number) => { const pages = t.pages.slice(); pages.splice(i, 1); upd({ pages }) }
  const add = (k: 'info' | 'media') => upd({ pages: [...t.pages, newPage(k)] })

  async function save(silent = false) {
    const cur = tRef.current; if (!cur) return
    setSaving(true)
    const { error } = await sb.from('templates').update({ title: cur.title.trim() || 'Untitled template', summary: cur.summary, category_id: cur.category_id, pages: cur.pages }).eq('id', cur.id)
    setSaving(false)
    if (error) toast(errMsg(error)); else { setDirty(false); if (!silent) toast('Saved') }
  }
  async function addCat() {
    if (!newCat.trim()) return
    const { data: row, error } = await sb.from('categories').insert({ workspace_id: ws!.id, name: newCat.trim(), position: (data?.cats.length || 0) }).select().single()
    if (error) return toast(errMsg(error))
    setNewCat(''); await reload(); upd({ category_id: (row as Cat).id })
  }

  return <>
    <div className="page-title"><div><Link className="link" to="/agency/templates">← Templates</Link><h1 style={{ marginTop: 6 }}>{t.title || 'Untitled template'}</h1>
      <p className="mono muted" style={{ marginTop: 4 }}>{reqSummary(t.pages)} · {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</p></div>
      <div className="row wrap"><button className="btn ghost" onClick={() => save()} disabled={!dirty || saving}>Save</button>
        <button className="btn primary" onClick={async () => { if (dirty) await save(true); setAssign(true) }} disabled={!t.pages.length}>Send to creators</button></div></div>
    {data!.used > 0 && <div className="notice">This template has been sent {data!.used} time{data!.used === 1 ? '' : 's'}. Edits only apply to future sends. Work already issued keeps the version it was sent with.</div>}
    <div className="card stack">
      <label className="field"><span>Title</span><input id="ttitle" className="input" value={t.title} maxLength={120} onChange={e => upd({ title: e.target.value })} /></label>
      <label className="field"><span>Summary (creators see this on the assignment)</span><textarea id="tsummary" className="textarea" style={{ minHeight: 60 }} value={t.summary} onChange={e => upd({ summary: e.target.value })} /></label>
      <div className="field"><span>Label</span><div className="row wrap">
        <div className="chips">{data!.cats.map(c => <button key={c.id} className="chip" aria-pressed={t.category_id === c.id} onClick={() => upd({ category_id: c.id })}>{c.name}</button>)}</div>
        <input id="newcat" className="input" style={{ maxWidth: 160 }} placeholder="New label" value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCat() }} />
        <button className="btn sm ghost" onClick={addCat} disabled={!newCat.trim()}>Add</button></div></div>
    </div>
    <div className="stack">
      {t.pages.map((p, i) => <div key={p.id} className={'pagecard ' + p.kind}>
        <div className="pc-head"><span className="pc-num">{String(i + 1).padStart(2, '0')}</span>
          <div className="seg" role="group" aria-label="Page type"><button aria-pressed={p.kind === 'info'} onClick={() => updPage(i, { kind: 'info' })}>Instructions</button><button aria-pressed={p.kind === 'media'} onClick={() => updPage(i, { kind: 'media', photos_min: p.photos_min || 1, photos_max: Math.max(p.photos_max, p.photos_min || 1), extras: p.extras || 2 })}>Uploads</button></div>
          <div className="pc-tools"><button aria-label="Move up" onClick={() => move(i, -1)}><IcUp /></button><button aria-label="Move down" onClick={() => move(i, 1)}><IcDown /></button><button aria-label="Duplicate page" onClick={() => dup(i)}><IcCopy /></button><button aria-label="Delete page" onClick={() => del(i)}><IcTrash /></button></div></div>
        <input id={'pt' + p.id} className="input" aria-label="Page title" value={p.title} onChange={e => updPage(i, { title: e.target.value })} style={{ fontWeight: 650 }} />
        <textarea id={'pb' + p.id} className="textarea" aria-label="Instructions" placeholder={p.kind === 'info' ? 'Tips or instructions, one per line' : 'What to film for this section'} value={p.body} onChange={e => updPage(i, { body: e.target.value })} />
        {p.kind === 'media' && <>
          <div className="reqgrid">
            <div className="reqbox"><span className="eyebrow">Photos</span><div className="row"><span className="muted" style={{ fontSize: 13 }}>min</span><Num id={'pmin' + p.id} value={p.photos_min} onChange={n => updPage(i, { photos_min: n })} /><span className="muted" style={{ fontSize: 13 }}>max</span><Num id={'pmax' + p.id} value={p.photos_max} onChange={n => updPage(i, { photos_max: n })} /></div></div>
            <div className="reqbox"><span className="eyebrow">Videos</span><div className="row"><span className="muted" style={{ fontSize: 13 }}>min</span><Num id={'vmin' + p.id} value={p.videos_min} onChange={n => updPage(i, { videos_min: n })} /><span className="muted" style={{ fontSize: 13 }}>max</span><Num id={'vmax' + p.id} value={p.videos_max} onChange={n => updPage(i, { videos_max: n })} /></div></div>
            <div className="reqbox"><span className="eyebrow">Optional extras</span><div className="row"><Num id={'ex' + p.id} value={p.extras} max={2} onChange={n => updPage(i, { extras: n })} /><span className="muted" style={{ fontSize: 13 }}>never block submitting</span></div></div>
          </div>
          <input id={'pg' + p.id} className="input" placeholder="Guidance, e.g. 10–30 seconds, vertical" value={p.guidance} onChange={e => updPage(i, { guidance: e.target.value })} />
        </>}
      </div>)}
      <div className="row wrap"><button className="btn ghost" onClick={() => add('info')}>+ Instructions page</button><button className="btn ghost" onClick={() => add('media')}>+ Uploads page</button></div>
    </div>
    {assign && <AssignModal tpl={t} onClose={() => setAssign(false)} onDone={() => { setAssign(false); reload() }} />}
  </>
}
function fixRanges(p: Page): Page {
  const q = { ...p }
  if (q.kind === 'info') { q.photos_min = q.photos_max = q.videos_min = q.videos_max = q.extras = 0; return q }
  if (q.photos_max < q.photos_min) q.photos_max = q.photos_min
  if (q.videos_max < q.videos_min) q.videos_max = q.videos_min
  return q
}
