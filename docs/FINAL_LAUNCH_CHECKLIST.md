# Final launch checklist

✅ done · ⬜ to do. **You** = needs your accounts or money; **Dev** = code work.

## Before showing it to agencies (demo)
- ✅ Agency data isolation tested on the live database
- ✅ Creator filming flow passes 32/32 automated checks
- ✅ Phone and iPad layouts fixed
- ✅ Forgot password, account deletion, import abuse limits live
- ⬜ **You:** change the demo account passwords
- ⬜ **You:** run one real Instagram import after today's update
- ⬜ **You:** Destiny films one full shot on her iPhone and sends it

## Before charging anyone (paid pilot)
- ⬜ **You:** Supabase Pro ($25/month) for backups and no pausing
- ⬜ **You:** `supabase db dump` the schema into the repo, keep a data backup privately
- ⬜ **You:** Resend account plus your domain, SMTP in Supabase, Confirm email on
- ⬜ **Dev:** remove the auto-confirm trigger after SMTP works
- ⬜ **Dev:** email notifications (invite, new submission, changes requested, due soon)
- ⬜ **You:** make the repo private and move hosting to Cloudflare Pages or Vercel
- ⬜ **You:** terms of service, privacy policy, data processing agreement for agencies (get a lawyer to review; adult content needs care)
- ⬜ **You:** decide where you're registered as a business and who's the data controller vs processor
- ⬜ **You:** payment link (Stripe or Razorpay) for the $99 pilot
- ⬜ **You:** leaked-password protection on in Supabase Auth
- ⬜ **Dev:** delete storage files when a creator deletes their account
- ⬜ **Dev:** log every download of social content (audit trail)
- ⬜ **You:** a support email address shown in the app

## Before public launch
- ⬜ **Dev:** subscription billing with plan limits enforced
- ⬜ **Dev:** two-factor login for agency staff
- ⬜ **Dev:** bulk export, so an agency can leave with its data
- ⬜ **Dev:** error monitoring (Sentry) and uptime alerts
- ⬜ **Dev:** load test, storage moved to R2 if egress costs climb
- ⬜ **Dev:** accessibility pass
- ⬜ **You:** trademark the final name in the markets you sell to
- ⬜ **You:** landing page and pricing page live
- ⬜ **You:** breach response plan rehearsed (draft in SECURITY_AUDIT.md)
- ⬜ **You:** 3+ pilots converted to paid, with their feedback in the product
