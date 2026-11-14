import { sb } from './supabase'

/** Calls the writing helper. Throws a plain-language message the UI can show. */
export async function aiWrite<T>(workspaceId: string, action: 'shots' | 'polish' | 'set', payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.functions.invoke('ai-write', { body: { action, workspace_id: workspaceId, ...payload } })
  if (error) throw new Error('The writing service did not respond. Try again.')
  if (!data?.ok) throw new Error(data?.code === 'no_key' ? "Write with AI isn't switched on yet. Add ANTHROPIC_API_KEY in Supabase to turn it on." : data?.error || 'Something went wrong.')
  return data as T
}
