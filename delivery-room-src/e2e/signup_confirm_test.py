"""Sign-up with email confirmation on: no session comes back, app shows 'Check your email', resend works, and the confirm link returns to the invite page."""
import json, time, base64
import creator_flow as cf
from playwright.sync_api import sync_playwright
fails = []
def check(ok, msg): print(('PASS ' if ok else 'FAIL ') + msg); ok or fails.append(msg)
CALLS = []
def handle(route):
    req = route.request; path = req.url.split('supabase.co', 1)[1].split('?')[0]
    hdr = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json'}
    j = lambda b, s=200: route.fulfill(status=s, headers=hdr, body=json.dumps(b))
    if req.method == 'OPTIONS': return route.fulfill(status=200, headers=hdr)
    if path == '/auth/v1/signup':
        body = json.loads(req.post_data or '{}'); CALLS.append(('signup', body, req.url))
        return j({'id': 'u1', 'email': body.get('email'), 'identities': [{'id': 'i1'}], 'aud': 'authenticated', 'role': '', 'app_metadata': {}, 'user_metadata': {}})
    if path == '/auth/v1/resend': CALLS.append(('resend', json.loads(req.post_data or '{}'), req.url)); return j({})
    if path == '/auth/v1/token': CALLS.append(('token',)); return j({'error': 'invalid_grant', 'error_description': 'Email not confirmed'}, 400)
    return cf.handle(route)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 393, 'height': 852}); ctx.route('**/*supabase.co/**', handle)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(cf.BASE + '#/auth?mode=signup&kind=creator&next=/invite/abc'); pg.wait_for_selector('#name')
    pg.fill('#name', 'New Creator'); pg.fill('input[type=email]', 'new@x.test'); pg.fill('#password', 'longpassword1')
    pg.get_by_role('button', name='Create account').click(); pg.wait_for_selector('text=Check your email', timeout=8000)
    su = [c for c in CALLS if c[0] == 'signup']
    check(su and 'redirect_to=' in su[0][2], 'sign-up asks Supabase to send the confirm link back to this app')
    check(not [c for c in CALLS if c[0] == 'token'], 'no premature sign-in attempt before the email is confirmed')
    check('new@x.test' in pg.inner_text('body'), 'tells the user which address the link went to')
    check(pg.evaluate("localStorage.getItem('sr.afterConfirm')") == '/invite/abc', 'remembers the invite page to return to')
    pg.get_by_role('button', name='Send the email again').click(); pg.wait_for_selector('text=Sent again', timeout=5000)
    rs = [c for c in CALLS if c[0] == 'resend']; check(rs and rs[0][1].get('type') == 'signup' and rs[0][1].get('email') == 'new@x.test', 'resend sends another confirmation email')
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
    tok = enc({'alg': 'HS256'}) + '.' + enc({'sub': 'u1', 'role': 'authenticated', 'exp': int(time.time()) + 3600, 'email': 'new@x.test'}) + '.s'
    pg.goto('about:blank'); pg.goto(cf.BASE + f'#access_token={tok}&refresh_token=r&expires_in=3600&token_type=bearer&type=signup'); pg.wait_for_timeout(2500)
    check('#/invite/abc' in pg.url, f'clicking the confirm link lands back on the invite page ({pg.url.split("#")[-1]})')
    check(not errs, 'no page errors ' + '; '.join(errs[:2]))
    b.close()
print(len(fails), 'failure(s)')
