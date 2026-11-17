-- Plans, allowances and transparent usage. Billing is by invoice for pilots; limits are shown, not enforced, except staff seats.
create table if not exists public.plans (
  id text primary key, name text not null, position int not null,
  price_usd int, price_aud int, creators int, staff int, storage_gb int,
  features text[] not null default '{}'
);
alter table public.plans enable row level security;
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated using (true);

insert into public.plans (id, name, position, price_usd, price_aud, creators, staff, storage_gb, features) values
 ('starter',    'Starter',    1, 29,  45,  5,    2,    250,  array['Creator portal','Filming briefs, scripts, references','Teleprompter and clip retakes','Original-quality downloads','Approvals']),
 ('growth',     'Growth',     2, 79,  119, 20,   5,    1000, array['Everything in Starter','Reusable briefs and recurring sets','Revision tracking','Staff roles','Agency dashboard','Automated reminders']),
 ('agency',     'Agency',     3, 199, 289, 50,   15,   3000, array['Everything in Growth','Creator performance reporting','Two-step login enforcement','Bulk downloads','Priority support']),
 ('enterprise', 'Enterprise', 4, 449, 649, null, null, null, array['Custom creator, staff and storage limits','Multiple teams','Dedicated onboarding'])
on conflict (id) do update set name = excluded.name, position = excluded.position, price_usd = excluded.price_usd, price_aud = excluded.price_aud,
  creators = excluded.creators, staff = excluded.staff, storage_gb = excluded.storage_gb, features = excluded.features;

alter table public.workspaces add column if not exists plan_id text not null default 'starter' references public.plans(id);
alter table public.workspaces add column if not exists extra_storage_gb int not null default 0;
alter table public.workspaces add column if not exists custom_limits jsonb not null default '{}'::jsonb;  -- enterprise overrides: {"creators":120,"staff":40,"storage_gb":8000}

-- Active creator = assigned work, or sent work, during the period (default: this calendar month, UTC).
create or replace function public.workspace_plan_usage(ws uuid, period_start timestamptz default date_trunc('month', now()))
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare w workspaces; p plans; act int; staffn int; bytes bigint; lim_c int; lim_s int; lim_g int;
begin
  if not is_staff(ws) then raise exception 'Not allowed'; end if;
  select * into w from workspaces where id = ws;
  select * into p from plans where id = w.plan_id;
  select count(distinct c) into act from (
    select creator_id c from social_assignments where workspace_id = ws and (created_at >= period_start or (due_at >= period_start))
    union select creator_id from social_submissions where workspace_id = ws and created_at >= period_start
    union select creator_id from assignments where workspace_id = ws and (created_at >= period_start or due_at >= period_start)
    union select creator_id from submission_files where workspace_id = ws and created_at >= period_start) x;
  select count(*) into staffn from workspace_members where workspace_id = ws;
  select coalesce(sum((metadata->>'size')::bigint), 0) into bytes from storage.objects
   where bucket_id in ('media','social') and split_part(name, '/', 1) = ws::text;
  lim_c := coalesce((w.custom_limits->>'creators')::int, p.creators);
  lim_s := coalesce((w.custom_limits->>'staff')::int, p.staff);
  lim_g := coalesce((w.custom_limits->>'storage_gb')::int, p.storage_gb) + w.extra_storage_gb;
  return jsonb_build_object('plan', p.id, 'plan_name', p.name, 'price_usd', p.price_usd, 'price_aud', p.price_aud,
    'period_start', period_start, 'active_creators', act, 'creator_limit', lim_c,
    'staff', staffn, 'staff_limit', lim_s, 'storage_bytes', bytes, 'storage_limit_gb', lim_g, 'extra_storage_gb', w.extra_storage_gb);
end $$;
revoke all on function public.workspace_plan_usage(uuid, timestamptz) from public, anon;
grant execute on function public.workspace_plan_usage(uuid, timestamptz) to authenticated;

-- Staff seats are the one hard limit: stop new staff invitations beyond the plan.
create or replace function public.enforce_staff_seats() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare lim int; used int;
begin
  if new.kind <> 'staff' then return new; end if;
  select coalesce((w.custom_limits->>'staff')::int, p.staff) into lim from workspaces w join plans p on p.id = w.plan_id where w.id = new.workspace_id;
  if lim is null then return new; end if;
  select (select count(*) from workspace_members where workspace_id = new.workspace_id)
       + (select count(*) from invitations where workspace_id = new.workspace_id and kind = 'staff' and status = 'pending' and expires_at > now()) into used;
  if used >= lim then raise exception 'Your plan includes % staff seats and all are used or invited. Upgrade, or remove someone first.', lim; end if;
  return new;
end $$;
drop trigger if exists invitations_staff_seats on public.invitations;
create trigger invitations_staff_seats before insert on public.invitations for each row execute function public.enforce_staff_seats();

-- Rollback: drop trigger invitations_staff_seats on invitations; drop function enforce_staff_seats(), workspace_plan_usage(uuid, timestamptz);
-- alter table workspaces drop column plan_id, drop column extra_storage_gb, drop column custom_limits; drop table plans;
