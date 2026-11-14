"""End-to-end creator flow against the real built app, with Supabase replaced by an in-test mock.
Fake camera + mic come from Chrome's --use-fake-device-for-media-stream."""
import json, re, sys, time, uuid
from urllib.parse import urlparse, parse_qs, unquote
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173/'
HOST = 'qchxfwoaaoslipwkdqep.supabase.co'
C = '11111111-1111-4111-8111-111111111111'; WA = '22222222-2222-4222-8222-222222222222'
T1 = 'aaaaaaa1-0000-4000-8000-000000000001'; SEC1 = 'bbbbbbb1-0000-4000-8000-000000000001'; SEC2 = 'bbbbbbb2-0000-4000-8000-000000000002'
P1 = 'ccccccc1-0000-4000-8000-000000000001'; P2 = 'ccccccc2-0000-4000-8000-000000000002'; P3 = 'ccccccc3-0000-4000-8000-000000000003'
A1, A2, A3 = (f'ddddddd{i}-0000-4000-8000-00000000000{i}' for i in (1, 2, 3))
REF = open('/home/claude/e2e/ref.mp4', 'rb').read(); WAV = open('/home/claude/e2e/ref.wav', 'rb').read()

def proj(id, sec, title, mode, pos, **kw):
    base = dict(id=id, workspace_id=WA, section_id=sec, title=title, description='', position=pos, mode=mode, instructions='Hook: start talking while you sit down\nSetup: bedroom, face well lit\nExample: https://www.instagram.com/reel/DWmYXSxD5GP/',
                script='', transcript_raw=None, transcript_approved=False, transcript_status='none', transcript_error=None, reference_url=None, ref_platform=None,
                ref_video_path=None, ref_mime=None, ref_audio_path=None, ref_duration=None, import_status='none', import_error=None, audio_status='none', audio_error=None,
                rights_status='unknown', keep_mic=True, publication_status='published', published_at='2026-11-13T10:00:00Z', created_at='2026-11-13T09:00:00Z', updated_at='2026-11-13T09:00:00Z')
    base.update(kw); return base

DB = {
  'profiles': [dict(id=C, full_name='Desi Destiny', email='c@x.test', kind='creator', smoothing=45)],
  'creator_memberships': [dict(creator_id=C, status='active', workspaces=dict(id=WA, name='Agency A'))],
  'workspace_members': [], 'notifications': [], 'assignments': [], 'submission_files': [],
  'social_content_types': [dict(id=T1, workspace_id=WA, name='Reels', position=0, archived_at=None), dict(id='aaaaaaa2-0000-4000-8000-000000000002', workspace_id=WA, name='Stories', position=1, archived_at=None)],
  'social_sections': [dict(id=SEC1, workspace_id=WA, content_type_id=T1, title='Talking heads', description='Straight to camera', position=0, archived_at=None),
                      dict(id=SEC2, workspace_id=WA, content_type_id=T1, title='Dances', description='', position=1, archived_at=None)],
  'social_projects': [
    proj(P1, SEC1, '“I like big butts and I can not lie”', 'talking', 0, script='I like big butts and I can not lie. Ladies, this one is for you!', transcript_approved=True, reference_url='https://www.instagram.com/reel/DWmYXSxD5GP/', ref_video_path=f'{WA}/ref/{P1}/v.mp4', import_status='ready'),
    proj(P2, SEC1, 'Instagram reference', 'reference', 1, reference_url='https://www.instagram.com/reel/ABCdef123/', import_status='link_only'),
    proj(P3, SEC2, 'Trend dance', 'dance', 0, ref_video_path=f'{WA}/ref/{P3}/v.mp4', ref_audio_path=f'{WA}/ref/{P3}/a.wav', audio_status='ready', rights_status='licensed', import_status='ready', ref_duration=60),
  ],
  'social_assignments': [dict(id=a, workspace_id=WA, project_id=p, creator_id=C, status='not_started', due_at=None, created_at='2026-11-13T10:00:00Z', updated_at='2026-11-13T10:00:00Z') for a, p in ((A1, P1), (A2, P2), (A3, P3))],
  'social_submissions': [],
}
CALLS = []; UPLOADS = {}

