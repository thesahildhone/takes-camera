# Move to US East (delivery-room-us, gebgnrstcqekhprbnfic)

Status: database, data, files and functions copied and verified. App still points at Mumbai.

## Verified
- Schema: all 28 recorded changes replayed + 1 reconciling change (my_kind / profiles_update_self).
  Fingerprint over 1,114 objects (columns, functions, policies, triggers, indexes, constraints, grants, RLS, buckets, cron, views) identical.
- Data: 26 tables + auth.users + auth.identities, per-table checksums identical (overall 805b3496…).
  Identity counters advanced past copied ids.
- Files: 7 real files copied with size check; 12 placeholder records (seed rows from 20 Oct with no file) recreated as-is.
- Functions: media, account-delete, email-dispatch identical bundles; ai-write identical source;
  social-import with the sign-in fix.
- US cron jobs paused until cut-over.

## Cut-over (in order)
1. You: US project dashboard settings + secrets (see chat checklist).
2. Final data re-sync (repeat import with fresh export), verify checksums.
3. Pause Mumbai cron jobs, enable US cron jobs.
4. Point app at US (VITE_SUPABASE_URL / key), build, deploy.
5. Smoke test: sign in, upload, review, download, email.
6. Delete migration-export (Mumbai) and migration-import (US); drop migrate_tmp schema.

## Rollback
Point the app back at Mumbai and re-enable Mumbai cron jobs. Mumbai is left untouched until you approve deleting it.
