import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { sb, errMsg } from '../lib/supabase'
import { useWs } from '../lib/auth'
import { useAsync, Loading, ErrorBox, useToast, Modal } from '../lib/ui'
import { IcDown, IcUp, IcPlus } from '../lib/icons'
import { BulkAdd, AssignSection, AiShots, type CreatorOpt } from './SectionTools'
import { MODE_LABEL, pad2, readyProblem, type ContentType, type Project, type SAssignment, type Section } from '../lib/social'

const TYPE_KEY = 'dr.soc.type'
type Edit = { kind: 'section'; s: Section | null } | { kind: 'type'; t: ContentType | null } | null

export default function Socials() {
  const { ws, isAdmin } = useWs(); const toast = useToast(); const nav = useNavigate()
  const [typeId, setTypeId] = useState<string | null>(() => { try { return localStorage.getItem(TYPE_KEY) } catch { return null } })
  const [edit, setEdit] = useState<Edit>(null); const [title, setTitle] = useState(''); const [desc, setDesc] = useState('')
  const [showArchived, setShowArchived] = useState(false); const [busy, setBusy] = useState(false)
  const [bulk, setBulk] = useState<Section | null>(null); const [assign, setAssign] = useState<Section | null>(null); const [ai, setAi] = useState<Section | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    await sb.rpc('social_bootstrap', { ws: ws!.id })
    const [t, s, p, a, c] = await Promise.all([
      sb.from('social_content_types').select('*').eq('workspace_id', ws!.id).order('position'),
      sb.from('social_sections').select('*').eq('workspace_id', ws!.id).order('position'),
      sb.from('social_projects').select('*').eq('workspace_id', ws!.id).order('position'),
      sb.from('social_assignments').select('id,project_id,status').eq('workspace_id', ws!.id).neq('status', 'cancelled'),
      sb.from('creator_memberships').select('creator_id,profiles(full_name,email)').eq('workspace_id', ws!.id).eq('status', 'active'),
    ])
    const creators: CreatorOpt[] = ((c.data || []) as unknown as { creator_id: string; profiles: { full_name: string; email: string } | null }[]).map(x => ({ id: x.creator_id, name: x.profiles?.full_name || x.profiles?.email || 'Creator' }))
    if (t.error) throw t.error; if (s.error) throw s.error; if (p.error) throw p.error
    return { types: t.data as ContentType[], sections: s.data as Section[], projects: p.data as Project[], asg: (a.data || []) as Pick<SAssignment, 'id' | 'project_id' | 'status'>[], creators }
  }, [ws?.id])
  const types = useMemo(() => (data?.types || []).filter(t => showArchived || !t.archived_at), [data, showArchived])
  useEffect(() => { if (types.length && !types.some(t => t.id === typeId)) setTypeId(types[0].id) }, [types, typeId])
  useEffect(() => { if (typeId) try { localStorage.setItem(TYPE_KEY, typeId) } catch { /* */ } }, [typeId])
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox msg={error} />

  const sections = data.sections.filter(s => s.content_type_id === typeId && (showArchived || !s.archived_at))
  const projectsOf = (sid: string) => data.projects.filter(p => p.section_id === sid && (showArchived || p.publication_status !== 'archived'))
  const asgOf = (pid: string) => data.asg.filter(a => a.project_id === pid)

  async function swap<T extends { id: string; position: number }>(table: string, list: T[], i: number, d: -1 | 1) {
    const j = i + d; if (j < 0 || j >= list.length) return
    const norm = list.map((x, k) => ({ id: x.id, position: k }))
    ;[norm[i].position, norm[j].position] = [norm[j].position, norm[i].position]
    const res = await Promise.all(norm.map(x => sb.from(table).update({ position: x.position }).eq('id', x.id)))
    const e = res.find(r => r.error)?.error; if (e) toast(errMsg(e)); reload()
  }
  async function saveEdit() {
    if (!edit || !title.trim()) return; setBusy(true)
    let e
    if (edit.kind === 'section') {
      e = edit.s ? (await sb.from('social_sections').update({ title: title.trim(), description: desc.trim() }).eq('id', edit.s.id)).error
        : (await sb.from('social_sections').insert({ workspace_id: ws!.id, content_type_id: typeId, title: title.trim(), description: desc.trim(), position: sections.length })).error
    } else {
      e = edit.t ? (await sb.from('social_content_types').update({ name: title.trim() }).eq('id', edit.t.id)).error
        : (await sb.from('social_content_types').insert({ workspace_id: ws!.id, name: title.trim(), position: data!.types.length })).error
    }
    setBusy(false); if (e) return toast(errMsg(e)); setEdit(null); reload()
  }
  async function archiveSection(s: Section) { const { error } = await sb.from('social_sections').update({ archived_at: s.archived_at ? null : new Date().toISOString() }).eq('id', s.id); if (error) toast(errMsg(error)); else { toast(s.archived_at ? 'Restored' : 'Archived. Creators no longer see it.'); reload() } }
  async function deleteSection(s: Section) { const { error } = await sb.from('social_sections').delete().eq('id', s.id); if (error) toast('Only empty sections can be deleted. Move or delete its shots first.'); else { toast('Deleted'); reload() } }
  async function addProject(s: Section) {
    const { data: row, error } = await sb.from('social_projects').insert({ workspace_id: ws!.id, section_id: s.id, title: 'New shot', position: projectsOf(s.id).length, mode: 'talking' }).select('id').single()
    if (error) return toast(errMsg(error)); nav('/agency/socials/p/' + row.id)
  }
  async function moveProject(p: Project, to: string) {
    const n = data!.projects.filter(x => x.section_id === to).length
    const { error } = await sb.from('social_projects').update({ section_id: to, position: n }).eq('id', p.id)
    if (error) toast(errMsg(error)); else { toast('Moved. Submissions stay attached.'); reload() }
  }
  async function publishReady(s: Section) {
    const { data: n, error } = await sb.rpc('social_publish_ready', { sec: s.id })
    if (error) return toast(errMsg(error)); toast(`${n} shot${n === 1 ? '' : 's'} published`); reload()
  }
  const allSections = data.sections.filter(s => !s.archived_at)
  const typeName = (id: string) => data.types.find(t => t.id === id)?.name || ''

  return <>
    <div className="page-title"><div><h1>Socials</h1><p className="muted" style={{ marginTop: 4 }}>Creators only see shots you've published and assigned to them.</p></div>
      <div className="row wrap"><label className="check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Show archived</label>
        <Link className="btn ghost" to="/agency/social-review">Review inbox</Link></div></div>

    <div className="row wrap" style={{ gap: 8 }}>
      <div className="seg" role="tablist" aria-label="Content type">{types.map(t => <button key={t.id} role="tab" aria-pressed={t.id === typeId} onClick={() => setTypeId(t.id)}>{t.name}{t.archived_at ? ' (archived)' : ''}</button>)}</div>
      {isAdmin && <button className="btn sm ghost" onClick={() => { setTitle(''); setDesc(''); setEdit({ kind: 'type', t: null }) }}>+ Content type</button>}
      {isAdmin && typeId && <button className="btn sm ghost" onClick={() => { const t = data.types.find(x => x.id === typeId)!; setTitle(t.name); setEdit({ kind: 'type', t }) }}>Rename</button>}
    </div>

    {sections.length === 0 && <div className="empty"><h3>No sections in {typeName(typeId || '')} yet</h3><p>Sections are your own groups, for example "Talking heads" or "Dances". Name them however you like.</p></div>}
    {sections.map((s, i) => { const ps = projectsOf(s.id), nReady = ps.filter(p => p.publication_status === 'draft' && !readyProblem(p)).length
      return <section key={s.id} className="card stack" style={{ opacity: s.archived_at ? .6 : 1 }}>
        <div className="sec-head">
          <div className="grow"><h3>{s.title}{s.archived_at ? ' · archived' : ''}</h3>{s.description && <p className="muted" style={{ fontSize: 13.5 }}>{s.description}</p>}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {nReady > 0 && <button className="btn sm ghost" onClick={() => publishReady(s)}>Publish {nReady} ready</button>}
            <button className="btn sm ghost" onClick={() => setAssign(s)}>Assign</button>
            <button className="btn sm ghost" onClick={() => setAi(s)}>Write with AI</button>
            <button className="btn sm ghost" onClick={() => setBulk(s)}>Add from links</button>
            <button className="btn sm primary" onClick={() => addProject(s)}><IcPlus />Add shot</button>
          </div>
        </div>
        <div className="sec-tools">
          {(s as Section & { auto_assign?: boolean }).auto_assign && <span className="pill ok">Assigned to everyone</span>}
          <button className="link" onClick={() => { setTitle(s.title); setDesc(s.description); setEdit({ kind: 'section', s }) }}>Rename</button>
          <button className="link" onClick={() => archiveSection(s)}>{s.archived_at ? 'Restore' : 'Archive'}</button>
          {ps.length === 0 && <button className="link" onClick={() => deleteSection(s)}>Delete</button>}
          <button className="link" disabled={i === 0} onClick={() => swap('social_sections', sections, i, -1)}>Move up</button>
          <button className="link" disabled={i === sections.length - 1} onClick={() => swap('social_sections', sections, i, 1)}>Move down</button>
        </div>
        {ps.length === 0 ? <p className="muted" style={{ fontSize: 13.5 }}>No shots yet. Add one, or paste a list of links.</p> :
          <div className="scroll-x"><table className="table shots"><thead><tr><th>#</th><th>Shot</th><th>Type</th><th>Status</th><th>Creators</th><th>Section</th><th /></tr></thead><tbody>
            {ps.map((p, k) => { const a = asgOf(p.id), sent = a.filter(x => x.status === 'submitted' || x.status === 'approved').length, why = readyProblem(p)
              return <tr key={p.id}>
                <td className="mono">{pad2(k + 1)}</td>
                <td><Link className="link" to={'/agency/socials/p/' + p.id}><b>{p.title}</b></Link>{p.import_status === 'failed' || p.import_status === 'awaiting_upload' ? <div className="muted" style={{ fontSize: 12.5 }}>Reference needs an upload</div> : null}</td>
                <td className="muted">{MODE_LABEL[p.mode]}</td>
                <td>{p.publication_status === 'published' ? <span className="pill ok">Published</span> : p.publication_status === 'archived' ? <span className="pill todo">Archived</span> : <span className="pill wait" title={why || ''}>{why ? 'Draft · ' + why : 'Draft · ready'}</span>}</td>
                <td className="mono">{a.length ? `${sent}/${a.length} sent` : '–'}</td>
                <td><select className="select" aria-label={`Move ${p.title} to section`} value={p.section_id} onChange={e => moveProject(p, e.target.value)} style={{ minWidth: 150 }}>
                  {allSections.map(x => <option key={x.id} value={x.id}>{typeName(x.content_type_id)} · {x.title}</option>)}</select></td>
                <td><div className="row" style={{ gap: 4 }}>
                  <button className="icon-btn" aria-label={`Move ${p.title} up`} disabled={k === 0} onClick={() => swap('social_projects', ps, k, -1)}><IcUp /></button>
                  <button className="icon-btn" aria-label={`Move ${p.title} down`} disabled={k === ps.length - 1} onClick={() => swap('social_projects', ps, k, 1)}><IcDown /></button></div></td>
              </tr> })}
          </tbody></table></div>}
      </section> })}
    {typeId && <button className="btn ghost" onClick={() => { setTitle(''); setDesc(''); setEdit({ kind: 'section', s: null }) }}><IcPlus />New section in {typeName(typeId)}</button>}

    {ai && <AiShots section={ai} startAt={projectsOf(ai.id).length} onClose={ch => { setAi(null); if (ch) reload() }} />}
    {bulk && <BulkAdd section={bulk} startAt={projectsOf(bulk.id).length} onClose={ch => { setBulk(null); if (ch) reload() }} />}
    {assign && <AssignSection section={assign} creators={data.creators} shotCount={projectsOf(assign.id).filter(p => p.publication_status !== 'archived').length} onClose={ch => { setAssign(null); if (ch) reload() }} />}
    {edit && <Modal center title={edit.kind === 'section' ? (edit.s ? 'Edit section' : 'New section') : (edit.t ? 'Rename content type' : 'New content type')} onClose={() => setEdit(null)}>
      <label className="field"><span>{edit.kind === 'section' ? 'Section name' : 'Name'}</span><input id="sec-title" className="input" value={title} maxLength={edit.kind === 'section' ? 60 : 40} onChange={e => setTitle(e.target.value)} placeholder={edit.kind === 'section' ? 'e.g. Talking heads' : 'e.g. Reels'} autoFocus /></label>
      {edit.kind === 'section' && <label className="field"><span>Description (creators see this)</span><textarea id="sec-desc" className="textarea" value={desc} onChange={e => setDesc(e.target.value)} /></label>}
      {edit.kind === 'type' && edit.t && <button className="link" onClick={async () => { const { error } = await sb.from('social_content_types').update({ archived_at: edit.t!.archived_at ? null : new Date().toISOString() }).eq('id', edit.t!.id); if (error) toast(errMsg(error)); setEdit(null); reload() }}>{edit.t.archived_at ? 'Restore this content type' : 'Archive this content type'}</button>}
      <button className="btn lg primary block" disabled={busy || !title.trim()} onClick={saveEdit}>Save</button>
    </Modal>}
  </>
}
