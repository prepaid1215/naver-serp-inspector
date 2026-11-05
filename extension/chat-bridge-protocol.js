/**
 * GitHub-powered Naver Chat Bridge protocol.
 * No public webhook, server or permanent token storage.
 * The result must only go to a private repository after explicit user approval.
 */
export const BRIDGE_SCHEMA='naver-chat-bridge-v1';
export const BRIDGE_JOB_SCHEMA='naver-chat-job-v1';
export const JOB_RE=/^[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6,16}$/;
export const ALLOWED_DOC_HOSTS=new Set([
  'blog.naver.com','m.blog.naver.com',
  'cafe.naver.com','m.cafe.naver.com'
]);
const normalize=value=>String(value??'').replace(/\s+/g,' ').trim();

export function parseRepository(value){
  const raw=normalize(value);
  if(!/^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(raw)||
    raw.includes('..'))throw Error('소유자/저장소 형식으로 입력해 주세요.');
  return raw;
}
export function parseBranch(value){
  const branch=normalize(value||'main');
  if(!/^[A-Za-z0-9._/-]{1,80}$/.test(branch)||branch.includes('..')||
    branch.startsWith('/')||branch.endsWith('/'))throw Error('브랜치 이름이 올바르지 않습니다.');
  return branch;
}
export function validateJob(input){
  if(!input||input.schema!==BRIDGE_JOB_SCHEMA)throw Error('지원하지 않는 요청 형식입니다.');
  if(!JOB_RE.test(input.job_id||''))throw Error('요청 ID 형식이 올바르지 않습니다.');
  if(input.mode!=='search_and_read')throw Error('지원하지 않는 검색 모드입니다.');
  const query=normalize(input.query);
  if(query.length<2||query.length>80)throw Error('네이버 검색어를 2~80자 이내로 지정해 주세요.');
  if(input.device!=='PC')throw Error('첫 버전은 PC 네이버 검색만 지원합니다.');
  const limit=Number(input.max_articles);
  if(!Number.isInteger(limit)||limit<1||limit>10)throw Error('본문 수집 수는 1~10개여야 합니다.');
  const requestedAt=Date.parse(input.requested_at);
  if(!Number.isFinite(requestedAt))throw Error('요청 시각이 올바르지 않습니다.');
  if(Date.now()-requestedAt>7*86400e3||requestedAt>Date.now()+600000)
    throw Error('7일보다 오래됐거나 미래 시각인 요청은 실행하지 않습니다.');
  return {schema:BRIDGE_JOB_SCHEMA,job_id:input.job_id,mode:'search_and_read',
    query,device:'PC',max_articles:limit,requested_at:new Date(requestedAt).toISOString()};
}
export function requestPath(id){
  if(!JOB_RE.test(id))throw Error('요청 ID가 올바르지 않습니다.');
  return 'bridge/requests/'+id+'.json';
}
export function resultPath(id){
  if(!JOB_RE.test(id))throw Error('요청 ID가 올바르지 않습니다.');
  return 'bridge/results/'+id+'.json';
}
export function supportedArticleURL(raw){
  try{
    const url=new URL(raw);
    url.hash='';
    if(url.protocol!=='https:'||!ALLOWED_DOC_HOSTS.has(url.hostname.toLowerCase()))return '';
    // Strictly public Naver blog/cafe pages; not admin, login, settings or private pages.
    if(/(?:admin|write|edit|setting|delete|login|profile)/i.test(url.pathname))return '';
    if(url.username||url.password)return '';
    return url.href;
  }catch{return '';}
}
export function summarizeRows(rows,limit=40){
  return (rows||[]).filter(r=>r&&r.result_url&&r.block_type!=='AD').slice(0,limit)
   .map(r=>({block_type:String(r.block_type||'UNCLASSIFIED').slice(0,24),
     result_title:normalize(r.result_title).slice(0,240),
     result_url:String(r.result_url).slice(0,1000),
     block_order:Number.isInteger(r.block_order)?r.block_order:null,
     rank_in_block:Number.isInteger(r.rank_in_block)?r.rank_in_block:null,
     organic_rank:Number.isInteger(r.organic_rank)?r.organic_rank:null,
     confidence:String(r.confidence||'unknown').slice(0,20)}));
}
export function selectArticles(rows,limit){
  const seen=new Set(),found=[];
  for(const r of rows||[]){
    if(!['BLOG','CAFE'].includes(r.block_type))continue;
    const url=supportedArticleURL(r.result_url);
    if(!url)continue;
    const key=url.replace(/^https:\/\/m\./,'https://').replace(/[?#].*$/,'').replace(/\/$/,'');
    if(seen.has(key))continue;
    seen.add(key);
    found.push({result_url:url,serp_title:normalize(r.result_title).slice(0,240),
      block_type:r.block_type,organic_rank:Number.isInteger(r.organic_rank)?r.organic_rank:null});
    if(found.length>=limit)break;
  }
  return found;
}
export function buildResult(job,search,articles,capturedAt=new Date()){
  const request=validateJob(job);
  return {
    schema:BRIDGE_SCHEMA,
    job_id:request.job_id,requested_at:request.requested_at,captured_at:capturedAt.toISOString(),
    query:request.query,device:'PC',source:'local-user-approved-chrome-extension',
    search:{
      url:search.url||'',status:search.status||'unknown',
      notes:search.notes||'',parsed_count:search.rows?.length||0,
      rows:summarizeRows(search.rows,60)
    },
    articles:(articles||[]).slice(0,10).map(a=>({
      serp_url:a.serp_url||'',serp_title:normalize(a.serp_title).slice(0,240),
      serp_type:a.serp_type||'',serp_order:a.serp_order??null,
      fetch_status:a.fetch_status||'unknown',article_url:a.article_url||'',
      title:normalize(a.title).slice(0,300),
      text:normalize(a.text).slice(0,15000),
      headings:(a.headings||[]).slice(0,50).map(h=>normalize(h).slice(0,200)),
      images:Number.isInteger(a.images)?a.images:0,
      published_at:a.published_at||'',content_confidence:a.content_confidence||'low',
      error:normalize(a.error).slice(0,240)
    })),
    limitations:[
      '네이버 공식 순위나 비공개 C-Rank/D.I.A. 점수를 의미하지 않습니다.',
      '검색 화면 DOM 파서에 나타난 일부 제목 링크만 대상으로 합니다.',
      '사용자 승인으로 열린 Naver 블로그·카페 문서만 수집하며 외부 사이트는 수집하지 않습니다.',
      '네이버 iframe·동적 로딩에 따라 본문이 누락되거나 불완전할 수 있습니다.',
      '검색 결과와 본문을 저장한 비공개 GitHub 저장소의 접근 권한을 따릅니다.'
    ]
  };
}
