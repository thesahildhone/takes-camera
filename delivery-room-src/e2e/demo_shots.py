import re, json, time
import creator_flow as cf
from creator_flow import *
from playwright.sync_api import sync_playwright
AG='d0000000-0000-4000-8000-00000000a001'; CR=C; W=WA
ref='https://www.instagram.com/reel/DWmYXSxD5GP/'
T=[('t1','Reels'),('t2','Stories'),('t3','Carousels')]
cf.DB['social_content_types']=[dict(id=f'aaaaaaa{i}-0000-4000-8000-00000000000{i}',workspace_id=W,name=n,position=i,archived_at=None) for i,(k,n) in enumerate(T,1)]
tid=lambda i: f'aaaaaaa{i}-0000-4000-8000-00000000000{i}'
S=[('Talking heads','Straight to camera. Hook in the first second.',1),('Home alone / gaming','Casual, at your desk or on the sofa.',1),('Dances','Trend dances. Film along with the reference.',1),('Day in my life','Quick vertical clips for stories.',2)]
cf.DB['social_sections']=[dict(id=f'bbbbbbb{i}-0000-4000-8000-00000000000{i}',workspace_id=W,content_type_id=tid(t),title=n,description=d,position=i,archived_at=None) for i,(n,d,t) in enumerate(S,1)]
sid=lambda i: f'bbbbbbb{i}-0000-4000-8000-00000000000{i}'
ins="Hook: start talking while you put the phone down, keep it quick and natural\nSetup: bedroom or gaming desk, face well lit, camera at eye level\nDelivery: like you are teasing a guy you like. Eye contact, playful smile"
PR=[(1,'“Ladies, this one is for you”','talking','Ladies, this one is for you. If he does not text back in an hour, he is not busy. He is just not that into you.'),
    (1,'Hot take: pineapple on pizza','talking','Unpopular opinion. Pineapple on pizza is elite. Fight me in the comments.'),
    (1,'Rate my outfit','talking','Okay be honest. Rate this fit out of ten. Comment below.'),
    (2,'Gaming setup tour','talking','Welcome to my little corner of the internet. This is where the magic happens.'),
    (2,'Reacting to your comments','reference',''),(3,'Trend dance (film along with the reference)','dance',''),(4,'Morning coffee','reference','')]
cf.DB['social_projects']=[]; cf.DB['social_assignments']=[]
pos={}
for i,(s,t,m,sc) in enumerate(PR,1):
    pos[s]=pos.get(s,-1)+1; pid=f'ccccccc{i}-0000-4000-8000-00000000000{i}'
    cf.DB['social_projects'].append(proj(pid,sid(s),t,m,pos[s],script=sc,transcript_approved=bool(sc),reference_url=ref,import_status='link_only',instructions=ins,rights_status='not_permitted' if m=='dance' else 'unknown'))
    st='approved' if i==2 else 'submitted' if i==3 else 'not_started'
    cf.DB['social_assignments'].append(dict(id=f'ddddddd{i}-0000-4000-8000-00000000000{i}',workspace_id=W,project_id=pid,creator_id=CR,status=st,due_at=None,created_at='2026-11-13T10:00:00Z',updated_at='2026-11-13T10:00:00Z'))
cf.DB['social_projects'].append(proj('ccccccc9-0000-4000-8000-000000000009',sid(3),'New trend (draft, upload the reference)','dance',1,reference_url=ref,import_status='awaiting_upload',import_error="Instagram doesn't allow automatic downloads. Upload a copy you have permission to use.",publication_status='draft'))
cf.DB['social_submissions']=[dict(id='eeeeeee3-0000-4000-8000-000000000003',assignment_id='ddddddd3-0000-4000-8000-000000000003',workspace_id=W,project_id='ccccccc3-0000-4000-8000-000000000003',creator_id=CR,version=1,clean_path=f'{W}/sub/x/{CR}/a-clean.mp4',mix_path=None,mix_note=None,mime='video/mp4',size_bytes=14200000,duration_s=9.8,width=1080,height=1920,smoothing=40,clip_count=3,source='camera',meta={},status='submitted',review_note=None,reviewed_at=None,created_at='2026-11-13T12:10:00Z',profiles=dict(full_name='Desi Destiny',email='demo.creator@deliveryroom.test'))]
pages=[dict(id='tips',title='Before you start',kind='info',body='Make sure it is morning or daytime\nKeep it playful and natural',photos_min=0,photos_max=0,videos_min=0,videos_max=0,extras=0,guidance=''),
 dict(id='teaser',title='Free teaser - Sleepy & cute',kind='media',body='',photos_min=3,photos_max=3,videos_min=0,videos_max=0,extras=2,guidance=''),
 dict(id='ppv1',title='PPV 1 - Getting cozy',kind='media',body='',photos_min=2,photos_max=2,videos_min=2,videos_max=2,extras=2,guidance=''),
 dict(id='bonus',title='Bonus free video',kind='media',body='',photos_min=0,photos_max=0,videos_min=1,videos_max=1,extras=2,guidance='')]
