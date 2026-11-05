"""Offline Chromium smoke test for the Intelligence dashboard; no Naver requests."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
import os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=os.environ.get('SERP_CHROME_PATH') or None,args=['--no-sandbox'])
        ctx=browser.new_context(accept_downloads=True)
        page=ctx.new_page()
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.goto(origin+'/extension/intelligence.html')
        page.evaluate("""async()=>{
          const {saveSearch,savePage}=await import('./intelligence-store.js');
          const rowsOld=[
            {block_type:'BLOG',result_url:'https://blog.naver.com/demo/111',result_title:'이전 글',organic_rank:1},
            {block_type:'WEB',result_url:'https://example.net/2',result_title:'계속 노출',organic_rank:2}
          ];
          const rowsNew=[
            {block_type:'WEB',result_url:'https://example.net/2',result_title:'계속 노출',organic_rank:1},
            {block_type:'WEB',result_url:'https://example.net/3',result_title:'신규 글',organic_rank:2}
          ];
          await saveSearch({id:'old',captured_at:'2026-11-01T00:00:00Z',query:'선불폰 개통',device:'PC',rows:rowsOld});
          await saveSearch({id:'new',captured_at:'2026-11-05T00:00:00Z',query:'선불폰 개통',device:'PC',rows:rowsNew});
          await savePage({id:'page',captured_at:'2026-11-05T00:00:00Z',url:'https://example.net/3',
            title:'신규 글',text:'이 내용은 수동으로 수집한 테스트 문서입니다.',headings:[{level:'H2',text:'가입 순서'}],
            images:1,internal_links:2,external_links:1});
          await savePage({id:'mine',captured_at:'2026-11-05T00:00:00Z',
            url:'https://my.example.org/1',title:'내 신규가입 글',
            text:'유심을 준비하고 신규가입하는 방법입니다.',description:'소개',
            headings:[{level:'H2',text:'유심 준비하기'}],
            images:1,internal_links:2,external_links:1});
          await savePage({id:'rival',captured_at:'2026-11-05T00:00:00Z',
            url:'https://competitor.example.org/1',title:'경쟁 문서',
            text:'테더링 제공량 확인을 설명한 글',
            headings:[{level:'H2',text:'테더링 제공량 확인'}],
            images:3,internal_links:3,external_links:2});
        }""")
        page.reload()
        page.wait_for_function("document.getElementById('search-count')?.textContent==='2'")
        assert page.locator('#doc-count').inner_text()=='3'
        assert page.locator('#diff-count').inner_text()=='1'
        assert page.locator('#comparison').get_by_text('신규 글').count()>=1
        assert page.locator('#pages .page').count()==3
        assert '가입 순서' in page.locator('#preview').input_value()
        page.locator('#own-page').select_option('mine')
        page.locator('#rival-pages').select_option(['rival','page'])
        page.locator('#gap-keyword').fill('선불폰 신규가입')
        page.locator('#compare-content').click()
        assert page.locator('#gap-results .gap-card').count()>=1
        assert '테더링 제공량 확인' in page.locator('#preview').input_value()
        with page.expect_download() as report:
            page.locator('#download-gap').click()
        assert report.value.suggested_filename=='naver-content-gap-evidence.txt'
        page.locator('#rank-filter').fill('선불폰')
        page.locator('#run-rank-lab').click()
        assert page.locator('#rank-keywords').inner_text()=='1'
        assert page.locator('#rank-matched').inner_text()=='1'
        assert page.locator('#rank-factors .factor-card').count()>=7
        assert page.locator('#rank-sources .source-record').count()>=1
        with page.expect_download() as rank_download:
            page.locator('#download-rank-lab').click()
        assert rank_download.value.suggested_filename=='naver-rank-lab-evidence.json'
        with page.expect_download() as info:
            page.locator('#download').click()
        assert info.value.suggested_filename=='naver-intelligence-ai-prompt.txt'
        page.locator('#remove-search').click()
        page.wait_for_function("document.getElementById('search-count')?.textContent==='1'")

        # Experiment ledger integration. Four captured snapshots bracket one change date.
        page.evaluate("""async()=>{
          const {saveSearch}=await import('./intelligence-store.js');
          const target='https://example.org/target',control='https://example.org/control';
          function rows(t,c){
            const arr=Array.from({length:5},(_,i)=>({block_type:'WEB',
              result_url:'https://example.org/other'+i,result_title:'기타 문서 '+i}));
            arr[t-1]={block_type:'WEB',result_url:target,result_title:'실험 글'};
            arr[c-1]={block_type:'WEB',result_url:control,result_title:'대조 글'};
            return arr;
          }
          const data=[
            ['experiment-b1','2026-11-01T00:00:00Z',3,1],
            ['experiment-b2','2026-11-02T00:00:00Z',3,1],
            ['experiment-a1','2026-11-04T00:00:00Z',1,2],
            ['experiment-a2','2026-11-05T00:00:00Z',1,2]
          ];
          for(const [id,captured_at,t,c] of data)await saveSearch({id,captured_at,query:'실험 키워드',device:'PC',
            sourceURL:'https://search.naver.com/search.naver?query=test',rows:rows(t,c)});
        }""")
        page.reload()
        page.wait_for_function("document.getElementById('search-count')?.textContent==='5'")
        page.locator('#exp-title').fill('제목 수정 대조군 실험')
        page.locator('#exp-query').fill('실험 키워드')
        page.locator('#exp-target-url').fill('https://example.org/target')
        page.locator('#exp-control-urls').fill('https://example.org/control')
        page.locator('#exp-changed-at').fill('2026-11-03T12:00')
        page.locator('#exp-change-note').fill('제목만 변경하고 대조 문서는 유지')
        page.locator('#exp-controls-unchanged').check()
        page.locator('#exp-save').click()
        page.wait_for_function("document.querySelector('#exp-select')?.selectedIndex>0")
        page.locator('#exp-run').click()
        assert page.locator('#exp-summary .exp-metric').count()==6
        assert '대조군 대비 상대 변화' in page.locator('#exp-summary').inner_text()
        assert '3' in page.locator('#exp-summary').inner_text()
        assert page.locator('#exp-evidence .exp-evidence-group').count()==2
        with page.expect_download() as exp_json:
            page.locator('#exp-export-json').click()
        assert exp_json.value.suggested_filename=='naver-rank-experiment-evidence.json'
        with page.expect_download() as exp_txt:
            page.locator('#exp-export-txt').click()
        assert exp_txt.value.suggested_filename=='naver-rank-experiment-report.txt'
        page.locator('#exp-delete').click()
        page.wait_for_function("document.querySelector('#exp-select')?.options.length===1")
        assert not errors,errors
        print('INTELLIGENCE DASHBOARD SMOKE PASS')
        ctx.close()
        browser.close()
finally:
    server.shutdown()
