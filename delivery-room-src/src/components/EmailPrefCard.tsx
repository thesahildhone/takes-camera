import { useState } from 'react'
import { sb, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/ui'

// Turns email copies of in-app notifications on or off for the signed-in person.
// Invites and password emails are always sent.
export default function EmailPrefCard({ section = false }: { section?: boolean }) {
  const { profile, refresh } = useAuth(); const toast = useToast()
  const [on, setOn] = useState(profile?.email_notifications !== false)
  async function set(v: boolean) {
    setOn(v)
    const { error } = await sb.from('profiles').update({ email_notifications: v }).eq('id', profile!.id)
    if (error) { setOn(!v); toast(errMsg(error)) } else { toast(v ? 'Email updates on' : 'Email updates off'); refresh() }
  }
  const body = <>
    <h3>Email updates</h3>
    <label className="row" style={{ gap: 10 }}><input id="emailpref" type="checkbox" checked={on} onChange={e => set(e.target.checked)} />
      <span>Email me when something needs my attention</span></label>
    <p className="muted" style={{ fontSize: 13 }}>Sent to {profile?.email}. Several updates close together arrive as one email.</p>
  </>
  return section ? <section className="card stack">{body}</section> : <div className="card stack">{body}</div>
}
