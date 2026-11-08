import assert from 'node:assert/strict';
import {collectNaverSearchDOM} from '../extension/naver-autopilot-search.js';
import {prepareSharedRecord} from '../extension/github-evidence-sync.js';

globalThis.location={href:'https://search.naver.com/search.naver?query='+encodeURIComponent('제주도 혼자 여행')};
globalThis.scrollY=0;globalThis.scrollX=0;
globalThis.innerWidth=1320;globalThis.innerHeight=920;
globalThis.getComputedStyle=()=>({display:'block',visibility:'visible'});
function element(tag,klass,text,top=0){
  return {tagName:tag,className:klass,innerText:text,textContent:text,
    parentElement:null,href:null,
    getBoundingClientRect(){return {top,left:20,width:300,height:27};},
    closest(){return null;},querySelector(){return null;},querySelectorAll(){return []}};
}
function fixture({heading,notes,withControls=true}){
  const root=element('DIV','main_pack','');
  const section=element('SECTION','sc_new','',10);
  const header=heading?element('H2','api_title',heading,20):null;
  const controls=withControls?[
    element('BUTTON','sds-button','더보기',310),
    element('BUTTON','topic_chip','제주 혼행',40),
    element('SPAN','comment_badge','댓글 12',240),
    element('SPAN','reaction_count','공감 4',240)
  ]:[];
  const anchors=notes.map((note,i)=>{
    const url='https://blog.naver.com/testblog/'+String(224460000001+i);
    const title='제주도 혼자 여행 기록 '+(i+1);
    const card=element('DIV','card',title+' '+note,70+i*80);
    const anchor=element('A','total_tit',title,80+i*80);
    anchor.href=url;anchor.parentElement=card;card.parentElement=section;
    card.querySelectorAll=sel=>sel==='a[href]'?[anchor]:[];
    return anchor;
  });
  section.querySelectorAll=sel=>{
    if(sel==='a[href]')return anchors;
    if(sel.startsWith('button,a,'))return controls;
    if(sel.startsWith('h2,h3,'))return header?[header]:[];
    return [];
  };
  root.querySelectorAll=sel=>sel==='a[href]'?anchors:[];
  globalThis.document={title:'네이버 검색',readyState:'complete',
    querySelector(sel){return sel==='#main_pack'?root:null}};
  return collectNaverSearchDOM();
}
const notes=[
 '저는 직접 혼자 여행을 다녀왔는데 일정이 편해서 정말 좋았어요. 실제로 돌아본 장소별 이동 순서를 기록합니다.',
 '처음 가봤던 여행 코스에서 제가 느꼈던 좋은 점과 아쉬웠던 부분을 담은 방문 기록입니다.',
 '혼자 다녀온 일정과 매장에서 실제로 경험했던 식사 후기를 적었습니다. 각 방문 코스가 있습니다.'
];
const topical=fixture({heading:'제주도 혼자여행 일정 짜는 법',notes});
assert.equal(topical.blocks.length,1);
assert.equal(topical.blocks[0].kind,'TOPIC_CLUSTER_CANDIDATE');
assert.equal(topical.blocks[0].experience_evidence,'multiple_firsthand_excerpts');
assert.equal(topical.ugc_observation.topic_cluster_candidate_count,1);
assert.equal(topical.ugc_observation.experience_evidence_candidate_count,1);
assert.equal(topical.ugc_observation.state,'not_determined');
assert.equal(topical.ugc_observation.topic_group_state,'topic_cluster_observed');
assert.equal(topical.blocks[0].signals.article_count,3);
assert.equal(topical.blocks[0].signals.excerpt_count,3);
assert.equal(topical.blocks[0].signals.firsthand_excerpt_count,3);
assert.equal(topical.blocks[0].signals.more_control_visible,true);
assert.equal(topical.blocks[0].signals.comment_control_visible,true);
assert.equal(topical.blocks[0].signals.reaction_control_visible,true);
assert.deepEqual(topical.blocks[0].signals.topic_tags,['제주 혼행']);
assert.equal(topical.rows[0].block_kind,'TOPIC_CLUSTER_CANDIDATE');

const unspecified=fixture({heading:null,notes});
assert.equal(unspecified.ugc_observation.topic_cluster_candidate_count,0);
assert.equal(unspecified.ugc_observation.state,'not_determined');
const one=fixture({heading:'여행 일정',notes:notes.slice(0,1)});
assert.equal(one.blocks[0].kind,'OTHER_LABELED_BLOCK');
const neutral=fixture({heading:'휴대폰 요금제 안내',notes:[
 '이번 달 서비스가 시작되는 시각과 이용할 수 있는 상품 정보를 누구나 확인할 수 있도록 정리합니다.',
 '가격과 접수 구분 안내 및 사용 방법에 대한 기본적인 요약을 안내하는 안내문입니다.'
]});
assert.equal(neutral.blocks[0].kind,'TOPIC_CLUSTER_CANDIDATE');
assert.equal(neutral.blocks[0].experience_evidence,'not_established');
assert.equal(neutral.ugc_observation.candidate_block_count,0);

const serial=prepareSharedRecord('searches',{
  query:'제주도 혼자 여행',device:'PC',sourceURL:globalThis.location.href,
  rows:topical.rows.map(r=>({result_url:r.url,result_title:r.title,block_kind:r.block_kind})),
  blocks:topical.blocks,ugc_observation:topical.ugc_observation
});
assert.equal(serial.data.blocks[0].kind,'TOPIC_CLUSTER_CANDIDATE');
assert.equal(serial.data.blocks[0].signals.more_control_visible,true);
assert.equal(serial.data.blocks[0].signals.topic_tags[0],'제주 혼행');
assert.equal(serial.data.ugc_observation.topic_group_state,'topic_cluster_observed');
console.log('UGC STRUCTURAL CLUSTER SIGNAL CONTRACT TESTS PASS');
