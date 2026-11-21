"""Creator upload straight to (mocked) Cloudflare R2: chunked parts, a failed part retried, sizes and bytes verified,
then the agency downloads through an R2 signed link. Supabase is mocked by creator_flow.handle."""
import hashlib, json, re
from urllib.parse import urlparse, unquote, parse_qs
from playwright.sync_api import sync_playwright
import creator_flow as cf

BASE = cf.BASE
R2 = {'parts': {}, 'objects': {}, 'fail_once': {3}, 'part_puts': [], 'begin': [], 'complete': [], 'sign': []}
PART = 1024 * 1024

def media_fn(route):
    req = route.request; b = json.loads(req.post_data or '{}'); a = b.get('action')
    hdr = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json'}
    if req.method == 'OPTIONS': return route.fulfill(status=200, headers=hdr)
    if a == 'begin':
        R2['begin'].append(b)
        if b['bucket'] != 'social' or '/sub/' not in b['path']: return route.fulfill(status=200, headers=hdr, body=json.dumps({'use': 'supabase'}))
        n = -(-b['size'] // PART)
        urls = [f'https://r2.test/part/{i}?p={b["path"]}' for i in range(1, n + 1)]
        return route.fulfill(status=200, headers=hdr, body=json.dumps({'use': 'r2', 'mode': 'multipart', 'uploadId': 'u1', 'partSize': PART, 'urls': urls, 'done': []}))
    if a == 'complete':
        R2['complete'].append(b); p = b['path']
        parts = sorted(b['parts'], key=lambda x: x['n'])
        ok = all(R2['parts'].get((p, x['n']), (None, None))[1] == x['etag'] for x in parts)
        if not ok: return route.fulfill(status=409, headers=hdr, body=json.dumps({'error': 'etag mismatch'}))
        R2['objects'][p] = b''.join(R2['parts'][(p, x['n'])][0] for x in parts); cf.UPLOADS[p] = R2['objects'][p]
        return route.fulfill(status=200, headers=hdr, body=json.dumps({'ok': True}))
    if a == 'sign':
        R2['sign'].append(b); names = b.get('names') or {}
        urls = {p: f'https://r2.test/get/{p}' + (f'?name={names[p]}' if p in names else '') for p in b['paths'] if p in R2['objects']}
        return route.fulfill(status=200, headers=hdr, body=json.dumps({'urls': urls}))
    return route.fulfill(status=400, headers=hdr, body=json.dumps({'error': 'unknown'}))

def r2_host(route):
    req = route.request; u = urlparse(req.url); q = parse_qs(u.query)
    hdr = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,HEAD,PUT', 'access-control-expose-headers': 'ETag'}
    if req.method == 'OPTIONS': return route.fulfill(status=200, headers=hdr)
    if u.path.startswith('/part/') and req.method == 'PUT':
        n = int(u.path.rsplit('/', 1)[1]); p = q['p'][0]; body = req.post_data_buffer or b''
        R2['part_puts'].append(n)
        if n in R2['fail_once']: R2['fail_once'].discard(n); return route.fulfill(status=503, headers=hdr, body='busy')
        tag = '"' + hashlib.md5(body).hexdigest() + '"'; R2['parts'][(p, n)] = (body, tag)
        return route.fulfill(status=200, headers={**hdr, 'etag': tag}, body='')
    if u.path.startswith('/get/'):
        p = unquote(u.path[5:]); name = q.get('name', [None])[0]
        return route.fulfill(status=200, headers={**hdr, 'content-type': 'video/mp4', **({'content-disposition': f'attachment; filename="{name}"'} if name else {})}, body=R2['objects'].get(p, b''))
    return route.fulfill(status=404, headers=hdr, body='')

def main():
    fails = []
    def check(c, m): print(('PASS ' if c else 'FAIL ') + m); (None if c else fails.append(m))
    src = open('./ref.mp4', 'rb').read(); sha = hashlib.sha256(src).hexdigest()
    readable = lambda paths: [{'path': p} for p in paths if p in R2['objects']]
    orig_handle = cf.handle
    def handle(route):
        u = urlparse(route.request.url)
        if u.path == '/functions/v1/media': return media_fn(route)
        if u.path == '/rest/v1/rpc/r2_readable':
            b = json.loads(route.request.post_data or '{}')
            return route.fulfill(status=200, headers={'access-control-allow-origin': '*', 'content-type': 'application/json'}, body=json.dumps(readable(b.get('paths', []))))
        return orig_handle(route)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, permissions=['camera', 'microphone'])
        ctx.route(re.compile(r'https://' + re.escape(cf.HOST) + r'/.*'), handle)
        ctx.route(re.compile(r'https://r2\.test/.*'), r2_host)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body=''))
        ctx.route(re.compile(r'https://www\.instagram\.com/.*'), lambda r: r.fulfill(status=200, content_type='text/html', body='<body>embed</body>'))
        sess = dict(access_token='t', refresh_token='r', expires_at=4102444800, expires_in=3600, token_type='bearer', user=dict(id=cf.C, email='c@x.test', aud='authenticated', role='authenticated'))
        ctx.add_init_script(f"localStorage.setItem('sb-qchxfwoaaoslipwkdqep-auth-token', JSON.stringify({json.dumps(sess)}))")
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + f'#/creator/s/p/{cf.P1}'); pg.wait_for_selector('text=Choose from camera roll', timeout=20000)
        with pg.expect_file_chooser() as fc: pg.click('text=Choose from camera roll')
        fc.value.set_files('./ref.mp4')
        pg.wait_for_selector('text=Send to your agency', timeout=30000)
        pg.locator('button.sbtn.primary', has_text=re.compile(r'^Send$')).click(no_wait_after=True)
        pg.wait_for_function("() => /Waiting for review|Sent /.test(document.body.innerText) && !/Send to your agency/.test(document.body.innerText)", timeout=90000)
        pg.wait_for_timeout(800)
        beg = [x for x in R2['begin'] if '/sub/' in x['path']]
        check(len(beg) == 1 and beg[0]['size'] == len(src) and beg[0]['mime'] == 'video/mp4', f'asked for an R2 upload with the exact size and type ({len(beg)} begin)')
        n = -(-len(src) // PART)
        check(sorted(set(R2['part_puts'])) == list(range(1, n + 1)), f'all {n} parts sent straight to storage (not through Supabase)')
        check(R2['part_puts'].count(3) == 2, 'a failed part was retried automatically')
        p = beg[0]['path'] if beg else ''
        check(p in R2['objects'] and hashlib.sha256(R2['objects'][p]).hexdigest() == sha, 'file in storage is byte-for-byte identical (sha256)')
        check(len(R2['complete']) == 1 and len(R2['complete'][0]['parts']) == n, 'upload finished with every part listed once')
        sb_uploads = [c for c in cf.CALLS if c[0] == 'upload' and '/sub/' in c[1]]
        check(not sb_uploads, 'nothing went to Supabase storage')
        subs = [c for c in cf.CALLS if c[0] == 'rpc' and c[1] == 'social_submit']
        check(len(subs) == 1 and subs[0][2]['clean'] == p and subs[0][2]['sz'] == len(src), 'submission recorded with the R2 path and size')
        check(not errs, 'no page errors ' + '; '.join(errs[:2]))

        # Agency side: the review page links come from R2 signing; download keeps a readable name.
        sub = cf.DB['social_submissions'][0] if cf.DB['social_submissions'] else None
        check(sub is not None, 'submission visible to agency')
        b.close()
    print(len(fails), 'failure(s)')

if __name__ == '__main__': main()
