import {parseSERP} from '../web/engine.js';
import {inspectNaverArticle} from './chat-bridge-inspector.js';
import {selectArticles,buildResult} from './chat-bridge-protocol.js';

const SEARCH_ORIGIN='https://search.naver.com';
const MAX_HTML=22*1024*1024;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitLoaded(tabId,timeoutMs=25000){
  const current=await chrome.tabs.get(tabId);
  if(current.status==='complete')return current;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      chrome.tabs.onUpdated.removeListener(listener);
      reject(Error('페이지 열림 시간 초과'));
    },timeoutMs);
    function listener(id,change){
      if(id!==tabId||change.status!=='complete')return;
      clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);
      resolve(chrome.tabs.get(tabId));
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
async function withTab(url,handler){
  const tab=await chrome.tabs.create({url,active:false});
  try{
    await waitLoaded(tab.id);
    await delay(1200); // allow client-rendered Naver text to settle
    return await handler(tab.id);
  }finally{
    try{await chrome.tabs.remove(tab.id);}catch{}
  }
}
async function collectSERP(query){
  const url=SEARCH_ORIGIN+'/search.naver?query='+encodeURIComponent(query);
  return withTab(url,async tabId=>{
    const [injected]=await chrome.scripting.executeScript({
      target:{tabId},func:()=>({
        url:location.href,
        html:document.documentElement?.outerHTML||'',
        title:document.title
      })
    });
    const observed=injected?.result;
    if(!observed?.html)throw Error('네이버 검색 HTML을 읽지 못했습니다.');
    if(new TextEncoder().encode(observed.html).byteLength>MAX_HTML)
      throw Error('네이버 검색 HTML 22MB 초과');
    const parsed=parseSERP(observed.html,{
      filename:'chat-bridge-serp.html',query,device:'PC',
      observed:new Date().toISOString()
    });
    return {
      url:observed.url,status:parsed.status,notes:parsed.notes,rows:parsed.rows,
      extracted_at:new Date().toISOString()
    };
  });
}
async function collectArticle(target){
  return withTab(target.result_url,async tabId=>{
    let responses;
    try{
      responses=await chrome.scripting.executeScript({
        target:{tabId,allFrames:true},func:inspectNaverArticle
      });
    }catch(error){
      // A cross-origin iframe may block some frames; try main frame only.
      responses=await chrome.scripting.executeScript({
        target:{tabId},func:inspectNaverArticle
      });
    }
    const best=(responses||[]).map(x=>x.result).filter(Boolean)
      .sort((a,b)=>(b.scored_length||0)-(a.scored_length||0))[0];
    return {
      serp_url:target.result_url,serp_title:target.serp_title,
      serp_type:target.block_type,serp_order:target.organic_rank,
      article_url:best?.article_url||target.result_url,
      title:best?.title||target.serp_title,
      text:best?.text||'',headings:best?.headings||[],
      images:best?.images||0,published_at:best?.published_at||'',
      content_confidence:best?.content_confidence||'unavailable',
      fetch_status:best?.fetch_status||'unavailable',
      error:best?.error||'본문을 찾을 수 없습니다.'
    };
  });
}
/**
 * A single job requires explicit user click. Does NOT automatically poll,
 * bypass CAPTCHA, capture login credentials or visit arbitrary web sites.
 */
export async function runNaverBridgeJob(job,onProgress=()=>{}){
  onProgress('네이버에서 '+job.query+' 검색 화면을 읽는 중…');
  const search=await collectSERP(job.query);
  const targets=selectArticles(search.rows,job.max_articles);
  const articles=[];
  onProgress('검색에서 블로그·카페 링크 '+targets.length+'개를 찾았습니다.');
  for(let i=0;i<targets.length;i++){
    const target=targets[i];
    onProgress('게시글 '+(i+1)+'/'+targets.length+' · '+target.serp_title.slice(0,36));
    try{articles.push(await collectArticle(target));}
    catch(error){
      articles.push({
        serp_url:target.result_url,serp_title:target.serp_title,
        serp_type:target.block_type,serp_order:target.organic_rank,
        fetch_status:'error',error:String(error.message||error).slice(0,200)
      });
    }
    if(i+1<targets.length)await delay(1400);
  }
  onProgress('수집 완료: 검색 링크 '+(search.rows?.length||0)+'개 / 본문 시도 '+articles.length+'개');
  return buildResult(job,search,articles);
}
