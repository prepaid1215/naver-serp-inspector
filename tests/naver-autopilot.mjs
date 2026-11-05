import assert from 'node:assert/strict';
import {
  JOB_LABEL,JOB_RESULT_MARKER,jobIssueBody,parseNaverJob,
  naverSearchURL,validNaverArticleURL,pickNaverArticles
} from '../extension/naver-autopilot-core.js';

const issue={number:42,state:'open',labels:[{name:JOB_LABEL}],
  body:jobIssueBody('396 요금제',2)};
assert.deepEqual(parseNaverJob(issue),{issue_number:42,query:'396 요금제',limit:2});
assert.match(naverSearchURL('396 요금제'),/^https:\/\/search\.naver\.com\/search\.naver\?/);
for(const invalid of [
 {...issue,labels:[]},{...issue,body:'<script>alert(1)</script>'},
 {...issue,body:'SERP_LENS_JOB_V1\n{"query":"abc","limit":99}'},
 {...issue,body:'SERP_LENS_JOB_V1\n{"query":"abc","limit":2,"url":"https://evil.example"}'}
])assert.throws(()=>parseNaverJob(invalid));
assert.equal(validNaverArticleURL('https://example.com/a'),null);
assert.equal(validNaverArticleURL('http://blog.naver.com/test/1'),null);
assert.equal(validNaverArticleURL('https://blog.naver.com.evil.com/test/1'),null);
assert.equal(validNaverArticleURL('https://blog.naver.com/test/12345'),null);
assert.equal(validNaverArticleURL('https://blog.naver.com/test'),null);
assert.equal(validNaverArticleURL('https://cafe.naver.com/example'),null);
assert.equal(validNaverArticleURL('https://blog.naver.com/test/224465527655'),'https://blog.naver.com/test/224465527655');
assert.equal(validNaverArticleURL('https://cafe.naver.com/example/8551'),'https://cafe.naver.com/example/8551');
assert.equal(validNaverArticleURL('https://blog.naver.com/PostView.naver?blogId=test&logNo=224465527655'),
  'https://blog.naver.com/PostView.naver?blogId=test&logNo=224465527655');
const chosen=pickNaverArticles([
  {type:'WEB',url:'https://example.com/other',title:'other'},
  {type:'BLOG',url:'https://blog.naver.com/demo',title:'블로그 프로필'},
  {type:'CAFE',url:'https://cafe.naver.com/example',title:'카페 메인'},
  {type:'BLOG',url:'https://blog.naver.com/demo/224465527655',title:'post'},
  {type:'BLOG',url:'https://blog.naver.com/demo/224465527655',title:'duplicate'},
  {type:'CAFE',url:'https://cafe.naver.com/example/12345',title:'cafe'},
  {type:'BLOG',url:'https://blog.naver.com/demo/224465548044',title:'third'}
],2);
assert.equal(chosen.length,2);
assert.equal(chosen[0].type,'BLOG');
assert.equal(chosen[1].type,'CAFE');

