/*
 * Final readiness gate for observational research.
 * Read-only checks over local evidence. Not a secret-algorithm validator.
 */
import {summarizeVisualAudit} from './visual-audit-core.js';
import {analyzeRankingEvidence} from './rank-lab.js';
import {analyzeExperiment} from './experiment-lab.js';
const clean=x=>String(x||'').trim();
const unique=arr=>[...new Set(arr)];
const fmt=(ok,warn,note,evidence={})=>({
  status:ok?'검증자료 확보':warn?'추가 검증 필요':'미검증',
  ready:Boolean(ok),note,evidence
});
export function buildFullValidation(searches=[],pages=[],experiments=[],audits=[]){
  const records=searches.filter(s=>s&&s.query&&s.device&&Array.isArray(s.rows));
  const withEvidence=records.filter(s=>s.rows.length>0&&typeof s.evidence_sha256==='string'&&s.evidence_sha256.length===64);
  const pc=records.filter(s=>s.device==='PC');
  const mobile=records.filter(s=>s.device==='모바일');
  const queries=unique(records.map(s=>s.query+'|'+s.device));
  const capturedPages=pages.filter(p=>p?.url&&p.title&&(p.text||'').length>=60);
  const ranked=analyzeRankingEvidence(records,capturedPages);
  const experimentReports=[];
  for(const e of experiments){
    try{experimentReports.push({id:e.id,title:e.title,analysis:analyzeExperiment(e,records)});}
    catch(error){experimentReports.push({id:e.id,title:e.title,error:error.message});}
  }
  const verifiedAudits=audits.map(a=>{
    const summary=summarizeVisualAudit(a);
    return {
      id:a.id,query:a.query,url_device:a.url_device,layout:a.layout_device,
      captured_at:a.captured_at,summary,
      mismatch_count:summary.counts.parser_unmatched,
      reviewed_candidates:summary.counts.confirmed+summary.counts.rejected,
      blocks_checked:summary.block_counts.confirmed+summary.block_counts.rejected
    };
  });
  const verified=verifiedAudits.filter(x=>x.summary.verified_viewport);
  const validPC=verified.filter(a=>a.url_device==='PC'&&a.layout==='데스크톱 너비'&&a.summary.visible_items.length>=1);
  const validMobile=verified.filter(a=>a.url_device==='모바일'&&a.layout==='모바일 너비'&&a.summary.visible_items.length>=1);
  const mismatches=verified.reduce((sum,a)=>sum+a.mismatch_count,0);
  const sources=['PC','모바일'].filter(device=>records.some(s=>s.device===device));
  const fields=['title_match','heading_match','body_match','text_length','image_count','published_at'];
  const eligibleSignals=ranked.factors.filter(f=>fields.includes(f.key)&&f.qualified);
  const experimentReady=experimentReports.filter(e=>!e.error&&e.analysis?.enough_repeated_observations&&e.analysis.relative_delta!==null);
  const stages=[
    {key:'search_capture',name:'1. 검색 결과 수집·이력',
      ...fmt(withEvidence.length>=2&&queries.length>=2,
        records.length>0,
        records.length===0?'검색 결과를 수집한 기록이 없습니다.':
        '총 '+records.length+'건 · 해시 증거 '+withEvidence.length+'건 · 검색 조건 '+queries.length+'개 · 기기 '+(sources.join('/')||'미확인'),
        {searches:records.length,hash_provenance:withEvidence.length,query_device_groups:queries.length,
         pc_snapshots:pc.length,mobile_snapshots:mobile.length})},
    {key:'content',name:'2. 실제 문서 본문 수집',
      ...fmt(capturedPages.length>=3,
        pages.length>0,
        '문서 수집 '+pages.length+'건 중 제목·본문이 있는 자료 '+capturedPages.length+'건 (기본 기준 3건)',
        {captured_pages:pages.length,usable_pages:capturedPages.length})},
    {key:'pattern',name:'3. 노출 패턴 관측',
      ...fmt(eligibleSignals.length>=1&&ranked.keyword_count>=3,
        ranked.keyword_count>0,
        '검색어·기기 그룹 '+ranked.keyword_count+'개 · 본문 연결 결과 '+ranked.matched_page_count+
         '건 · 비교쌍 '+ranked.pair_comparisons+'개 · 표본 기준 충족 특성 '+eligibleSignals.length+'개',
        {keyword_device_groups:ranked.keyword_count,matched_pages:ranked.matched_page_count,
         feature_pairs:ranked.pair_comparisons,eligible_signals:eligibleSignals.length})},
    {key:'experiments',name:'4. 변경 전후 대조군 실험',
      ...fmt(experimentReady.length>=1,
        experiments.length>0,
        '등록 실험 '+experiments.length+'개 · 동일 조건·전후 반복·대조군 근거가 있는 실험 '+experimentReady.length+'개',
        {registered:experiments.length,comparable:experimentReady.length})},
    {key:'visual',name:'5. 검색 화면 위치·블록 검수',
      ...fmt(validPC.length>=1&&validMobile.length>=1,
        audits.length>0,
        '화면 캡처 '+audits.length+'개 · 사용자 검수 완료 '+verified.length+
        '개 · PC 실화면 '+validPC.length+'개 · 모바일 실화면 '+validMobile.length+
        '개 · 검수 화면에서 파서 미일치 후보 '+mismatches+'개',
        {audits:audits.length,confirmed:verified.length,
         pc:validPC.length,mobile:validMobile.length,parser_unmatched:mismatches})}
  ];
  // A "full confirmation" is a readiness claim about reviewed evidence, never ranking causes.
  const ready=stages.every(x=>x.ready);
  return {
    schema:'naver-serp-full-validation-v1',
    generated_at:new Date().toISOString(),ready,
    status:ready?'현장 자료 기준 5단계 증거 확보':'전체 현장 검증 미완료',
    stages,
    reviewed_audits:verifiedAudits,
    experiments:experimentReports.map(e=>({
      id:e.id,title:e.title,error:e.error||null,
      enough_repeated_observations:e.analysis?.enough_repeated_observations||false,
      relative_delta:e.analysis?.relative_delta??null
    })),
    limitations:[
      '이 판정은 사용자가 직접 수집하고 검수한 증거의 충족 여부만 나타냅니다.',
      'GitHub 자동 테스트의 성공 여부는 이 대시보드에서 측정하지 않습니다. 배포된 빌드의 GitHub Actions 실행 결과도 별도로 확인해야 합니다.',
      '네이버의 실제 전체 검색 순위·내부 점수·가중치·상위노출 원인은 확인할 수 없습니다.',
      'PC와 모바일은 각기 다른 레이아웃으로 실제 검색한 자료만 인정합니다.',
      '사용자 검수 완료 기록은 수동 판단이며 자동 정확도 인증이나 검색 엔진의 공식 확인이 아닙니다.',
      '화면에서 보이지 않는 영역은 단일 스크린샷으로 확인할 수 없습니다.'
    ]
  };
}
