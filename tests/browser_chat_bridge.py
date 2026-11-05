"""Offline Chrome-like integration test: private GitHub bridge, a user-approved job and article export."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
import json,os
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
fixture=(ROOT/'tests/fixtures/sample_pc_선불폰_개통.html').read_text('utf-8')
article=(ROOT/'tests/fixtures/chat_bridge_blog.html').read_text('utf-8')
inspector=(ROOT/'extension/chat-bridge-inspector.js').read_text('utf-8').replace(
    'export function inspectNaverArticle','function inspectNaverArticle'
)
try:
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('SERP_CHROME_PATH') or None,args=['--no-sandbox'])
    ctx=browser.new_context(accept_downloads=True)
    ctx.add_init_script(script="""({fixture})=>{
      const job={
        schema:'naver-chat-job-v1',job_id:'20261105T093000Z-aabbccdd',mode:'search_and_read',
        query:'선불폰 개통',device:'PC',max_articles:2,
        requested_at:new Date().toISOString()
      };
      window.__bridge_uploaded=null;
      const oldFetch=window.fetch.bind(window);
      function respond(body,status=200){
        return new Response(JSON.stringify(body),{
          status,headers:{'content-type':'application/json'}
        });
      }
      function b64(str){
        return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
      }
      window.fetch=async(url,opts={})=>{
        if(!String(url).startsWith('https://api.github.com/repos/'))return oldFetch(url,opts);
        const path=String(url),method=opts.method||'GET';
        if(path==='https://api.github.com/repos/prepaid1215/private-research')
          return respond({private:true,full_name:'prepaid1215/private-research',archived:false});
        if(path.includes('/contents/bridge/requests?'))
          return respond([{type:'file',name:job.job_id+'.json'}]);
        if(path.includes('/contents/bridge/results?'))
          return respond(window.__bridge_uploaded?[{type:'file',name:job.job_id+'.json'}]:[]);
        if(path.includes('/contents/bridge/requests/'))
          return respond({type:'file',encoding:'base64',content:b64(JSON.stringify(job))});
        if(path.includes('/contents/bridge/results/')){
          if(method==='GET')return window.__bridge_uploaded?respond({content:{sha:'done'}}):respond({},404);
          if(method==='PUT'){
            const req=JSON.parse(opts.body);
            window.__bridge_uploaded=JSON.parse(new TextDecoder().decode(
              Uint8Array.from(atob(req.content),s=>s.charCodeAt(0))));
            return respond({content:{sha:'saved-from-browser'}},201);
          }
        }
        return respond({unexpected:path},500);
      };
      let nextId=100;
      window.chrome={
        permissions:{request:async()=>true},
        tabs:{
          create:async({url})=>{window.__openUrl=url;return {id:++nextId,url,status:'complete'};},
          get:async(id)=>({id,status:'complete'}),
          remove:async()=>{},
          onUpdated:{addListener:()=>{},removeListener:()=>{}}
        },
        scripting:{
          executeScript:async({func})=>{
            if(func.name==='inspectNaverArticle')
              return [{result:{
                article_url:window.__openUrl,title:'선불폰 블로그 본문',
                text:'본인명의 선불폰 개통 방법을 설명합니다. '.repeat(20),
                headings:['유심 준비','신청 과정'],images:2,
                content_confidence:'medium',fetch_status:'ok',scored_length:10400
              }}];
            return [{result:{url:window.__openUrl,html:fixture,title:'선불폰 개통 검색'}}];
          }
        }
      };
    }""".replace('({fixture})=>','({fixture})=>') )
    # Supply fixture through a separate seeded init script to avoid JS string interpolation.
    ctx.add_init_script(script="window.__testFixture="+json.dumps(fixture,ensure_ascii=False)+";")
    # The above mock takes an argument, but init scripts are invoked without args.
    # Define a compatible wrapper around the injected function.
    page=ctx.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(origin+'/extension/chat-bridge.html')
    page.locator('#bridge-repo').fill('prepaid1215/private-research')
    page.locator('#bridge-token').fill('test-session-secret')
    page.locator('#bridge-connect').click()
    expect(page.locator('#bridge-jobs .bridge-job')).to_have_count(1,timeout=10000)
    assert '선불폰 개통' in page.locator('#bridge-jobs').inner_text()
    assert page.locator('#bridge-token').input_value()==''
    page.locator('#bridge-jobs button').click()
    expect(page.locator('#bridge-preview .bridge-article')).to_have_count(2,timeout=16000)
    assert page.locator('#bridge-upload').is_disabled()
    page.locator('#bridge-approve').check()
    page.locator('#bridge-upload').click()
    page.wait_for_function("Boolean(window.__bridge_uploaded)",timeout=10000)
    uploaded=page.evaluate('window.__bridge_uploaded')
    assert uploaded['schema']=='naver-chat-bridge-v1'
    assert uploaded['query']=='선불폰 개통'
    assert len(uploaded['articles'])==2
    assert uploaded['articles'][0]['text']
    assert 'test-session-secret' not in json.dumps(uploaded)
    assert page.locator('#bridge-jobs').get_by_text('완료').count()>=1
    assert not errors,errors
    print('CHAT BRIDGE GITHUB QUEUE MOCK CHROMIUM PASS')
    ctx.close();browser.close()
finally:
  server.shutdown()
