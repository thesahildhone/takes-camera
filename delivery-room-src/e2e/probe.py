import json, re, time, sys
sys.argv=[sys.argv[0]]
import creator_flow as cf
from playwright.sync_api import sync_playwright
from fonts import route_fonts
D=cf.DB
D['social_content_types'].append(dict(id='aaaaaaa3-0000-4000-8000-000000000003', workspace_id=cf.WA, name='Carousels', position=2, archived_at=None))
D['social_sections'].append(dict(id='bbbbbbb3-0000-4000-8000-000000000003', workspace_id=cf.WA, content_type_id=cf.T1, title='Home alone / gaming', description='Casual, at your desk or on the sofa.', position=1, archived_at=None))
for i,t in enumerate(['History hook: first woman to study law at Oxford','Trend dance (film along with the reference)','Hot take: pineapple on pizza']):
    pid=f'ccccccc{i+4}-0000-4000-8000-00000000000{i+4}'
    D['social_projects'].append(cf.proj(pid, 'bbbbbbb3-0000-4000-8000-000000000003', t, 'talking', i, script='x', transcript_approved=True))
    D['social_assignments'].append(dict(id=f'ddddddd{i+4}-0000-4000-8000-00000000000{i+4}', workspace_id=cf.WA, project_id=pid, creator_id=cf.C, status='not_started', due_at='2026-11-19T10:00:00Z', created_at='2026-11-13T10:00:00Z', updated_at='2026-11-13T10:00:00Z'))
W=int(__import__('os').environ.get('W','393'))
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': W, 'height': 852}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route(re.compile(r'https://' + re.escape(cf.HOST) + r'/.*'), cf.handle)
    route_fonts(ctx)
    ctx.route(re.compile(r'https://www\.instagram\.com/.*'), lambda r: r.fulfill(status=200, content_type='text/html', body='<body>IG</body>'))
    sess = {'access_token': 'x', 'refresh_token': 'y', 'expires_in': 86400, 'expires_at': int(time.time()) + 86400, 'token_type': 'bearer', 'user': {'id': cf.C, 'email': 'c@x.test', 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {}}}
    ctx.add_init_script(f"localStorage.setItem('sb-qchxfwoaaoslipwkdqep-auth-token', JSON.stringify({json.dumps(sess)}))")
    pg = ctx.new_page()
    pg.goto(cf.BASE + '#/creator'); pg.wait_for_selector('text=Socials', timeout=45000)
    pg.get_by_role('tab', name='Socials').click(); pg.wait_for_selector('.ringcard', timeout=10000); pg.wait_for_timeout(800)
    print('doc', pg.evaluate("[document.documentElement.scrollWidth, innerWidth]"))
    print(pg.evaluate("""[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>e.tagName+'|'+(e.parentElement.className||e.parentElement.parentElement.className)+'|'+e.textContent.slice(0,40)+' '+Math.round(e.getBoundingClientRect().width))"""))
    pg.screenshot(path=f'probe_{W}.png', full_page=True)
