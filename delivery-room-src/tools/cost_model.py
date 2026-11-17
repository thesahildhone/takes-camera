"""Delivery Room storage and infrastructure cost model. Prints markdown tables.
Prices are list prices found 17 Nov 2026 (see docs/INFRASTRUCTURE_COST_MODEL.md for sources). Everything else is an assumption, labelled."""
GB = 1.0
PRICE = {
  'supabase': dict(store=0.0213, store_free=100, egress=0.09, egress_free=250),       # Pro plan, per GB-month / per GB
  'r2':       dict(store=0.015,  store_free=10,  egress=0.0,  egress_free=0, classA=4.50/1e6, classB=0.36/1e6),
  's3':       dict(store=0.023,  store_free=0,   egress=0.09, egress_free=100),
  'b2':       dict(store=0.00695,store_free=10,  egress=0.01, egress_free_mult=3),
}
# ---- assumptions (edit here)
STORED_PER_UPLOAD = 1.8   # x the final video size: originals 1.0 + joined copy 0.5 + 720p preview 0.1 + revisions 0.2
EGRESS_PER_UPLOAD = 1.3   # x size: preview streams in review + one download of the originals
PART_MB = 10              # multipart chunk size
DAYS = 30

def monthly(creators, per_day, size_mb):
    uploads = creators * per_day * DAYS
    gb = uploads * size_mb / 1024
    return uploads, gb, gb * STORED_PER_UPLOAD, gb * EGRESS_PER_UPLOAD

def cost(provider, stored_gb, egress_gb, uploads, size_mb):
    p = PRICE[provider]
    s = max(0, stored_gb - p.get('store_free', 0)) * p['store']
    if provider == 'b2':
        e = max(0, egress_gb - 3 * stored_gb) * p['egress']
    else:
        e = max(0, egress_gb - p.get('egress_free', 0)) * p['egress']
    ops = 0
    if provider == 'r2':
        ops = uploads * STORED_PER_UPLOAD * max(1, size_mb / PART_MB) * p['classA'] + uploads * 20 * p['classB']
    return s + e + ops

def fmt(x):
    return f"{x/1024:,.1f} TB" if x >= 1024 else f"{x:,.0f} GB"

if __name__ == '__main__':
    print('## Upload volume vs retained storage (per agency)\n')
    print('Upload volume = new footage per month. Retained = what sits in storage if nothing is deleted. Stored multiplier', STORED_PER_UPLOAD, '\n')
    print('| Creators | Uploads/creator/day | Avg file | Uploads/month | New footage/month | Stored after 30d | 90d | 180d | 365d |')
    print('|---|---|---|---|---|---|---|---|---|')
    for c in (5, 20, 50, 100, 300):
        for n in (5, 10, 15):
            for s in (50, 100, 250, 500):
                u, gb, st, eg = monthly(c, n, s)
                print(f'| {c} | {n} | {s} MB | {u:,} | {fmt(gb)} | {fmt(st)} | {fmt(st*3)} | {fmt(st*6)} | {fmt(st*12.17)} |')
    print('\n## Monthly storage + download cost at month 12 (no deletion) vs 90-day retention\n')
    print('| Creators | Uploads/day | File | Retained (12 mo) | Supabase | R2 | S3 | B2 | R2 with 90-day retention |')
    print('|---|---|---|---|---|---|---|---|---|')
    for c in (5, 20, 50, 100, 300):
        for n in (5, 10, 15):
            for s in (100, 250):
                u, gb, st, eg = monthly(c, n, s)
                kept = st * 12
                row = [cost(p, kept, eg, u, s) for p in ('supabase', 'r2', 's3', 'b2')]
                r90 = cost('r2', st * 3, eg, u, s)
                print(f'| {c} | {n} | {s} MB | {fmt(kept)} | ${row[0]:,.0f} | ${row[1]:,.0f} | ${row[2]:,.0f} | ${row[3]:,.0f} | ${r90:,.0f} |')
