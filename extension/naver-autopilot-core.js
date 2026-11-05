/*
 * Chat-to-browser job envelope. Treat all issue fields as untrusted input.
 * Only exact label + exact version marker + capped keyword/limit accepted.
 */
export const JOB_LABEL='serp-lens-request';
export const JOB_MARKER='SERP_LENS_JOB_V1';
export const JOB_RESULT_MARKER='SERP_LENS_JOB_RESULT_V1';
export const MAX_ARTICLES=6;
export const MAX_CANDIDATES=12;
const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
export function parseNaverJob(issue){
  if(!issue||!Number.isInteger(issue.number)||issue.number<1)throw Error('올바르지 않은 작업 번호');
  if(!Array.isArray(issue.labels)||!issue.labels.some(label=>
    (typeof label==='string'?label:label?.name)===JOB_LABEL))throw Error('승인된 요청 라벨이 없습니다.');
  if(issue.state!=='open'||issue.pull_request)throw Error('열린 검색 작업이 아닙니다.');
  const body=String(issue.body||'');
  const match=body.match(/^SERP_LENS_JOB_V1\r?\n(\{[^\n]*\})\s*$/);
  if(!match||body.length>900)throw Error('작업 내용 형식이 잘못됐습니다.');
  let data;try{data=JSON.parse(match[1]);}catch{throw Error('작업 JSON이 올바르지 않습니다.');}
  const keys=Object.keys(data).sort().join(',');
  if(keys!=='limit,query')throw Error('검색어와 최대 게시글 수만 허용합니다.');
  const query=clean(data.query);
  if(query.length<2||query.length>70||/[\u0000-\u001f<>]/.test(query))
    throw Error('검색어는 2~70자 일반 텍스트여야 합니다.');
  if(!Number.isInteger(data.limit)||data.limit<1||data.limit>MAX_ARTICLES)
    throw Error('게시글 수는 1~'+MAX_ARTICLES+'개로 제한합니다.');
  return {issue_number:issue.number,query,limit:data.limit};
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
