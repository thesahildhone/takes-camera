"""Two-step login: gate appears when the agency requires it, enrolment works, wrong code is rejected, and the app opens after a correct code.
Runs against the mocked backend from creator_flow.py, with auth endpoints mocked here."""
import base64, json, time
import creator_flow as cf
from playwright.sync_api import sync_playwright
fails = []
def check(ok, msg): print(('PASS ' if ok else 'FAIL ') + msg); ok or fails.append(msg)
def jwt(aal, amr):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
    return enc({'alg': 'HS256', 'typ': 'JWT'}) + '.' + enc({'sub': cf.C, 'role': 'authenticated', 'aal': aal, 'amr': [{'method': m, 'timestamp': int(time.time())} for m in amr], 'exp': int(time.time()) + 3600}) + '.sig'
STATE = {'factors': [], 'verified': False, 'calls': []}
USER = lambda: {'id': cf.C, 'email': 'o@x.test', 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {}, 'factors': STATE['factors']}
def handle(route):
    req = route.request; path = route.request.url.split('supabase.co', 1)[1].split('?')[0]
    hdr = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json'}
    j = lambda b, s=200: route.fulfill(status=s, headers=hdr, body=json.dumps(b))
    if req.method == 'OPTIONS': return route.fulfill(status=200, headers=hdr)
    if path == '/rest/v1/rpc/my_mfa_required': return j(True)
    if path == '/auth/v1/user': return j(USER())
    if path == '/auth/v1/factors' and req.method == 'POST':
        f = {'id': 'f1', 'factor_type': 'totp', 'status': 'unverified', 'friendly_name': 'A', 'created_at': '2026-11-17T00:00:00Z', 'updated_at': '2026-11-17T00:00:00Z'}
        STATE['factors'] = [f]; STATE['calls'].append('enroll')
        return j({'id': 'f1', 'type': 'totp', 'totp': {'qr_code': 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', 'secret': 'JBSWY3DPEHPK3PXP', 'uri': 'otpauth://x'}})
    if path.startswith('/auth/v1/factors/') and path.endswith('/challenge'): return j({'id': 'ch1', 'type': 'totp', 'expires_at': int(time.time()) + 300})
    if path.startswith('/auth/v1/factors/') and path.endswith('/verify'):
        code = json.loads(req.post_data or '{}').get('code'); STATE['calls'].append('verify:' + str(code))
        if code != '123456': return j({'code': 'mfa_verification_failed', 'msg': 'Invalid TOTP code entered', 'error_code': 'mfa_verification_failed'}, 422)
        STATE['factors'][0]['status'] = 'verified'; STATE['verified'] = True
        return j({'access_token': jwt('aal2', ['password', 'totp']), 'refresh_token': 'r2', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600, 'token_type': 'bearer', 'user': USER()})
    if path.startswith('/auth/v1/factors/') and req.method == 'DELETE': STATE['factors'] = []; return j({'id': 'f1'})
    return cf.handle(route)

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 393, 'height': 852}); ctx.route('**/*supabase.co/**', handle)
    sess = {'access_token': jwt('aal1', ['password']), 'refresh_token': 'y', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600, 'token_type': 'bearer', 'user': USER()}
    ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('sb-qchxfwoaaoslipwkdqep-auth-token', JSON.stringify({json.dumps(sess)})); sessionStorage.setItem('seeded','1') }}")
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(cf.BASE + '#/agency'); pg.wait_for_selector('text=Set up two-step login', timeout=15000)
    check(pg.locator('text=requires it for everyone').count() == 1 and pg.locator('nav, .side').count() == 0, 'agency requiring two-step login blocks the app and asks for setup')
    pg.wait_for_selector('img[alt^="QR code"]', timeout=10000)
    check('enroll' in STATE['calls'] and pg.locator('text=JBSWY3DPEHPK3PXP').count() == 1, 'QR code and manual key shown')
    btn = pg.get_by_role('button', name='Turn on two-step login')
    pg.fill('input[autocomplete="one-time-code"]', '12a3'); check(btn.is_disabled(), 'button stays disabled until 6 digits')
    pg.fill('input[autocomplete="one-time-code"]', '000000'); btn.click(); pg.wait_for_selector('[role=alert]', timeout=8000)
    check('did not match' in pg.inner_text('[role=alert]') and not STATE['verified'], 'wrong code is rejected with a clear message')
    pg.fill('input[autocomplete="one-time-code"]', '123456'); btn.click()
    pg.wait_for_function("!document.body.innerText.includes('Set up two-step login')", timeout=15000); pg.wait_for_timeout(800)
    check(STATE['verified'] and pg.locator('text=Set up two-step login').count() == 0, 'correct code turns it on and opens the app')
    check(not errs, 'no page errors ' + '; '.join(errs[:2]))
    # next visit: verified factor + aal1 session -> code prompt
    STATE['verified'] = False
    sess['user'] = USER()
    pg2 = ctx.new_page()
    pg2.goto(cf.BASE + '#/agency'); pg2.evaluate(f"localStorage.setItem('sb-qchxfwoaaoslipwkdqep-auth-token', JSON.stringify({json.dumps(sess)}))"); pg2.reload()
    pg2.wait_for_selector('text=Enter your code', timeout=15000); check(True, 'returning user with an authenticator is asked for the code')
    pg2.fill('input[autocomplete="one-time-code"]', '123456'); pg2.get_by_role('button', name='Continue').click()
    pg2.wait_for_function("!document.body.innerText.includes('Enter your code')", timeout=15000)
    check(STATE['verified'], 'code accepted and app opens')
    b.close()
print(len(fails), 'failure(s)')
