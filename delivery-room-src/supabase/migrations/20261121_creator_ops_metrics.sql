-- Creator operations report from real workflow data (Socials shots + OF sets). Staff only. Read-only.
create or replace function public.creator_ops_metrics(ws uuid, since timestamptz default now() - interval '30 days')
 returns table(creator_id uuid, name text, tasks int, submitted int, approved int, on_time int, with_due int,
   avg_turnaround_h numeric, avg_review_h numeric, reviews int, revisions int, overdue_now int, open_now int, last_sent timestamptz)
 language sql stable security definer set search_path to 'public'
as $$
  with t as (
    select a.creator_id, a.created_at, a.due_at, a.status,
      (select min(s.created_at) from social_submissions s where s.assignment_id = a.id) first_sub,
      (select max(s.created_at) from social_submissions s where s.assignment_id = a.id) last_sub,
      (select count(*) from social_submissions s where s.assignment_id = a.id and s.status in ('approved','revision_requested')) n_rev,
      (select count(*) from social_submissions s where s.assignment_id = a.id and s.status = 'revision_requested') n_redo,
      (select avg(extract(epoch from s.reviewed_at - s.created_at)) from social_submissions s where s.assignment_id = a.id and s.reviewed_at is not null) rev_s
    from social_assignments a where a.workspace_id = ws and (a.created_at >= since or a.due_at >= since)
    union all
    select a.creator_id, a.created_at, a.due_at, a.status, a.submitted_at, a.submitted_at,
      case when a.reviewed_at is not null then 1 + (select count(*) from revision_requests r where r.assignment_id = a.id) else (select count(*) from revision_requests r where r.assignment_id = a.id) end,
      (select count(*) from revision_requests r where r.assignment_id = a.id),
      extract(epoch from a.reviewed_at - a.submitted_at)
    from assignments a where a.workspace_id = ws and (a.created_at >= since or a.due_at >= since)
  )
  select t.creator_id, coalesce(nullif(p.full_name,''), p.email, 'Creator'),
    count(*)::int,
    count(first_sub)::int,
    count(*) filter (where t.status = 'approved')::int,
    count(*) filter (where first_sub is not null and due_at is not null and first_sub <= due_at)::int,
    count(*) filter (where first_sub is not null and due_at is not null)::int,
    round((avg(extract(epoch from first_sub - t.created_at)) / 3600)::numeric, 1),
    round((avg(rev_s) / 3600)::numeric, 1),
    sum(n_rev)::int, sum(n_redo)::int,
    count(*) filter (where t.status in ('not_started','in_progress','revision_requested') and due_at < now())::int,
    count(*) filter (where t.status in ('not_started','in_progress','revision_requested'))::int,
    max(last_sub)
  from t left join profiles p on p.id = t.creator_id
  where is_staff(ws)
  group by t.creator_id, p.full_name, p.email
  order by 2;
$$;
revoke all on function public.creator_ops_metrics(uuid, timestamptz) from public, anon;
grant execute on function public.creator_ops_metrics(uuid, timestamptz) to authenticated;
-- Rollback: drop function public.creator_ops_metrics(uuid, timestamptz);
