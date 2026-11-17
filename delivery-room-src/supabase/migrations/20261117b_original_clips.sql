-- Keep the untouched original clips of a multi-clip submission, check upload integrity, log social downloads.
-- Non-destructive: replaces one function (same signature), adds one function. No table changes.

create or replace function public.social_submit(sub_id uuid, asg uuid, clean text, mix text, mix_note text, m text, sz bigint, dur numeric, w integer, h integer, sm integer, clips integer, src text, meta jsonb)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare a social_assignments; p social_projects; v int; cname text; prefix text; o jsonb; osz bigint; n int := 0;
begin
  if exists(select 1 from social_submissions where id = sub_id and creator_id = auth.uid()) then return sub_id; end if;  -- idempotent retry
  select * into a from social_assignments where id = asg for update;
  if not found or a.creator_id <> auth.uid() then raise exception 'Assignment not found'; end if;
  if not is_active_creator(a.workspace_id) then raise exception 'You are no longer part of this agency'; end if;
  if a.status not in ('not_started','in_progress','revision_requested') then raise exception 'This shot is already submitted'; end if;
  select * into p from social_projects where id = a.project_id;
  if p.publication_status <> 'published' then raise exception 'This shot is not available any more'; end if;
  prefix := a.workspace_id::text || '/sub/' || a.project_id::text || '/' || auth.uid()::text || '/';
  if clean not like prefix || '%' then raise exception 'Bad file path'; end if;
  if mix is not null and mix not like prefix || '%' then raise exception 'Bad file path'; end if;
  if mix is not null and p.rights_status <> 'licensed' then raise exception 'Music version is not allowed for this shot'; end if;

  -- integrity: the stored object must exist and be exactly the size the phone sent
  select (metadata->>'size')::bigint into osz from storage.objects where bucket_id = 'social' and name = clean;
  if not found then raise exception 'Upload not finished'; end if;
  if osz is not null and sz is not null and osz <> sz then raise exception 'Upload incomplete (size mismatch). Send again.'; end if;
  if mix is not null then
    select (metadata->>'size')::bigint into osz from storage.objects where bucket_id = 'social' and name = mix;
    if not found then raise exception 'Upload not finished'; end if;
    if osz is not null and (meta->>'mix_size') is not null and osz <> (meta->>'mix_size')::bigint then raise exception 'Upload incomplete (size mismatch). Send again.'; end if;
  end if;

  -- original clips (untouched recordings), if any
  if jsonb_typeof(meta->'originals') = 'array' then
    if jsonb_array_length(meta->'originals') > 60 then raise exception 'Too many clips'; end if;
    for o in select * from jsonb_array_elements(meta->'originals') loop
      n := n + 1;
      if coalesce(o->>'path','') not like prefix || '%' then raise exception 'Bad file path'; end if;
      select (metadata->>'size')::bigint into osz from storage.objects where bucket_id = 'social' and name = o->>'path';
      if not found then raise exception 'Clip % upload not finished', n; end if;
      if osz is not null and (o->>'size') is not null and osz <> (o->>'size')::bigint then raise exception 'Clip % upload incomplete. Send again.', n; end if;
    end loop;
  end if;

  select coalesce(max(version),0) + 1 into v from social_submissions where assignment_id = asg;
  insert into social_submissions (id, assignment_id, workspace_id, project_id, creator_id, version, clean_path, mix_path, mix_note, mime, size_bytes, duration_s, width, height, smoothing, clip_count, source, meta)
  values (sub_id, asg, a.workspace_id, a.project_id, auth.uid(), v, clean, mix, mix_note, m, coalesce(sz,0), dur, w, h, sm, clips, coalesce(src,'camera'), coalesce(meta,'{}'::jsonb));
  update social_assignments set status = 'submitted' where id = asg;
  select full_name into cname from profiles where id = auth.uid();
  perform notify_staff(a.workspace_id, 'social_submitted', coalesce(nullif(cname,''),'A creator') || ' sent ' || p.title, 'Version ' || v || ' is ready for review.', '/agency/social-review/' || sub_id);
  perform audit(a.workspace_id, 'social.submitted', sub_id::text);
  return sub_id;
end $function$;

create or replace function public.log_social_download(sub uuid, what text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare ws uuid;
begin
  select workspace_id into ws from social_submissions where id = sub;
  if ws is null or not is_staff(ws) then raise exception 'Not allowed'; end if;
  perform audit(ws, 'social.download', sub::text, jsonb_build_object('what', left(what, 200)));
end $function$;
revoke all on function public.log_social_download(uuid, text) from public, anon;
grant execute on function public.log_social_download(uuid, text) to authenticated;

-- Rollback: re-run the previous social_submit definition (in TECHNICAL_HANDOVER / migration history
-- "socials_rpcs"), and `drop function public.log_social_download(uuid, text);`
