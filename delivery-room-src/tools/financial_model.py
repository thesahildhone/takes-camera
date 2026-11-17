"""Delivery Room revenue and cost projections. All figures monthly USD. Assumptions are labelled; edit and rerun."""
TIERS = {  # name: (hypothesis price, recommended price, avg active creators, plan mix share)
  'Starter':    (29, 29, 4, 0.50),
  'Growth':     (59, 79, 12, 0.33),
  'Agency':     (119, 199, 30, 0.14),
  'Enterprise': (249, 449, 80, 0.03),
}
GB_PER_CREATOR_STEADY = 24      # typical: 2 videos/day x 75 MB x 1.8 stored copies, kept 90 days
STORAGE_PER_GB = {'r2': 0.015, 'b2': 0.00695}
ADDON_STORAGE_REV_SHARE = 0.06  # assumed extra revenue from storage add-ons, as share of subscription revenue
SUPPORT_PER_AGENCY = 6.0        # assumed: ~20 min/month of founder or VA time at ~$18/h
EMAIL_PER_AGENCY = 0.4          # Resend, transactional volume
AI_PER_AGENCY = 1.5             # brief generation + transcripts, capped by plan
def fixed(n):                   # platform costs that step with scale
    supa = 25 + 10 + (15 if n > 25 else 0) + (45 if n > 100 else 0) + (100 if n > 200 else 0)   # Pro + staging + compute upgrades
    tools = 26 + 20 + 15        # error monitoring, email plan, domain/DNS/misc
    return supa + tools
def payment(rev, n, model):
    return rev * 0.05 + n * 0.5 if model == 'mor' else rev * 0.10   # Paddle-style MoR vs high-risk processor (assumed 10%)

def run(price_idx, n, store='r2', pay='mor', dev=0):
    rev_sub = sum(n * t[3] * t[price_idx] for t in TIERS.values())
    rev = rev_sub * (1 + ADDON_STORAGE_REV_SHARE)
    creators = sum(n * t[3] * t[2] for t in TIERS.values())
    storage = creators * GB_PER_CREATOR_STEADY * STORAGE_PER_GB[store]
    var = storage + n * (SUPPORT_PER_AGENCY + EMAIL_PER_AGENCY + AI_PER_AGENCY) + payment(rev, n, pay)
    cost = var + fixed(n) + dev
    return rev, storage, cost, (rev - var - fixed(n)) / rev if rev else 0, rev - cost

if __name__ == '__main__':
    for label, idx in (('Your hypothesis ($29/$59/$119/$249)', 0), ('Recommended ($29/$79/$199/$449)', 1)):
        arpa = sum(t[3] * t[idx] for t in TIERS.values()) * (1 + ADDON_STORAGE_REV_SHARE)
        print(f'\n### {label}: average revenue per agency ${arpa:,.0f}/month\n')
        print('| Agencies | MRR | ARR | Storage (R2) | All costs (no salary) | Gross margin | Profit, no dev | Profit with $1,500/mo dev | Profit with 10% high-risk processor |')
        print('|---|---|---|---|---|---|---|---|---|')
        for n in (5, 10, 25, 50, 100, 250):
            rev, st, cost, gm, prof = run(idx, n)
            _, _, _, _, prof_dev = run(idx, n, dev=1500)
            _, _, _, _, prof_hr = run(idx, n, pay='hr')
            print(f'| {n} | ${rev:,.0f} | ${rev*12:,.0f} | ${st:,.0f} | ${cost:,.0f} | {gm*100:.0f}% | ${prof:,.0f} | ${prof_dev:,.0f} | ${prof_hr:,.0f} |')
        # breakeven with a $1,500 developer
        n = 1
        while run(idx, n, dev=1500)[4] < 0 and n < 2000: n += 1
        print(f'\nBreak-even with a $1,500/month part-time developer: about {n} agencies.')
