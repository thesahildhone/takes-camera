# Test report

Date: 17 Nov 2026. Only tests that were actually run are marked PASS/FAIL. Everything else is listed as **NOT TESTED**.

## How tests were run

| Suite | What it is | Where |
|---|---|---|
| `creator_flow.py` | Browser test (Chrome, phone size, fake camera) of the creator's Socials flow against a **mocked** Supabase | `delivery-room-src/e2e/` |
| `agency_flow.py` | Browser test of agency Socials pages against the mock | same |
| `forgot_test.py` | Forgot-password flow against the mock | same |
| `probe.py`, `aprobe.py` | Layout checks: page width and overflow on phone (393 px) and iPad (820 px) | same |
| Database security tests | Signed in as real demo users on **production**, inside transactions that were rolled back | SQL in SECURITY_AUDIT.md |
| SSRF unit test | Local Deno server that redirects to private addresses | ad hoc, described below |

Mocked tests prove the app's logic and screens. They don't prove the real backend; the database tests cover that side.

## Totals

| Suite | Run | Pass | Fail |
|---|---|---|---|
| Creator flow (final run) | 32 | 32 | 0 |
| Agency flow | 10 | 10 | 0 |
| Forgot password | 3 | 3 | 0 |
| Layout (14 page/size combinations) | 14 | 14 page-level | 0 (tables scroll inside their cards on phones, by design) |
| Cross-agency isolation (DB) | 15 | 15 | 0 |
| Creator permission checks (DB) | 10 | 10 | 0 |
| Creator visibility checks (DB, 2 creators) | 2 sets | 2 | 0 |
| Account deletion (DB, rolled back) | 1 | 1 | 0 |
| SSRF blocking | 13 | 13 | 0 |
| **Total** | **100** | **100** | **0** |

Earlier runs today had 2 failures, both investigated:
- "Stop clip" timed out on the retake step: the test machine has no GPU, so the skin-smoothing camera was too slow. Not a product bug; the test now turns smoothing off after checking it works.
- "Cue advanced past 0:00" assumed clips over 10 seconds; the real check (clip 2 picks up the sound where clip 1 ended) passed. Test expectation fixed.

## Detailed results

| Test | Expected | Actual | Result | Severity if failed | Fix | Retest |
|---|---|---|---|---|---|---|
| Creator home shows shots to go | Ring shows count | Shows count | PASS | | | |
| Section list numbering | 01, 02… | Correct | PASS | | | |
| OF toggle | Shows OF view | Shows | PASS | | | |
| Shot detail | "Shot 1 of 2", script, notes, actions inside viewport | All present | PASS | | | |
| Camera opens from Film it, no filter | Plain camera visible | Visible | PASS | | | |
| Smoothing toggle | Switches to filtered camera | Switches | PASS | | | |
| Record 3 clips | 3 clips, saved to phone | 3 non-empty clips in IndexedDB | PASS | | | |
| Retake clip 2 | Clips 1 and 3 untouched | Byte-identical | PASS | | | |
| Delete + undo clip | Removed then restored | Works | PASS | | | |
| Leave and come back | "Continue · 3 clips saved" | Shown | PASS | | | |
| Reload page | Draft survives | Survives | PASS | | | |
| Send | Uploads to agency/sub/project/creator path; one submit call | Correct | PASS | | | |
| Joined video length | Matches timeline | Matches | PASS | P2 | Re-measure clips after recording (17 Nov) | PASS |
| Local draft cleared after confirmed send | Cleared | Cleared | PASS | | | |
| Dance: sound explained, cue continues across clips, music version uploaded | All | All | PASS | | | |
| Agency: Socials nav, sections, import warning actions, failed import keeps URL | All | All | PASS | | | |
| Agency: creator preview | Renders | Renders | PASS | | | |
| Agency review: list, filter, players, request changes with note | All | All | PASS | | | |
| Forgot password sends reset with return link | Request made with redirect | Made | PASS | P0 (was missing) | Built 17 Nov | PASS |
| Reset page without valid link | "Link expired" | Shown | PASS | | | |
| Expired email link | Clear message on sign-in | Shown | PASS | | | |
| Phone/iPad layout, 7 agency pages × 2 sizes + creator home | No page wider than screen | None | PASS | P1 (was broken) | Fixed 17 Nov | PASS |
| Agency B reads/changes Agency A data (15 attempts) | All blocked | All blocked | PASS | | | |
| Creator oversteps (10 attempts) | All blocked | All blocked | PASS | | | |
| Creator deletes own account | Login, assignments, profile gone | Gone (rolled back) | PASS | P1 (was missing) | Built 17 Nov | PASS |
| Import redirect to 127.0.0.1 / *.internal | Refused | Refused | PASS | P1 (SSRF) | Fixed 17 Nov | PASS |
| Normal file download in import | Allowed | Allowed | PASS | | | |

## NOT TESTED (needs doing before a paid pilot)

| Area | Why not | How to test |
|---|---|---|
| Real email delivery (verification, reset) | No SMTP configured | After Resend setup: sign up, reset, confirm on a real inbox |
| Live video import after today's redeploy | This environment can't reach your Supabase functions | Paste one Instagram reel into a shot; it should download as before |
| Real iPhone/Android filming | No device here | Destiny's test run: teleprompter, retakes, dance sound, send |
| Large uploads (500 MB+), interrupted uploads, flaky network | Needs a real device and network | Upload a long video, toggle airplane mode mid-upload |
| Simultaneous uploads, two staff editing one shot | Needs two real sessions | Two browsers on the same shot |
| "Who's online" presence | Needs two real logins | Two devices on the Team page |
| Invite: expired, duplicate, revoked links | Logic exists in SQL; not exercised end-to-end today | Create, revoke, expire (change `expires_at`), accept |
| Removed employee mid-session | Policies checked; not exercised live | Remove a teammate while they have the app open; refresh |
| Time zones | Dates stored in UTC; displayed in device time; not tested across zones | Set phone to another zone, check due labels |
| OF flow end to end | Not re-run today | Issue a set, upload, request revision, resubmit, approve |
| Scheduled reminders (cron) | Runs in production; output not checked today | Check `notifications` after a due date passes |
| Accessibility (screen readers) | Not audited | VoiceOver pass on creator flow |
| Load (hundreds of agencies) | No load test | k6 or similar against a staging project |
