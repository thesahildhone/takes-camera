import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync, Loading, ErrorBox } from '../lib/ui'
import { IcPlus } from '../lib/icons'
import { dueLabel } from '../lib/types'
import { isSent, isToFilm, pad2, parseRef, SA_LABEL, SA_TONE, usesAudio, usesScript, type ContentType, type Project, type SAssignment, type Section } from '../lib/social'

export interface SocialData { types: ContentType[]; sections: Section[]; projects: Project[]; asg: SAssignment[]; sentWeek: Set<string> }

export async function loadSocial(uid: string): Promise<SocialData> {
  const a = await sb.from('social_assignments').select('*').eq('creator_id', uid).neq('status', 'cancelled')
  if (a.error) throw a.error
  const asg = (a.data || []) as SAssignment[]
  if (!asg.length) return { types: [], sections: [], projects: [], asg: [], sentWeek: new Set() }
  const ws = [...new Set(asg.map(x => x.workspace_id))]
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
  const [p, s, t, sub] = await Promise.all([
    sb.from('social_projects').select('*').in('id', asg.map(x => x.project_id)),
    sb.from('social_sections').select('*').in('workspace_id', ws).is('archived_at', null).order('position'),
    sb.from('social_content_types').select('*').in('workspace_id', ws).is('archived_at', null).order('position'),
    sb.from('social_submissions').select('assignment_id').eq('creator_id', uid).gte('created_at', weekAgo),
  ])
  if (p.error) throw p.error
  const projects = ((p.data || []) as Project[]).filter(x => x.publication_status === 'published')
  return { types: (t.data || []) as ContentType[], sections: (s.data || []) as Section[], projects, asg: asg.filter(x => projects.some(p => p.id === x.project_id)), sentWeek: new Set((sub.data || []).map(r => r.assignment_id)) }
}

/** Ordered list of this creator's shots in a section — this order is the "Shot X of Y" numbering. */
export function shotsIn(d: SocialData, sectionId: string) {
  return d.projects.filter(p => p.section_id === sectionId).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
    .map(p => ({ p, a: d.asg.find(x => x.project_id === p.id)! })).filter(x => x.a)
}

const K = { type: 'dr.soc.ctype', sec: 'dr.soc.csec', ws: 'dr.soc.cws' }
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* */ } }

