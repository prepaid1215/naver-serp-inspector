"""Offline Chromium integration: 5-stage readiness UI and JSON export."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
import json, os
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
try:
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('SERP_CHROME_PATH') or None,args=['--no-sandbox'])
    ctx=browser.new_context(accept_downloads=True)
    page=ctx.new_page()
    errs=[]
    page.on('pageerror',lambda e:errs.append(str(e)))
    page.goto(origin+'/extension/full-validation.html')
    expect(page.locator('.validation-stage')).to_have_count(5)
    assert '전체 현장 검증 미완료' in page.locator('#validation-summary').inner_text()
    page.evaluate("""async()=>{
      const store=await import('./intelligence-store.js');
      const visual=await import('./visual-store.js');
      const terms=['선불폰 개통','앤텔레콤 개통방법','선불유심 신규가입'];
      const links=['https://blog.naver.com/test1/100','https://blog.naver.com/test2/100','https://blog.naver.com/test3/100'];
      for(let i=0;i<3;i++){
        await store.savePage({id:'doc'+i,url:links[i],title:'제목 '+i+' 선불폰 개통',
          text:'선불폰 개통 방법 '.repeat(70),headings:[{level:'H2',text:'개통 안내'}],
          captured_at:'2026-11-05T00:00:00Z'});
      }
      for(let k=0;k<3;k++)for(const device of ['PC','모바일']){
        await store.saveSearch({id:'serp'+k+device,query:terms[k],device,
          captured_at:'2026-11-05T09:00:00Z',evidence_sha256:'c'.repeat(64),
          rows:links.map((url,i)=>({block_type:'BLOG',result_url:url,result_title:'문서'+i}))});
      }
      for(const device of ['PC','모바일']){
        await visual.saveVisualAudit({
          id:'audit-'+device,captured_at:'2026-11-05T09:00:00Z',
          query:'선불폰 개통',url_device:device,
          layout_device:device==='PC'?'데스크톱 너비':'모바일 너비',
          viewport:{width:device==='PC'?1200:390,height:740},
          screenshot_png:new Uint8Array([137,80,78,71]),
          screenshot_image_size:{width:device==='PC'?1200:390,height:740},
          root_fallback:false,checked_complete:true,
          capture_moved:false,screenshot_dimension_mismatch:false,
          reviews:{r:{verdict:'confirmed',correct_type:'BLOG'}},
          block_reviews:{b:{verdict:'confirmed',correct_type:'BLOG'}},
          candidates:[{id:'r',title:'제목',url:links[0],type_hint:'BLOG',y:70,x:25}],
          blocks:[{id:'b',type_hints:['BLOG'],y:60,x:20,candidates:1}],
          parsed_rows:[{block_type:'BLOG',result_url:links[0]}],added:[]
        });
      }
    }""")
    stored=page.evaluate("""async()=>{
      const visual=await import('./visual-store.js');
      return (await visual.listVisualAuditSummaries()).map(x=>x.id);
    }""")
    assert len(stored)==2,('visual store records absent',stored)
    page.locator('#run-validation').click()
    page.wait_for_function("document.getElementById('run-validation')?.disabled===false")
    expect(page.locator('.validation-stage')).to_have_count(5)
    assert '통합 검증 실패' not in page.locator('#validation-status').inner_text(),page.locator('#validation-status').inner_text()
    assert '5단계 중 자료 확보' in page.locator('#validation-summary').inner_text()
    audit=page.locator('.validation-stage').nth(4).inner_text()
    assert '검증자료 확보' in audit,audit
    assert 'PC 실화면 1개' in audit
    assert '모바일 실화면 1개' in audit
    assert '전체 현장 검증 미완료' in page.locator('#validation-summary').inner_text() # no experiments
    expect(page.locator('#validation-audits .source-record')).to_have_count(2)
    with page.expect_download() as dl:
      page.locator('#download-validation').click()
    data=json.loads(Path(dl.value.path()).read_text('utf-8'))
    assert data['schema']=='naver-serp-full-validation-v1'
    assert data['stages'][4]['ready'] is True
    assert data['stages'][3]['ready'] is False
    assert data['ready'] is False
    assert not errs,errs
    print('FULL VALIDATION DASHBOARD BROWSER E2E PASS')
    ctx.close()
    browser.close()
finally:
  server.shutdown()
