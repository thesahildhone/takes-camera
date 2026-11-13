import re, json, time
import creator_flow as cf
from creator_flow import *
from playwright.sync_api import sync_playwright
STAFF = '99999999-9999-4999-8999-999999999999'
cf.DB['profiles'] = [dict(id=STAFF, full_name='Agency Owner', email='o@x.test', kind='business', smoothing=45), dict(id=C, full_name='Desi Destiny', email='c@x.test', kind='creator', smoothing=45)]
cf.DB['workspace_members'] = [dict(user_id=STAFF, workspace_id=WA, role='owner', workspaces=dict(id=WA, name='Agency A', status='active'))]
cf.DB['creator_memberships'] = [dict(creator_id=C, workspace_id=WA, status='active', joined_at='2026-11-01', profiles=dict(full_name='Desi Destiny', email='c@x.test'))]
cf.DB['social_projects'][1].update(import_status='awaiting_upload', import_error="Instagram doesn't allow automatic downloads.", publication_status='draft')
cf.DB['social_submissions'] = [dict(id='eeeeeee1-0000-4000-8000-000000000001', assignment_id=A3, workspace_id=WA, project_id=P3, creator_id=C, version=1, clean_path=f'{WA}/sub/{P3}/{C}/x-clean.mp4', mix_path=f'{WA}/sub/{P3}/{C}/x-mix.mp4', mix_note=None, mime='video/mp4', size_bytes=900000, duration_s=12.3, width=1080, height=1920, smoothing=40, clip_count=2, source='camera', meta={}, status='submitted', review_note=None, reviewed_at=None, created_at='2026-11-13T11:00:00Z', profiles=dict(full_name='Desi Destiny', email='c@x.test'))]
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
    t = pg.inner_text('main'); check('Sections & shots' in pg.inner_text('aside') and 'Socials review' in pg.inner_text('aside'), 'agency nav has Socials entries')
    check('Dances' in t and 'Reference needs an upload' in t, 'sections and import warning listed')
    pg.locator('a', has_text='Instagram reference').click(); pg.wait_for_selector('text=Unable to import reference video', timeout=10000)
    check(pg.locator('text=Upload Video File').count() == 1 and pg.locator('text=Retry Import').count() == 1 and pg.locator('text=Keep Link Only / Save Draft').count() == 1, 'import warning has all three actions')
    check(pg.locator('#pj-url').input_value().startswith('https://www.instagram.com/reel/ABCdef123'), 'original URL kept after failed import')
    pg.screenshot(path='a2_editor.png', full_page=True)
    pg.get_by_role('button', name='Preview creator view').click(); pg.wait_for_selector('.preview-frame .shot-num'); check(True, 'creator preview renders'); pg.screenshot(path='a3_preview.png')
    pg.keyboard.press('Escape')
    pg.goto(BASE + '#/agency/social-review'); pg.wait_for_selector('table', timeout=10000)
    check('Desi Destiny' in pg.inner_text('table') and 'Clean + music' in pg.inner_text('table'), 'review inbox lists the submission')
    pg.select_option('select[aria-label="Status"]', 'approved'); check(pg.locator('table').count() == 0, 'status filter works')
    pg.select_option('select[aria-label="Status"]', 'submitted')
    pg.locator('table a').first.click(); pg.wait_for_selector('text=Clean video', timeout=10000); pg.wait_for_timeout(500)
    check(pg.locator('text=With reference music').count() == 1 and pg.locator('video').count() == 2, 'detail shows clean + music players'); pg.screenshot(path='a4_review.png', full_page=True)
    pg.get_by_role('button', name='Request redo').click(); pg.fill('#rv-note', 'Smile more in the hook'); pg.get_by_role('button', name='Send back for redo').click(); pg.wait_for_timeout(800)
    rv = [c for c in cf.CALLS if c[0] == 'rpc' and c[1] == 'social_review']
    check(rv and rv[0][2] == {'sub': 'eeeeeee1-0000-4000-8000-000000000001', 'act': 'revise', 'note': 'Smile more in the hook'}, 'redo request sent with note')
    check(not errs, 'no page errors ' + '; '.join(errs[:3]))
    b.close()
print(len(fails), 'failure(s)')
