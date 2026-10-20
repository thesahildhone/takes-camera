import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { STATUS_LABEL, STATUS_TONE, type AStatus } from './types'

const ToastCtx = createContext<(m: string) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t) }, [msg])
  return <ToastCtx.Provider value={setMsg}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>
}
export const useToast = () => useContext(ToastCtx)

export function StatusPill({ s }: { s: AStatus }) { return <span className={'pill ' + STATUS_TONE[s]}>{STATUS_LABEL[s]}</span> }

export function Modal({ title, onClose, children, center }: { title?: string; onClose: () => void; children: ReactNode; center?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return <div className={'scrim' + (center ? ' center' : '')} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="sheet" role="dialog" aria-label={title}>{!center && <span className="grab" />}{title && <h3 style={{ fontSize: 18 }}>{title}</h3>}{children}</div>
  </div>
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => { setLoading(true); setError(null); try { setData(await fn()) } catch (e) { setError((e as Error).message || 'Failed to load') } finally { setLoading(false) } }, deps)
  useEffect(() => { run() }, [run])
  return { data, error, loading, reload: run, setData }
}

export function Loading({ label = 'Loading…' }: { label?: string }) { return <p className="muted" style={{ padding: '24px 0' }}>{label}</p> }
export function ErrorBox({ msg }: { msg: string | null }) { return msg ? <div className="err" role="alert">{msg}</div> : null }

export async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true } catch { return false }
}
