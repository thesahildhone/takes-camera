# Commercial strategy

Working name: Delivery Room (the app name isn't final; see the earlier trademark notes). Pricing is in PRICING_MODEL.md and competitors are in COMPETITIVE_ANALYSIS.md.

## Positioning

**Who it's for:** agencies that run 3–50 creators across Instagram, TikTok and OnlyFans. They currently brief creators over WhatsApp/Telegram and collect files through Google Drive.

**The problem:** briefs get lost in chat, creators film the wrong thing, files arrive unnamed and in the wrong format, and nobody can see what's late.

**One line:** The shot list, camera and inbox your creators actually use, so content arrives filmed right, named right and on time.

**Elevator pitch (30 seconds):**
Your managers brief creators in WhatsApp and chase files in Drive. Delivery Room replaces both. You drop a reference reel into a shot. The creator opens it on their phone and films it with a teleprompter and the original sound playing. They retake any clip and hit send. It lands in your review queue already named, sorted by creator and due date. You approve or send it back with a note. No more "which video was this for?"

## What it does better (be accurate about this)

1. Filming happens inside the brief: script on a teleprompter, reference playing, dance audio in sync across clips.
2. Clip-by-clip retakes, saved on the phone, so a dropped connection doesn't lose a take.
3. One review queue across every creator, with request-changes notes.
4. Staff roles and who's-online presence.
5. Agency data kept separate at the database level. This was tested; see TEST_REPORT.md.

Don't claim: guaranteed virality, revenue uplift, screenshot prevention, or any OnlyFans integration. OnlyFans has no public API; the app only organises files the agency then uploads by hand.

## The five things to show in every demo

1. Paste an Instagram reel link and it becomes a shot with the video, sound and transcript.
2. The creator view on a phone: teleprompter plus the reference sound, filming 3 clips.
3. Retake the middle clip only.
4. The agency review queue: approve one, send one back with a note.
5. The Team page: roles and who's online.

## Onboarding workflow (target: first video in under 30 minutes)

1. The agency signs up and names the workspace.
2. Invite 1 manager and 2 creators. Creators get a link and set a password.
3. Create a "Week 1" section with 3 shots from reference reels.
4. The creator films one shot on their phone and sends it.
5. A manager reviews it. This is the aha moment. The pilot call should end here.

Needed before the pilot: invite and review emails (P0 in PRODUCT_AUDIT.md). Until then, staff have to tell creators manually.

## Landing page structure

1. The headline (the one-liner) plus a 20-second phone screen recording of filming with the teleprompter.
2. "Before and after": a WhatsApp + Drive screenshot next to the review queue.
3. Three blocks: Brief, Film, Review.
4. Security and privacy in plain words: private storage, agency data separated, creators can delete their account, EU/India data notes. No overclaiming.
5. Pricing (3 tiers plus Enterprise, annual toggle).
6. "Start a $99 pilot" button and a "Book a demo" button.
7. FAQ: OnlyFans (manual upload), storage, who owns content (the agency/creator, never us), cancelling and export.

## Pricing page

Starter $79, Growth $199 (highlighted), Scale $449, Enterprise from $1,000/month. Annual billing gives 2 months free. Every plan includes a 30-day paid pilot at $99, credited to the first month. Limits are in PRICING_MODEL.md.

## Outreach strategy

The best first channel is warm: your friend who runs an agency, then his introductions. Agencies trust other agency owners, not ads.

- **Tier 1 (week 1–2):** 10 warm intros. Ask for a 15-minute screen share, not a sale.
- **Tier 2:** agency owners who post on X/LinkedIn about creator management. Short DM with the 20-second clip.
- **Tier 3:** creator-economy Discords and communities. Only where self-promotion is allowed.
- Skip cold email lists. This market is reputation-driven, and spam will burn the name.

Sample DM (edit to your own voice):
> saw you run a few creators. built a tool that replaces the whatsapp brief + drive folder mess, creators film inside the brief with the script and reference sound, you get it back named and in one queue. 20 sec clip attached. worth a 15 min look?

## 30-day acquisition plan

| Week | Goal | Actions |
|---|---|---|
| 1 | Pilot-ready | Ship SMTP + email notifications, Pro plan backups, terms + privacy page, Stripe pilot link |
| 2 | 3 pilots started | Your friend's agency + 2 warm intros. Onboard each live on a call |
| 3 | Learn | Watch each agency use it weekly. Fix the top 3 friction points |
| 4 | First paid conversions | Convert pilots to Starter/Growth. Ask each for 1 intro. Target: 2 paying, 5 in pipeline |

Measure: time to first video, % of shots filmed on time, weekly active creators per agency, and pilot-to-paid conversion. Don't promise ROI numbers until you have these.

## Defensibility (honest)

The code itself can be copied in a few months. What's harder to copy:
- **Workflow lock-in:** an agency's shot library, sections, history and approvals live here.
- **Creator habit:** once creators film in the app, switching means retraining all of them.
- **Data:** which reference formats get filmed on time, which get sent back. Over time this becomes "brief templates that work".
- **Speed:** you're close to the users (your friend's agency, Destiny's feedback).

## Five features that differentiate next

1. Brief templates library (trending sound plus script plus shot notes, one tap to reuse).
2. Due-date chasing by WhatsApp/email, so the app nags, not the manager.
3. Creator scorecard: on-time %, revision rate (internal only, shown to staff).
4. Watermarked review links for outside editors (honest limits: it deters casual sharing, it can't stop screen recording).
5. Content calendar view across creators.

## Agency OS roadmap (after product-market fit, not before)

Phase A: notifications, calendar, templates. Phase B: editor hand-off, approvals by client. Phase C: payouts/earnings tracking (manual entry only; no OnlyFans scraping). Each phase should be paid for by customers asking for it.
