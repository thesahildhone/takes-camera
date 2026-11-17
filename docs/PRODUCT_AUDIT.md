# Product audit

Date: 17 Nov 2026. Product: "Delivery Room" (working name; "Takeo" is the leading candidate). Live at `https://thesahildhone.github.io/takes-camera/app/`.

## What it is

A content-production workspace for creator agencies (OnlyFans/fan-platform agencies and influencer agencies). The agency plans what to film; the creator films it on their phone inside the app; the agency reviews and approves. Two sides:

- **Socials**: short-form video shots (reels, stories, carousels) with a reference video, script, teleprompter, and in-app camera.
- **OF**: multi-part photo/video "sets" built from templates, issued once or on a schedule, uploaded slot by slot, reviewed with per-slot revision requests.

## Architecture

| Layer | Technology | Notes |
|---|---|---|
| Front end | React 18 + TypeScript + Vite, hash routing | Single-page app. `delivery-room-src/` |
| Hosting | GitHub Pages, public repo `thesahildhone/takes-camera` (`app/` folder on `main`) | Public repo = code is visible to anyone. Move to private + Cloudflare Pages/Vercel |
| Backend | Supabase (Postgres 17, Mumbai region), project `qchxfwoaaoslipwkdqep`, **Free plan** | All business rules in SQL functions and row-level security |
| Auth | Supabase Auth, email + password | Email confirmation bypassed by a trigger (see SECURITY_AUDIT S1) |
| Storage | Supabase Storage, private buckets `media` (OF) and `social` (Socials) | 1 GB file limit each |
| Server functions | Edge functions `social-import` (video download + transcripts), `ai-write` (Claude) | Source now in `supabase/functions/` |
| Scheduled jobs | pg_cron: schedules every 5 min, due reminders hourly | |
| Paid APIs | Apify (Instagram/TikTok download), OpenAI (speech-to-text), Anthropic (writing help) | Keys in Supabase secrets |
| Video processing | In the browser: WebGL skin smoothing, MediaRecorder, canvas re-encode to join clips | Heavy on older phones |

## Roles

| Role | Where | Can |
|---|---|---|
| Owner | `workspace_members.role = owner` | Everything |
| Full access (admin) | `admin` | Everything except owner-only; manages team, creators, settings |
| Content only (reviewer) | `reviewer` | Shots, sets, reviews, calendar. No team/creator/settings management |
| Creator | `creator_memberships` | Sees only published shots/sets assigned to them, in agencies they belong to |
| Job titles | `workspace_members.title` | Manager, Co-manager, Content director, etc. Labels only, no permission effect |

## Existing functionality (tested status in TEST_REPORT.md)

**Agency**
- Sign-up as agency, name workspace, switch workspaces.
- Overview: review queue, creator table with progress, "Remind" (in-app nudge, rate-limited to once per 6 h), getting-started steps.
- Calendar of due dates; in-app notifications inbox.
- Socials: folders (Reels, Stories, Carousels…) and sections in a sidebar tree; create/rename/archive/reorder.
- Shots: types talking / dance / reference / both; reference link (Instagram/TikTok/YouTube embeds) or file upload; automatic download, sound extraction and transcript; script approval; filming notes; due dates.
- Write with AI (several shots from a brief), Tighten with AI (script), bulk "Add from links", assign a whole section, auto-assign new shots to a section's creators, publish.
- Socials review inbox: filter, play clean and music versions, approve or request changes with a note.
- OF: set templates (pages with photo/video slots and instructions), versioning, issue to creators, recurring schedules, review with per-slot revision requests, zip download with logging.
- Creators: invite links, list, remove.
- Team: invite staff with job title and access level, edit, remove, see who's online and which page they're on.

**Creator**
- Join via invite link; one account can belong to several agencies (kept separate).
- Home: Socials/OF toggle, "Hey {name}", ring progress, due this week, sections, shot list with due chips.
- Shot page: Instagram/TikTok embed or stored reference, script, notes, "Film it".
- Camera: teleprompter (still/scroll), multi-clip recording, retake one clip, trim, reorder, delete with undo, optional skin smoothing, dance sound cue with countdown; drafts saved on the phone and survive reloads.
- Send: joins clips into one video (plus a version with licensed music for dance), uploads, shows status.
- OF runner: page-by-page photo/video slots, camera or camera roll, save progress, submit, see revision requests.
- Account: name, password change, leave agency, **delete account (new)**.
- **Forgot password (new)**.

## Missing functionality

