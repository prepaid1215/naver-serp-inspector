"""Offline Chromium integration test for popup -> IndexedDB -> dashboard.

Chrome extension management is blocked in some CI containers. To test the same
JavaScript, serve a temporary copy via localhost, mock only chrome's host APIs,
and replace only the extension protocol check in that TEMPORARY test copy.
No request to Naver or any other external website is made.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
import os, tempfile, shutil, base64
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
TEMP=Path(tempfile.mkdtemp(prefix='serp-lens-browser-e2e-'))
for folder in ['web','extension']:
    shutil.copytree(ROOT/folder,TEMP/folder)
app=TEMP/'web/app.js'
code=app.read_text('utf-8')
assert "location.protocol!=='chrome-extension:'" in code
app.write_text(code.replace("location.protocol!=='chrome-extension:'","location.protocol!=='http:'"),'utf-8')
fixture=(ROOT/'tests/fixtures/sample_pc_선불폰_개통.html').read_text('utf-8')
PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yHKoAAAAASUVORK5CYII='

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(TEMP)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'

try:
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('SERP_CHROME_PATH') or None,args=['--no-sandbox'])
    ctx=browser.new_context(accept_downloads=True)
    mock='''({origin,fixture,png})=>{
      const navURL='https://search.naver.com/search.naver?query=%EC%84%A0%EB%B6%88%ED%8F%B0+%EA%B0%9C%ED%86%B5';
      window.__newTabURL='';
      window.chrome={
        tabs:{
          query:async()=>[{id:101,windowId:1,url:navURL}],
          captureVisibleTab:async()=>`data:image/png;base64,${png}`,
          create:async({url})=>{window.__newTabURL=url;}
        },
        scripting:{executeScript:async()=>[{result:{html:fixture,url:navURL,title:'선불폰 개통 : 네이버 검색'}}]},
        runtime:{getURL:(path)=>`${origin}/${path}`}
      };
    }'''
    ctx.add_init_script(script=f'({mock})({{origin:{origin!r},fixture:{fixture!r},png:{PNG!r}}})')
    popup=ctx.new_page(); errors=[]
    popup.on('pageerror',lambda e: errors.append('popup: '+str(e)))
    popup.goto(f'{origin}/extension/popup.html')
    popup.wait_for_function("document.getElementById('capture')?.disabled===false")
    assert popup.locator('#query').inner_text()=='선불폰 개통'
    popup.locator('#capture').click()
    popup.wait_for_function("Boolean(window.__newTabURL)")
    opened=popup.evaluate('window.__newTabURL')
    assert 'serp_lens_capture=latest' in opened
    analysis=ctx.new_page();analysis.on('pageerror',lambda e: errors.append('dashboard: '+str(e)))
    analysis.goto(f'{origin}/web/index.html?serp_lens_capture=latest')
    analysis.wait_for_function("document.querySelector('#metric-files')?.textContent==='1'",timeout=15000)
    assert int(analysis.locator('#metric-results').inner_text()) >= 5
    assert analysis.locator('#extension-evidence').is_visible()
    assert analysis.locator('#section-blocks .section-block').count() >= 4
    analysis.locator('#domains').fill('59man.shop')
    analysis.locator('#analyze').click()
    analysis.wait_for_function("document.querySelector('#metric-target')?.textContent==='1'",timeout=10000)
    with analysis.expect_download() as info:
        analysis.locator('#save-extension-html').click()
    assert info.value.suggested_filename=='20261015-1630_pc_선불폰 개통.html' or info.value.suggested_filename.endswith('_pc_선불폰 개통.html')
    with analysis.expect_download() as info:
        analysis.locator('#save-extension-png').click()
    assert info.value.suggested_filename.endswith('_pc_선불폰 개통.png')
    analysis.locator('#erase-extension-capture').click()
    analysis.wait_for_function('document.getElementById("save-extension-html").disabled')
    stored=analysis.evaluate('''async()=>{
      const {readCapture}=await import('../extension/capture-store.js');
      return Boolean(await readCapture('latest'));
    }''')
    assert not stored
    assert not errors,errors
    print('EXTENSION MOCK CHROME BROWSER E2E PASS',{'results':analysis.locator('#metric-results').inner_text(),'target_matches':analysis.locator('#metric-target').inner_text(),'download_html':True,'download_png':True})
    ctx.close();browser.close()
finally:
  server.shutdown()
