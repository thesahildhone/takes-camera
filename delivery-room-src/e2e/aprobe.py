import re, json, time, sys, os
sys.argv=[sys.argv[0]]
import creator_flow as cf
from creator_flow import *
from playwright.sync_api import sync_playwright
from fonts import route_fonts
STAFF = '99999999-9999-4999-8999-999999999999'
cf.DB['profiles'] = [dict(id=STAFF, full_name='Agency Owner', email='o@x.test', kind='business', smoothing=45), dict(id=C, full_name='Desi Destiny', email='c@x.test', kind='creator', smoothing=45)]
W0=dict(id=WA, name='Agency A', status='active')
cf.DB['workspace_members'] = [dict(user_id=STAFF, workspace_id=WA, role='owner', title='Owner', last_seen_at='2026-11-17T00:00:00Z', last_page='Overview', workspaces=W0, profiles=dict(full_name='Sahil Dhone', email='o@x.test')),
  dict(user_id='99999999-9999-4999-8999-999999999998', workspace_id=WA, role='admin', title='Co-manager', last_seen_at='2026-11-16T20:00:00Z', last_page='Socials review', workspaces=W0, profiles=dict(full_name='Priya Shah', email='p@x.test')),
  dict(user_id='99999999-9999-4999-8999-999999999997', workspace_id=WA, role='reviewer', title='Content director', last_seen_at=None, last_page=None, workspaces=W0, profiles=dict(full_name='Marco Ruiz', email='m@x.test'))]
cf.DB['invitations']=[dict(id='i1', workspace_id=WA, email='editor@x.test', kind='staff', role='reviewer', title='Editor', token='t1', status='pending', expires_at='2026-11-30T00:00:00Z', created_at='2026-11-16T00:00:00Z')]
cf.DB['creator_memberships'] = [dict(creator_id=C, workspace_id=WA, status='active', joined_at='2026-11-01', profiles=dict(full_name='Desi Destiny', email='c@x.test'))]
pages = os.environ.get('P','agency,agency/socials/t/'+T1+',agency/socials/p/'+P1+',agency/social-review,agency/calendar,agency/creators,agency/settings').split(',')
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for W,H in ((393,852),(820,1180)):
        ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, is_mobile=True, has_touch=True)
        ctx.route(re.compile(r'https://' + re.escape(HOST) + r'/.*'), handle)
        route_fonts(ctx); ctx.route(re.compile(r'https://www\.instagram.*'), lambda r: r.fulfill(status=200, body=''))
        sess = {'access_token':'x','refresh_token':'y','expires_in':86400,'expires_at':int(time.time())+86400,'token_type':'bearer','user':{'id':STAFF,'email':'o@x.test','aud':'authenticated','role':'authenticated','app_metadata':{},'user_metadata':{}}}
        ctx.add_init_script(f"localStorage.setItem('sb-qchxfwoaaoslipwkdqep-auth-token', JSON.stringify({json.dumps(sess)}))")
        pg = ctx.new_page()
        for i,p in enumerate(pages):
            pg.goto(BASE + '#/' + p); pg.wait_for_timeout(2500)
            over = pg.evaluate("""[document.documentElement.scrollWidth, [...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1 && !e.closest('.tablewrap,.table-wrap')).slice(0,4).map(e=>e.tagName+'.'+(typeof e.className=='string'?e.className:'')+'|'+e.textContent.slice(0,30))]""")
            print(W, p, over)
            pg.screenshot(path=f'ap_{W}_{i}.png', full_page=True)
        ctx.close()