cf.DB['assignments']=[dict(id='fffffff1-0000-4000-8000-000000000001',workspace_id=W,creator_id=CR,template_id=None,schedule_id=None,title='OF · Good Morning',category_name='Good Morning',summary='Morning set',pages=pages,status='not_started',release_at='2026-11-13T10:00:00Z',due_at='2026-11-18T10:00:00Z',last_page=0,submitted_at=None,reviewed_at=None,created_at='2026-11-13T10:00:00Z')]
def run(uid, kind, shots, vp):
    cf.DB['profiles']=[dict(id=AG,full_name='Demo Agency Owner',email='demo.agency@deliveryroom.test',kind='business',smoothing=45),dict(id=CR,full_name='Desi Destiny',email='demo.creator@deliveryroom.test',kind='creator',smoothing=45)]
    cf.DB['workspace_members']=[dict(user_id=AG,workspace_id=W,role='owner',workspaces=dict(id=W,name='Demo Agency',status='active'))] if kind=='agency' else []
    cf.DB['creator_memberships']=[dict(creator_id=CR,workspace_id=W,status='active',joined_at='2026-11-01',workspaces=dict(id=W,name='Demo Agency'),profiles=dict(full_name='Desi Destiny',email='demo.creator@deliveryroom.test'))]
    with sync_playwright() as pw:
        b=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=b.new_context(viewport=vp,device_scale_factor=2,color_scheme='dark')
        ctx.route(re.compile(r'https://'+re.escape(HOST)+r'/.*'),handle)
        ctx.route(re.compile(r'https://fonts\..*'),lambda r:r.fulfill(status=200,body=''))
        ctx.route(re.compile(r'https://www\.instagram\.com/.*'),lambda r:r.fulfill(status=200,content_type='text/html',body='<body style="margin:0;font:600 15px system-ui;background:#fff;color:#262626"><div style="display:flex;align-items:center;gap:10px;padding:12px"><div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)"></div>reference_account<span style="margin-left:auto;background:#4f5bd5;color:#fff;padding:6px 12px;border-radius:8px">View profile</span></div><div style="background:linear-gradient(160deg,#3a2f4f,#1b1726);height:440px;display:grid;place-items:center;color:#fff;font-size:42px">▶</div><div style="padding:12px;color:#4f5bd5">View more on Instagram</div></body>'))
        sess={'access_token':'x','refresh_token':'y','expires_in':86400,'expires_at':int(time.time())+86400,'token_type':'bearer','user':{'id':uid,'email':'d@x.test','aud':'authenticated','role':'authenticated','app_metadata':{},'user_metadata':{}}}
        ctx.add_init_script(f"localStorage.setItem('sb-qchxfwoaaoslipwkdqep-auth-token', JSON.stringify({json.dumps(sess)}))")
        pg=ctx.new_page()
        for name,url,act in shots:
            pg.goto(BASE+url); pg.wait_for_timeout(1800)
            if act: act(pg); pg.wait_for_timeout(900)
            pg.screenshot(path=f'demo_{name}.png',full_page=True); print('shot',name)
        b.close()
P1='ccccccc1-0000-4000-8000-000000000001'
cf.DB['notifications']=[dict(id='n1',user_id=AG,workspace_id=W,type='social_submitted',title='Desi Destiny sent Rate my outfit',body='Version 1 is ready for review.',link='/agency/social-review/eeeeeee3-0000-4000-8000-000000000003',read_at=None,created_at='2026-11-13T12:10:00Z')]
cf.DB['assignments'][0]['profiles']=dict(full_name='Desi Destiny')
M={'width':400,'height':860}; D={'width':1280,'height':860}
def bulk(p):
    p.get_by_role('button',name='Add from links').first.click(); p.fill('textarea','https://www.instagram.com/reel/AAA111/\nhttps://www.instagram.com/reel/BBB222/\nhttps://www.tiktok.com/@x/video/7300000000000000000')
import datetime
soon=(datetime.datetime.utcnow()+datetime.timedelta(days=2)).strftime('%Y-%m-%dT18:00:00Z'); late=(datetime.datetime.utcnow()-datetime.timedelta(days=1)).strftime('%Y-%m-%dT18:00:00Z')
for i,a in enumerate(cf.DB['social_assignments']): a['due_at']= late if i==3 else soon if i in (0,4,5) else None
def ai(p): p.get_by_role('button',name='Write with AI').first.click()
SEC1='bbbbbbb1-0000-4000-8000-000000000001'
run(CR,'creator',[('c1_socials','#/creator',lambda p:p.get_by_role('tab',name='Socials').click()),('c2_shot',f'#/creator/s/p/{P1}',None),('c3_of','#/creator',lambda p:p.get_by_role('tab',name='OF').click()),('c4_runner','#/creator/a/fffffff1-0000-4000-8000-000000000001',None)],M)
run(AG,'agency',[('a1_overview','#/agency',None),('a2_type','#/agency/socials',None),('a3_section',f'#/agency/socials/s/{SEC1}',None),('a4_editor',f'#/agency/socials/p/{P1}',None),('a7_calendar','#/agency/calendar',None)],D)
