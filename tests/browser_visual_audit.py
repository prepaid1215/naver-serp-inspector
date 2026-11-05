"""Offline Chromium end-to-end screen verification; not a live Naver ranking test."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
import base64, json, os
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=os.environ.get('SERP_CHROME_PATH') or None,args=['--no-sandbox'])
        ctx=browser.new_context(viewport={'width':900,'height':700},device_scale_factor=1,accept_downloads=True)
        page=ctx.new_page()
        errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(origin+'/tests/fixtures/visual_serp_fixture.html')
        geometry=page.evaluate("""async()=>{
          const {inspectVisibleSearch}=await import('/extension/visual-viewport.js');
          return inspectVisibleSearch();
        }""")
        assert geometry['root_used']=='#main_pack',geometry
        assert geometry['root_fallback'] is False
        assert len(geometry['candidates'])==3,geometry['candidates']
        assert [r['type_hint'] for r in geometry['candidates']]==['AD','BLOG','WEB']
        assert geometry['candidates'][0]['y']<geometry['candidates'][1]['y']<geometry['candidates'][2]['y']
        png=base64.b64encode(page.screenshot(full_page=False)).decode()
        page.evaluate("""async({geometry,png})=>{
          const {saveVisualAudit}=await import('/extension/visual-store.js');
          const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
          await saveVisualAudit({
            id:'offline-visual-test',captured_at:'2026-11-05T06:00:00Z',
            ...geometry,
            query:'선불폰 개통',
            source_url:'https://search.naver.com/search.naver?query=test',
            url_device:'PC',layout_device:'데스크톱 너비',
            screenshot_png:bytes,screenshot_image_size:{width:900,height:700},
            capture_moved:false,screenshot_dimension_mismatch:false,
            reviews:{},added:[],checked_complete:false,
            parsed_rows:[
              {block_type:'AD',result_url:'https://ads.example.org/paid'},
              {block_type:'BLOG',result_url:'https://blog.naver.com/tester/12345'},
              {block_type:'WEB',result_url:'https://www.example.org/guide'}
            ]
          });
        }""",{'geometry':geometry,'png':png})
        page.goto(origin+'/extension/visual-audit.html?audit=offline-visual-test')
        expect(page.locator('.candidate-card')).to_have_count(3)
        expect(page.locator('.candidate-rect')).to_have_count(3)
        assert page.locator('#screenshot').evaluate('(img)=>img.naturalWidth')==900
        assert '검수 미완료' in page.locator('#audit-status').inner_text()
        for i in range(3):
            page.locator('.candidate-card').nth(i).locator('select').first.select_option('confirmed')
        expect(page.locator('#count-confirmed')).to_have_text('3')
        expect(page.locator('.block-item')).to_have_count(3)
        page.locator('#show-blocks').check()
        expect(page.locator('.block-rect')).to_have_count(3)
        for i in range(3):
            page.locator('.block-item').nth(i).locator('select').first.select_option('confirmed')
        page.locator('#audit-complete').check()
        expect(page.locator('#audit-status')).to_contain_text('확정했습니다')
        with page.expect_download() as json_download:
            page.locator('#download-json').click()
        path=json_download.value.path()
        report=json.loads(Path(path).read_text('utf-8'))
        assert report['report']['verified_viewport'] is True
        assert report['report']['counts']['parser_matched']==3
        assert [r['actual_type'] for r in report['report']['visible_items']]==['AD','BLOG','WEB']
        with page.expect_download() as png_download:
            page.locator('#download-image').click()
        assert png_download.value.suggested_filename.endswith('.png')
        page.locator('#pick-location').click()
        page.locator('#screenshot').click(position={'x':100,'y':320})
        page.locator('#missing-title').fill('화면에서 수동으로 확인한 누락 제목')
        page.locator('#missing-type').select_option('NEWS')
        page.locator('#add-missing').click()
        expect(page.locator('#count-missed')).to_have_text('1')
        assert '검수 미완료' in page.locator('#audit-status').inner_text()
        page.locator('#audit-complete').check()
        expect(page.locator('#audit-status')).to_contain_text('확정했습니다')
        page.wait_for_function("""async()=>{
          const {readVisualAudit}=await import('/extension/visual-store.js');
          return (await readVisualAudit('offline-visual-test'))?.added?.length===1;
        }""")
        page.reload()
        expect(page.locator('#count-missed')).to_have_text('1')
        expect(page.locator('#audit-status')).to_contain_text('확정했습니다')
        assert not errors,errors
        print('VISUAL SERP AUDIT CHROMIUM E2E PASS')
        ctx.close();browser.close()
finally:
    server.shutdown()
