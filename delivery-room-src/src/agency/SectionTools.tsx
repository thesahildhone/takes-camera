import { useEffect, useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { Modal, useToast } from '../lib/ui'
import { MODE_LABEL, parseRef, type Mode, type Project, type Section } from '../lib/social'
import { getCaps, importReference, processReference, type Caps } from '../lib/refpipe'

export interface CreatorOpt { id: string; name: string }
type Row = { url: string; id?: string; state: 'waiting' | 'saved' | 'downloading' | 'processing' | 'ready' | 'review' | 'upload' | 'error'; note?: string }
const STATE: Record<Row['state'], [string, string]> = { waiting: ['Waiting', 'todo'], saved: ['Saved as link', 'todo'], downloading: ['Downloading…', 'prog'], processing: ['Processing…', 'prog'], ready: ['Ready', 'ok'], review: ['Script to check', 'wait'], upload: ['Needs a file', 'bad'], error: ['Failed', 'bad'] }

export function BulkAdd({ section, startAt, onClose }: { section: Section; startAt: number; onClose: (changed: boolean) => void }) {
  const toast = useToast()
  const [text, setText] = useState(''); const [mode, setMode] = useState<Mode>('talking'); const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null); const [running, setRunning] = useState(false); const [caps, setCaps] = useState<Caps | null>(null)
  useEffect(() => { getCaps().then(setCaps) }, [])
  const links = [...new Set(text.split(/\s+/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x) && parseRef(x)))]
  const set = (i: number, r: Partial<Row>) => setRows(cur => cur && cur.map((x, k) => k === i ? { ...x, ...r } : x))

  async function run() {
    if (!links.length) return
    setRunning(true)
    const list: Row[] = links.map(url => ({ url, state: 'waiting' })); setRows(list)
    const { data, error } = await sb.from('social_projects').insert(links.map((url, i) => ({
      workspace_id: section.workspace_id, section_id: section.id, title: 'New shot', position: startAt + i, mode, instructions: notes,
      reference_url: url, ref_platform: parseRef(url)?.platform || null, import_status: 'link_only' }))).select('*')
    if (error || !data) { toast(errMsg(error)); setRunning(false); setRows(null); return }
    const made = (data as Project[]).sort((a, b) => a.position - b.position)
    made.forEach((p, i) => { list[i].id = p.id; list[i].state = 'saved' }); setRows([...list])
    for (let i = 0; i < made.length; i++) {
      const ref = parseRef(made[i].reference_url)!
      const social = ref.platform === 'instagram' || ref.platform === 'tiktok'
      if (ref.platform === 'youtube' || (social && !caps?.link_import)) { set(i, { state: mode === 'reference' ? 'ready' : 'upload', note: mode === 'reference' ? 'Embedded player' : 'Upload the video to get the ' + (mode === 'dance' ? 'sound' : 'script') }); continue }
      try {
        set(i, { state: 'downloading' })
        let p = await importReference(made[i].id)
        if (p.import_status !== 'ready') { set(i, { state: 'upload', note: p.import_error || undefined }); continue }
        set(i, { state: 'processing' })
        p = await processReference(p, () => {})
        if (mode === 'talking' || mode === 'both') set(i, p.transcript_status === 'ready' ? { state: 'review', note: p.title } : { state: 'error', note: p.transcript_error || 'No script' })
        else set(i, p.audio_status === 'ready' || mode === 'reference' ? { state: 'ready' } : { state: 'error', note: p.audio_error || 'No sound' })
      } catch (e) { set(i, { state: 'error', note: errMsg(e) }) }
    }
    setRunning(false)
  }

  return <Modal center title={`Add shots to ${section.title}`} onClose={() => { if (!running) onClose(!!rows) }}>
    {!rows ? <>
      <p className="muted" style={{ fontSize: 13.5 }}>Paste one link per line. Each link becomes its own shot, in this order.</p>
      <textarea className="textarea" rows={7} value={text} onChange={e => setText(e.target.value)} placeholder={'https://www.instagram.com/reel/…\nhttps://www.tiktok.com/@name/video/…'} autoFocus />
      <label className="field"><span>What kind of shots are these?</span><select className="select" value={mode} onChange={e => setMode(e.target.value as Mode)}>{(['talking', 'dance', 'reference'] as Mode[]).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></label>
      <label className="field"><span>Notes for every shot (optional)</span><textarea className="textarea" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder={'Setup: bedroom, face well lit\nDelivery: playful, eye contact'} /></label>
      {caps && !caps.link_import && links.some(l => ['instagram', 'tiktok'].includes(parseRef(l)!.platform)) && <p className="muted" style={{ fontSize: 13 }}>Automatic Instagram and TikTok downloads aren't switched on, so these are saved as embedded players. {mode !== 'reference' && 'Each one will need its video uploaded before it can go live.'}</p>}
      <button className="btn lg primary block" disabled={!links.length} onClick={run}>{links.length ? `Create ${links.length} shot${links.length === 1 ? '' : 's'}` : 'Paste links first'}</button>
    </> : <>
      <p className="muted" style={{ fontSize: 13.5 }}>{running ? 'Working through them. Keep this open.' : 'Done. Shots are saved as drafts. Check the scripts, then publish.'}</p>
      <div className="list" style={{ maxHeight: '46vh', overflow: 'auto' }}>{rows.map((r, i) => <div key={i} className="card tight between" style={{ gap: 10 }}>
        <span style={{ minWidth: 0 }}><b className="mono">{String(startAt + i + 1).padStart(2, '0')}</b> <span className="muted" style={{ fontSize: 13, wordBreak: 'break-all' }}>{r.note || r.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 46)}</span></span>
        <span className={'pill ' + STATE[r.state][1]} style={{ flex: 'none' }}>{STATE[r.state][0]}</span></div>)}</div>
      <button className="btn lg primary block" disabled={running} onClick={() => onClose(true)}>{running ? 'Working…' : 'Done'}</button>
    </>}
  </Modal>
}

