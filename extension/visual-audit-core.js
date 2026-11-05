/* Pure evidence & review rules. No artificial rank for missing or unreviewed rows. */
import {documentKey} from './rank-lab.js';
export const TYPES=['AD','BLOG','CAFE','WEB','NEWS','KIN','CLIP','VIDEO','UNCLASSIFIED','AI','MIXED','OTHER'];
function safeURL(value){
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return'';}
}
export function normalizeVisualAudit(audit){
  if(!audit||!Array.isArray(audit.candidates)||!audit.viewport)throw Error('화면 검수 자료가 올바르지 않습니다.');
  return {
    ...audit,
    reviews:audit.reviews&&typeof audit.reviews==='object'?audit.reviews:{},
    added:Array.isArray(audit.added)?audit.added:[],
    blocks:Array.isArray(audit.blocks)?audit.blocks:[],
    block_reviews:audit.block_reviews&&typeof audit.block_reviews==='object'?audit.block_reviews:{},
    checked_complete:Boolean(audit.checked_complete)
  };
}
export function summarizeVisualAudit(original){
  const audit=normalizeVisualAudit(original);
  const valid= audit.candidates.filter(c=>!c.outside_screenshot);
  const counts={confirmed:0,rejected:0,uncertain:0,unreviewed:0,manual:0,
    parser_matched:0,parser_unmatched:0};
  const normalizedRows=new Map();
  for(const r of audit.parsed_rows||[]){
    if(!r.result_url)continue;
    const key=documentKey(r.result_url);
    if(!normalizedRows.has(key))normalizedRows.set(key,[]);
    normalizedRows.get(key).push(r);
  }
  const classified=[];
  const blockCounts={confirmed:0,rejected:0,uncertain:0,unreviewed:0};
  const verifiedBlocks=[];
  for(const block of audit.blocks){
    const r=audit.block_reviews[block.id]||{};
    const verdict=['confirmed','rejected','uncertain'].includes(r.verdict)?r.verdict:'unreviewed';
    blockCounts[verdict]++;
    if(verdict!=='confirmed')continue;
    const suggested=block.type_hints?.length===1?block.type_hints[0]:'MIXED';
    verifiedBlocks.push({
      id:block.id,visual_y:block.y,visual_x:block.x,
      actual_type:TYPES.includes(r.correct_type)?r.correct_type:suggested,
      type_hints:block.type_hints,
      candidate_count:block.candidates||0
    });
  }
  for(const c of valid){
    const review=audit.reviews[c.id]||{};
    const verdict=review.verdict||'unreviewed';
    if(!['confirmed','rejected','uncertain','unreviewed'].includes(verdict))continue;
    counts[verdict]++;
    if(verdict!=='confirmed')continue;
    const actualType=TYPES.includes(review.correct_type)?review.correct_type:c.type_hint;
    const parserMatches=normalizedRows.get(documentKey(c.url))||[];
    if(parserMatches.length)counts.parser_matched++;else counts.parser_unmatched++;
    classified.push({
      id:c.id,kind:'detected',title:c.title,url:c.url,
      actual_type:actualType,detected_type:c.type_hint,
      y:c.y,x:c.x,parser_matched:parserMatches.length>0,
      parser_types:[...new Set(parserMatches.map(r=>r.block_type))]
    });
  }
  for(const item of audit.added){
    if(!Number.isFinite(item.y)||item.y<0||item.y>audit.viewport.height)continue;
    counts.manual++;
    classified.push({
      id:item.id,kind:'manually_added',title:item.title||'수동 추가',
      url:safeURL(item.url),actual_type:TYPES.includes(item.type)?item.type:'OTHER',
      y:item.y,x:item.x||0,parser_matched:!!safeURL(item.url)&&normalizedRows.has(documentKey(item.url)),
      parser_types:[],
    });
  }
  classified.sort((a,b)=>a.y-b.y||a.x-b.x);
  const visible=classified.map((c,i)=>({...c,viewport_order:i+1}));
  const nonAds=visible.filter(x=>x.actual_type!=='AD');
  const confirmedComplete=audit.checked_complete&&classified.length>=1&&counts.unreviewed===0&&counts.uncertain===0
    &&blockCounts.unreviewed===0&&blockCounts.uncertain===0
    &&!!audit.screenshot_png?.byteLength&&!audit.capture_moved&&
    !audit.screenshot_dimension_mismatch&&!audit.root_fallback&&!audit.truncated;
  const warnings=[
    ...(!audit.checked_complete?['화면 안의 누락 문서 점검 완료 표시가 없습니다.']:[]),
    ...(!classified.length?['검증된 화면 제목이 없어 순서를 확정할 수 없습니다.']:[]),
    ...(counts.unreviewed?['미검수 제목 후보 '+counts.unreviewed+'개']:[]),
    ...(counts.uncertain?['불명확 제목 후보 '+counts.uncertain+'개']:[]),
    ...(blockCounts.unreviewed?['미검수 검색 블록 '+blockCounts.unreviewed+'개']:[]),
    ...(blockCounts.uncertain?['불명확 검색 블록 '+blockCounts.uncertain+'개']:[]),
    ...(audit.capture_moved?['스크린샷과 위치 측정 사이에 스크롤 또는 화면 크기가 변했습니다. 다시 캡처하세요.']:[]),
    ...(audit.root_fallback?['주요 검색결과 컨테이너를 찾지 못해 본문 전체에서 추출했습니다. 후보가 부정확할 수 있습니다.']:[]),
    ...(audit.truncated?['화면 제목 후보가 추출 상한을 넘어 일부가 제외됐습니다.']:[]),
    ...(audit.screenshot_dimension_mismatch?['스크린샷 비율과 측정한 브라우저 화면 비율이 일치하지 않습니다. 좌표 표시를 신뢰할 수 없습니다.']:[]),
    '순서는 현재 보이는 화면(스크롤 한 구간)에서만 확인한 순서이며 네이버 검색 전체 순위가 아닙니다.'
  ];
  return {
    id:audit.id,source_url:audit.source_url,query:audit.query,
    captured_at:audit.captured_at,device_url:audit.url_device,layout:audit.layout_device,
    viewport:audit.viewport,screenshot_image_size:audit.screenshot_image_size||null,
    counts,block_counts:blockCounts,verified_blocks:verifiedBlocks,
    verified_viewport:confirmedComplete,
    visible_items:visible,visible_non_ad_count:nonAds.length,
    warnings
  };
}
export function compareViewportParser(report){
  return {
    verified_viewport:report.verified_viewport,
    matched:report.counts.parser_matched,
    unmatched_in_screenshot:report.counts.parser_unmatched,
    unknown_under_fold:'검색 결과 HTML에서 추출된 다른 링크는 이 화면 밖에 있을 수 있어 누락으로 판정하지 않습니다.',
    overview:report.warnings
  };
}
