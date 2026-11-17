-- Two-step login (TOTP) for agency staff. An owner/admin can require it for everyone on the team.
-- When required, staff signed in with password only (aal1) lose data access until they pass the second step (aal2).
alter table public.workspaces add column if not exists require_mfa boolean not null default false;

create or replace function public.mfa_ok(ws uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select not coalesce((select require_mfa from workspaces where id = ws), false)
      or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;

create or replace function public.is_staff(ws uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from workspace_members where workspace_id = ws and user_id = auth.uid()) and mfa_ok(ws);
$$;

create or replace function public.is_ws_admin(ws uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role in ('owner','admin')) and mfa_ok(ws);
$$;

-- What the app needs before routing: does any of my agencies require two-step login?
create or replace function public.my_mfa_required() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from workspace_members m join workspaces w on w.id = m.workspace_id where m.user_id = auth.uid() and w.require_mfa);
$$;

-- Turning the requirement on or off needs an admin who has already passed two-step login, so nobody locks themselves out.
create or replace function public.set_require_mfa(ws uuid, req boolean) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists(select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role in ('owner','admin')) then raise exception 'Only the owner or an admin can change this'; end if;
  if coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then raise exception 'Set up two-step login on your own account first, then sign in again with your code.'; end if;
  update workspaces set require_mfa = req where id = ws;
  perform audit(ws, case when req then 'security.mfa_required' else 'security.mfa_optional' end, ws::text);
end $$;

revoke all on function public.mfa_ok(uuid), public.my_mfa_required(), public.set_require_mfa(uuid, boolean) from public, anon;
grant execute on function public.mfa_ok(uuid), public.my_mfa_required(), public.set_require_mfa(uuid, boolean) to authenticated;

-- Rollback: restore is_staff / is_ws_admin to the membership-only versions (without "and mfa_ok(ws)"),
-- drop functions mfa_ok, my_mfa_required, set_require_mfa; alter table workspaces drop column require_mfa.
