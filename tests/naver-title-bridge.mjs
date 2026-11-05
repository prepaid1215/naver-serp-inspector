import assert from 'node:assert/strict';
import {JOB_LABEL,JOB_RESULT_MARKER,titleCompareIssueBody} from '../extension/naver-autopilot-core.js';

const issue={number:77,state:'open',labels:[{name:JOB_LABEL}],
  body:titleCompareIssueBody(['KT 바로유심 개통','바로유심 개통방법'],2)};
const local={},session={'serp-lens-chat-bridge-token':'test-private-token'};
let messageListener,tabId=30;
const tabs=new Map(),urls=[],writes=[],results=[];
const store=obj=>({
  get:async keys=>{
    const names=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys||{});
    return Object.fromEntries(names.map(k=>[k,obj[k]]));
  },
  set:async data=>Object.assign(obj,data)
});
globalThis.chrome={
  storage:{local:store(local),session:store(session)},
  runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},
    onMessage:{addListener(fn){messageListener=fn;}}},
  alarms:{create:async()=>{},onAlarm:{addListener(){}}},
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
      const url=tabs.get(target.tabId).url;
      if(func.name==='collectNaverSearchDOM'){
        const query=new URL(url).searchParams.get('query');
        return [{result:{
          source_url:url,query,observed_at:'2026-11-05T07:00:00Z',
          position_basis:'approximate_document_y_order_of_detected_links',
          viewport:{width:1200,height:900,scroll_y:0},
          rows:[
            {type:'BLOG',url:'https://blog.naver.com/demo/224465859329?track='+query,
              title:'KT 바로유심 개통 후기',visible_title:'KT 바로유심 개통 후기',
              title_confidence:'high',title_source:'headline_anchor',
              is_article_link:true,document_visual_order:1,source_visual_order:1,y:200},
            {type:'CAFE',url:'https://cafe.naver.com/dowajo/1614530?art='+query,
              title:'바로유심 비용과 신청 방법',visible_title:'바로유심 비용과 신청 방법',
              title_confidence:'heuristic',title_source:'nearby_card_heading',
              is_article_link:true,document_visual_order:2,source_visual_order:1,y:350}
          ]
        }}];
      }
      if(func.name==='extractOpenArticle')return [{result:{
        url,source_frame:url,title:url.includes('blog.naver')?
          'KT 바로유심 개통 후기':'바로유심 비용과 신청 방법',
        text:'네이버 게시글의 유효한 본문이 검색어 비교를 위해 수집됐습니다. '.repeat(5),
        clean_text:'네이버 게시글의 유효한 본문이 검색어 비교를 위해 수집됐습니다. '.repeat(5),
        extraction_quality:'article',
        source_kind:url.includes('blog.naver')?'NAVER_BLOG':'NAVER_CAFE',
        headings:[],images:1,score:30000
      }}];
      throw Error('unexpected extraction function '+func.name);
    }
  }
};
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
globalThis.fetch=async(url,opts={})=>{
  const method=opts.method||'GET';
  assert.equal(opts.headers.Authorization,'Bearer test-private-token');
  if(method==='GET'&&/\/repos\/demo\/private-evidence$/.test(url))
    return response(200,{private:true,default_branch:'main',permissions:{push:true}});
  if(method==='GET'&&url.endsWith('/labels?per_page=100'))
    return response(200,[{name:JOB_LABEL}]);
  if(method==='GET'&&url.includes('/issues?'))
    return response(200,results.length?[]:[issue]);
  if(method==='GET'&&url.includes('/issues/77/comments?'))
    return response(200,results.map(result=>({body:JOB_RESULT_MARKER+'\n'+JSON.stringify(result)})));
  if(method==='GET'&&url.includes('/contents/'))
    return response(404,{message:'Not Found'});
  if(method==='PUT'&&url.includes('/contents/')){
    const obj=JSON.parse(opts.body);assert.ok(obj.content);
    writes.push({url,content:obj.content});
    return response(201,{content:{sha:'generated'}});
  }
  if(method==='POST'&&url.endsWith('/issues/77/comments')){
    const result=JSON.parse(JSON.parse(opts.body).body.split('\n').slice(1).join('\n'));
    assert.equal(result.mode,'title_compare');
    assert.equal(result.status,'completed',JSON.stringify(result));
    assert.deepEqual(result.queries,['KT 바로유심 개통','바로유심 개통방법']);
    assert.equal(result.query_comparison.overlaps[0].shared_article_candidates,2);
    assert.equal(result.query_comparison.repeated_article_count,2);
    assert.equal(result.captured_articles,2);
    assert.equal(result.paths.length,4); // 2 searches + 2 posts
    assert.ok(result.article_summaries.every(x=>x.observed_queries.length===2));
    results.push(result);
    return response(201,{id:123});
  }
  if(method==='PATCH'&&url.endsWith('/issues/77')){
    assert.equal(JSON.parse(opts.body).state,'closed');
    return response(200,{state:'closed'});
  }
  throw Error('Unexpected '+method+' '+url);
};
await import('../extension/naver-autopilot-background.js');
function send(type,extra={}){
  return new Promise((resolve,reject)=>{
    const ok=messageListener({type,...extra},null,resolve);
    if(ok!==true)reject(Error('listener missing'));
  });
}
assert.equal((await send('AUTOPILOT_ENABLE',{repository:'demo/private-evidence'})).ok,true);
const r=await send('AUTOPILOT_CHECK_NOW');
assert.equal(r.ok,true,JSON.stringify(r));
assert.equal(r.result.mode,'title_compare');
assert.equal(urls.filter(x=>x.startsWith('https://search.naver.com')).length,2);
assert.equal(writes.length,5); // 2 searches + 2 posts + index
assert.equal(results.length,1);
console.log('NAVER TITLE MULTI-QUERY GITHUB BRIDGE TESTS PASS');
