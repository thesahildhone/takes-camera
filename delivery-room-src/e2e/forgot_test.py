import re, sys
sys.argv=[sys.argv[0]]
import creator_flow as cf
from fonts import route_fonts
from playwright.sync_api import sync_playwright
reset_calls=[]
def handle(route):
    if '/auth/v1/recover' in route.request.url:
        reset_calls.append(route.request.url); return route.fulfill(status=200, content_type='application/json', body='{}')
    return cf.handle(route)
res = {}
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width':393,'height':852})
    ctx.route(re.compile(r'https://' + re.escape(cf.HOST) + r'/.*'), handle); route_fonts(ctx)
    pg = ctx.new_page(); pg.goto(cf.BASE + '#/auth'); pg.wait_for_selector('text=Forgot your password?', timeout=30000)
    pg.click('text=Forgot your password?'); pg.fill('#email','x@y.test'); pg.click('text=Email me a reset link')
    pg.wait_for_selector('text=a reset link is on its way', timeout=8000)
    res['reset email requested with redirect back to app'] = bool(reset_calls) and 'redirect_to' in reset_calls[0]
    pg.goto(cf.BASE + '#/reset'); pg.wait_for_timeout(2000); res['reset page without valid link says expired'] = 'Link expired' in pg.inner_text('body')
    pg = ctx.new_page(); pg.goto(cf.BASE + '#error=access_denied&error_description=Email+link+is+invalid'); pg.wait_for_timeout(2500); res['expired email link shows a clear message'] = 'expired or was already used' in pg.inner_text('body')
for k,v in res.items(): print('PASS' if v else 'FAIL', k)
