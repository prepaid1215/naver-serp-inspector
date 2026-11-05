/*
 * NAVER Rank Lab: observational analysis, not a reconstruction of Naver's algorithms.
 * Works solely on previously user-captured SERP rows and manually visited pages.
 */
const MIN_COMPARISONS=8;
const MIN_QUERIES=3;
function clean(value){return String(value||'').replace(/\s+/g,' ').trim();}
function words(value){
 return [...new Set((clean(value).toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{2,}/g)||[])
 .filter(s=>s.length>=2))].slice(0,14);
}
function domainFor(url){
 try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return'';}
}
export function documentKey(raw){
 try{
  const u=new URL(raw);const host=u.hostname.replace(/^m\./,'');
  if(host==='blog.naver.com'){
   const parts=u.pathname.split('/').filter(Boolean);
   const blogId=u.searchParams.get('blogId')||parts[0];
   const logNo=u.searchParams.get('logNo')||parts[1];
   if(blogId&&logNo&&/^\d+$/.test(logNo))return 'blog:'+blogId.toLowerCase()+'/'+logNo;
  }
  u.hash='';
  for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid|navType|proxyReferer|trackingCode)$/i.test(key))u.searchParams.delete(key);
  return u.hostname.replace(/^www\./,'').toLowerCase()+u.pathname.replace(/\/$/,'')+u.search;
 }catch{return clean(raw);}
}
export function sourceKey(row){
 const url=row.result_url||row.url;
 try{
  const u=new URL(url);
  const host=u.hostname.replace(/^m\./,'').replace(/^www\./,'').toLowerCase();
  if(host==='blog.naver.com'){
    const parts=u.pathname.split('/').filter(Boolean);
    const author=u.searchParams.get('blogId')||parts[0]||'unknown';
    return 'blog:'+author.toLowerCase();
  }
  if(host==='cafe.naver.com'){
    const parts=u.pathname.split('/').filter(Boolean);
    const club=u.searchParams.get('clubid')||parts[0]||'unknown';
    return 'cafe:'+club.toLowerCase();
  }
  return 'site:'+host;
 }catch{return 'unknown';}
}
function metricCoverage(terms,text){
 if(!terms.length)return null;
 const normalized=clean(text).toLowerCase();
 return terms.filter(t=>normalized.includes(t)).length/terms.length;
}
function publishedDate(page){
 const raw=page.published_at||page.published||page.datePublished||'';
 if(!raw)return null;
 const d=new Date(raw);
 return !Number.isNaN(d.getTime())?d.getTime():null;
}
export function pageFeatures(page,query){
 const terms=words(query);
 return {
  title_match:metricCoverage(terms,page.title),
  heading_match:metricCoverage(terms,(page.headings||[]).map(x=>x.text).join(' ')),
  body_match:metricCoverage(terms,(page.text||'').slice(0,18000)),
  text_length:(page.text||'').length,
  heading_count:(page.headings||[]).length,
  image_count:Number.isFinite(page.images)?page.images:null,
  outbound_links:Number.isFinite(page.external_links)?page.external_links:null,
  published_at:publishedDate(page)
 };
}
const LABELS={
 title_match:'제목의 검색어 포함 정도',
 heading_match:'소제목의 검색어 포함 정도',
 body_match:'본문의 검색어 포함 정도',
 text_length:'수집된 본문 글자 수',
 heading_count:'수집된 소제목 개수',
 image_count:'수집된 이미지 개수',
 outbound_links:'수집된 외부 링크 개수',
 published_at:'문서 공개 시점의 최근성'
};
export function analyzeRankingEvidence(searches,pages,config={}){
 const device=config.device||'ALL';
 const filter=clean(config.keyword||'').toLowerCase();
 const observed=(searches||[]).filter(s=>s&&s.query&&Array.isArray(s.rows))
  .filter(s=>device==='ALL'||s.device===device)
  .filter(s=>!filter||clean(s.query).toLowerCase().includes(filter));
 const snapshots=new Map();
 for(const s of observed){
  const key=s.device+'|'+clean(s.query).toLowerCase();
  const old=snapshots.get(key);
  if(!old||String(s.captured_at)>String(old.captured_at))snapshots.set(key,s);
 }
 const chosen=[...snapshots.values()].sort((a,b)=>a.query.localeCompare(b.query,'ko'));
 const pagesMap=new Map();
 for(const page of (pages||[]).filter(p=>p&&p.url)){
  const key=documentKey(page.url);
  const prior=pagesMap.get(key);
  if(!prior||String(page.captured_at)>String(prior.captured_at))pagesMap.set(key,page);
 }
 const observations=[],groups=[],sourceCount=new Map();
 for(const s of chosen){
  const rows=s.rows.filter(r=>r.block_type!=='AD'&&r.result_url);
  const types={},sourceSet=new Set();
  rows.forEach((row,index)=>{
    const key=documentKey(row.result_url);
    const source=sourceKey(row);
    const page=pagesMap.get(key);
    types[row.block_type]=(types[row.block_type]||0)+1;
    sourceSet.add(source);
    const current=sourceCount.get(source)||{source,appearances:0,queries:new Set(),best_estimated_order:Infinity,links:new Set()};
    current.appearances+=1;current.queries.add(clean(s.query));current.best_estimated_order=Math.min(current.best_estimated_order,index+1);
    current.links.add(key);sourceCount.set(source,current);
    observations.push({query:s.query,device:s.device,estimated_order:index+1,
      block_type:row.block_type,title:row.result_title,url:row.result_url,
      source,matched:!!page,features:page?pageFeatures(page,s.query):null});
  });
  groups.push({query:s.query,device:s.device,captured_at:s.captured_at,
    result_count:rows.length,types,distinct_sources:sourceSet.size,
    captured_document_count:rows.filter(r=>pagesMap.has(documentKey(r.result_url))).length});
 }
 const topSources=[...sourceCount.values()].map(s=>({
  source:s.source,appearances:s.appearances,query_count:s.queries.size,
  best_estimated_order:s.best_estimated_order,distinct_urls:s.links.size
 })).sort((a,b)=>b.query_count-a.query_count||b.appearances-a.appearances||a.source.localeCompare(b.source)).slice(0,30);
 const stats=Object.fromEntries(Object.entries(LABELS).map(([key,label])=>[key,{
  key,label,higher_greater:0,lower_greater:0,pairs:0,queries:new Set(),examples:[]
 }]));
 let consideredPairs=0;
 for(const group of groups){
  const docs=observations.filter(o=>o.query===group.query&&o.device===group.device&&o.features);
  for(let i=0;i<docs.length;i++)for(let j=i+1;j<docs.length;j++){
   const upper=docs[i],lower=docs[j];
   if(upper.block_type!==lower.block_type)continue;
   if(upper.source===lower.source)continue;
   consideredPairs++;
   for(const key of Object.keys(stats)){
    const a=upper.features[key],b=lower.features[key];
    if(a===null||b===null||!Number.isFinite(a)||!Number.isFinite(b)||a===b)continue;
    const item=stats[key];
    item.pairs++;
    item.queries.add(group.query+'|'+group.device);
    const olderDirection=key==='published_at';
    // Higher publication timestamp means newer. For all metrics greater = more.
    const greater=a>b;
    if(greater)item.higher_greater++;else item.lower_greater++;
    if(item.examples.length<3)item.examples.push({
      query:group.query,device:group.device,
      higher:{url:upper.url,title:upper.title,value:a,estimated_order:upper.estimated_order},
      lower:{url:lower.url,title:lower.title,value:b,estimated_order:lower.estimated_order},
      factor:key
    });
   }
  }
 }
 const factors=Object.values(stats).map(s=>{
  const n=s.pairs,rate=n?s.higher_greater/n:null;
  const qualified=n>=MIN_COMPARISONS&&s.queries.size>=MIN_QUERIES;
  let interpretation='표본 부족';
  if(qualified){
    if(rate>=0.65)interpretation='상위 쪽에서 더 큰 값이 반복 관측됨';
    else if(rate<=0.35)interpretation='하위 쪽에서 더 큰 값이 반복 관측됨';
    else interpretation='일관된 방향이 관측되지 않음';
  }
  return {key:s.key,label:s.label,pairs:n,higher_greater:s.higher_greater,
    lower_greater:s.lower_greater,observed_queries:s.queries.size,
    higher_greater_ratio:rate,qualified,interpretation,examples:s.examples};
 });
 return {
  generated_at:new Date().toISOString(),device,query_filter:filter,
  keyword_count:chosen.length,search_capture_count:observed.length,used_latest_capture_count:chosen.length,
  results_count:observations.length,matched_page_count:observations.filter(x=>x.matched).length,
  pair_comparisons:consideredPairs,groups,top_sources:topSources,factors,
  limitations:[
   '실제 네이버 랭킹 점수와 C-Rank, D.I.A., RRA의 내부 수치는 수집하거나 복원하지 못합니다.',
   '검색 결과의 순서는 HTML DOM으로 추정한 관측 순서로, 광고/AI/블록/개인화·기기 차이와 실제 시각적 순서가 다를 수 있습니다.',
   '문서 특성의 크기와 노출 순서 간 관련성을 비교할 뿐이며 알고리즘 가중치·상위노출 원인·인과관계를 의미하지 않습니다.',
   '사용자가 직접 수집한 검색결과와 직접 방문한 문서만 평가합니다. 일부만 저장한 경우 표본 편향이 큽니다.',
   '최근 검색 결과는 같은 키워드·기기별 최신 한 건만 사용하며, 이전 시점 비교는 별도의 검색 이력 분석을 사용하세요.',
   '동일 검색어·같은 콘텐츠 유형·서로 다른 출처 간 문서만 비교합니다. 그래도 통제되지 않은 다른 요인이 남습니다.',
   '표본이 적거나 공개 시점을 알 수 없는 경우 신뢰도 있는 결론을 내리지 않습니다.'
  ]
 };
}
export function rankLabPrompt(report){
 return [
  'NAVER Rank Lab 관측 분석을 해줘.',
  '제공하는 값은 공식 검색 알고리즘 점수가 아니라 사용자가 수집한 자료에서 계산한 관측치다.',
  'C-Rank, D.I.A., RRA의 공식 공개 설명과 비교할 수 있는 가설을 만들되 어떤 가설도 사실이라고 단정하지 마라.',
  '동일 검색어와 콘텐츠 유형 비교 결과만 사용하고, 반대 사례와 표본 편향·문서 수집 누락을 먼저 밝혀라.',
  '다음 검증에 필요한 키워드·표본·실험 변경 변수와 대조군을 제안하고, 상위노출을 보장한다고 주장하지 마라.',
  JSON.stringify(report,null,2)
 ].join('\n\n');
}
