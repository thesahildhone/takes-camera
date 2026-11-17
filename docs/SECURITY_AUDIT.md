# Security and privacy audit

Audit date: 17 Nov 2026. Scope: the live Supabase project `qchxfwoaaoslipwkdqep` (database, row-level security, storage, edge functions, auth settings) and the React app in `delivery-room-src/`.

Method: I read every access policy and security-definer function, then ran **live impersonation tests** against production inside transactions that were rolled back (no data changed). Each test signs in as a real demo user from a different agency or role and tries to read or change someone else's data. Supabase's own security linter was run before and after the fixes.

This is an engineering review, not a penetration test by an independent firm. A paid pilot with real creator media should be followed by one.

## Summary

| Area | Result |
|---|---|
| Agency A reading Agency B's data | **Blocked** in every test (tables, files, functions) |
| Creator reading another creator's work | **Blocked** |
| Creator seeing unpublished or unassigned shots | **Blocked** |
| Removed staff losing access | **Immediate** for new requests; already-issued file links last up to 30 min |
| Storage buckets | Private; access checked per file path |
| Email verification | **Off (P0)**: accounts are auto-confirmed |
| Password reset | **Was missing (P0)**, now built |
| Account deletion | **Was missing (P1)**, now built for creators |
| Server-side request forgery in video import | **Fixed** (redirects to private addresses were possible) |
| Paid-API abuse limits | Writing AI already capped; **import and transcript caps added** |
| Backups | **None on the Free plan (P0 for a paid pilot)** |

## Tests run against production (rolled back)

Signed in as **the owner of "Other Demo Agency"**, trying to reach "Demo Agency":

| Attempt | Result |
|---|---|
| List workspaces | Saw only their own |
| Read projects, submissions, files, OF sets, storage objects of the other agency | 0 rows |
| Approve a submission in the other agency (`social_review`) | Blocked: "Submission not found" |
| Assign / publish / unpublish the other agency's shot | Blocked: "Project not found" |
| Nudge the other agency's creator | Blocked: "Not allowed" |
| Read the other agency's usage numbers | Returned nothing |
| Load the other agency's Socials tree (`social_bootstrap`) | Blocked |
| Change the other agency's team | Blocked: "Only admins can change the team" |
| Insert an invitation into the other agency | Blocked by RLS |
| Insert themselves as owner of the other agency | Blocked by RLS |
| Rename the other agency's shots | 0 rows changed |
| Run the other agency's schedules | Blocked |
| Read the other agency's audit log | 0 rows |
| Switch their own account type | Blocked by RLS |

Signed in as **creator "Desi Destiny"**:

