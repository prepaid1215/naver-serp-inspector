"""Offline regression: Naver's 2026 FDS single-card .api_subject_bx markup."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
FIX=(ROOT/'tests/fixtures/synthetic_fds_2026.html').read_text(encoding='utf-8')
SOURCE=(ROOT/'web/engine.js').read_text(encoding='utf-8').replace('export ','')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('SERP_CHROME_PATH') or None,args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content('<html><body>Parser synthetic test</body></html>')
    page.add_script_tag(content=SOURCE)
    result=page.evaluate('(html)=>parseSERP(html,{filename:"20261015-1711_pc_선불폰 개통.html",domains:["59man.shop"]})',FIX)
    rows=result['rows']
    print('FDS test rows:',[(r['block_order'],r['rank_in_block'],r['block_type'],r['result_title']) for r in rows])
    assert len(rows)==6,rows
    assert [r['block_type'] for r in rows]==['AD','AD','CAFE','CAFE','BLOG','WEB'],rows
    assert [r['block_order'] for r in rows]==[1,1,2,2,3,3],rows
    assert [r['rank_in_block'] for r in rows]==[1,2,1,2,1,2],rows
    assert rows[-1]['result_title']=='선불폰 개통',rows[-1]
    groups=page.evaluate('(html)=>groupBlocks(parseSERP(html,{filename:"input.html"}))',FIX)
    assert len(groups)==3,groups
    assert groups[-1]['inferred_type']=='MIXED',groups
    assert groups[-1]['type_breakdown']=='BLOG 1 · WEB 1',groups
    assert rows[-1]['is_target']=='Y',rows[-1]
    assert result['meta']['device']=='PC'
    print('Naver FDS synthetic regression PASS')
    browser.close()
