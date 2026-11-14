-- Delivery Room demo setup. Paste into Supabase > SQL Editor > Run. Safe to run again (it rebuilds the demo).
-- Logins:  agency  -> demo.agency@deliveryroom.test  / DemoAgency2026
--          creator -> demo.creator@deliveryroom.test / DemoCreator2026

-- 0) fix "infinite recursion detected in policy for relation profiles" when saving your name
create or replace function public.my_kind() returns text language sql stable security definer set search_path = public
as $$ select kind from profiles where id = auth.uid() $$;
revoke execute on function public.my_kind() from public, anon;
grant execute on function public.my_kind() to authenticated;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and kind = public.my_kind());

do $$
declare
  ag uuid := 'd0000000-0000-4000-8000-00000000a001';
  cr uuid := 'd0000000-0000-4000-8000-00000000c001';
  ws uuid := 'd0000000-0000-4000-8000-0000000000a5';
  reels uuid; stories uuid; carousels uuid; s_talk uuid; s_home uuid; s_dance uuid; s_story uuid;
  tpl uuid; tv uuid; p uuid;
  ref text := 'https://www.instagram.com/reel/DWmYXSxD5GP/';
  of_pages jsonb;
begin
  -- clean out any previous demo
  delete from social_submissions where workspace_id = ws;
  delete from social_assignments where workspace_id = ws;
  delete from social_projects where workspace_id = ws;
  delete from social_sections where workspace_id = ws;
  delete from social_content_types where workspace_id = ws;
  delete from submission_files where workspace_id = ws;
  delete from revision_requests where workspace_id = ws;
  delete from reviews where workspace_id = ws;
  delete from assignments where workspace_id = ws;
  delete from schedule_runs where workspace_id = ws;
  delete from schedules where workspace_id = ws;
  update templates set current_version_id = null where workspace_id = ws;
  delete from template_versions where workspace_id = ws;
  delete from templates where workspace_id = ws;
  delete from categories where workspace_id = ws;
  delete from invitations where workspace_id = ws;
  delete from notifications where workspace_id = ws or user_id in (ag, cr);
  delete from audit_events where workspace_id = ws;
  delete from creator_memberships where workspace_id = ws;
  delete from workspace_members where workspace_id = ws;
  delete from workspaces where id = ws;
  delete from profiles where id in (ag, cr);
  delete from auth.identities where user_id in (ag, cr);
  delete from auth.users where id in (ag, cr);

  -- the two logins
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values
   ('00000000-0000-0000-0000-000000000000', ag, 'authenticated', 'authenticated', 'demo.agency@deliveryroom.test', extensions.crypt('DemoAgency2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Agency Owner","kind":"business"}', now(), now(), '', '', '', ''),
   ('00000000-0000-0000-0000-000000000000', cr, 'authenticated', 'authenticated', 'demo.creator@deliveryroom.test', extensions.crypt('DemoCreator2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Desi Destiny","kind":"creator"}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
   (gen_random_uuid(), ag, ag::text, jsonb_build_object('sub', ag::text, 'email', 'demo.agency@deliveryroom.test', 'email_verified', true), 'email', now(), now(), now()),
   (gen_random_uuid(), cr, cr::text, jsonb_build_object('sub', cr::text, 'email', 'demo.creator@deliveryroom.test', 'email_verified', true), 'email', now(), now(), now());
  insert into profiles (id, full_name, email, kind) values (ag, 'Demo Agency Owner', 'demo.agency@deliveryroom.test', 'business'), (cr, 'Desi Destiny', 'demo.creator@deliveryroom.test', 'creator')
  on conflict (id) do update set full_name = excluded.full_name, kind = excluded.kind;

  insert into workspaces (id, name, created_by) values (ws, 'Demo Agency', ag);
  insert into workspace_members (workspace_id, user_id, role) values (ws, ag, 'owner');
  insert into creator_memberships (workspace_id, creator_id, status) values (ws, cr, 'active');

  -- ===== Socials
  insert into social_content_types (workspace_id, name, position) values (ws, 'Reels', 0) returning id into reels;
  insert into social_content_types (workspace_id, name, position) values (ws, 'Stories', 1) returning id into stories;
  insert into social_content_types (workspace_id, name, position) values (ws, 'Carousels', 2) returning id into carousels;
  insert into social_sections (workspace_id, content_type_id, title, description, position) values (ws, reels, 'Talking heads', 'Straight to camera. Hook in the first second.', 0) returning id into s_talk;
  insert into social_sections (workspace_id, content_type_id, title, description, position) values (ws, reels, 'Home alone / gaming', 'Casual, at your desk or on the sofa.', 1) returning id into s_home;
  insert into social_sections (workspace_id, content_type_id, title, description, position) values (ws, reels, 'Dances', 'Trend dances. Film along with the reference.', 2) returning id into s_dance;
  insert into social_sections (workspace_id, content_type_id, title, description, position) values (ws, stories, 'Day in my life', 'Quick vertical clips for stories.', 0) returning id into s_story;

  insert into social_projects (workspace_id, section_id, title, position, mode, script, transcript_approved, reference_url, ref_platform, import_status, instructions, publication_status, published_at) values
   (ws, s_talk, '“Ladies, this one is for you”', 0, 'talking', 'Ladies, this one is for you. If he does not text back in an hour, he is not busy. He is just not that into you.', true, ref, 'instagram', 'link_only',
    E'Hook: start talking while you put the phone down, keep it quick and natural\nSetup: bedroom or gaming desk, face well lit, camera at eye level\nDelivery: like you are teasing a guy you like. Eye contact, playful smile', 'published', now()),
   (ws, s_talk, 'Hot take: pineapple on pizza', 1, 'talking', 'Unpopular opinion. Pineapple on pizza is elite. Fight me in the comments.', true, ref, 'instagram', 'link_only',
    E'Hook: look away then snap to camera on "Unpopular opinion"\nKeep it under 10 seconds\nEnd with a smirk, no outro', 'published', now()),
   (ws, s_talk, 'Rate my outfit', 2, 'talking', 'Okay be honest. Rate this fit out of ten. Comment below.', true, ref, 'instagram', 'link_only',
    E'Full outfit in frame for the second half\nFilm in daylight near a window\nTwo takes: one with a spin, one without', 'published', now()),
   (ws, s_home, 'Gaming setup tour', 0, 'talking', 'Welcome to my little corner of the internet. This is where the magic happens.', true, ref, 'instagram', 'link_only',
    E'Start close on the keyboard, pull back to your face\nLED lights on if you have them\nKeep the voice soft and cosy', 'published', now()),
   (ws, s_home, 'Reacting to your comments', 1, 'reference', '', false, ref, 'instagram', 'link_only',
    E'Read three comments from your last post out loud and react\nBig expressions, no script needed\nUnder 20 seconds', 'published', now()),
   (ws, s_dance, 'Trend dance (film along with the reference)', 0, 'dance', '', false, ref, 'instagram', 'link_only',
    E'Learn the first 8 counts from the reference\nFull body in frame, phone at hip height\nTip: the agency can upload the reference video so the sound plays while you film', 'published', now()),
   (ws, s_story, 'Morning coffee', 0, 'reference', '', false, ref, 'instagram', 'link_only',
    E'One clip making coffee, one sipping and smiling at camera\nNatural light, messy bun is fine', 'published', now());
  update social_projects set rights_status = 'not_permitted' where workspace_id = ws and mode = 'dance';
  -- one draft shot so the agency can see what an unpublished project looks like
  insert into social_projects (workspace_id, section_id, title, position, mode, reference_url, ref_platform, import_status, import_error, instructions)
  values (ws, s_dance, 'New trend (draft, upload the reference)', 1, 'dance', ref, 'instagram', 'awaiting_upload', 'Instagram doesn''t allow automatic downloads. Upload a copy you have permission to use.', 'Film along with the sound.');
  insert into social_assignments (workspace_id, project_id, creator_id, notified_at)
  select ws, id, cr, now() from social_projects where workspace_id = ws and publication_status = 'published';

  -- ===== OF
  of_pages := jsonb_build_array(
    jsonb_build_object('id','tips','title','Before you start','kind','info','body', E'Make sure it is actually morning or daytime\nKeep it playful and natural\nGood lighting and angles for the best look\nGirl-next-door vibes, it should feel live','photos_min',0,'photos_max',0,'videos_min',0,'videos_max',0,'extras',0,'guidance',''),
    jsonb_build_object('id','teaser','title','Free teaser - Sleepy & cute','kind','media','body','Oversized tee, messy hair, soft smile and sleepy eyes. Caption idea: just woke up.','photos_min',3,'photos_max',3,'videos_min',0,'videos_max',0,'extras',2,'guidance',''),
    jsonb_build_object('id','teaser2','title','Free teaser part 2','kind','media','body','Two more in the same outfit, different angle.','photos_min',2,'photos_max',2,'videos_min',0,'videos_max',0,'extras',2,'guidance',''),
    jsonb_build_object('id','ppv1','title','PPV 1 - Getting cozy','kind','media','body','Two photos and two short videos.','photos_min',2,'photos_max',2,'videos_min',2,'videos_max',2,'extras',2,'guidance','10 to 30 seconds, vertical'),
    jsonb_build_object('id','ppv2','title','PPV 2 - Slow tease','kind','media','body','Three photos and two to three videos.','photos_min',3,'photos_max',3,'videos_min',2,'videos_max',3,'extras',2,'guidance',''),
    jsonb_build_object('id','bonus','title','Bonus free video','kind','media','body','One casual video. Goes out free.','photos_min',0,'photos_max',0,'videos_min',1,'videos_max',1,'extras',2,'guidance','15 to 30 seconds'));
  insert into categories (workspace_id, name, position) values (ws, 'Good Morning', 0);
  insert into templates (workspace_id, title, summary, pages, created_by) values (ws, 'OF · Good Morning', 'Morning set: two free teasers, two PPVs and a bonus.', of_pages, ag) returning id into tpl;
  insert into template_versions (template_id, workspace_id, version, title, summary, category_name, pages, created_by) values (tpl, ws, 1, 'OF · Good Morning', 'Morning set: two free teasers, two PPVs and a bonus.', 'Good Morning', of_pages, ag) returning id into tv;
  update templates set current_version_id = tv where id = tpl;
  insert into assignments (workspace_id, creator_id, template_id, template_version_id, title, category_name, summary, pages, status, release_at, due_at, created_by)
  values (ws, cr, tpl, tv, 'OF · Good Morning', 'Good Morning', 'Morning set: two free teasers, two PPVs and a bonus.', of_pages, 'not_started', now(), now() + interval '5 days', ag);

  insert into notifications (user_id, workspace_id, type, title, body, link) values
   (cr, ws, 'social_assigned', 'New shots from Demo Agency', '7 Socials shots and 1 OF set are ready to film.', '/creator');
end $$;

select 'Demo ready' as status,
  (select count(*) from social_projects where workspace_id = 'd0000000-0000-4000-8000-0000000000a5') as social_projects,
  (select count(*) from assignments where workspace_id = 'd0000000-0000-4000-8000-0000000000a5') as of_assignments;
