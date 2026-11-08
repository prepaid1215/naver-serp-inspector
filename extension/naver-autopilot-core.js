/*
 * Chat-to-browser job envelope. Treat all issue fields as untrusted input.
 * Only exact label + exact version marker + capped keyword/limit accepted.
 */
export const JOB_LABEL='serp-lens-request';
export const JOB_MARKER='SERP_LENS_JOB_V1';
export const TITLE_COMPARE_MARKER='SERP_LENS_TITLE_COMPARE_V1';
export const MAX_COMPARE_QUERIES=4;
export const JOB_RESULT_MARKER='SERP_LENS_JOB_RESULT_V1';
export const MAX_ARTICLES=6;
export const MAX_CANDIDATES=12;
const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
const validQuery=query=>query.length>=2&&query.length<=70&&
  !/[\u0000-\u001f<>]/.test(query);
export function parseNaverJob(issue){
  if(!issue||!Number.isInteger(issue.number)||issue.number<1)throw Error('올바르지 않은 작업 번호');
  if(!Array.isArray(issue.labels)||!issue.labels.some(label=>
    (typeof label==='string'?label:label?.name)===JOB_LABEL))throw Error('승인된 요청 라벨이 없습니다.');
  if(issue.state!=='open'||issue.pull_request)throw Error('열린 검색 작업이 아닙니다.');
  const body=String(issue.body||'');
  const match=body.match(/^(SERP_LENS_JOB_V1|SERP_LENS_TITLE_COMPARE_V1)\r?\n(\{[^\n]*\})\s*$/);
  if(!match||body.length>900)throw Error('작업 내용 형식이 잘못됐습니다.');
  let data;try{data=JSON.parse(match[2]);}catch{throw Error('작업 JSON이 올바르지 않습니다.');}
  if(!Number.isInteger(data.limit)||data.limit<1||data.limit>MAX_ARTICLES)
    throw Error('게시글 수는 1~'+MAX_ARTICLES+'개로 제한합니다.');
  const keys=Object.keys(data).sort().join(',');
  if(match[1]===JOB_MARKER){
    if(keys!=='limit,query')throw Error('검색어와 최대 게시글 수만 허용합니다.');
    const query=clean(data.query);
    if(!validQuery(query))throw Error('검색어는 2~70자 일반 텍스트여야 합니다.');
    return {issue_number:issue.number,query,limit:data.limit};
  }
  if(keys!=='limit,queries'||!Array.isArray(data.queries)||
    data.queries.length<2||data.queries.length>MAX_COMPARE_QUERIES)
    throw Error('제목 비교에는 검색어 2~4개만 허용합니다.');
  if(data.queries.some(x=>typeof x!=='string'||!validQuery(clean(x))))
    throw Error('검색어는 2~70자 일반 텍스트여야 합니다.');
  const queries=data.queries.map(clean);
  if(new Set(queries.map(q=>q.toLocaleLowerCase('ko-KR'))).size!==queries.length)
    throw Error('중복 검색어는 비교할 수 없습니다.');
  return {issue_number:issue.number,query:queries[0],queries,limit:data.limit,
    mode:'title_compare'};
}
export function naverSearchURL(query){
  const q=clean(query);
  if(q.length<2||q.length>70)throw Error('검색어 길이가 올바르지 않습니다.');
  return 'https://search.naver.com/search.naver?where=nexearch&query='+encodeURIComponent(q);
}
export function validNaverArticleURL(input){
  let u;try{u=new URL(input);}catch{return null;}
  if(u.protocol!=='https:'||u.username||u.password)return null;
  const host=u.hostname.toLowerCase();
  const blog=['blog.naver.com','m.blog.naver.com'].includes(host);
  const cafe=['cafe.naver.com','m.cafe.naver.com'].includes(host);
  if(!blog&&!cafe)return null;
  const path=u.pathname;
  let isArticle=false;
  if(blog){
    // Blog profile links (/blogId) are NOT individual posts.
    isArticle=/^\/[A-Za-z0-9_-]{2,80}\/\d{8,20}\/?$/.test(path);
    if(!isArticle&&/^\/PostView\.naver$/i.test(path)){
      const id=u.searchParams.get('blogId'),number=u.searchParams.get('logNo');
      isArticle=/^[A-Za-z0-9_-]{2,80}$/.test(id||'')&&/^\d{8,20}$/.test(number||'');
    }
    if(!isArticle&&/^\/PostView\.nhn$/i.test(path)){
      const id=u.searchParams.get('blogId'),number=u.searchParams.get('logNo');
      isArticle=/^[A-Za-z0-9_-]{2,80}$/.test(id||'')&&/^\d{8,20}$/.test(number||'');
    }
  }else if(cafe){
    // Cafe homepage links (/clubSlug) are NOT individual articles.
    isArticle=/^\/[A-Za-z0-9_-]{2,80}\/\d{1,20}\/?$/.test(path);
    if(!isArticle&&/^\/ca-fe\/cafes\/\d+\/articles\/\d+\/?$/i.test(path))isArticle=true;
    if(!isArticle&&/^\/ArticleRead\.(?:nhn|naver)$/i.test(path)){
      const club=u.searchParams.get('clubid'),article=u.searchParams.get('articleid');
      isArticle=/^\d{1,20}$/.test(club||'')&&/^\d{1,20}$/.test(article||'');
    }
  }
  if(!isArticle)return null;
  u.hash='';
  return u.href;
}
// Choose from both Naver sources when both are available. This is source
// diversity, NOT an assertion about visual or organic ranking. Preserve the
// search DOM order within each source and keep all search-linked parameters
// (some Cafe articles need the referral token for public rendering).
export function pickNaverArticles(rows,limit=3){
  const cap=Math.min(MAX_CANDIDATES,Math.max(1,Math.floor(limit)||1));
  const byType={BLOG:[],CAFE:[]},seen=new Set();
  let firstType='';
  for(const row of rows||[]){
    if(row.type!=='BLOG'&&row.type!=='CAFE')continue;
    const url=validNaverArticleURL(row.url);
    if(!url)continue;
    const u=new URL(url);
    let key=u.hostname+u.pathname.replace(/\/$/,'');
    if(/\/PostView\.(?:naver|nhn)$/i.test(u.pathname)){
      key=u.hostname+'/'+u.searchParams.get('blogId')+'/'+u.searchParams.get('logNo');
    }
    if(/\/ArticleRead\.(?:naver|nhn)$/i.test(u.pathname)){
      key=u.hostname+'/'+u.searchParams.get('clubid')+'/'+u.searchParams.get('articleid');
    }
    if(seen.has(key))continue;
    seen.add(key);
    if(!firstType)firstType=row.type;
    byType[row.type].push({title:clean(row.title).slice(0,250),url,type:row.type});
  }
  const order=firstType==='CAFE'?['CAFE','BLOG']:['BLOG','CAFE'];
  const selected=[];
  while(selected.length<cap&&(byType.BLOG.length||byType.CAFE.length)){
    for(const kind of order){
      if(selected.length>=cap)break;
      if(byType[kind].length)selected.push(byType[kind].shift());
    }
  }
  return selected;
}
export function jobIssueBody(query,limit=3){
  const q=clean(query);
  const number=Math.min(MAX_ARTICLES,Math.max(1,Math.floor(limit)));
  if(q.length<2||q.length>70||/[\u0000-\u001f<>]/.test(q))throw Error('검색어가 올바르지 않습니다.');
  return JOB_MARKER+'\n'+JSON.stringify({query:q,limit:number});
}