| Attempt | Result |
|---|---|
| See other agencies | Only her own agency |
| See draft or unassigned shots | 0 |
| See other creators' assignments, submissions, profiles, notifications | 0 |
| Approve her own submission | Blocked |
| Edit a shot's script | 0 rows changed |
| Assign herself to a shot | Blocked |
| Create invitations | Blocked |
| Read another creator's upload path | `false` |
| Write into another agency's storage | `false` |
| Create an agency workspace | Blocked (creator accounts can't) |
| Turn her account into an agency account | Blocked |

Signed in as **creator "Zara" (Northlight)**: saw only Northlight; 0 rows from every other table.

## Findings

### P0 (launch blocking)

**S1. Email addresses are never verified.** A database trigger (`autoconfirm_before_insert` on `auth.users`) marks every new account as confirmed. It was added because Supabase's built-in email is heavily rate-limited. Impact: anyone can sign up with someone else's email, and squat an agency name or a creator's identity. Fix order: (1) set up custom SMTP (Resend) in Supabase, (2) turn on "Confirm email" in Auth settings, (3) `drop trigger autoconfirm_before_insert on auth.users;`. The app already handles the confirmation link (see `main.tsx`). Not done today because without SMTP nobody could sign up.

**S2. No database backups.** The project is on the Free plan, which has no daily backups, and free projects pause after a week without activity. A paid pilot with creator media needs Supabase Pro (daily backups) at minimum, ideally with point-in-time recovery.

**S3. No password reset.** Fixed today: "Forgot your password?" on the sign-in page, a reset page, and handling for expired links. It sends email through Supabase, so it depends on S1's SMTP setup to work reliably for real users.

### P1

**S4. Server-side request forgery in video import.** Fixed and deployed (function version 6). The import function followed redirects automatically, so a public link that redirected to a private address could be fetched by the server. It now follows redirects one hop at a time and refuses private, local, numeric and Supabase-internal hosts at every hop. Verified with a local test server: redirects to `127.0.0.1` and `*.internal` are refused; normal files still download.

**S5. Unlimited paid-API use per agency.** Fixed and deployed: imports (Apify) and transcripts (OpenAI) are capped at 60 per agency per hour, like the existing 40/hour cap on AI writing. Also set spending limits in the Apify, OpenAI and Anthropic dashboards.

**S6. No way to delete an account.** Fixed for creators: Account → "Delete my account" (type DELETE). It removes the login, profile, memberships, assignments and submission records immediately, and writes an audit entry. Agency accounts are refused and routed to support, because they own shared data. **Gap:** the creator's video files stay in storage as orphans (no database row points to them, so nobody can open them through the app). A scheduled storage clean-up is still needed for full erasure.

**S7. Team functions callable while signed out.** Fixed: `team_heartbeat` and `team_update` had the default public grant. They already refused to act without a signed-in member, but they are now unreachable to signed-out visitors.

**S8. Invite links are bearer tokens.** Anyone holding a link can accept it once, regardless of email. Links expire after 14 days and can be cancelled. For staff invites with full access, consider checking the email matches.

**S9. Leaked-password protection is off.** Supabase can reject passwords found in breach lists. Turn it on in Auth settings (may need a paid plan).

### P2

**S10. File links last 30 minutes** (reduced from 60 today). A removed employee who already had a page open can keep playing those files until the link expires. True instant revocation needs a proxy that checks access per request.

**S11. Download logging is partial.** OF downloads call `log_download`; Socials downloads are not logged yet.

**S12. "Content only" staff can delete shots and sections.** By design today, but agencies may want a read/review-only role. Custom roles are on the roadmap.

**S13. No MFA.** Supabase supports TOTP. Recommended for agency owners and admins.

**S14. Media is not malware-scanned.** Uploads are restricted by MIME type and size, and only video, image and audio types are accepted, but nothing scans file contents.

### Checked and fine

- All 21 public tables have row-level security on. Every security-definer function sets a fixed `search_path`.
- Storage buckets `media` and `social` are private; reads and writes go through path-based checks (workspace, project, creator).
- No service keys or API keys in the front-end bundle. Only the publishable key is in `src/lib/supabase.ts`, which is safe.
- No `dangerouslySetInnerHTML` or `eval` in the app. React escapes all user text, so stored XSS through titles and scripts was not possible in what I reviewed.
- SQL injection: the app only uses the Supabase client and parameterised RPCs. No string-built SQL.
- CSRF: auth uses bearer tokens in headers, not cookies.
- Paid API keys live only in Supabase Edge Function secrets.

## What cannot be promised

- **Screenshots and screen recordings can't be prevented** in a browser. What the platform can do: private storage, short-lived links, per-path access checks, audit logs, watermarking (roadmap), and contract terms. Don't tell agencies or creators that leaks are impossible.
- Downloaded files are outside the platform's control.

## Sensitive-media handling today

| Control | Status |
|---|---|
| Private buckets | Yes |
| Short-lived signed links | Yes, 30 min |
| Per-agency, per-creator path checks | Yes |
| Encryption in transit | Yes (HTTPS everywhere) |
| Encryption at rest | Supabase storage is encrypted at rest by the provider |
| Audit trail | Invites, reviews, imports, AI use, nudges, OF downloads, account deletions |
| Retention policy | **None defined.** Decide e.g. "submissions deleted 12 months after approval unless pinned" |
| Data export | **Not built.** Agencies can download files one by one; needs a bulk export |
| Breach response | **Not written.** See below |

## Breach response (draft, needs legal review)

1. Contain: revoke the affected keys in Supabase (rotate the service-role key, JWT secret, API keys), remove compromised accounts, and take the import function offline if involved.
2. Assess: use `audit_events` and Supabase logs to find what was accessed and by whom.
3. Notify: India's DPDP Rules require a report to the Data Protection Board within 72 hours of becoming aware, and notice to affected people without delay. GDPR requires notice to the supervisory authority within 72 hours where it applies.
4. Fix and document.

## Legal and compliance items needing a professional

These need a qualified lawyer. I am not one, and nothing here is legal advice.

1. **Privacy policy, terms of service, acceptable use policy, data processing agreement (DPA)**: none exist yet. Agencies will be data fiduciaries/controllers for their creators; this platform is their processor.
2. **India DPDP Act and Rules**: the Rules were notified on 13 November 2025, and the main obligations (consent notices, breach reporting, erasure) apply from 13 May 2027. Plan for: consent notices, a grievance contact, the 72-hour breach report, and erasure on request.
3. **GDPR / UK GDPR** if any agency or creator is in the EU/UK: lawful basis, DPA, international transfer terms (Supabase region is Mumbai).
4. **Age and consent verification for adult content.** The platform must not hold sexual content of anyone under 18. Today it does no age or ID checks. Agencies are responsible for verifying creators, but the terms should require it, and you should decide whether the platform verifies too. US 18 U.S.C. § 2257 record-keeping may apply to producers of explicit content; get advice.
5. **Copyright / DMCA**: a takedown contact and process, especially since agencies import other creators' reels as references.
6. **Instagram/TikTok terms**: reference downloads go through a third-party scraper (Apify). Check this against both platforms' terms. A conservative option is to make embed-only the default and downloads opt-in.
7. **No OnlyFans integration exists or should be added** unless OnlyFans offers an authorised method. As far as I know, there's no official public API.
