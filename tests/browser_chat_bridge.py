"""Offline Chromium test for Naver iframe article extraction and consent-only GitHub bridge."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
import json, os
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
try:
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('SERP_CHROME_PATH') or None,args=['--no-sandbox'])
    ctx=browser.new_context(accept_downloads=True)
    page=ctx.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(origin+'/tests/fixtures/naver_blog_shell.html')
    page.frame_locator('#mainFrame').locator('.se-main-container').wait_for()
    iframe=next(f for f in page.frames if 'naver_blog_frame.html' in f.url)
    result=iframe.evaluate("""async()=> {
      const {extractOpenArticle}=await import('/extension/naver-article.js');
      return extractOpenArticle();
    }""")
    assert result['title'].startswith('다이소 유심'), result
    assert result['extraction_selector']=='.se-main-container'
    assert '앤텔레콤' not in result['text'] # only this fixture article
    assert '원칩' in result['text']
    assert result['images']==1
    assert result['score']>40000
    assert 'AI 활용' in result['text']
    assert 'AI 활용' not in result['clean_text']
    assert any(h['text']=='1. NFC 지원 확인 방법' for h in result['headings'])
    assert any(h['text']=='2. 편의점 구매 전 확인' for h in result['headings'])
    assert not any(h['text'] in ('39,600원','10.3GB') for h in result['headings'])
    assert result['image_captions']==['유심 외관 사진 설명']
    assert result['extraction_audit']['comparison_to_original']=='not_verified'
    assert result['extraction_audit']['images_ocr'] is False
    assert result['extraction_audit']['numbered_section_candidates']==2
    page.goto(origin+'/tests/fixtures/naver_cafe_article.html')
    cafe=page.evaluate("""async()=>{
      const {extractOpenArticle}=await import('/extension/naver-article.js');
      return extractOpenArticle();
    }""")
    assert cafe['extraction_selector']=='.ArticleContentBox'
    assert '태블릿 번호' in cafe['text']
    assert cafe['title']=='LG 원칩 신규가입 안내'

    ctx.add_init_script("""(()=>{
      let stored={};
      window.chrome={
        runtime:{getManifest:()=>({version:'2.3.0'}),sendMessage:async()=>({enabled:true,repository:'example/private-evidence',status:{phase:'idle',message:'새 요청 없음 · 최근 다이소 유심 본문 3/3건',last_result:{query:'다이소 유심',captured_articles:3,attempted_articles:3,issue_number:7,captured_at:'2026-11-05T08:00:00Z'}}})},
        storage:{
          session:{
            get:async key=>({[key]:stored[key]}),
            set:async obj=>{Object.assign(stored,obj);},
            remove:async key=>{delete stored[key];}
          },
          local:{
            get:async keys=>Object.fromEntries(
              (Array.isArray(keys)?keys:[keys]).map(key=>[key,stored[key]])),
            set:async obj=>{Object.assign(stored,obj);}
          }
        }
      };
    })()""")
    requests=[]
    def github(route):
      req=route.request
      path=req.url
      requests.append((req.method,path))
      headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*',
               'Access-Control-Allow-Methods':'GET,PUT,OPTIONS'}
      if req.method=='OPTIONS':
        route.fulfill(status=200,headers=headers,body='')
      elif req.method=='GET' and path.endswith('/repos/example/private-evidence'):
        route.fulfill(status=200,headers=headers,content_type='application/json',
          body=json.dumps({'private':True,'default_branch':'main','permissions':{'push':True}}))
      elif req.method=='GET' and '/contents/' in path:
        route.fulfill(status=404,headers=headers,content_type='application/json',
          body=json.dumps({'message':'Not Found'}))
      elif req.method=='PUT' and '/contents/' in path:
        body=json.loads(req.post_data)
        assert body.get('content')
        route.fulfill(status=201,headers=headers,content_type='application/json',
          body=json.dumps({'content':{'sha':'abc'}}))
      else:
        route.fulfill(status=500,headers=headers,content_type='application/json',
          body=json.dumps({'error':'unexpected mock request'}))
    page.route('https://api.github.com/**',github)
    page.goto(origin+'/extension/chat-bridge.html')
    page.evaluate("""async()=>{
      const {savePage,saveSearch}=await import('./intelligence-store.js');
      await savePage({
        id:'article-test',url:'https://blog.naver.com/demo/224123456789',
        title:'다이소 유심 비교',text:'다이소 유심과 LG 원칩을 비교하는 본문입니다. '.repeat(25),
        captured_at:'2026-11-05T03:00:00Z',images:1,headings:[],
        extraction_quality:'article',source_kind:'NAVER_BLOG'
      });
      await saveSearch({
        id:'search-test',query:'다이소 유심',device:'PC',
        captured_at:'2026-11-05T03:00:00Z',
        sourceURL:'https://search.naver.com/search.naver?query=다이소유심',
        rows:[{block_type:'BLOG',result_title:'다이소 유심 비교',
               result_url:'https://blog.naver.com/demo/224123456789'}]
      });
    }""")
    page.reload()
    expect(page.locator('h1')).to_contain_text('네이버 자동 조사')
    expect(page.locator('#bridge-repo')).to_have_value('prepaid1215/serp-lens-private-data')
    expect(page.locator('#autopilot-state-label')).to_contain_text('자동 조사 켜짐')
    expect(page.locator('#autopilot-last-query')).to_have_text('다이소 유심')
    expect(page.locator('#autopilot-last-count')).to_have_text('3 / 3건')
    expect(page.locator('#autopilot-check-now')).to_be_visible()
    expect(page.locator('#autopilot-disable')).to_be_visible()
    expect(page.locator('#autopilot-enable')).to_be_hidden()
    assert not requests
    assert page.locator('#manual-sharing').evaluate('(el)=>el.open') is False
    page.locator('#manual-sharing > summary').click()
    expect(page.locator('.bridge-choice')).to_have_count(2)
    page.locator('.bridge-choice input').nth(0).check()
    page.locator('.bridge-choice input').nth(1).check()
    page.locator('#preview-selection').click()
    preview=page.locator('#selection-preview').inner_text()
    assert '다이소 유심 비교' in preview
    assert '다이소 유심과 LG 원칩' in preview
    with page.expect_download() as download:
      page.locator('#download-selected').click()
    record=json.loads(Path(download.value.path()).read_text('utf-8'))
    assert len(record['records'])==2
    assert all('token' not in str(x).lower() for x in record['records'])
    page.locator('#bridge-repo').fill('example/private-evidence')
    page.locator('#bridge-token').fill('secret-token')
    page.locator('#verify-repo').click()
    expect(page.locator('#repo-status')).to_contain_text('확인 완료')
    expect(page.locator('#repo-connection-chip')).to_contain_text('비공개 연결 확인')
    page.locator('#share-confirm').check()
    page.once('dialog',lambda dialog:dialog.accept())
    page.locator('#upload-selected').click()
    expect(page.locator('#upload-result')).to_contain_text('전송 완료',timeout=30000)
    assert len([x for x in requests if x[0]=='PUT'])==3,requests
    expect(page.locator('#copy-chat-request')).to_be_enabled()
    # Responsive layout must not introduce a horizontal page scrollbar.
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2')
    assert not errors,errors
    print('NAVER ARTICLE + RESPONSIVE CHATGPT DASHBOARD CHROMIUM E2E PASS')
    ctx.close();browser.close()
finally:
  server.shutdown()
