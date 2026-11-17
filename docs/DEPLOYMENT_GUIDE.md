# Deployment guide

## Current setup (as of 17 Nov 2026)

| Piece | Where | How it's updated |
|---|---|---|
| Web app | GitHub Pages, repo `thesahildhone/takes-camera`, folder `app/` on `main` | Build, copy `dist/` to `app/`, push |
| Database, login, storage | Supabase project `qchxfwoaaoslipwkdqep` (Mumbai, **Free plan**) | Migrations |
| Server functions | Supabase Edge Functions `social-import`, `ai-write` | `supabase functions deploy` |
| Scheduled jobs | pg_cron inside Supabase | SQL |

## 1. Deploy the web app

```bash
cd delivery-room-src
npm ci
npm run build             # type-checks then builds to dist/
rm -rf ../app && cp -r dist ../app
cd .. && git add app && git commit -m "Deploy" && git push origin main
```
GitHub Pages updates within about 1 minute. The app uses hash URLs (`#/…`), so no server rewrite rules are needed.

**Rollback:** `git revert <deploy commit>` then push, or check out `app/` from the previous commit.

## 2. Move to a proper host (recommended before paid pilots)

The GitHub repo is **public**, so anyone can read the code. Do one of these:
- Make the repo private (GitHub Pages on private repos needs a paid GitHub plan), or
- Host on **Cloudflare Pages** or **Vercel** (free tiers are fine): connect the repo, build command `npm run build`, root `delivery-room-src`, output `dist`. Then make the repo private.

After moving, add the new site address in Supabase → Authentication → URL Configuration (Site URL plus Redirect URLs). Otherwise password-reset links will point to the old address.

## 3. Database changes

All changes so far are listed in TECHNICAL_HANDOVER.md. To make a change:
1. Write it as a SQL file in `delivery-room-src/supabase/migrations/` with a date prefix.
2. Include rollback notes at the bottom of the file.
3. Test it on a branch or copy first (Supabase Pro has branching), then apply with `supabase db push` or the dashboard SQL editor.

**Back up first.** The Free plan has no automatic backups. Until you upgrade, before any change run:
```bash
supabase login
supabase link --project-ref qchxfwoaaoslipwkdqep
supabase db dump -f backup-schema.sql
supabase db dump --data-only -f backup-data.sql
```
Keep these files off the public repo (they contain user data).

## 4. Edge functions

```bash
supabase functions deploy social-import
supabase functions deploy ai-write
```
Both expect a signed-in user (JWT verification on). Source is in `delivery-room-src/supabase/functions/`.

**Secrets** (set in Supabase → Edge Functions → Secrets, never in code or chat):
- `APIFY_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (set)
- Optional: `ANTHROPIC_MODEL`, `APIFY_IG_ACTOR`, `APIFY_TT_ACTOR`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

## 5. Email (required before pilots)

1. Create a Resend account, verify a domain you own (DNS records).
2. Supabase → Authentication → SMTP Settings: enter the Resend SMTP details.
3. Turn on **Confirm email**.
4. Remove the auto-confirm trigger (`autoconfirm_before_insert`) with a migration. It was added only because there was no email service.
5. Test sign-up and password reset on a real inbox.

## 6. Upgrade checklist for production

- Supabase **Pro** ($25/month): daily backups, no pausing after a week of inactivity, more storage and egress.
- Turn on leaked-password protection (Authentication → Policies).
- Optional: point a custom domain at the host.
