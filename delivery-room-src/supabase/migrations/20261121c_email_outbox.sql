-- Email delivery for in-app notifications and invites.
-- Every notification row (and every invite that has an email address) is queued in email_outbox.
-- A cron job pings the email-dispatch edge function every 2 minutes when anything is pending; the
-- function claims rows, groups each person's notifications into one email, sends via Resend, and
-- marks them sent/failed. Nothing here is readable by app users (RLS on, no policies).
--
-- Rollback:
--   select cron.unschedule('submitreel-email-dispatch');
--   drop trigger if exists notifications_email on public.notifications;
--   drop trigger if exists invitations_email on public.invitations;
--   drop function if exists public.queue_notification_email(), public.queue_invite_email(),
--     public.email_outbox_claim(int), public.email_outbox_done(uuid[], boolean, text), public.email_dispatch_ping();
--   drop table if exists public.email_outbox;
--   alter table public.profiles drop column if exists email_notifications;

alter table public.profiles add column if not exists email_notifications boolean not null default true;

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('notification','invite')),
  to_email text not null,
  user_id uuid references auth.users(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete cascade,
  invitation_id uuid references public.invitations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists email_outbox_pending on public.email_outbox (created_at) where status in ('pending','sending');
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

create or replace function public.queue_notification_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare em text; ok boolean;
begin
  select p.email, p.email_notifications into em, ok from profiles p where p.id = new.user_id;
  if em is not null and em like '%@%' and coalesce(ok, true) then
    insert into email_outbox(kind, to_email, user_id, notification_id) values ('notification', lower(em), new.user_id, new.id);
  end if;
  return new;
end $$;

create or replace function public.queue_invite_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.email like '%@%' and new.status = 'pending' then
    insert into email_outbox(kind, to_email, invitation_id) values ('invite', lower(trim(new.email)), new.id);
  end if;
  return new;
end $$;

drop trigger if exists notifications_email on public.notifications;
create trigger notifications_email after insert on public.notifications for each row execute function public.queue_notification_email();
drop trigger if exists invitations_email on public.invitations;
create trigger invitations_email after insert on public.invitations for each row execute function public.queue_invite_email();

-- Claim up to n rows (pending, or stuck in 'sending' for 10+ minutes) and return what the email needs.
create or replace function public.email_outbox_claim(n int default 50)
returns table(id uuid, kind text, to_email text, n_type text, n_title text, n_body text, n_link text, n_created timestamptz,
              ws_name text, inv_kind text, inv_role text, inv_token uuid, inv_expires timestamptz, inviter text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select o.id from email_outbox o
    where o.status = 'pending' or (o.status = 'sending' and o.created_at < now() - interval '10 minutes' and o.attempts < 3)
    order by o.created_at limit n for update skip locked
  ), u as (
    update email_outbox o set status = 'sending', attempts = o.attempts + 1 from c where o.id = c.id returning o.*
  )
  select u.id, u.kind, u.to_email, nt.type, nt.title, nt.body, nt.link, nt.created_at,
         w.name, i.kind, i.role, i.token, i.expires_at, pr.full_name
  from u
  left join notifications nt on nt.id = u.notification_id
  left join invitations i on i.id = u.invitation_id
  left join workspaces w on w.id = coalesce(nt.workspace_id, i.workspace_id)
  left join profiles pr on pr.id = i.invited_by;
end $$;

create or replace function public.email_outbox_done(ids uuid[], ok boolean, err text default null) returns void
language sql security definer set search_path = public as $$
  update email_outbox set
    status = case when ok then 'sent' when attempts >= 3 then 'failed' else 'pending' end,
    sent_at = case when ok then now() end,
    last_error = case when ok then null else left(err, 500) end
  where id = any(ids);
$$;

revoke all on function public.email_outbox_claim(int), public.email_outbox_done(uuid[], boolean, text),
  public.queue_notification_email(), public.queue_invite_email() from public, anon, authenticated;
grant execute on function public.email_outbox_claim(int), public.email_outbox_done(uuid[], boolean, text) to service_role;

-- Only calls the function when there is work, so idle minutes cost nothing.
create or replace function public.email_dispatch_ping() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from email_outbox where status = 'pending' or (status = 'sending' and created_at < now() - interval '10 minutes' and attempts < 3)) then
    perform net.http_post(url := 'https://qchxfwoaaoslipwkdqep.supabase.co/functions/v1/email-dispatch',
      body := '{}'::jsonb, headers := '{"content-type":"application/json"}'::jsonb, timeout_milliseconds := 30000);
  end if;
end $$;
revoke all on function public.email_dispatch_ping() from public, anon, authenticated;

select cron.schedule('submitreel-email-dispatch', '*/2 * * * *', 'select public.email_dispatch_ping();');
