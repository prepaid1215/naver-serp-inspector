"""Fake pywebview bridge smoke test; no Naver/network/Windows GUI required."""
from pathlib import Path
import base64
import os
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'web/index.html').read_text()
html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', '',html)
html=re.sub(r'<link rel="stylesheet"[^>]+>', '',html)
html=re.sub(r'<script type="module"[^>]+></script>', '',html)
source='\n'.join((ROOT/'web'/f).read_text().replace('export ','') for f in ('engine.js','zip.js','desktop-ui.js'))
app=(ROOT/'web/app.js').read_text()
source+='\n'+re.sub(r'^import .*?;\s*','',app,flags=re.M)
fixture=(ROOT/'tests/fixtures/sample_pc_선불폰_개통.html').read_bytes()
encoded=base64.b64encode(fixture).decode('ascii')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('SERP_CHROME_PATH') or None,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1350,'height':900})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html)
 page.add_style_tag(content=(ROOT/'web/style.css').read_text())
 page.evaluate('''(file)=>{
  Object.defineProperty(window.crypto,'subtle',{value:{digest:async()=>new Uint8Array(32).buffer}});
  window.__collectState='idle';
  window.pywebview={api:{
    start_collect:async(words,modes)=>{window.__words=words;window.__modes=modes;window.__collectState='completed';return {ok:true,run_id:'fake-run'};},
    collect_status:async()=>({state:window.__collectState,completed:1,total:1,message:'모의 수집 완료',run_id:window.__collectState==='completed'?'fake-run':'',files:window.__collectState==='completed'?['20261015-1500_pc_선불폰 개통.html']:[],folder:'C:\\\\Temp\\\\SERP-Lens'}),
    read_collected_html:async(name)=>({name,base64:file}),
    stop_collect:async()=>({ok:true}),open_run_folder:async()=>({ok:true})
  }};
 }''',encoded)
 page.add_script_tag(content=source)
 assert page.locator('#desktop-collector').is_visible()
 page.locator('#domains').fill('59man.shop')
 page.locator('#collect-keywords').fill('선불폰 개통')
 page.locator('#collect-mo').uncheck()
 page.locator('#collect-start').click()
 page.wait_for_function("document.querySelector('#metric-files')?.textContent==='1'",timeout=20000)
 assert page.locator('#metric-results').inner_text()=='5'
 assert page.evaluate('window.__words')==['선불폰 개통']
 assert page.evaluate('window.__modes')==['pc']
 assert page.locator('#section-blocks .section-block').count()>=3
 assert not errors,errors
 print('WINDOWS MOCK BRIDGE -> FILE -> ANALYSIS PASS')
 b.close()