export function AssignSection({ section, creators, shotCount, onClose }: { section: Section & { auto_assign?: boolean }; creators: CreatorOpt[]; shotCount: number; onClose: (changed: boolean) => void }) {
  const toast = useToast()
  const [pick, setPick] = useState<Record<string, boolean>>(() => Object.fromEntries(creators.map(c => [c.id, true])))
  const [due, setDue] = useState(''); const [auto, setAuto] = useState(!!section.auto_assign); const [busy, setBusy] = useState(false)
  const ids = creators.filter(c => pick[c.id]).map(c => c.id)
  async function go() {
    setBusy(true)
    if (auto !== !!section.auto_assign) { const { error } = await sb.from('social_sections').update({ auto_assign: auto }).eq('id', section.id); if (error) { toast(errMsg(error)); setBusy(false); return } }
    if (ids.length && shotCount) { const { error } = await sb.rpc('social_assign_section', { sec: section.id, creator_ids: ids, due: due ? new Date(due).toISOString() : null }); if (error) { toast(errMsg(error)); setBusy(false); return } }
    toast(ids.length && shotCount ? `Assigned ${shotCount} shot${shotCount === 1 ? '' : 's'} to ${ids.length} creator${ids.length === 1 ? '' : 's'}` : 'Saved'); onClose(true)
  }
  return <Modal center title={`Assign ${section.title}`} onClose={() => onClose(false)}>
    {creators.length === 0 ? <p className="muted">No creators yet. Invite them from Creators first.</p> : <>
      <p className="muted" style={{ fontSize: 13.5 }}>Gives every shot in this section to the creators you tick. Each creator films their own version. Anyone already assigned keeps their progress.</p>
      <div className="checks">{creators.map(c => <label key={c.id} className="check"><input type="checkbox" checked={!!pick[c.id]} onChange={e => setPick({ ...pick, [c.id]: e.target.checked })} />{c.name}</label>)}</div>
      <label className="field"><span>Deadline (optional)</span><input type="datetime-local" className="input" value={due} onChange={e => setDue(e.target.value)} /></label>
    </>}
    <label className="check"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /><span><b>Keep this section assigned to everyone</b><br /><span className="muted" style={{ fontSize: 13 }}>New shots here, and creators who join later, are assigned automatically.</span></span></label>
    <button className="btn lg primary block" disabled={busy} onClick={go}>{ids.length && shotCount ? 'Assign' : 'Save'}</button>
  </Modal>
}
