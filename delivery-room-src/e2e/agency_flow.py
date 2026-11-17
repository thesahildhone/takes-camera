import re, json, time
import creator_flow as cf
from creator_flow import *
from playwright.sync_api import sync_playwright
STAFF = '99999999-9999-4999-8999-999999999999'
cf.DB['profiles'] = [dict(id=STAFF, full_name='Agency Owner', email='o@x.test', kind='business', smoothing=45), dict(id=C, full_name='Desi Destiny', email='c@x.test', kind='creator', smoothing=45)]
cf.DB['workspace_members'] = [dict(user_id=STAFF, workspace_id=WA, role='owner', workspaces=dict(id=WA, name='Agency A', status='active'))]
cf.DB['creator_memberships'] = [dict(creator_id=C, workspace_id=WA, status='active', joined_at='2026-11-01', profiles=dict(full_name='Desi Destiny', email='c@x.test'))]
cf.DB['social_projects'][1].update(import_status='awaiting_upload', import_error="Instagram doesn't allow automatic downloads.", publication_status='draft')
cf.DB['social_submissions'] = [dict(id='eeeeeee1-0000-4000-8000-000000000001', assignment_id=A3, workspace_id=WA, project_id=P3, creator_id=C, version=1, clean_path=f'{WA}/sub/{P3}/{C}/x-clean.mp4', mix_path=f'{WA}/sub/{P3}/{C}/x-mix.mp4', mix_note=None, mime='video/mp4', size_bytes=900000, duration_s=12.3, width=1080, height=1920, smoothing=40, clip_count=2, source='camera', meta={'originals': [dict(path=f'{WA}/sub/{P3}/{C}/x-clip-1.mp4', size=400000, duration=6.2, trim_in=0, trim_out=6.2, width=1080, height=1920, smoothing=40), dict(path=f'{WA}/sub/{P3}/{C}/x-clip-2.mp4', size=500000, duration=6.4, trim_in=0.3, trim_out=6.4, width=1080, height=1920, smoothing=40)]}, status='submitted', review_note=None, reviewed_at=None, created_at='2026-11-13T11:00:00Z', profiles=dict(full_name='Desi Destiny', email='c@x.test'))]
cf.DB['social_assignments'][2]['status'] = 'submitted'
fails = []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m); (None if c else fails.append(m))
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.route(re.compile(r'https://' + re.escape(HOST) + r'/.*'), handle)
    ctx.route(re.compile(r'https://(fonts\.|www\.instagram).*'), lambda r: r.fulfill(status=200, body=''))
    sess = {'access_token':'x','refresh_token':'y','expires_in':86400,'expires_at':int(time.time())+86400,'token_type':'bearer','user':{'id':STAFF,'email':'o@x.test','aud':'authenticated','role':'authenticated','app_metadata':{},'user_metadata':{}}}
    ctx.add_init_script(f"localStorage.setItem('sb-qchxfwoaaoslipwkdqep-auth-token', JSON.stringify({json.dumps(sess)}))")
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE + '#/agency/socials'); pg.wait_for_selector('text=Talking heads', timeout=15000); pg.wait_for_timeout(500)
    pg.screenshot(path='a1_socials.png', full_page=True)
    t = pg.inner_text('main'); check('New section' in pg.inner_text('aside') and 'New folder' in pg.inner_text('aside'), 'agency nav has Socials entries')
    check('Dances' in t and 'Reference needs an upload' in t, 'sections and import warning listed')
    pg.locator('a', has_text='Instagram reference').click(); pg.wait_for_selector('text=Unable to import reference video', timeout=10000)
    check(pg.get_by_role('button', name='Upload Video File', exact=True).count() == 1 and pg.locator('text=Retry Import').count() == 1 and pg.locator('text=Keep Link Only / Save Draft').count() == 1, 'import warning has all three actions')
    check(pg.locator('#pj-url').input_value().startswith('https://www.instagram.com/reel/ABCdef123'), 'original URL kept after failed import')
    pg.screenshot(path='a2_editor.png', full_page=True)
    pg.get_by_role('button', name='Preview creator view').click(); pg.wait_for_selector('.preview-frame .shot-num'); check(True, 'creator preview renders'); pg.screenshot(path='a3_preview.png')
    pg.keyboard.press('Escape')
    pg.goto(BASE + '#/agency/social-review'); pg.wait_for_selector('table', timeout=10000)
    check('Desi Destiny' in pg.inner_text('table') and 'Clean + music' in pg.inner_text('table'), 'review inbox lists the submission')
    pg.select_option('select[aria-label="Status"]', 'approved'); check(pg.locator('table').count() == 0, 'status filter works')
    pg.select_option('select[aria-label="Status"]', 'submitted')
    pg.locator('table a').first.click(); pg.wait_for_selector('text=Clean video', timeout=10000); pg.wait_for_timeout(500)
    check(pg.locator('text=With reference music').count() == 1 and pg.locator('.vgrid video').count() == 2, 'detail shows joined + music players'); pg.screenshot(path='a4_review.png', full_page=True)
    check(pg.locator('#originals .clipcard').count() == 2 and pg.locator('#originals video').count() == 2, 'original clips section lists both untouched clips with players')
    check('Trimmed in the joined video' in pg.inner_text('#originals .clipcard >> nth=1'), 'clip 2 shows it was trimmed in the joined version (original kept whole)')
    with pg.expect_download(timeout=15000) as dl: pg.locator('#originals').get_by_role('button', name='Download clip 1').click()
    d = dl.value; pg.wait_for_timeout(600)
    signs = [c for c in cf.CALLS if c[0] == 'sign1']
    check(d.suggested_filename.endswith('_clip1.mp4') and signs and signs[-1][1].endswith('x-clip-1.mp4') and signs[-1][2].get('expiresIn') == 600, f'clip 1 downloads as the stored original via a 10-min signed link ({d.suggested_filename})')
    lg = [c for c in cf.CALLS if c[0] == 'rpc' and c[1] == 'log_social_download']
    check(lg and lg[-1][2] == {'sub': 'eeeeeee1-0000-4000-8000-000000000001', 'what': 'original clip 1'}, 'download is written to the audit log')
    pg.get_by_role('button', name='Request redo').click(); pg.fill('#rv-note', 'Smile more in the hook'); pg.get_by_role('button', name='Send back for redo').click(); pg.wait_for_timeout(800)
    rv = [c for c in cf.CALLS if c[0] == 'rpc' and c[1] == 'social_review']
    check(rv and rv[0][2] == {'sub': 'eeeeeee1-0000-4000-8000-000000000001', 'act': 'revise', 'note': 'Smile more in the hook'}, 'redo request sent with note')
    pg.goto(BASE + '#/agency/social-review'); pg.wait_for_selector('select[aria-label="Status"]', timeout=10000)
    pg.select_option('select[aria-label="Status"]', '')
    btn = pg.get_by_role('button', name=re.compile(r'Download 3 files'))
    check(btn.count() == 1, 'bulk download offers 3 files (2 original clips + music version) for the filtered list')
    got = []; pg.on('download', lambda d: got.append(d.suggested_filename))
    n0 = len([c for c in cf.CALLS if c[0] == 'rpc' and c[1] == 'log_social_download'])
    btn.click(); pg.wait_for_selector('text=Downloads finished', timeout=20000); pg.wait_for_timeout(800)
    logs_b = [c for c in cf.CALLS if c[0] == 'rpc' and c[1] == 'log_social_download'][n0:]
    check(sorted(x.rsplit('_', 1)[1] for x in got) == ['clip1.mp4', 'clip2.mp4', 'music.mp4'], f'all 3 files downloaded with readable names {got}')
    check(len(logs_b) == 3 and all('(bulk)' in c[2]['what'] for c in logs_b), 'each bulk download is logged')
    check(not errs, 'no page errors ' + '; '.join(errs[:3]))
    b.close()
print(len(fails), 'failure(s)')