def filt(rows, q):
    out = rows
    for k, vs in q.items():
        if k in ('select', 'order', 'limit', 'offset'): continue
        for v in vs:
            op, _, val = v.partition('.')
            if op == 'eq': out = [r for r in out if str(r.get(k)).lower() == val.lower()]
            elif op == 'neq': out = [r for r in out if str(r.get(k)) != val]
            elif op == 'in': ids = val.strip('()').split(','); out = [r for r in out if str(r.get(k)) in ids]
            elif op == 'is' and val == 'null': out = [r for r in out if r.get(k) is None]
            elif op == 'gte': out = [r for r in out if str(r.get(k)) >= val]
    return out

def unwrap(body, ctype):
    if 'multipart/form-data' not in ctype: return body
    bnd = ('--' + ctype.split('boundary=')[1]).encode()
    for part in body.split(bnd):
        if b'filename=' in part[:400] or (b'name=""' in part[:400]):
            h, _, data = part.partition(b'\r\n\r\n'); return data[:-2]
    return body

def handle(route):
    req = route.request; u = urlparse(req.url); path = unquote(u.path); q = parse_qs(u.query)
    hdr = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*'}
    if req.method == 'OPTIONS': return route.fulfill(status=200, headers=hdr)
    j = lambda body, status=200, extra={}: route.fulfill(status=status, headers={**hdr, 'content-type': 'application/json', **extra}, body=json.dumps(body))
    if path.startswith('/storage/v1/object/sign/social') and req.method == 'POST':
        paths = json.loads(req.post_data or '{}').get('paths', [])
        return j([{'path': p, 'signedURL': f'/object/sign/social/{p}?token=t', 'error': None} for p in paths])
    if path.startswith('/storage/v1/object/sign/social/'):
        p = path.split('/object/sign/social/', 1)[1]
        body = UPLOADS.get(p) or (WAV if p.endswith('.wav') else REF)
        return route.fulfill(status=200, headers={**hdr, 'content-type': 'audio/wav' if p.endswith('.wav') else 'video/mp4'}, body=body)
    if path.startswith('/storage/v1/object/social/') and req.method == 'POST':
        p = path.split('/object/social/', 1)[1]; UPLOADS[p] = unwrap(req.post_data_buffer, req.headers.get('content-type') or ''); CALLS.append(('upload', p, len(req.post_data_buffer or b''), req.headers.get('content-type')))
        return j({'Key': 'social/' + p, 'Id': str(uuid.uuid4())})
    if path.startswith('/rest/v1/rpc/'):
        fn = path.rsplit('/', 1)[1]; args = json.loads(req.post_data or '{}'); CALLS.append(('rpc', fn, args))
        if fn == 'social_submit':
            DB['social_submissions'].insert(0, dict(id=args['sub_id'], assignment_id=args['asg'], workspace_id=WA, project_id=P1 if args['asg'] == A1 else P3, creator_id=C, version=1, clean_path=args['clean'], mix_path=args['mix'],
                mix_note=args['mix_note'], mime=args['m'], size_bytes=args['sz'], duration_s=args['dur'], width=args['w'], height=args['h'], smoothing=args['sm'], clip_count=args['clips'], source=args['src'], meta={}, status='submitted', review_note=None, reviewed_at=None, created_at='2026-11-13T11:00:00Z'))
            for a in DB['social_assignments']:
                if a['id'] == args['asg']: a['status'] = 'submitted'
            return j(args['sub_id'])
        return j(None)
    if path.startswith('/rest/v1/'):
        t = path.split('/rest/v1/', 1)[1]
        rows = filt(DB.get(t, []), q)
        if req.method == 'HEAD': return route.fulfill(status=200, headers={**hdr, 'content-range': f'0-0/{len(rows)}'})
        if req.method in ('PATCH', 'POST'): return j(rows[:1] if rows else [])
        if 'vnd.pgrst.object' in (req.headers.get('accept') or ''):
            return j(rows[0]) if rows else j({'message': 'none'}, 406)
        return j(rows, 200, {'content-range': f'0-{max(0, len(rows) - 1)}/{len(rows)}'})
    return j({}, 404)