const local={},session={'serp-lens-chat-bridge-token':'test-private-token'};
let listener,alarmListener,tabId=10;
const tabs=new Map();
const urls=[],requests=[],files=new Map();
const history=[];
function storage(store){return{
  get:async keys=>{
    const names=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys||{});
    return Object.fromEntries(names.map(k=>[k,store[k]]));
  },
  set:async obj=>Object.assign(store,obj),
  remove:async key=>{delete store[key];}
};}
globalThis.chrome={
  storage:{local:storage(local),session:storage(session)},
  runtime:{
    onInstalled:{addListener(){}},onStartup:{addListener(){}},
    onMessage:{addListener(fn){listener=fn;}}
  },
  alarms:{create:async()=>{},onAlarm:{addListener(fn){alarmListener=fn;}}},
  tabs:{
    create:async ({url,active})=>{
      assert.equal(active,false);
      urls.push(url);tabs.set(++tabId,{url,status:'complete'});
      return {id:tabId};
    },
    get:async id=>tabs.get(id),
    remove:async id=>{tabs.delete(id);}
  },
  scripting:{
    executeScript:async ({target,func})=>{
      const tab=tabs.get(target.tabId);
      if(func.name==='collectNaverSearchDOM')return [{result:{
        source_url:tab.url,query:'396 요금제',rows:[
          {url:'https://blog.naver.com/demo',title:'인용 블로그 프로필',type:'BLOG',headline_hint:true},
          {url:'https://cafe.naver.com/demo',title:'인용 카페 프로필',type:'CAFE',headline_hint:true},
          {url:'https://blog.naver.com/demo/10000000',title:'396 요금제 글',type:'BLOG',headline_hint:true},
          {url:'https://cafe.naver.com/demo/20000000',title:'396 요금제 카페',type:'CAFE',headline_hint:true},
          {url:'https://evil.example/redirect',title:'잘못된 링크',type:'BLOG'}
        ]}}];
      if(func.name==='extractOpenArticle')return [{result:{
        url:tab.url,source_frame:tab.url,title:'396 요금제 본문 테스트',
        text:'네이버 공개 게시글 본문 내용입니다. '.repeat(12),
        extraction_quality:'article',source_kind:tab.url.includes('blog.naver.com')?'NAVER_BLOG':'NAVER_CAFE',
        headings:[{level:'H2',text:'가입 절차'}],images:1,score:44000
      }}];
      throw Error('unexpected injected function: '+func.name);
    }
  }
};
function reply(status,json){
  return {ok:status>=200&&status<300,status,json:async()=>json};
}
globalThis.fetch=async (url,opts={})=>{
  const method=opts.method||'GET';requests.push({url,method});
  assert.equal(opts.headers.Authorization,'Bearer test-private-token');
  if(method==='GET'&&/\/repos\/demo\/private-evidence$/.test(url))
    return reply(200,{private:true,default_branch:'main',permissions:{push:true}});
  if(method==='GET'&&/\/labels\?per_page=100$/.test(url))
    return reply(200,[{name:JOB_LABEL}]);
  if(method==='GET'&&/\/issues\?/.test(url)){
    return reply(200,history.length?[]:[issue]);
  }
  if(method==='GET'&&url.includes('/contents/')){
    if(!files.has(url.split('?')[0]))return reply(404,{message:'Not Found'});
    return reply(200,{type:'file',sha:'existing',content:files.get(url.split('?')[0])});
  }
  if(method==='PUT'&&url.includes('/contents/')){
    const payload=JSON.parse(opts.body);
    files.set(url, payload.content);
    return reply(201,{content:{sha:'created'}});
  }
  if(method==='POST'&&url.endsWith('/issues/42/comments')){
    const obj=JSON.parse(opts.body);
    assert.ok(obj.body.startsWith(JOB_RESULT_MARKER));
    const p=JSON.parse(obj.body.split('\n').slice(1).join('\n'));
    assert.equal(p.status,'completed');
    assert.equal(p.captured_articles,2);
    assert.equal(p.search_candidates,5);
    assert.equal(p.paths.length,3);
    history.push(p);
    return reply(201,{id:123});
  }
  if(method==='PATCH'&&url.endsWith('/issues/42')){
    assert.equal(JSON.parse(opts.body).state,'closed');
    return reply(200,{state:'closed'});
  }
  throw Error('Unexpected GitHub request '+method+' '+url);
};
await import('../extension/naver-autopilot-background.js');
function send(type,data={}){
  return new Promise((resolve,reject)=>{
    const ok=listener({type,...data},null,resolve);
    if(ok!==true)reject(Error('background response not registered'));
  });
}
let r=await send('AUTOPILOT_STATUS');
assert.equal(r.enabled,false);
r=await send('AUTOPILOT_CHECK_NOW');
assert.equal(r.ok,false);
assert.equal(urls.length,0);
r=await send('AUTOPILOT_ENABLE',{repository:'demo/private-evidence'});
assert.equal(r.ok,true);
r=await send('AUTOPILOT_CHECK_NOW');
assert.equal(r.ok,true,JSON.stringify(r));
assert.equal(r.result.captured_articles,2);
assert.equal(urls.length,3);
assert.ok(urls.every(u=>u.startsWith('https://search.naver.com/')||
  u.startsWith('https://blog.naver.com/')||u.startsWith('https://cafe.naver.com/')));
assert.equal(files.size,4); // 1 result list + 2 posts + 1 index
assert.equal(history.length,1);
assert.equal(local['serp-autopilot-processed-v1'].numbers[0],42);
r=await send('AUTOPILOT_CHECK_NOW');
assert.equal(r.processed,0);
assert.equal(urls.length,3);
r=await send('AUTOPILOT_DISABLE');
assert.equal(r.ok,true);
assert.equal((await send('AUTOPILOT_STATUS')).enabled,false);
console.log('CHAT-DRIVEN NAVER BROWSER AUTOPILOT TESTS PASS');
