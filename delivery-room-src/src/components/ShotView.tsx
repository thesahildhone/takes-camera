import type { ReactNode } from 'react'
import { instructionLines, pad2, parseRef, SA_LABEL, usesAudio, usesScript, type Project, type SAStatus } from '../lib/social'
import { IcBack } from '../lib/icons'

interface Props {
  p: Project; sectionName: string; index: number; total: number; status: SAStatus | null
  refUrl: string | null; audioUrl?: string | null
  onBack?: () => void; actions?: ReactNode; notice?: ReactNode; below?: ReactNode; preview?: boolean
}

export function RefCard({ p, refUrl }: { p: Project; refUrl: string | null }) {
  const ref = parseRef(p.reference_url)
  if (refUrl) return <div className="refcard"><span className="refsrc">{ref?.label && ref.platform !== 'file' ? ref.label : 'Reference'}</span>
    <video src={refUrl} controls playsInline preload="metadata" /></div>
  if (ref?.embed) return <div className="refcard embed"><span className="refsrc">{ref.label}</span>
    <iframe src={ref.embed} title={`${ref.label} reference`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
    <a className="reflink" href={p.reference_url!} target="_blank" rel="noreferrer">Open on {ref.label} if it doesn't load</a></div>
  if (p.reference_url) return <div className="refcard empty"><span className="refsrc">{ref?.label || 'Link'}</span>
    <a className="btn ghost" href={p.reference_url} target="_blank" rel="noreferrer">Open reference</a></div>
  return null
}

export default function ShotView({ p, sectionName, index, total, status, refUrl, audioUrl, onBack, actions, notice, below, preview }: Props) {
  const lines = instructionLines(p.instructions)
  return <div className="shot">
    <button className="shot-back" onClick={onBack} disabled={!onBack}><IcBack />{sectionName}</button>
    <div className="shot-head">
      <span className="shot-num">{pad2(index + 1)}</span>
      <div className="grow"><p className="shot-sec">{sectionName}</p>
        <p className="muted">Shot {index + 1} of {total}{status ? ` · ${SA_LABEL[status].toLowerCase()}` : preview ? ' · preview' : ''}</p></div>
    </div>
    <h1 className="shot-title">{p.title}</h1>
    {notice}
    <RefCard p={p} refUrl={refUrl} />
    {usesScript(p.mode) && p.script.trim() && <div className="scriptcard"><p className="lbl">Your script</p><p className="txt">{p.script}</p></div>}
    {usesAudio(p.mode) && <div className="audionote">
      {p.audio_status === 'ready' && audioUrl ? <><p><b>Sound plays while you film.</b> Wear headphones if you can, so the music isn't picked up by your mic.</p><audio src={audioUrl} controls preload="none" /></>
        : <p><b>No backing sound for this one.</b> Film along with the reference video above.</p>}
      {p.rights_status !== 'licensed' && <p className="muted" style={{ fontSize: 13 }}>Your agency gets a clean video without the music. {p.rights_status === 'not_permitted' ? 'The music is not cleared for reuse.' : 'The music rights are not confirmed yet.'}</p>}
    </div>}
    {(lines.length > 0 || p.description) && <div className="before"><h2>Before you film</h2>
      {p.description && <p className="muted">{p.description}</p>}
      <ul>{lines.map((l, i) => <li key={i}>{linkify(l)}</li>)}</ul></div>}
    {below}
    {actions && <div className="shot-actions">{actions}</div>}
  </div>
}

function linkify(t: string) {
  const parts = t.split(/(https?:\/\/\S+)/g)
  return parts.map((x, i) => /^https?:\/\//.test(x) ? <a key={i} href={x} target="_blank" rel="noreferrer" className="link" style={{ wordBreak: 'break-all' }}>{x}</a> : x)
}