def main():
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg); (None if cond else fails.append(msg))
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2, permissions=['camera', 'microphone'])
        ctx.route(re.compile(r'https://' + re.escape(HOST) + r'/.*'), handle)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body=''))
        ctx.route(re.compile(r'https://www\.instagram\.com/.*'), lambda r: r.fulfill(status=200, content_type='text/html', body='<body style="margin:0;background:#fafafa;font:16px sans-serif;display:grid;place-items:center;height:100vh">Instagram embed (mocked)</body>'))
        sess = {'access_token': 'x', 'refresh_token': 'y', 'expires_in': 86400, 'expires_at': int(time.time()) + 86400, 'token_type': 'bearer', 'user': {'id': C, 'email': 'c@x.test', 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {}}}
        ctx.add_init_script(f"localStorage.setItem('sb-qchxfwoaaoslipwkdqep-auth-token', JSON.stringify({json.dumps(sess)}))")
        pg = ctx.new_page(); logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}')); pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        pg.goto(BASE + '#/creator'); pg.wait_for_selector('text=Socials', timeout=45000)
        pg.get_by_role('tab', name='Socials').click()
        pg.wait_for_selector('.ringcard', timeout=10000); pg.screenshot(path='01_home.png', full_page=True)
        check('2 shots to go' in pg.inner_text('.ringcard') or '3 shots to go' in pg.inner_text('.ringcard'), 'home ring shows shots to go: ' + pg.inner_text('.ringcard').replace('\n', ' '))
        check(pg.locator('.shotrow').count() == 2, f'Talking heads list has 2 numbered shots ({pg.locator(".shotrow").count()})')
        check('01' in pg.locator('.shotrow').first.inner_text(), 'numbering starts at 01')
        pg.locator('.sectabs button', has_text='Dances').click(); check(pg.locator('.shotrow').count() == 1, 'Dances tab shows its 1 shot')
        pg.get_by_role('tab', name='OF').click(); pg.wait_for_timeout(300); check(pg.locator('.ringcard').count() == 0, 'OF toggle shows the existing OF view')
        pg.get_by_role('tab', name='Socials').click(); pg.wait_for_selector('.shotrow')
        pg.locator('.sectabs button', has_text='Talking heads').click()

        # ---- talking shot detail
        pg.locator('.shotrow').first.click(); pg.wait_for_selector('.shot-num', timeout=10000); pg.wait_for_timeout(600)
        pg.screenshot(path='02_shot.png', full_page=True)
        t = pg.inner_text('.shot')
        check('Shot 1 of 2' in t, 'detail shows "Shot 1 of 2"'); check('Your script' in t, 'script card shown'); check('Before you film' in t, 'instructions shown')
        check(pg.locator('.shot-actions >> text=Film it').count() == 1 and pg.locator('.shot-actions >> text=Choose from camera roll').count() == 1, 'bottom actions present')
        box = pg.locator('.shot-actions').bounding_box(); check(box and box['y'] + box['height'] <= 862, 'actions pinned inside viewport')

        # ---- camera: 3 clips
        pg.locator('.shot-actions >> text=Film it').click(); pg.get_by_role('button', name='Turn on camera').click()
        pass
        pg.wait_for_selector('.scam .shutter', timeout=45000); pg.wait_for_timeout(800)
        check(pg.locator('.scam .tp').count() == 1, 'teleprompter visible'); pg.screenshot(path='03_camera.png')
        pg.get_by_role('button', name='Scroll').click(); pg.get_by_role('button', name='Still').click()
        for i in range(3):
            pg.get_by_role('button', name='Record clip').click(); pg.wait_for_timeout(1600)
            pg.get_by_role('button', name='Stop clip').click(); pg.wait_for_selector('.scam .cthumbs b', timeout=45000)
            pg.wait_for_function(f"document.querySelector('.scam .cthumbs b')?.textContent === '{i + 1}'", timeout=60000)
        check(pg.inner_text('.scam .cthumbs b') == '3', '3 clips recorded')
        pg.get_by_role('button', name='Done').click(); pg.wait_for_selector('.scam .edit')
        sizes = pg.evaluate("""async () => { const r = indexedDB.open('dr-social'); const db = await new Promise(x => r.onsuccess = () => x(r.result));
          const all = await new Promise(x => { const q = db.transaction('drafts').objectStore('drafts').getAll(); q.onsuccess = () => x(q.result) });
          const d = all[0]; return { order: d.order, sizes: d.order.map(id => d.clips.find(c => c.id === id).blob.size) } }""")
        check(len(sizes['order']) == 3 and all(s > 1000 for s in sizes['sizes']), f'draft autosaved in IndexedDB with 3 non-empty clips {sizes["sizes"]}')
        pg.screenshot(path='04_edit.png')

        # ---- retake clip 2 only
        pg.locator('.scam .sclip').nth(1).click(); pg.get_by_role('button', name='Redo this clip').click()
        pg.wait_for_selector('text=Redoing clip 2', timeout=5000) if pg.locator('text=Redoing clip 2').count() else None
        pg.get_by_role('button', name='Record clip').click(); pg.wait_for_timeout(1300); pg.get_by_role('button', name='Stop clip').click()
        pg.wait_for_selector('text=Keep the new take?', timeout=45000); pg.screenshot(path='05_retake.png')
        pg.get_by_role('button', name='Use new take').click(); pg.wait_for_selector('.scam .edit'); pg.wait_for_timeout(400)
        after = pg.evaluate("""async () => { const r = indexedDB.open('dr-social'); const db = await new Promise(x => r.onsuccess = () => x(r.result));
          const all = await new Promise(x => { const q = db.transaction('drafts').objectStore('drafts').getAll(); q.onsuccess = () => x(q.result) });
          const d = all[0]; return { order: d.order, sizes: d.order.map(id => d.clips.find(c => c.id === id).blob.size), n: d.clips.length } }""")
        check(after['order'][0] == sizes['order'][0] and after['order'][2] == sizes['order'][2] and after['order'][1] != sizes['order'][1] and after['n'] == 3,
              'retake replaced only clip 2; A and C unchanged, order A, B-new, C')
        check(after['sizes'][0] == sizes['sizes'][0] and after['sizes'][2] == sizes['sizes'][2], 'clips 1 and 3 bytes identical after retake')

        # ---- trim clip 1, delete + undo clip 3
        pg.locator('.scam .sclip').nth(0).click()
        pg.locator('.scam .trim input').first.evaluate("(el) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(el, '0.3'); el.dispatchEvent(new Event('input', {bubbles:true})); }")
        pg.locator('.scam .sclip').nth(2).click(); pg.locator('.scam .ebtns >> text=Delete').click(); pg.locator('.scam .confirm button', has_text='Delete').click()
        check(pg.locator('.scam .sclip:not(.add)').count() == 2, 'delete removed a clip'); pg.screenshot(path='04b_undo.png'); pg.get_by_role('button', name='Undo').click(timeout=20000); pg.wait_for_timeout(300)
        check(pg.locator('.scam .sclip:not(.add)').count() == 3, 'undo restored it')

        # ---- leave and come back: draft restored
        pg.locator('.scam .etop button[aria-label="Close"]').click(); pg.wait_for_timeout(500)
        check('3 clips saved' in pg.inner_text('.shot-actions'), 'after closing, the shot shows "Continue · 3 clips saved"')
        pg.reload(); pg.wait_for_selector('.shot-actions', timeout=10000); pg.wait_for_timeout(800)
        check('3 clips saved' in pg.inner_text('.shot-actions'), 'draft survives a page reload')

        # ---- send: assemble + upload + submit
        pg.locator('.shot-actions .sbtn.primary').click(); pg.wait_for_selector('.scam .edit', timeout=10000)
        expect_total = float(re.search(r'([\d.]+)s', pg.inner_text('.scam .etop b')).group(1)); print('edit view total', expect_total)
        pg.get_by_role('button', name=re.compile('Use these 3 clips')).click(); pg.wait_for_selector('text=Send to your agency')
        pg.get_by_role('button', name='Send', exact=True).click()
        pg.wait_for_selector('text=Sent to your agency', timeout=90000)
        ups = [c for c in CALLS if c[0] == 'upload']; subs = [c for c in CALLS if c[0] == 'rpc' and c[1] == 'social_submit']
        check(len(ups) == 1 and ups[0][1].startswith(f'{WA}/sub/{P1}/{C}/') and ups[0][2] > 10000, f'clean video uploaded to agency/sub/project/creator path ({ups[0][1] if ups else None}, {ups[0][2] if ups else 0} bytes)')
        check(len(subs) == 1 and subs[0][2]['mix'] is None and subs[0][2]['clips'] == 3 and subs[0][2]['src'] == 'camera', 'social_submit called once, clean only, 3 clips')
        dur = subs[0][2]['dur'] if subs else 0
        check(abs(dur - expect_total) < 0.6, f'assembled duration = trimmed total ({dur}s vs {expect_total}s)')
        pg.wait_for_timeout(800); pg.screenshot(path='06_sent.png', full_page=True)
        check('Waiting for review' in pg.inner_text('.shot'), 'page shows sent / waiting for review')
        out = UPLOADS[ups[0][1]]; open('/home/claude/e2e/out_clean.' + ('webm' if b'webm' in out[:64] or out[:4] == b'\x1aE\xdf\xa3' else 'mp4'), 'wb').write(out)
        import subprocess; fn = [f for f in __import__('os').listdir('.') if f.startswith('out_clean.')][0]
        real = float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',fn],capture_output=True,text=True).stdout.strip() or 0)
        check(abs(real - expect_total) < 1.0, f'actual joined file length matches the timeline ({real:.1f}s vs {expect_total}s)')
        left = pg.evaluate("""async () => { const r = indexedDB.open('dr-social'); const db = await new Promise(x => r.onsuccess = () => x(r.result));
          return await new Promise(x => { const q = db.transaction('drafts').objectStore('drafts').count(); q.onsuccess = () => x(q.result) }) }""")
        check(left == 0, 'local draft cleared after confirmed send')

        # ---- dance shot: sound + licensed mix
        CALLS.clear()
        pg.goto(BASE + f'#/creator/s/p/{P3}'); pg.wait_for_selector('.shot-actions', timeout=10000); pg.wait_for_timeout(500)
        check('Sound plays while you film' in pg.inner_text('.shot'), 'dance shot explains the sound')
        pg.locator('.shot-actions >> text=Film it').click(); pg.get_by_role('button', name='Turn on camera').click(timeout=45000)
        pg.wait_for_selector('.scam .cue', timeout=45000); pg.screenshot(path='07_dance_cam.png')
        for i in range(2):
            pg.get_by_role('button', name='Record clip').click(); pg.wait_for_selector('.scam .countdown', timeout=45000); pg.wait_for_timeout(5500)
            pg.get_by_role('button', name='Stop clip').click(); pg.wait_for_function(f"document.querySelector('.scam .cthumbs b')?.textContent === '{i + 1}'", timeout=60000)
        cue = pg.inner_text('.scam .cue'); check('0:0' not in cue.split('starts at')[1][:6] if 'starts at' in cue else True, 'cue advanced to where clip 2 ended: ' + cue.split('\n')[0])
        refs = pg.evaluate("""async () => { const r = indexedDB.open('dr-social'); const db = await new Promise(x => r.onsuccess = () => x(r.result));
          const all = await new Promise(x => { const q = db.transaction('drafts').objectStore('drafts').getAll(); q.onsuccess = () => x(q.result) });
          const d = all[0]; return d.order.map(id => { const c = d.clips.find(c => c.id === id); return [c.refStart, c.duration] }) }""")
        check(len(refs) == 2 and abs(refs[1][0] - (refs[0][0] + refs[0][1])) < 0.6, f'clip 2 starts in the sound where clip 1 ended {refs}')
        pg.get_by_role('button', name='Done').click(); pg.get_by_role('button', name=re.compile('Use these 2 clips')).click()
        pg.wait_for_selector('text=one with the music'); pg.get_by_role('button', name='Send', exact=True).click()
        pg.wait_for_selector('text=Sent to your agency', timeout=90000)
        ups = [c for c in CALLS if c[0] == 'upload']; subs = [c for c in CALLS if c[0] == 'rpc' and c[1] == 'social_submit']
        check(len(ups) == 2 and any(u[1].endswith('-mix.mp4') or '-mix.' in u[1] for u in ups), f'licensed dance uploads clean + music versions {[u[1].rsplit("/",1)[1] for u in ups]}')
        check(subs and subs[0][2]['mix'] is not None, 'submission links the music version')
        for u in ups: open('/home/claude/e2e/out_dance_' + ('mix' if '-mix.' in u[1] else 'clean') + '.' + u[1].rsplit('.', 1)[1], 'wb').write(UPLOADS[u[1]])

        errs = [l for l in logs if l.startswith('PAGEERROR') or l.startswith('error')]
        print('\nconsole errors:', *errs[:15], sep='\n  ')
        b.close()
    print(f'\n{len(fails)} failure(s)'); sys.exit(1 if fails else 0)

if __name__ == "__main__": main()
