-- Lists every stored file that belongs to a creator, so their account deletion can also erase the files.
-- Only the service role (edge function) may call it. Non-destructive.
create or replace function public.account_media_paths(u uuid)
 returns table(bucket text, name text) language sql stable security definer set search_path to 'public'
as $$
  select o.bucket_id::text, o.name::text from storage.objects o
   where o.bucket_id = 'social' and split_part(o.name,'/',2) = 'sub' and split_part(o.name,'/',4) = u::text
  union
  select 'media', f.storage_path from submission_files f where f.creator_id = u
  union
  select o.bucket_id::text, o.name::text from storage.objects o join assignments a on a.id::text = split_part(o.name,'/',2)
   where o.bucket_id = 'media' and a.creator_id = u and split_part(o.name,'/',1) = a.workspace_id::text
$$;
revoke all on function public.account_media_paths(uuid) from public, anon, authenticated;
grant execute on function public.account_media_paths(uuid) to service_role;
-- Rollback: drop function public.account_media_paths(uuid);
