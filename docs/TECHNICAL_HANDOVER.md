# Technical handover

For a developer taking over. Everything runs on accounts you own (GitHub `thesahildhone`, Supabase, Apify, OpenAI, Anthropic). Nothing depends on the Claude environment the app was built in.

## Architecture

```
Phone / laptop browser
   └─ React 18 + TypeScript + Vite single-page app (hash routes)
        ├─ Supabase Auth (email + password)
        ├─ Postgres via supabase-js, protected by Row Level Security
        ├─ Storage buckets: media, social (both private, signed URLs, 30 min)
        ├─ Realtime channel team:<workspace> for presence
        └─ Edge Functions
             ├─ social-import  → Apify (IG/TikTok download), OpenAI (transcript)
             └─ ai-write       → Anthropic (script help)
Postgres pg_cron
   ├─ delivery-room-schedules     every 5 min
   └─ delivery-room-due-reminders hourly
```

## Code map (`delivery-room-src/src`)

| Area | Files |
|---|---|
| Boot, email-link handling | `main.tsx`, `App.tsx` |
| Login, sign-up, forgot/reset | `Public.tsx`, `lib/auth.tsx` |
| Agency side | `agency/` (AgencyApp, Creators, Team, Review, ReviewDetail, Socials pages) |
| Creator side | `creator/` (Home, Runner, Account, SocialHome, SocialProject, ShotView, SocialCamera) |
| Camera engine | `camEngine.ts` (plain mode records the stream; smoothing mode uses WebGL canvas) |
| Local drafts | `drafts.ts` (IndexedDB, survives reloads) |
| Supabase client | `lib/supabase.ts` (URL + publishable key; the publishable key is safe to be public) |
| Styling | `styles.css` (After Dark theme tokens, Bricolage Grotesque font) |

## Roles

- **Owner / manager / staff:** a row in `workspace_members` with a role and a title.
- **Creator:** belongs to one workspace and sees only assigned shots and their own submissions.
- Access is enforced in Postgres RLS and security-definer functions, not just in the UI.

## Database migrations applied (in order)

core_schema, access_rules, server_logic, scheduler_cron_and_fixes, harden_functions, profile_links, fix_scheduler_names, socials_schema, socials_rpcs, socials_sub_profile_fk, socials_hardening, trial_readiness, talking_shots_without_reference, creators_cannot_create_workspaces, social_ready_allow_link_audio, team_titles_presence, security_hardening_launch_audit.

**Gap:** only the last one is saved as a file in the repo. The rest live in the database's migration history (`supabase_migrations.schema_migrations`). First job for a new developer: run `supabase db dump -f supabase/schema.sql` and commit the schema (not the data).

## Key server functions (RPCs)

bootstrap, accept_invitation, social_assign, social_review, social_publish, nudge, team_heartbeat, team_update, delete_my_account, plus the scheduler functions. All check the caller's workspace membership.

## Secrets (names only)

`APIFY_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`; optional `ANTHROPIC_MODEL`, `APIFY_IG_ACTOR`, `APIFY_TT_ACTOR`. Rotate any key you think was exposed: create a new one in the provider dashboard, update the Supabase secret, delete the old one.

## Tests

`delivery-room-src/e2e/` holds Playwright (Python) scripts that run against a mocked backend:
```bash
cd delivery-room-src && npm run build && npx vite preview --port 4173 &
python e2e/creator_flow.py && python e2e/agency_flow.py && python e2e/forgot_test.py
```
The database security tests are written up in SECURITY_AUDIT.md. Run them as SQL inside `begin … rollback`.

## Demo accounts (test data only)

- Agency owner: demo.agency@deliveryroom.test (Demo Agency)
- Creator: Desi Destiny (Demo Agency)

Passwords were shared in chat during the build, so change them before any public demo. Don't use demo accounts for real content.

## Known limitations

See PRODUCT_AUDIT.md (bugs B1–B10) and SECURITY_AUDIT.md (S1–S14). The biggest ones:
- no email sending
- no backups on the Free plan
- public repo
- no billing
- files left in storage after account deletion (deletion currently by support request)

## How to restore if things break

- **App:** revert the last deploy commit (DEPLOYMENT_GUIDE §1).
- **Edge function:** redeploy from the repo copy.
- **Database:** from your latest `db dump` (Free plan) or Supabase point-in-time/daily backup (Pro).
