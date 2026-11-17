-- Security hardening, 17 Nov 2026 (launch-readiness audit)
-- Rollback: see bottom of file.

-- 1. Team functions were executable by signed-out visitors (default PUBLIC grant). They already refused
--    to do anything without a signed-in admin/member, but they should not be reachable at all.
revoke all on function public.team_heartbeat(uuid, text) from public, anon;
revoke all on function public.team_update(uuid, uuid, text, text) from public, anon;
grant execute on function public.team_heartbeat(uuid, text) to authenticated;
grant execute on function public.team_update(uuid, uuid, text, text) to authenticated;

-- 2. Creators can delete their own account (privacy law: right to erasure).
--    Agency staff and owners are refused: an agency account owns shared data, so that goes through support.
--    Files already uploaded stay in storage until the storage cleanup runs (see SECURITY_AUDIT.md).
create or replace function public.delete_my_account(confirm text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  if confirm is distinct from 'DELETE' then raise exception 'Type DELETE to confirm'; end if;
  if exists(select 1 from workspace_members where user_id = me) then
    raise exception 'Agency accounts are closed by support so shared work is not lost. Email support to close this account.';
  end if;
  insert into audit_events (workspace_id, actor_id, action, target)
    select workspace_id, me, 'creator.account_deleted', me::text from creator_memberships where creator_id = me;
  delete from social_submissions where creator_id = me;
  delete from social_assignments where creator_id = me;
  update invitations set accepted_by = null where accepted_by = me;
  delete from auth.users where id = me;  -- cascades profile, memberships, OF assignments, files rows, notifications
end $$;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- Rollback:
--   grant execute on function public.team_heartbeat(uuid, text), public.team_update(uuid, uuid, text, text) to public;
--   drop function public.delete_my_account(text);
