# Pricing model

All prices in USD (bill Indian agencies in INR at the same value). Every cost below is an **assumption**, labelled, because there are no real operating costs yet. Re-run the numbers once the pilot produces real storage and download figures.

## Market reference points (checked Nov 2026)

| Product | Pricing | Source |
|---|---|---|
| Content Snare (generic content collection) | Basic $29, Plus $59, Pro $99 per month; Basic includes 20 active requests, 20 GB, 2 users | TrustRadius, Software Advice |
| SuiteDash (client portal, flat rate) | Start $19, Thrive $49, Pinnacle $99 per month; unlimited clients and staff | Capterra, eLearning Industry |
| Infloww (OnlyFans agency CRM) | From about $79/month, no free tier | hiltonsoftware comparison |
| OnlyFans CRMs generally | Commonly per-creator, around $40/creator/month cited | Desirely 2026 comparison |
| Supabase (our main infrastructure) | Pro $25/month base; 250 GB egress included, then $0.09/GB; 100 GB file storage included | makerkit, activepieces, toolradar |

What this means: generic portals are cheap ($19–99) but don't do filming, scripts or review. OF agency CRMs charge more and per creator. We sit between: a specialised production tool, priced per agency with creator bands, so price tracks value without punishing agencies for adding creators.

## Recommended structure

Per-agency subscription with **creator bands**, **staff seats included**, storage allowance, and add-ons. Reasons:

- Agencies think in "how many creators do we run". Bands map to that.
- Per-seat pricing for staff discourages adding the managers who make the tool sticky. Include generous seats.
- Storage is the real cost driver (video). Allowances plus paid top-ups protect margin.
- Annual plans at ~2 months free for predictable revenue.

## Tiers

| | Starter | Growth | Scale | Enterprise |
|---|---|---|---|---|
| Monthly | **$79** | **$199** | **$449** | from **$1,000** |
| Annual (2 months free) | $790 | $1,990 | $4,490 | custom |
| Active creators | 5 | 20 | 50 | unlimited |
| Staff seats | 3 | 10 | 25 | unlimited |
| Storage | 100 GB | 500 GB | 2 TB | custom |
| Active shots/sets at once | 200 | 1,000 | unlimited | unlimited |
| Automation | Reminders, auto-assign | + recurring OF sets, bulk add, AI writing (200/mo) | + AI writing (1,000/mo), escalations | custom |
| Reference import + transcripts | 50/mo | 300/mo | 1,000/mo | custom |
| Reporting | Basic progress | Creator punctuality + turnaround | + staff workload, exports | + custom reports |
| Branding | Platform branding | Agency name + logo | Branded creator portal | Custom domain, white-label |
| Integrations | — | Google Drive export | + Slack, webhooks | + custom |
| Support | Email | Email, 1 business day | Priority chat + onboarding call | Dedicated manager, DPA, SLA |

**Add-ons:** extra creator $8/month; extra 100 GB storage $10/month; onboarding and migration from spreadsheets/Drive $500 (Growth) to $2,000 (Enterprise), one-off.

Most of the plan limits above aren't enforced in the product yet (billing isn't built). Enforce them before charging.

## Revenue scenarios

Assumptions:
- Plan mix: 40% Starter, 40% Growth, 15% Scale, 5% Enterprise at $1,000. Average revenue per agency (ARPA) = **$228.55/month**.
- Monthly billing for all (annual billing lowers monthly revenue by ~17% but improves cash and retention).
- Infrastructure per month: Supabase Pro $25 plus compute upgrades as agencies grow ($0 / $50 / $110 / $210); 150 GB stored per agency (storage beyond 100 GB at an assumed $0.021/GB); **300 GB downloaded per agency** at $0.09/GB beyond 250 GB; $5 per agency of Apify/OpenAI/Anthropic; email $20–90; $30 misc.
- Payment processing: 4% blended (cards, international, currency conversion). Stripe and Razorpay rates vary by country; check yours.

| Paying agencies | MRR | ARR | Infra / month | Payment fees / month | Gross margin |
|---|---|---|---|---|---|
| 5 | $1,143 | $13,713 | $226 | $46 | 76% |
| 10 | $2,286 | $27,426 | $402 | $91 | 78% |
| 25 | $5,714 | $68,565 | $979 | $229 | 79% |
| 50 | $11,428 | $137,130 | $1,988 | $457 | 79% |
| 100 | $22,855 | $274,260 | $3,845 | $914 | 79% |

**Download traffic is two-thirds of infrastructure cost** in these numbers. Moving media to Cloudflare R2 (no egress fee) or putting a CDN in front would push gross margin towards ~90%. Do it before ~25 agencies.

## Customer acquisition and break-even

Assumptions (yours to replace with real numbers):
- Founder-led sales: direct outreach to agencies, demos, a paid pilot. Cash cost per customer ≈ $150–300 (tools, ads, travel), plus your time.
- Fixed monthly costs with a part-time developer: ~$1,600 ($1,500 contractor + $100 tools). Without one: ~$100.
- Contribution per agency ≈ $178/month (ARPA × ~78%).

Break-even:
- **Without a developer:** 1 paying agency covers fixed costs.
- **With a part-time developer:** about **9–10 agencies**.
- CAC payback at $300: under 2 months.

## Free trial vs pilot vs freemium

- **Freemium: no.** Video storage makes free users expensive, and this market buys on trust and results, not self-serve sign-ups.
- **Free trial: 14 days, card required**, capped at 3 creators and 10 GB. Good for inbound.
- **Paid pilot: yes, for the first 5–10 agencies.** 30 days at 50% of the Growth price ($99), credited against the first paid month. Agree baseline numbers at the start (hours spent chasing creators per week, % of content late, time from request to approved) and measure them at the end. Don't promise savings in advance.
- **Founder-led sales first**, self-serve later.

## Expansion revenue

Creators added (band upgrades), extra storage, Scale-tier branding, migration services, and Enterprise contracts for agencies with 50+ creators.
