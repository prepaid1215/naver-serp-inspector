import assert from 'node:assert/strict';
import {collectNaverSearchDOM} from '../extension/naver-autopilot-search.js';
import {prepareSharedRecord,updateEvidenceIndex} from '../extension/github-evidence-sync.js';

globalThis.location={href:'https://search.naver.com/search.naver?where=nexearch&query='+encodeURIComponent('휴대폰 미납정지')};
globalThis.scrollY=0;globalThis.scrollX=0;
globalThis.innerWidth=1200;globalThis.innerHeight=900;
globalThis.getComputedStyle=()=>({display:'block',visibility:'visible'});
function element(tag,klass,text,top=0){
  return {tagName:tag,className:klass,innerText:text,textContent:text,
    parentElement:null,href:null,
    getBoundingClientRect(){return {top,left:20,width:220,height:24};},
    closest(){return null;},querySelector(){return null;},querySelectorAll(){return []}};
}
function page(label){
  const root=element('DIV','main_pack','');
  const sectionA=element('SECTION','sc_new','',30);
  const sectionB=element('SECTION','sc_new','',400);
  const aHeader=label?element('H2','api_title',label,35):null;
  const bHeader=element('H2','api_title','블로그 인기글',405);
  const titleA='정지폰 실제 이용 후기';
  const titleB='개통 절차 정리';
  function article(section,url,title,top){
    const card=element('DIV','result_card',title+' 실제 방문 가능한 매장과 개통 준비 설명입니다.',top-5);
    const anchor=element('A','total_tit',title,top);
    anchor.href=url;anchor.parentElement=card;card.parentElement=section;
    card.querySelectorAll=selector=>selector==='a[href]'?[anchor]:[];
    return {anchor,card};
  }
  const a=article(sectionA,'https://blog.naver.com/demo/224465859329',titleA,100);
  const b=article(sectionB,'https://cafe.naver.com/demo/1654321',titleB,470);
  sectionA.querySelectorAll=selector=>selector==='a[href]'?[a.anchor]:aHeader?[aHeader]:[];
  sectionB.querySelectorAll=selector=>selector==='a[href]'?[b.anchor]:[bHeader];
  root.querySelectorAll=selector=>selector==='a[href]'?[a.anchor,b.anchor]:[];
  globalThis.document={
    title:'네이버 검색',readyState:'complete',
    querySelector(selector){return selector==='#main_pack'?root:null}
  };
  return collectNaverSearchDOM();
}
const found=page('실사용 후기와 경험담');
assert.equal(found.rows.length,2);
assert.equal(found.rows[0].block_kind,'EXPERIENCE_REVIEW_CANDIDATE');
assert.equal(found.rows[0].block_label,'실사용 후기와 경험담');
assert.equal(found.rows[1].block_kind,'GENERAL_UGC_CANDIDATE');
assert.equal(found.ugc_observation.state,'candidate_observed');
assert.equal(found.ugc_observation.candidate_block_count,1);
assert.equal(found.blocks.length,2);
assert.ok(found.rows[0].snippet_text.includes('매장과 개통 준비'));
assert.equal(found.rows[0].snippet_basis,'visible_card_text');
const unknown=page(null);
assert.equal(unknown.ugc_observation.state,'not_determined');
assert.equal(unknown.rows[0].block_kind,'UNCLASSIFIED');
assert.equal(unknown.rows[1].block_kind,'GENERAL_UGC_CANDIDATE');
const unrelated=page('통신사 요금제 안내');
assert.equal(unrelated.ugc_observation.state,'not_determined');
assert.equal(unrelated.rows[0].block_kind,'OTHER_LABELED_BLOCK');
// Article title contains "후기", but the block heading does not, so no
// experience candidate must be inferred from its title.
const sanitized=prepareSharedRecord('searches',{
  query:'휴대폰 미납정지',device:'PC',sourceURL:globalThis.location.href,
  rows:found.rows.map(row=>({
    result_url:row.url,result_title:row.title,
    block_id:row.block_id,block_label:row.block_label,
    block_kind:row.block_kind,block_confidence:row.block_confidence,
    snippet_text:row.snippet_text,snippet_basis:row.snippet_basis
  })),
  blocks:found.blocks,ugc_observation:found.ugc_observation
});
assert.equal(sanitized.data.blocks.length,2);
assert.equal(sanitized.data.rows[0].block_kind,'EXPERIENCE_REVIEW_CANDIDATE');
assert.equal(sanitized.data.ugc_observation.state,'candidate_observed');
assert.equal(sanitized.data.blocks[0].sample_links.length,1);

const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64');
const decode=v=>JSON.parse(Buffer.from(v,'base64').toString());
let remote={sha:'old_sha',records:[{path:'older.json'}]};
let attempts=0;let observed=[];
const mockFetch=async (url,opts={})=>{
  assert.ok(url.includes('serp-lens/index.json'));
  if(!opts.method||opts.method==='GET')
    return {ok:true,status:200,json:async()=>({
      type:'file',sha:remote.sha,
      content:encode({records:remote.records})
    })};
  const body=JSON.parse(opts.body);
  observed.push({sha:body.sha,records:decode(body.content).records});
  attempts++;
  if(attempts===1){
    remote={sha:'new_sha',records:[{path:'someone-else.json'},...remote.records]};
    return {ok:false,status:409,json:async()=>({message:'does not match'})};
  }
  assert.equal(body.sha,'new_sha');
  remote={sha:'latest',records:decode(body.content).records};
  return {ok:true,status:200,json:async()=>({})};
};
await updateEvidenceIndex({
  config:{name:'demo/private',branch:'main'},token:'test',
  entries:[{path:'this-job.json'}],fetcher:mockFetch
});
assert.equal(attempts,2);
assert.deepEqual(remote.records.map(x=>x.path),[
  'this-job.json','someone-else.json','older.json'
]);
console.log('UGC BLOCK + PRIVATE INDEX CONCURRENCY TESTS PASS');
