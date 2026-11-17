import re
WOFF=open('/home/claude/mock/node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2','rb').read()
CSS="@font-face{font-family:'Bricolage Grotesque';src:url(https://fonts.gstatic.com/brico.woff2) format('woff2');font-weight:200 800;font-stretch:75% 100%}"
def route_fonts(ctx):
    ctx.route(re.compile(r'https://fonts\.googleapis\.com/.*'), lambda r: r.fulfill(status=200, content_type='text/css', body=CSS))
    ctx.route(re.compile(r'https://fonts\.gstatic\.com/.*'), lambda r: r.fulfill(status=200, content_type='font/woff2', body=WOFF, headers={'access-control-allow-origin':'*'}))