export default function SocialHome() {
  const { profile, creatorOf } = useAuth()
  const { data, loading, error } = useAsync(() => loadSocial(profile!.id), [profile?.id])
  const active = useMemo(() => new Set(creatorOf.map(w => w.id)), [creatorOf])
  const wsWith = useMemo(() => creatorOf.filter(w => data?.asg.some(a => a.workspace_id === w.id)), [creatorOf, data])
  const [wsId, setWsId] = useState<string | null>(get(K.ws))
  const [typeId, setTypeId] = useState<string | null>(get(K.type)); const [secId, setSecId] = useState<string | null>(get(K.sec))
  useEffect(() => { if (wsWith.length && !wsWith.some(w => w.id === wsId)) setWsId(wsWith[0].id) }, [wsWith, wsId])
  const d = useMemo(() => data && wsId ? { ...data, asg: data.asg.filter(a => a.workspace_id === wsId && active.has(a.workspace_id)) } : null, [data, wsId, active])
  const types = useMemo(() => (d?.types || []).filter(t => t.workspace_id === wsId), [d, wsId])
  useEffect(() => { if (types.length && !types.some(t => t.id === typeId)) setTypeId(types[0].id) }, [types, typeId])
  const secs = useMemo(() => (d?.sections || []).filter(s => s.content_type_id === typeId && shotsIn(d!, s.id).length), [d, typeId])
  useEffect(() => { if (secs.length && !secs.some(s => s.id === secId)) setSecId(secs[0].id) }, [secs, secId])
  useEffect(() => { if (wsId) put(K.ws, wsId); if (typeId) put(K.type, typeId); if (secId) put(K.sec, secId) }, [wsId, typeId, secId])

  if (loading) return <Loading />
  if (error) return <ErrorBox msg={error} />
  if (!d || !d.asg.length) return <div className="empty"><h3>{creatorOf.length ? 'No Socials shots yet' : "You're not part of an agency yet"}</h3><p>{creatorOf.length ? 'When your agency assigns reels, stories or carousels to you, they show up here.' : 'Ask your agency for an invite link and open it on this phone. Their shots show up here.'}</p></div>

  const countsFor = (tid: string) => { const list = d.sections.filter(s => s.content_type_id === tid).flatMap(s => shotsIn(d, s.id)); return { total: list.length, toFilm: list.filter(x => isToFilm(x.a.status)).length, sent: list.filter(x => isSent(x.a.status)).length } }
  const c = typeId ? countsFor(typeId) : { total: 0, toFilm: 0, sent: 0 }
  const ring = c.total ? c.sent / c.total : 0
  const cur = secId ? shotsIn(d, secId) : []

  return <div className="stack" style={{ gap: 16 }}>
    {wsWith.length > 1 && <select className="sselect" aria-label="Agency" value={wsId || ''} onChange={e => setWsId(e.target.value)}>{wsWith.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
    <div className="tcards">{types.map(t => { const n = countsFor(t.id); return <button key={t.id} className="tcard" aria-pressed={t.id === typeId} onClick={() => setTypeId(t.id)}><b>{t.name}</b><span>{n.toFilm} to film</span></button> })}</div>
    <div className="ringcard">
      <div className="ring" style={{ ['--p' as string]: ring }}><b>{c.toFilm}</b><span>left</span></div>
      <div><h2>{c.toFilm ? `${c.toFilm} shot${c.toFilm === 1 ? '' : 's'} to go` : c.total ? 'All sent' : 'Nothing here yet'}</h2><p>{c.sent} of {c.total} sent in total</p></div>
    </div>
    {secs.length > 0 && <div className="secgrid">{secs.map(s => { const list = shotsIn(d, s.id), week = list.filter(x => d.sentWeek.has(x.a.id)).length
      return <button key={s.id} className="seccard" aria-pressed={s.id === secId} onClick={() => { setSecId(s.id); document.getElementById('shots')?.scrollIntoView({ behavior: 'smooth' }) }}>
        <span className="bar0"><i style={{ width: (list.filter(x => isSent(x.a.status)).length / list.length * 100) + '%' }} /></span>
        <span className="plus" aria-hidden="true"><IcPlus /></span>
        <b>{s.title}</b><span>{list.filter(x => isSent(x.a.status)).length} of {list.length} sent · {week ? `${week} this week` : 'none this week'}</span></button> })}</div>}
    {secs.length > 0 && <>
      <div className="sectabs" id="shots" role="tablist">{secs.map(s => { const list = shotsIn(d, s.id), sent = list.filter(x => isSent(x.a.status)).length
        return <button key={s.id} role="tab" aria-selected={s.id === secId} onClick={() => setSecId(s.id)}><b>{s.title}</b><span>{sent}/{list.length}</span><span className="bar0"><i style={{ width: (sent / list.length * 100) + '%' }} /></span></button> })}</div>
      <div className="between"><h2 className="sh2">To film</h2><span className="smuted">{cur.length} shot{cur.length === 1 ? '' : 's'}</span></div>
      {d.sections.find(s => s.id === secId)?.description && <p className="smuted">{d.sections.find(s => s.id === secId)!.description}</p>}
      <div className="shotlist">{cur.map(({ p, a }, i) => { const r = parseRef(p.reference_url)
        return <Link key={p.id} to={'/creator/s/p/' + p.id} className={'shotrow' + (isSent(a.status) ? ' sent' : '')}>
          <span className="num">{pad2(i + 1)}</span>
          <span className="grow"><b>{p.title}</b><span className="tags">
            {a.status !== 'not_started' && <span className={'pill ' + SA_TONE[a.status]}>{SA_LABEL[a.status]}</span>}
            {usesScript(p.mode) && <span className="tag">Script</span>}{usesAudio(p.mode) && p.audio_status === 'ready' && <span className="tag">Sound</span>}
            {r && r.platform !== 'file' && r.platform !== 'other' && <span className="tag dim">{r.label}</span>}
            {a.due_at && isToFilm(a.status) && <span className={'duechip' + (new Date(a.due_at) < new Date() ? ' late' : '')}>{dueLabel(a.due_at)}</span>}</span></span>
          <span className="chev">›</span></Link> })}</div>
    </>}
  </div>
}
