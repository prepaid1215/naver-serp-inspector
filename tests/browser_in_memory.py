"""In-memory browser smoke test: no localhost navigation or external requests."""
from pathlib import Path
import re,json,os,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'web/index.html').read_text()
html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', '', html)
html=re.sub(r'<link rel="stylesheet"[^>]+>', '', html)
html=re.sub(r'<script type="module"[^>]+></script>', '', html)
css=(ROOT/'web/style.css').read_text()
code='\n'.join((ROOT/'web'/name).read_text().replace('export ','') for name in ('engine.js','zip.js'))
app=(ROOT/'web/app.js').read_text()
app=re.sub(r'^import .*?;\s*','',app,flags=re.M)
code+='\n'+app
FIX=ROOT/'tests/fixtures/sample_pc_선불폰_개통.html'
ZIP=ROOT/'tests/fixtures/sample_zip.zip'
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path=os.environ.get('SERP_CHROME_PATH') or None,args=['--no-sandbox'])
    page=b.new_page(viewport={'width':1350,'height':900},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    page.evaluate("Object.defineProperty(window.crypto, 'subtle', {value: {digest: async () => new Uint8Array(32).buffer}})")
    page.add_style_tag(content=css)
    page.add_script_tag(content=code)
    assert page.locator('h1').inner_text()=='검색 화면을 데이터로.'
    page.locator('#files').set_input_files(str(FIX))
    page.locator('#analyze').click()
    page.wait_for_function("document.querySelector('#metric-files')?.textContent==='1'")
    print('HTML metrics:',{x:page.locator('#'+x).inner_text() for x in ['metric-files','metric-results','metric-target']})
    print('row types:',page.locator('#rows').inner_text()[:270])
    print('status',page.locator('#status').inner_text())
    # Screenshot output optional; do not place it in the public source tree.
    assert int(page.locator('#metric-results').inner_text())>=5
    assert page.locator('#metric-target').inner_text()=='1'
    assert page.locator('#rows').get_by_text('NEWS').count()>0
    page.locator('#files').set_input_files(str(ZIP))
    page.locator('#analyze').click()
    page.wait_for_function("document.querySelector('#metric-files')?.textContent==='2'")
    print('ZIP metrics:',{x:page.locator('#'+x).inner_text() for x in ['metric-files','metric-results','metric-target']})
    assert int(page.locator('#metric-results').inner_text())>=10
    assert not errors,errors
    page.set_viewport_size({'width':390,'height':844})
    # Mobile layout can be rendered in the same document.
    print('BROWSER IN-MEMORY SMOKE PASS')
    b.close()
