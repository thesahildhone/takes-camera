-- Configurable reminders: due-soon timing, overdue reminders (repeating, max 3), and escalation to the
-- agency team when a creator is late. Settings live on workspaces.reminder_settings; admins change them
-- with set_reminder_settings(). Changing a due date resets that assignment's reminder state.
--
-- Rollback:
--   restore send_due_reminders() from 20261117 security hardening (24h due-soon only), then:
--   drop trigger if exists assignments_due_reset on public.assignments;
--   drop trigger if exists social_assignments_due_reset on public.social_assignments;
--   drop function if exists public.reset_reminders_on_due_change(), public.set_reminder_settings(uuid, jsonb);
--   alter table public.workspaces drop column if exists reminder_settings;
--   alter table public.assignments drop column if exists overdue_count, drop column if exists overdue_reminded_at, drop column if exists escalated_at;
--   alter table public.social_assignments drop column if exists overdue_count, drop column if exists overdue_reminded_at, drop column if exists escalated_at;

alter table public.workspaces add column if not exists reminder_settings jsonb not null
  default '{"due_soon_hours":24,"overdue":true,"overdue_repeat_hours":24,"escalate_after_hours":24}'::jsonb;

alter table public.assignments add column if not exists overdue_count int not null default 0,
  add column if not exists overdue_reminded_at timestamptz, add column if not exists escalated_at timestamptz;
alter table public.social_assignments add column if not exists overdue_count int not null default 0,
  add column if not exists overdue_reminded_at timestamptz, add column if not exists escalated_at timestamptz;

create or replace function public.reset_reminders_on_due_change() returns trigger
language plpgsql as $$
begin
  if new.due_at is distinct from old.due_at then
    new.reminded_at := null; new.overdue_count := 0; new.overdue_reminded_at := null; new.escalated_at := null;
  end if;
  return new;
end $$;
drop trigger if exists assignments_due_reset on public.assignments;
create trigger assignments_due_reset before update of due_at on public.assignments for each row execute function public.reset_reminders_on_due_change();
drop trigger if exists social_assignments_due_reset on public.social_assignments;
create trigger social_assignments_due_reset before update of due_at on public.social_assignments for each row execute function public.reset_reminders_on_due_change();