export function titleCompareIssueBody(queries,limit=6){
  if(!Array.isArray(queries)||queries.length<2||queries.length>MAX_COMPARE_QUERIES)
    throw Error('제목 비교 검색어는 2~4개여야 합니다.');
  const cleanQueries=queries.map(q=>clean(q));
  if(cleanQueries.some(q=>!validQuery(q))||
    new Set(cleanQueries.map(q=>q.toLocaleLowerCase('ko-KR'))).size!==cleanQueries.length)
    throw Error('검색어가 올바르지 않거나 중복됐습니다.');
  const n=Math.min(MAX_ARTICLES,Math.max(1,Math.floor(limit)));
  return TITLE_COMPARE_MARKER+'\n'+JSON.stringify({queries:cleanQueries,limit:n});
}

// A stable, query-independent identity for common Naver post URL formats.
// Tracking/referral query strings are ignored. Comparing different Cafe URL
// aliases cannot always be resolved and may undercount overlaps.
export function naverArticleIdentity(input){
  const url=validNaverArticleURL(input);
  if(!url)return null;
  const u=new URL(url),host=u.hostname.replace(/^m\./,'');
  if(host==='blog.naver.com'){
    const parts=u.pathname.match(/^\/([\w-]{2,80})\/(\d{8,20})\/?$/);
    if(parts)return 'blog:'+parts[1].toLowerCase()+'/'+parts[2];
    if(/^\/PostView\.(?:nhn|naver)$/i.test(u.pathname))
      return 'blog:'+u.searchParams.get('blogId').toLowerCase()+'/'+u.searchParams.get('logNo');
  }
  if(host==='cafe.naver.com'){
    if(/^\/ArticleRead\.(?:nhn|naver)$/i.test(u.pathname))
      return 'cafe-id:'+u.searchParams.get('clubid')+'/'+u.searchParams.get('articleid');
    const canonical=u.pathname.match(/^\/ca-fe\/cafes\/(\d+)\/articles\/(\d+)\/?$/i);
    if(canonical)return 'cafe-id:'+canonical[1]+'/'+canonical[2];
    const legacy=u.pathname.match(/^\/([\w-]{2,80})\/(\d{1,20})\/?$/);
    if(legacy)return 'cafe-slug:'+legacy[1].toLowerCase()+'/'+legacy[2];
  }
  return host+u.pathname.replace(/\/$/,'');
}
export function compareNaverQueryObservations(snapshots){
  if(!Array.isArray(snapshots)||!snapshots.length)return {queries:[],counts:[],overlaps:[],repeated_articles:[]};
  const sightings=new Map(),counts=[];
  for(const snapshot of snapshots){
    const seen=new Set();
    for(const row of snapshot.rows||[]){
      const id=naverArticleIdentity(row.url);
      if(!id||seen.has(id))continue;
      seen.add(id);
      if(!sightings.has(id))sightings.set(id,{
        id,type:row.type,url:row.url,sightings:[]
      });
      sightings.get(id).sightings.push({
        query:snapshot.query,
        displayed_title:clean(row.visible_title||row.title).slice(0,260),
        title_confidence:row.title_confidence||'unknown',
        visual_order_candidate:row.document_visual_order||null,
        source_order_candidate:row.source_visual_order||null,
        block_heading_hint:row.block_heading_hint||''
      });
    }
    counts.push({query:snapshot.query,article_link_candidates:seen.size});
  }
  const overlaps=[];
  for(let i=0;i<snapshots.length;i++){
    for(let j=i+1;j<snapshots.length;j++){
      const qa=snapshots[i].query,qb=snapshots[j].query;
      overlaps.push({query_a:qa,query_b:qb,
        shared_article_candidates:[...sightings.values()].filter(x=>
          x.sightings.some(s=>s.query===qa)&&x.sightings.some(s=>s.query===qb)).length});
    }
  }
  const repeated=[...sightings.values()].filter(x=>x.sightings.length>1)
    .sort((a,b)=>b.sightings.length-a.sightings.length);
  return {queries:snapshots.map(x=>x.query),counts,overlaps,
    all_unique_article_candidates:sightings.size,
    repeated_article_count:repeated.length,
    repeated_articles:repeated.slice(0,20)};
}
