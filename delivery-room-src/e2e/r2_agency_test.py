"""Agency review with mixed storage: clip 1 lives in R2, clip 2 and the joined video in Supabase storage.
Players and downloads must work for both, with readable file names, and downloads logged."""
import json, re, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
import agency_flow as af
import r2_upload_test as rt
cf = af.cf
WA, C = cf.WA, cf.C
SUB = 'eeeeeee1-0000-4000-8000-000000000001'
CLIP1 = f'{WA}/sub/{cf.P3}/{C}/x-clip-1.mp4'
BYTES = b'R2-ORIGINAL-' + bytes(range(256)) * 400

def main():
    fails = []
    def check(c, m): print(('PASS ' if c else 'FAIL ') + m); (None if c else fails.append(m))
    rt.R2['objects'][CLIP1] = BYTES
    seen = []
    def handle(route):
        u = urlparse(route.request.url)
        if u.path == '/functions/v1/media': return rt.media_fn(route)
        if u.path == '/rest/v1/rpc/r2_readable':
            b = json.loads(route.request.post_data or '{}'); seen.append(b)
            return route.fulfill(status=200, headers={'access-control-allow-origin': '*', 'content-type': 'application/json'}, body=json.dumps([{'path': p} for p in b.get('paths', []) if p in rt.R2['objects']]))
        return cf.handle(route)
    with sync_playwright() as pw:
        b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
        ctx.route(re.compile(r'https://' + re.escape(cf.HOST) + r'/.*'), handle)
        ctx.route(re.compile(r'https://r2\.test/.*'), rt.r2_host)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body=''))
        sess = {'access_token': 'x', 'refresh_token': 'y', 'expires_in': 86400, 'expires_at': int(time.time()) + 86400, 'token_type': 'bearer', 'user': {'id': af.STAFF, 'email': 'o@x.test', 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {}}}
        ctx.add_init_script(f"localStorage.setItem('sb-qchxfwoaaoslipwkdqep-auth-token', JSON.stringify({json.dumps(sess)}))")
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(cf.BASE + f'#/agency/social-review/{SUB}'); pg.wait_for_selector('#originals .clipcard', timeout=15000); pg.wait_for_timeout(1200)
        srcs = pg.eval_on_selector_all('#originals video', 'v => v.map(x => x.getAttribute("src") || "")')
        check(len(srcs) == 2 and srcs[0].startswith('https://r2.test/get/') and '/object/sign/social/' in srcs[1], f'clip 1 plays from R2, clip 2 from Supabase ({[s[:30] for s in srcs]})')
        joined = pg.eval_on_selector_all('.vgrid video', 'v => v.map(x => x.getAttribute("src") || "")')
        check(joined and all('/object/sign/social/' in s for s in joined), 'joined and music videos (older uploads) still play from Supabase')
        check(seen and CLIP1 in seen[-1]['paths'], 'app asked which files are in R2 before making links')
        with pg.expect_download(timeout=15000) as dl: pg.locator('#originals').get_by_role('button', name='Download clip 1').click()
        d = dl.value; data = open(d.path(), 'rb').read()
        signs = rt.R2['sign']
        check(data == BYTES, 'clip 1 downloaded from R2 byte-for-byte')
        check(d.suggested_filename.endswith('_clip1.mp4') and signs and signs[-1].get('names', {}).get(CLIP1, '').endswith('_clip1.mp4') and signs[-1].get('ttl') == 600, f'R2 download keeps a readable name and a 10-minute link ({d.suggested_filename})')
        with pg.expect_download(timeout=15000) as dl2: pg.locator('#originals').get_by_role('button', name='Download clip 2').click()
        check(dl2.value.suggested_filename.endswith('_clip2.mp4'), 'clip 2 (Supabase) still downloads with its name')
        lg = [c for c in cf.CALLS if c[0] == 'rpc' and c[1] == 'log_social_download']
        check(len(lg) >= 2 and lg[-2][2]['what'] == 'original clip 1', 'both downloads written to the audit log')
        check(not errs, 'no page errors ' + '; '.join(errs[:2]))
        b.close()
    print(len(fails), 'failure(s)')

if __name__ == '__main__': main()
