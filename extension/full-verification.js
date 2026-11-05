/*
 * Independent read-only verification of the entire SERP Lens evidence chain.
 * Status "ready" describes user-captured evidence adequacy, NOT true Naver rank.
 * Never infers official ranking, indexing status, or causal SEO effects.
 */
import {documentKey,analyzeRankingEvidence} from './rank-lab.js';
import {analyzeExperiment} from './experiment-lab.js';
import {summarizeVisualAudit} from './visual-audit-core.js';

function domainFrom(raw){
  try{return new URL(raw).hostname.toLowerCase();}catch{return'';}
}
function isNaverSearch(raw){
  try{
    const u=new URL(raw);
    return u.protocol==='https:'&&
      ['search.naver.com','m.search.naver.com'].includes(u.hostname.toLowerCase())&&
      u.pathname==='/search.naver'&&!!u.searchParams.get('query')?.trim();
  }catch{return false;}
}
const buildStage=(key,title,ready,metrics,next,problems=[])=>({
  key,title,status:ready?'ready':problems.length?'review':'pending',ready,
  metrics,next,problems
});
export function verifyCompletePipeline({searches=[],pages=[],experiments=[],visualAudits=[]}){
  // Never trust a passed-in record to be a live capture; these statuses
  // apply equally to offline fixtures and therefore are not a live-site proof.
  const validSearches=searches.filter(s=>s&&s.id&&Array.isArray(s.rows)&&s.rows.some(r=>r.result_url));
  const naverSearches=validSearches.filter(s=>isNaverSearch(s.sourceURL));
  const queries=new Set(naverSearches.map(s=>s.query+'|'+s.device));
  const searchReady=naverSearches.length>0;
  const capture=buildStage('capture','1. 실제 검색 화면 수집',searchReady,{
    records:searches.length,parsed:validSearches.length,naver_urls:naverSearches.length,
    distinct_query_device:queries.size
  },'네이버 검색 결과 화면에서 수집 버튼을 누르고, 검색어·기기·원본 URL이 정상 기록되는지 확인하세요.',
  validSearches.length>0&&!naverSearches.length?['검색 이력이 있지만 네이버 검색 URL 근거가 없습니다.']:[]);

  const linkIDs=new Set(naverSearches.flatMap(s=>s.rows.map(r=>r.result_url).filter(Boolean).map(documentKey)));
  const capturedPages=pages.filter(p=>p&&p.url&&Array.isArray(p.headings)&&typeof p.text==='string');
  const matchedPages=capturedPages.filter(p=>linkIDs.has(documentKey(p.url)));
  const pageReady=capturedPages.length>=2&&matchedPages.length>=1;
  const documents=buildStage('documents','2. 상위·경쟁 문서 본문 연결',pageReady,{
    captured:capturedPages.length,matched_to_search:matchedPages.length
  },'검색 결과에 실제 등장한 경쟁 문서와 내 문서를 각각 방문한 뒤 문서 분석용으로 저장하세요.',
  capturedPages.length>=2&&!matchedPages.length?['수집 문서가 있지만 검색 결과 URL과 연결되지 않았습니다.']:[]);

  const report=analyzeRankingEvidence(naverSearches,capturedPages);
  const qualifying=report.factors.filter(f=>f.qualified);
  const rankReady=qualifying.length>0&&report.keyword_count>=3;
  const rank=buildStage('rank','3. 키워드별 비교 가능한 표본',rankReady,{
    keyword_device_groups:report.keyword_count,
    matched_results:report.matched_page_count,
    comparable_pairs:report.pair_comparisons,
    qualified_features:qualifying.length
  },'최소 3개 검색 조건에서 서로 다른 출처의 동일 유형 문서를 수집해 비교 표본을 늘리세요.',
  report.matched_page_count>0&&!rankReady?['비교 표본이 부족해 상위노출 패턴은 아직 판단할 수 없습니다.']:[]);

  const expResults=[],expErrors=[];
  for(const e of experiments){
    try{expResults.push(analyzeExperiment(e,naverSearches));}
    catch(error){expErrors.push((e?.title||e?.id||'이름 없는 실험')+': '+error.message);}
  }
  const usable=expResults.filter(r=>r.enough_repeated_observations&&r.relative_delta!==null);
  const experimentReady=usable.length>0;
  const experiment=buildStage('experiment','4. 수정 전후·대조군 관측',experimentReady,{
    registered:experiments.length,analyzed:expResults.length,
    comparable:usable.length,insufficient:expResults.length-usable.length
  },'실제 변경시각을 입력하고 동일한 검색어·기기로 전후 2회 이상 수집하세요. 같은 유형의 대조 문서가 필요합니다.',
  expErrors.map(s=>'실험 분석 오류: '+s));

  const visualResults=[],visualErrors=[];
  for(const a of visualAudits){
    try{visualResults.push(summarizeVisualAudit(a));}
    catch(error){visualErrors.push((a?.id||'ID 없음')+': '+error.message);}
  }
  const verified=visualResults.filter(r=>r.verified_viewport);
  const pc=verified.filter(r=>r.device_url==='PC'&&r.layout==='데스크톱 너비');
  const mobile=verified.filter(r=>r.device_url==='모바일'&&r.layout==='모바일 너비');
  const viewportReady=pc.length>0&&mobile.length>0;
  const viewport=buildStage('viewport','5. 실제 화면 PC·모바일 수동 검수',viewportReady,{
    screenshot_records:visualAudits.length,
    manually_verified:verified.length,pc_verified:pc.length,mobile_verified:mobile.length
  },'PC와 실제 모바일 너비의 네이버 검색 화면을 각각 캡처하고, 제목·광고·블록·누락 항목을 전부 수동 검수하세요.',
  [
    ...visualErrors.map(s=>'화면 검수 오류: '+s),
    ...(visualAudits.some(a=>a?.capture_moved)?['화면 위치 측정 중 스크롤/크기 변화가 발생한 캡처가 있습니다.']:[]),
    ...(visualAudits.some(a=>a?.screenshot_dimension_mismatch)?['측정한 화면과 PNG 비율이 다른 캡처가 있습니다.']:[])
  ]);

  const linked=verified.filter(r=>naverSearches.some(s=>s.query===r.query&&s.device===r.device_url));
  const totalConfirmed=linked.reduce((n,r)=>n+r.counts.confirmed,0);
  const totalMatched=linked.reduce((n,r)=>n+r.counts.parser_matched,0);
  const noMisses=linked.length>0&&linked.every(r=>r.counts.parser_unmatched===0);
  const linkedReady=linked.length>=2&&noMisses&&totalConfirmed>0;
  const cross=buildStage('cross','6. 화면·파서 결과 교차검증',linkedReady,{
    verified_with_matching_query:linked.length,
    confirmed_headlines:totalConfirmed,parser_url_matches:totalMatched,
    unresolved_visible_url_mismatches:totalConfirmed-totalMatched
  },'같은 검색어·기기의 검색 이력과 화면 검수 자료를 연결하고, 화면에 확인된 결과 중 파서가 놓친 URL을 점검하세요.',
  linked.length&& !noMisses?['수동 확인한 화면 제목 중 HTML 파서에서 찾지 못한 URL이 있습니다.']:[]);

  const stages=[capture,documents,rank,experiment,viewport,cross];
  const completed=stages.filter(s=>s.ready).length;
  return {
    schema:'serp-lens-complete-verification-v1',
    generated_at:new Date().toISOString(),
    overall:completed===stages.length?'evidence-ready':'incomplete',
    completed,total:stages.length,stages,
    provenance:{
      confirmed_live_site:false,
      reason:'도구는 입력 자료가 실제 네이버 사이트에서 사용자가 직접 수집된 것인지 암호학적으로 증명하지 못합니다. PC/모바일 현장 확인 필요.',
      search_record_count:searches.length,
      visual_record_count:visualAudits.length,
      page_record_count:pages.length
    },
    limitations:[
      '자동 CI 통과는 별도 GitHub Actions에서 확인해야 합니다. 이 대시보드는 브라우저에 저장된 자료의 연결 상태만 검사합니다.',
      '네이버 내부 알고리즘과 공식 검색 순위를 알아냈다는 의미가 아닙니다.',
      '스크린샷 검수의 순서는 한 화면에 실제 보이는 구간만 포함하며 페이지 전체 순위가 아닙니다.',
      '실험 전후 상대 변화는 상관 관측이며 원인·인과관계가 증명되지 않습니다.',
      '저장 자료의 URL·본문·기기·확인 여부를 실제로 검토해야 하며 익명화된 테스트 자료도 같은 검사를 통과할 수 있습니다.'
    ]
  };
}
