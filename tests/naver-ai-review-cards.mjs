import assert from 'node:assert/strict';
import {collectNaverSearchDOM} from '../extension/naver-autopilot-search.js';
import {prepareSharedRecord} from '../extension/github-evidence-sync.js';

globalThis.location={href:'https://search.naver.com/search.naver?query='+encodeURIComponent('제주도 맛집')};
globalThis.innerWidth=1300;globalThis.innerHeight=900;
globalThis.scrollX=0;globalThis.scrollY=0;
globalThis.getComputedStyle=()=>({display:'block',visibility:'visible'});
function elt(tag,cls,value='',top=0,left=20,width=240,height=24){
  return {
    tagName:tag,className:cls,innerText:value,textContent:value,parentElement:null,
    href:null,alt:'',
    getBoundingClientRect(){return {top,left,width,height};},
    closest(){return null;},querySelector(){return null;},
    querySelectorAll(){return [];},getAttribute(name){return name==='alt'?this.alt:'';}
  };
}
function render({
  label='제주도 맛집 내돈내산 후기',
  aiBadge=true,
  badgeInCard=false,
  cardCount=3,
  firsthand=true,
  tagChips=true,
  thumbnails=true,
  badgeContent='AI 생성'
}={}){
  const root=elt('DIV','main_pack','');
  const section=elt('SECTION','sc_new','',20);
  const header=elt('H2','api_title',label,30);
  const badge=elt('SPAN','ai-generated-badge',badgeContent,badgeInCard?220:28,555,80,23);
  const records=Array.from({length:cardCount},(_,i)=>{
    const title=['제주 표선 가볼만한 곳 성게칼국수 내돈내산','제주도 메밀 맛집 비빔작물 방문','제주도 맛집 동문시장 도넛'][i]||'제주 맛집 카드 '+i;
    const author=['blue0418님의블로그','지히의 건강한 일상','제주 여행 기록'][i]||'작성자';
    const time=(i+5)+'시간 전';
    const summary=firsthand?
      '저는 직접 이 식당에 방문해서 음식을 먹어 봤습니다. 담백한 맛과 향이 좋았고 솔직한 방문 기록입니다.':
      '메뉴 구성과 영업시간 및 위치를 안내합니다. 방문할 수 있는 매장 정보를 정리하고 영업 일정을 설명합니다.';
    const card=elt('DIV','review-card',author+' '+time+' '+title+' '+summary,130+i*180,40,610,140);
    card.parentElement=section;
    const link=elt('A','total_tit',title,180+i*180,75,420,25);
    link.href='https://blog.naver.com/reviewsample/'+String(224470000001+i);
    link.parentElement=card;
    const source=elt('SPAN','profile-writer',author,135+i*180);
    source.parentElement=card;
    const chip=elt('SPAN','topic-chip',tagChips?'성게칼국수 시식':'',245+i*180);
    chip.parentElement=card;
    const img=elt('IMG','food-thumbnail','',175+i*180,570,102,95);
    img.alt='음식 사진';
    img.parentElement=card;
    const localBadge=badgeInCard&&i===0?badge:null;
    card.querySelectorAll=selector=>{
      if(selector==='a[href]')return [link];
      if(selector.includes('[class*="source"]'))return [source];
      if(selector==='img')return thumbnails?[img]:[];
      if(selector.startsWith('[class*="chip"],'))return tagChips?[chip]:[];
      if(selector.startsWith('[class*="desc"],'))return [];
      if(selector.startsWith('span,small,'))return localBadge?[localBadge]:[];
      return [];
    };
    return {card,link,source,chip,img};
  });
  section.querySelectorAll=selector=>{
    if(selector==='a[href]')return records.map(r=>r.link);
    if(selector.startsWith('h2,h3,'))return [header];
    if(selector.startsWith('span,small,'))return aiBadge?[badge]:[];
    if(selector.startsWith('button,a,'))return [];
    return [];
  };
  root.querySelectorAll=selector=>selector==='a[href]'?records.map(r=>r.link):[];
  globalThis.document={title:'네이버 검색',readyState:'complete',
    querySelector(sel){return sel==='#main_pack'?root:null}};
  return collectNaverSearchDOM();
}

const observed=render();
assert.equal(observed.blocks.length,1);
const b=observed.blocks[0];
assert.equal(b.label,'제주도 맛집 내돈내산 후기');
assert.equal(b.kind,'AI_REVIEW_CLUSTER_CANDIDATE');
assert.equal(b.ai_generated_badge,true);
assert.equal(b.ai_badge_evidence.basis,'visible_label_adjacent_to_heading');
assert.equal(b.signals.card_count,3);
assert.equal(b.signals.cards_with_title,3);
assert.equal(b.signals.cards_with_snippet,3);
assert.equal(b.signals.cards_with_time,3);
assert.equal(b.signals.cards_with_tags,3);
assert.equal(b.signals.cards_with_thumbnail,3);
assert.equal(b.cards.length,3);
assert.equal(b.cards[0].source_name,'blue0418님의블로그');
assert.equal(b.cards[0].time_text,'5시간 전');
assert.equal(b.cards[0].tags[0],'성게칼국수 시식');
assert.equal(b.cards[0].has_thumbnail,true);
assert.equal(observed.ugc_observation.ai_review_candidate_count,1);
assert.equal(observed.ugc_observation.state,'candidate_observed');
assert.equal(observed.rows[0].block_kind,'AI_REVIEW_CLUSTER_CANDIDATE');

const noAi=render({aiBadge:false});
assert.equal(noAi.ugc_observation.ai_review_candidate_count,0);
assert.equal(noAi.blocks[0].ai_generated_badge,false);
assert.equal(noAi.blocks[0].kind,'EXPERIENCE_REVIEW_CANDIDATE');
const oneCard=render({cardCount:1});
assert.equal(oneCard.ugc_observation.ai_review_candidate_count,0);
assert.equal(oneCard.blocks[0].kind,'EXPERIENCE_REVIEW_CANDIDATE');
const offTopic=render({label:'제주도 혼자여행 일정 짜는 법',firsthand:false});
assert.equal(offTopic.blocks[0].kind,'AI_TOPIC_CLUSTER_CANDIDATE');
assert.equal(offTopic.ugc_observation.ai_topic_candidate_count,1);
const distant=render({badgeInCard:true});
assert.equal(distant.blocks[0].ai_generated_badge,false);
assert.equal(distant.blocks[0].kind,'EXPERIENCE_REVIEW_CANDIDATE');
const unrelated=render({badgeContent:'AI 생성 콘텐츠 리뷰'});
assert.equal(unrelated.blocks[0].ai_generated_badge,false);

const exportable=prepareSharedRecord('searches',{
  query:'제주도 맛집',device:'PC',sourceURL:globalThis.location.href,
  rows:observed.rows.map(r=>({result_url:r.url,result_title:r.title,
    block_kind:r.block_kind})),
  blocks:observed.blocks,ugc_observation:observed.ugc_observation
});
const item=exportable.data.blocks[0];
assert.equal(item.ai_generated_badge,true);
assert.equal(item.cards.length,3);
assert.equal(item.cards[0].source_name,'blue0418님의블로그');
assert.equal(item.cards[0].tags[0],'성게칼국수 시식');
assert.equal(item.signals.cards_with_thumbnail,3);
assert.equal(exportable.data.ugc_observation.ai_review_candidate_count,1);
console.log('AI REVIEW CARD OBSERVATION AND PRIVACY WHITELIST TESTS PASS');