| Missing | Why it matters | Priority |
|---|---|---|
| Email (or WhatsApp/SMS) notifications | Creators only see tasks and reminders inside the app. Chasing creators is the core pain; in-app only won't fix it | **P0** |
| Working email delivery (SMTP) | Needed for verification and password reset | **P0** |
| Billing and plans (Stripe/Razorpay) | Can't charge agencies; no usage limits per plan | P1 (before paid pilot ends) |
| Magic-link creator access | Competitor's main advantage: creators open a link and film, no account | P1 |
| Reports / creator performance analytics | Directive A and C; agencies want punctuality, turnaround, revision rate | P1 |
| Creator groups / teams / departments | Large agencies split creators across managers | P2 |
| Bulk export and data export | Data portability, offboarding | P1 |
| Comments thread per submission | Today a single note per review action | P2 |
| Integrations: Google Drive/Dropbox export, Slack, webhooks, Zapier | Agencies already live in Drive/Slack | P2 |
| White-label branded creator portal | Premium tier value | P2 |
| Watermarking of review copies | Leak deterrence | P2 |
| Retention policy + storage clean-up | Cost and privacy | P1 |
| Terms, privacy policy, DPA | Legal requirement before paid use | **P0** |

## Critical bugs and gaps found today

| # | Issue | Severity | Status |
|---|---|---|---|
| B1 | Email verification bypassed for all accounts | P0 | Documented; needs SMTP first |
| B2 | No password reset | P0 | **Fixed** |
| B3 | No backups (Free plan) | P0 | Needs Supabase Pro |
| B4 | Video import could be redirected to private addresses (SSRF) | P1 | **Fixed, deployed** |
| B5 | No cap on paid API use per agency (imports, transcripts) | P1 | **Fixed, deployed** |
| B6 | No account deletion | P1 | **Fixed for creators** |
| B7 | Team functions callable while signed out | P2 | **Fixed** |
| B8 | Edge function `ai-write` source existed only on the server | P1 | **Saved into the repo** |
| B9 | Deleting a creator who has Socials work was impossible (foreign keys) | P2 | Handled inside `delete_my_account` |
| B10 | Clip length could be wrong on slow phones | P2 | Fixed 17 Nov (re-measured after recording) |

## UX issues

- Creator side is now mobile-first and fits phones; agency side works on iPad and phone after the 17 Nov fixes but is designed for desktop. Tables on phones scroll sideways inside cards.
- The camera's skin-smoothing path is heavy; the plain camera (default) is light.
- Empty states exist for most lists; error messages are written for users.
- Still missing: onboarding tour for new agencies, sample data option ("load a demo agency"), and a clearer explanation of "Content only" vs "Full access" at invite time (partly done).

## Scalability

- **Multi-tenant model is sound**: every row carries `workspace_id`; access is enforced in the database. It can hold thousands of creators.
- Indexes exist on the main lookup paths (assignments by workspace/status and creator, files by workspace, notifications by user). Audit and notification tables will grow without limit: add retention.
- **Storage cost is the real scaling risk.** Video is large, and agencies download it, so egress dominates (see PRICING_MODEL). Move media to Cloudflare R2 or put a CDN in front before ~25 agencies.
- Free plan limits (1 GB storage, 500 MB database, pausing) will be hit during a pilot. Upgrade first.
- Video joining runs on the creator's phone. Long takes (several minutes) on old phones may be slow or run out of memory; a server-side join (e.g. a worker with ffmpeg) is the long-term fix.
- The `social-import` function waits up to ~2 minutes for Apify; long imports may hit edge function time limits. Move to a queue for scale.

## Technical debt

- Hash routing (`#/…`) is fine for now but makes clean URLs and some email link flows harder.
- Two parallel systems (Socials and OF) with separate tables and review flows. Fine, but shared concepts (assignments, reviews, notifications) could be unified later.
- E2E tests run against a mocked backend. There's no automated test against a real staging database.
- No staging environment: every change goes straight to production.
- `.npmrc`/CI: no continuous integration; builds are manual.

## Dependence on this development environment

The running product does **not** depend on this AI environment. Everything lives in accounts you own: GitHub (`thesahildhone`), Supabase (org "Dhone Performance"), Apify, OpenAI, Anthropic. What you lose is the ability to have me make changes. The test suite in `e2e/` needs Python + Playwright + Chrome to run elsewhere.

## Recommended improvements, in order

| # | Work | Effort | Priority |
|---|---|---|---|
| 1 | Supabase Pro + backups; set spend caps on Apify/OpenAI/Anthropic | 30 min | P0 |
| 2 | Domain + Resend SMTP + turn on email confirmation + drop auto-confirm trigger | 2 h | P0 |
| 3 | Terms, privacy policy, DPA, age/consent clause (lawyer) | 1–2 weeks | P0 |
| 4 | Email notifications for new tasks, reminders, revisions, approvals | 2–3 days | P0 |
| 5 | Move hosting to private repo + Cloudflare Pages/Vercel | 2 h | P1 |
| 6 | Magic-link creator access | 2–3 days | P1 |
| 7 | Reports page: on-time rate, average turnaround, revision rate, per creator and per staff | 3–4 days | P1 |
| 8 | Billing (Stripe or Razorpay) with plan limits | 4–6 days | P1 |
| 9 | Storage retention + clean-up job; bulk export | 2–3 days | P1 |
| 10 | Media to Cloudflare R2 or CDN | 2–4 days | P1 at ~25 agencies |
| 11 | MFA for agency admins | 1 day | P2 |
| 12 | Creator groups, comments, Drive/Slack/webhooks, white-label | 2–4 weeks | P2 |