create or replace function public.set_reminder_settings(ws uuid, s jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d int := (s->>'due_soon_hours')::int; r int := (s->>'overdue_repeat_hours')::int;
        e int := (s->>'escalate_after_hours')::int; o boolean := (s->>'overdue')::boolean; v jsonb;
begin
  if not is_ws_admin(ws) then raise exception 'Only admins can change reminders'; end if;
  if d is null or d not in (0,2,6,12,24,48) then raise exception 'Due-soon reminder must be off, 2, 6, 12, 24 or 48 hours'; end if;
  if r is null or r not in (0,12,24,48) then raise exception 'Repeat must be off, 12, 24 or 48 hours'; end if;
  if e is null or e not in (0,6,12,24,48,72) then raise exception 'Team alert must be off, 6, 12, 24, 48 or 72 hours'; end if;
  if o is null then raise exception 'Overdue reminder setting missing'; end if;
  v := jsonb_build_object('due_soon_hours', d, 'overdue', o, 'overdue_repeat_hours', r, 'escalate_after_hours', e);
  update workspaces set reminder_settings = v where id = ws;
  insert into audit_events(workspace_id, actor_id, action, target, meta) values (ws, auth.uid(), 'reminders.update', ws::text, v);
  return v;
end $$;
revoke all on function public.set_reminder_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_reminder_settings(uuid, jsonb) to authenticated;

-- Runs hourly (cron 'delivery-room-due-reminders'). Each step marks rows before notifying, so a
-- creator never gets the same reminder twice. OF-side staff alerts never name the set.
create or replace function public.send_due_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare open_states text[] := array['not_started','in_progress','revision_requested'];
begin
  -- 1. Due soon (per-workspace window; 0 = off)
  with t as (
    update social_assignments a set reminded_at = now() from social_projects p, workspaces w
    where p.id = a.project_id and w.id = a.workspace_id and p.publication_status = 'published' and a.reminded_at is null
      and a.status = any(open_states) and (w.reminder_settings->>'due_soon_hours')::int > 0
      and a.due_at between now() and now() + make_interval(hours => (w.reminder_settings->>'due_soon_hours')::int)
    returning a.creator_id, a.workspace_id, p.id pid, p.title, a.due_at)
  insert into notifications (user_id, workspace_id, type, title, body, link)
  select creator_id, workspace_id, 'due_soon', 'Due soon: ' || title,
    'This shot is due in about ' || greatest(1, round(extract(epoch from due_at - now()) / 3600))::int || ' hours.', '/creator/s/p/' || pid from t;

  with t as (
    update assignments a set reminded_at = now() from workspaces w
    where w.id = a.workspace_id and a.reminded_at is null and a.status = any(open_states)
      and (w.reminder_settings->>'due_soon_hours')::int > 0
      and a.due_at between now() and now() + make_interval(hours => (w.reminder_settings->>'due_soon_hours')::int)
    returning a.creator_id, a.workspace_id, a.id, a.title, a.due_at)
  insert into notifications (user_id, workspace_id, type, title, body, link)
  select creator_id, workspace_id, 'due_soon', 'Due soon: ' || title,
    'This set is due in about ' || greatest(1, round(extract(epoch from due_at - now()) / 3600))::int || ' hours.', '/creator/a/' || id from t;

  -- 2. Overdue reminders to the creator: first one when the deadline passes, then every N hours, max 3
  with t as (
    update social_assignments a set overdue_count = a.overdue_count + 1, overdue_reminded_at = now()
    from social_projects p, workspaces w
    where p.id = a.project_id and w.id = a.workspace_id and p.publication_status = 'published'
      and a.status = any(open_states) and a.due_at < now() and a.due_at > now() - interval '14 days'
      and coalesce((w.reminder_settings->>'overdue')::boolean, true) and a.overdue_count < 3
      and (a.overdue_count = 0 or ((w.reminder_settings->>'overdue_repeat_hours')::int > 0
           and a.overdue_reminded_at < now() - make_interval(hours => (w.reminder_settings->>'overdue_repeat_hours')::int)))
    returning a.creator_id, a.workspace_id, p.id pid, p.title)
  insert into notifications (user_id, workspace_id, type, title, body, link)
  select creator_id, workspace_id, 'overdue', 'Overdue: ' || title, 'This shot was due already. Film it when you can, or message your agency.', '/creator/s/p/' || pid from t;

  with t as (
    update assignments a set overdue_count = a.overdue_count + 1, overdue_reminded_at = now() from workspaces w
    where w.id = a.workspace_id and a.status = any(open_states) and a.due_at < now() and a.due_at > now() - interval '14 days'
      and coalesce((w.reminder_settings->>'overdue')::boolean, true) and a.overdue_count < 3
      and (a.overdue_count = 0 or ((w.reminder_settings->>'overdue_repeat_hours')::int > 0
           and a.overdue_reminded_at < now() - make_interval(hours => (w.reminder_settings->>'overdue_repeat_hours')::int)))
    returning a.creator_id, a.workspace_id, a.id, a.title)
  insert into notifications (user_id, workspace_id, type, title, body, link)
  select creator_id, workspace_id, 'overdue', 'Overdue: ' || title, 'This set was due already. Finish it when you can, or message your agency.', '/creator/a/' || id from t;

  -- 3. Escalate to the agency team once, N hours after the deadline (0 = off)
  with t as (
    update social_assignments a set escalated_at = now() from social_projects p, workspaces w
    where p.id = a.project_id and w.id = a.workspace_id and p.publication_status = 'published'
      and a.status = any(open_states) and a.escalated_at is null and a.due_at > now() - interval '14 days'
      and (w.reminder_settings->>'escalate_after_hours')::int > 0
      and a.due_at < now() - make_interval(hours => (w.reminder_settings->>'escalate_after_hours')::int)
    returning a.creator_id, a.workspace_id, p.id pid, p.title)
  insert into notifications (user_id, workspace_id, type, title, body, link)
  select m.user_id, t.workspace_id, 'overdue_team',
    coalesce(nullif(pr.full_name, ''), 'A creator') || ' is late on “' || t.title || '”',
    'Still not sent. You can nudge them from Creators.', '/agency/socials/p/' || t.pid
  from t join workspace_members m on m.workspace_id = t.workspace_id left join profiles pr on pr.id = t.creator_id;

  with t as (
    update assignments a set escalated_at = now() from workspaces w
    where w.id = a.workspace_id and a.status = any(open_states) and a.escalated_at is null and a.due_at > now() - interval '14 days'
      and (w.reminder_settings->>'escalate_after_hours')::int > 0
      and a.due_at < now() - make_interval(hours => (w.reminder_settings->>'escalate_after_hours')::int)
    returning a.creator_id, a.workspace_id, a.id)
  insert into notifications (user_id, workspace_id, type, title, body, link)
  select m.user_id, t.workspace_id, 'overdue_team',
    coalesce(nullif(pr.full_name, ''), 'A creator') || ' is late on a set',
    'Still not submitted. Open Assignments to check or nudge them.', '/agency/assignments'
  from t join workspace_members m on m.workspace_id = t.workspace_id left join profiles pr on pr.id = t.creator_id;
end $$;
revoke all on function public.send_due_reminders() from public, anon, authenticated;

-- Backfill: work that was already late before this shipped is treated as already reminded and escalated,
-- so switching this on doesn't send a burst of emails about old deadlines.
update public.assignments set overdue_count = 3, overdue_reminded_at = now(), escalated_at = now()
  where due_at < now() and status in ('not_started','in_progress','revision_requested');
update public.social_assignments set overdue_count = 3, overdue_reminded_at = now(), escalated_at = now()
  where due_at < now() and status in ('not_started','in_progress','revision_requested');
