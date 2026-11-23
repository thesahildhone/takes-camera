-- New agencies store creator uploads in Cloudflare R2; Destiny workspace switched (it had no files).
-- Rollback: alter table public.workspaces alter column storage_backend set default 'supabase';
--           update public.workspaces set storage_backend = 'supabase' where id = '6ec28084-01a0-46a1-af42-02e5efe30188';
alter table public.workspaces alter column storage_backend set default 'r2';
update public.workspaces set storage_backend = 'r2' where id = '6ec28084-01a0-46a1-af42-02e5efe30188';
