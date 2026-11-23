-- Captures a fix that was applied to the Mumbai database outside the recorded history:
-- users may edit their own profile but not change their account kind. my_kind() avoids the policy
-- querying profiles from inside a profiles policy.
create or replace function public.my_kind() returns text
language sql stable security definer set search_path to 'public'
as $function$ select kind from profiles where id = auth.uid() $function$;
revoke all on function public.my_kind() from public, anon;
grant execute on function public.my_kind() to authenticated, service_role;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to public
  using (id = auth.uid()) with check (id = auth.uid() and kind = my_kind());
