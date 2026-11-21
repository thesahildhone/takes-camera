-- Cloudflare R2 for creator uploads (behind a per-workspace switch).
-- Files keep the same bucket + path strings as before; r2_objects records which ones live in R2.
-- internal.objects is a combined view (Supabase storage + finished R2 uploads) that every function
-- which used to read storage.objects now reads, so size checks, usage and account deletion cover both.
-- Agency reference files stay in Supabase storage.
--
-- Rollback (only safe while no workspace has storage_backend = 'r2' with real uploads):
--   update workspaces set storage_backend = 'supabase';
--   re-run the DO block below with the two replace() arguments swapped, then:
--   drop function if exists public.r2_begin(text,text,bigint,text), public.r2_readable(text,text[]),
--     public.r2_finish(text,text,bigint,text), public.account_r2_paths(uuid);
--   drop view if exists internal.objects; drop table if exists public.r2_objects;
--   alter table public.workspaces drop column if exists storage_backend;

alter table public.workspaces add column if not exists storage_backend text not null default 'supabase'
  check (storage_backend in ('supabase','r2'));

create table if not exists public.r2_objects (
  bucket text not null check (bucket in ('media','social')),
  path text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  size bigint not null check (size > 0),
  mime text not null,
  status text not null default 'uploading' check (status in ('uploading','ready')),
  upload_id text,
  etag text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (bucket, path)
);
create index if not exists r2_objects_creator on public.r2_objects (created_by);
create index if not exists r2_objects_ws on public.r2_objects (workspace_id) where status = 'ready';
alter table public.r2_objects enable row level security;
revoke all on public.r2_objects from anon, authenticated;

create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;
create or replace view internal.objects as
  select o.bucket_id::text as bucket_id, o.name::text as name, o.metadata from storage.objects o
  union all
  select r.bucket, r.path, jsonb_build_object('size', r.size, 'mimetype', r.mime, 'store', 'r2') from public.r2_objects r where r.status = 'ready';
revoke all on internal.objects from public, anon, authenticated;

-- Point the four storage-aware functions at the combined view.
do $$
declare f regprocedure; d text;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('attach_file','social_submit','account_media_paths','workspace_plan_usage')
  loop
    d := pg_get_functiondef(f);
    if position('storage.objects' in d) > 0 then execute replace(d, 'storage.objects', 'internal.objects'); end if;
  end loop;
end $$;

-- Called as the uploading user (through the media edge function). Decides where the file goes and
-- checks the same write rules the storage policies use. Never lets a file be overwritten.
create or replace function public.r2_begin(b text, p text, sz bigint, m text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid; r r2_objects; lim bigint := 4294967296;
begin
  if b not in ('media','social') or p !~ '^[0-9a-f-]{36}/' or p ~ '\.\.' then raise exception 'Bad file path'; end if;
  ws := split_part(p, '/', 1)::uuid;
  if b = 'social' and split_part(p, '/', 2) <> 'sub' then return jsonb_build_object('use', 'supabase'); end if;
  if coalesce((select storage_backend from workspaces where id = ws), 'supabase') <> 'r2' then return jsonb_build_object('use', 'supabase'); end if;
  if not (case when b = 'media' then storage_can_write(p) else social_can_write(p) end) then raise exception 'Not allowed to upload here'; end if;
  if m is null or not (m = any(coalesce((select allowed_mime_types from storage.buckets where id = b), array[]::text[]))) then raise exception 'This file type is not supported'; end if;
  if sz is null or sz < 1 or sz > lim then raise exception 'Files must be under 4 GB'; end if;
  if exists(select 1 from storage.objects where bucket_id = b and name = p) then raise exception 'A file with this name already exists'; end if;
  select * into r from r2_objects where bucket = b and path = p;
  if found then
    if r.status = 'ready' then raise exception 'A file with this name already exists'; end if;
    if r.created_by = auth.uid() and r.size = sz then return jsonb_build_object('use', 'r2', 'resume', true, 'upload_id', r.upload_id); end if;
    raise exception 'Another upload is using this name';
  end if;
  insert into r2_objects(bucket, path, workspace_id, size, mime, created_by) values (b, p, ws, sz, m, auth.uid());
  return jsonb_build_object('use', 'r2', 'resume', false);
end $$;
revoke all on function public.r2_begin(text,text,bigint,text) from public, anon;
grant execute on function public.r2_begin(text,text,bigint,text) to authenticated;

-- Which of these paths are finished R2 files the caller may read (same read rules as storage).
create or replace function public.r2_readable(b text, paths text[]) returns table(path text)
language sql stable security definer set search_path = public as $$
  select r.path from r2_objects r
  where r.bucket = b and r.status = 'ready' and r.path = any(paths[1:300])
    and (case when b = 'media' then storage_can_read(r.path) when b = 'social' then social_can_read(r.path) else false end);
$$;
revoke all on function public.r2_readable(text,text[]) from public, anon;
grant execute on function public.r2_readable(text,text[]) to authenticated;

-- Service role only: mark an upload finished after the edge function has checked its size in R2.
create or replace function public.r2_finish(b text, p text, sz bigint, tag text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update r2_objects set status = 'ready', etag = tag, completed_at = now()
   where bucket = b and path = p and status = 'uploading' and size = sz;
  if not found then raise exception 'Upload record missing or size changed'; end if;
end $$;
revoke all on function public.r2_finish(text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.r2_finish(text,text,bigint,text) to service_role;

-- Service role only: every R2 file (finished or not) a creator uploaded, for account deletion.
create or replace function public.account_r2_paths(u uuid) returns table(bucket text, path text, status text, upload_id text)
language sql stable security definer set search_path = public as $$
  select r.bucket, r.path, r.status, r.upload_id from r2_objects r where r.created_by = u;
$$;
revoke all on function public.account_r2_paths(uuid) from public, anon, authenticated;
grant execute on function public.account_r2_paths(uuid) to service_role;

-- Pilot: Demo Agency only. Other workspaces switch when approved.
update public.workspaces set storage_backend = 'r2' where id = 'd0000000-0000-4000-8000-0000000000a5';
