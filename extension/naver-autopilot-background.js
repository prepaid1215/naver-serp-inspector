/*
 * Naver Autopilot background worker (opt-in).
 *
 * User must explicitly enable it on the bridge page. Each GitHub issue with
 * the exact job label + schema is one authorization-scoped search request.
 * Searches open normal background tabs in this user's running Chrome session.
 * Never visits user-provided URLs, signs in, clicks, posts, or bypasses limits.
 */
import {extractOpenArticle} from './naver-article.js';
import {collectNaverSearchDOM} from './naver-autopilot-search.js';
import {checkPrivateRepository,uploadEvidence,updateEvidenceIndex} from './github-evidence-sync.js';
import {JOB_LABEL,JOB_RESULT_MARKER,parseNaverJob,naverSearchURL,pickNaverArticles} from './naver-autopilot-core.js';

const SETTINGS='serp-autopilot-settings-v1';
const STATUS='serp-autopilot-status-v1';
const SEEN='serp-autopilot-processed-v1';
const LAST_RESULT='serp-autopilot-last-result-v1';
const TOKEN='serp-lens-chat-bridge-token';
const ALARM='serp-autopilot-poll-v1';
const MAX_JOBS_PER_DAY=8;
let running=false;
const now=()=>new Date().toISOString();
const short=x=>String(x||'').slice(0,150);
const raw=(repo,path)=>'https://api.github.com/repos/'+repo+'/'+path;
function responseError(status){return 'GitHub API HTTP '+status;}
async function github(fetchURL,token,opts={}){
  const response=await fetch(fetchURL,{
    ...opts,
    headers:{
      Accept:'application/vnd.github+json',
      Authorization:'Bearer '+token,
      'X-GitHub-Api-Version':'2022-11-28',
      ...(opts.body?{'Content-Type':'application/json'}:{})
    }
  });
  if(!response.ok)throw Error(responseError(response.status));
  return response.status===204?null:response.json();
}
async function status(message,details={}){
  await chrome.storage.local.set({
    [STATUS]:{updated_at:now(),message:short(message),...details}
  });
}
async function token(){
  const values=await chrome.storage.session.get(TOKEN);
  return values?.[TOKEN]||'';
}
async function enabled(){
  const values=await chrome.storage.local.get(SETTINGS);
  return values?.[SETTINGS]||{enabled:false};
}
async function ensureEnabled(){
  const config=await enabled();
  if(!config.enabled)throw Error('자동 조사가 중지됐습니다.');
  return config;
}
async function waitLoaded(id,timeout=22000){
  const tab=await chrome.tabs.get(id).catch(()=>null);
  if(!tab)throw Error('검색 탭이 닫혔습니다.');
  if(tab.status!=='complete'){
    await new Promise((resolve,reject)=>{
      let timer;
      const listener=(changed,info)=>{
        if(changed===id&&info.status==='complete'){
          clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve();
        }
      };
      timer=setTimeout(()=>{
        chrome.tabs.onUpdated.removeListener(listener);
        reject(Error('페이지 로드 시간 초과'));
      },timeout);
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  // React/SmartEditor may render after the document load event.
  await new Promise(r=>setTimeout(r,1100));
}
async function openAndRead(url,extractor,allFrames=false){
  const tab=await chrome.tabs.create({url,active:false});
  if(!tab.id)throw Error('브라우저 검색 탭을 생성하지 못했습니다.');
  try{
    await waitLoaded(tab.id);
    await ensureEnabled();
    const outputs=await chrome.scripting.executeScript({
      target:{tabId:tab.id,allFrames},func:extractor
    });
    return outputs.map(x=>x.result).filter(Boolean);
  }finally{
    await chrome.tabs.remove(tab.id).catch(()=>{});
  }
}
async function currentProcessed(){
  const value=await chrome.storage.local.get(SEEN);
  return value?.[SEEN]||{day:now().slice(0,10),numbers:[],today_count:0};
}
async function markProcessed(number){
  const existing=await currentProcessed(),today=now().slice(0,10);
  const next={
    day:today,
    today_count:(existing.day===today?existing.today_count:0)+1,
    numbers:[...new Set([number,...existing.numbers])].slice(0,200)
  };
  await chrome.storage.local.set({[SEEN]:next});
}
async function postJobComment(config,secret,number,payload){
  const body=JOB_RESULT_MARKER+'\n'+JSON.stringify(payload);
  await github(raw(config.name,'issues/'+number+'/comments'),secret,{
    method:'POST',body:JSON.stringify({body})
  });
}
async function finishJob(config,secret,number,resultStatus){
  await github(raw(config.name,'issues/'+number),secret,{
    method:'PATCH',body:JSON.stringify({state:'closed',state_reason:resultStatus==='completed'?'completed':'not_planned'})
  });
}
async function ensureJobLabel(config,secret){
  const list=await github(raw(config.name,'labels?per_page=100'),secret);
  if(Array.isArray(list)&&list.some(x=>x.name===JOB_LABEL))return;
  const response=await fetch(raw(config.name,'labels'),{
    method:'POST',
    headers:{
      Accept:'application/vnd.github+json',
      Authorization:'Bearer '+secret,
      'X-GitHub-Api-Version':'2022-11-28',
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      name:JOB_LABEL,color:'2b6cb0',
      description:'Authorized SERP Lens Naver search request'
    })
  });
  if(!response.ok)throw Error('GitHub 작업 라벨 생성에 실패했습니다. 토큰에 Issues 읽기/쓰기 권한이 필요합니다. HTTP '+response.status);
}
async function fetchJobs(config,secret){
  const url=raw(config.name,'issues')+'?state=open&labels='+encodeURIComponent(JOB_LABEL)+
    '&per_page=20&sort=created&direction=asc';
  const issues=await github(url,secret);
  if(!Array.isArray(issues))throw Error('검색 요청 목록 응답이 올바르지 않습니다.');
  return issues.filter(x=>!x.pull_request);
}
async function executeJob(job,config,secret){
  await ensureEnabled();
  await status('네이버 검색 중: '+job.query,{issue_number:job.issue_number,phase:'search'});
  const [serp]=await openAndRead(naverSearchURL(job.query),collectNaverSearchDOM);
  if(!serp||!Array.isArray(serp.rows))throw Error('검색 결과를 읽지 못했습니다.');
  const articles=pickNaverArticles(serp.rows,job.limit);
  const captured_at=now();
  const rows=serp.rows.slice(0,100).map((r,index)=>({
    result_url:r.url,result_title:r.title,block_type:r.type,
    block_order:index+1,headline_hint:r.headline_hint,
    note:'DOM 후보 목록이며 실제 검색순위 아님'
  }));
  const uploaded=[],failures=[];
  if(rows.length){
    uploaded.push(await uploadEvidence({
      config,token:secret,type:'searches',
      record:{
        id:'issue-'+job.issue_number+'-serp',
        query:job.query,device:'PC',
        sourceURL:serp.source_url,captured_at,status:'candidate_links',
        notes:'DOM 후보. 실제 검색순위 또는 전체 페이지 순위가 아님.',
        rows
      }
    }));
  }
  for(const [index,article] of articles.entries()){
    await ensureEnabled();
    await status('게시글 본문 수집 '+(index+1)+'/'+articles.length+' — '+job.query,{
      issue_number:job.issue_number,phase:'articles',completed:index,total:articles.length
    });
    try{
      const frames=await openAndRead(article.url,extractOpenArticle,true);
      const candidate=frames.filter(x=>x?.text?.length>=90)
        .sort((a,b)=>(b.score||0)-(a.score||0))[0];
      if(!candidate||candidate.extraction_quality!=='article')
        throw Error('게시글 본문을 확인할 수 없습니다.');
      delete candidate.score;
      candidate.origin_url=article.url;
      uploaded.push(await uploadEvidence({
        config,token:secret,type:'pages',
        record:{
          id:'issue-'+job.issue_number+'-article-'+index,
          captured_at:now(),...candidate
        }
      }));
    }catch(error){
      failures.push({url:article.url,reason:short(error.message)});
    }
  }
  if(uploaded.length)await updateEvidenceIndex({config,token:secret,entries:uploaded});
  return {
    status:uploaded.filter(x=>x.kind==='pages').length===0?'incomplete':
      uploaded.filter(x=>x.kind==='pages').length<articles.length?'partial':'completed',
    query:job.query,limit:job.limit,issue_number:job.issue_number,
    captured_at,search_candidates:serp.rows.length,
    attempted_articles:articles.length,
    captured_articles:uploaded.filter(x=>x.kind==='pages').length,
    paths:uploaded.map(x=>x.path),
    failed_articles:failures,
    warning:'검색 결과의 DOM 링크 후보를 조사한 것이며 실제 네이버 순위는 검증되지 않았습니다.'
  };
}
async function poll(){
  if(running)return {ok:false,message:'이미 요청을 처리하고 있습니다.'};
  running=true;
  try{
    const settings=await enabled();
    if(!settings.enabled)return {ok:false,message:'자동 조사가 비활성화돼 있습니다.'};
    const secret=await token();
    if(!secret){
      await status('비공개 저장소 토큰이 없습니다. 연결 화면에서 다시 확인하세요.',{phase:'paused'});
      return {ok:false,message:'토큰이 없습니다.'};
    }
    const config=await checkPrivateRepository({
      repository:settings.repository,token:secret
    });
    const progress=await currentProcessed(),today=now().slice(0,10);
    if(progress.day===today&&progress.today_count>=MAX_JOBS_PER_DAY){
      await status('하루 최대 '+MAX_JOBS_PER_DAY+'건을 처리했습니다.',{phase:'limit'});
      return {ok:false,message:'일일 상한'};
    }
    const issues=await fetchJobs(config,secret);
    const item=issues.find(x=>!progress.numbers.includes(x.number));
    if(!item){
      const last=(await chrome.storage.local.get(LAST_RESULT))[LAST_RESULT];
      const label=last?'새 요청 없음 · 최근 '+last.query+' 본문 '+
        last.captured_articles+'/'+last.attempted_articles+'건 ('+last.status+')':
        '새 네이버 검색 요청이 없습니다.';
      await status(label,{phase:'idle',last_result:last||null});
      return {ok:true,processed:0};
    }
    let job;
    try{job=parseNaverJob(item);}
    catch(error){
      // Ignore arbitrary issues rather than executing untrusted issue bodies.
      await status('유효하지 않은 요청 건너뜀: #'+item.number,{phase:'ignored'});
      await markProcessed(item.number);
      return {ok:false,skipped:item.number,message:short(error.message)};
    }
    let result;
    try{
      result=await executeJob(job,config,secret);
    }catch(error){
      result={
        status:'failed',query:job.query,issue_number:job.issue_number,
        error:short(error.message),captured_at:now(),paths:[]
      };
    }
    await status('네이버 조사 '+(result.status==='completed'?'완료':result.status==='partial'?'일부 수집':'본문 수집 실패')+
      ': '+job.query,{issue_number:job.issue_number,phase:result.status,result});
    await chrome.storage.local.set({[LAST_RESULT]:result});
    try{await postJobComment(config,secret,job.issue_number,result);}
    catch(error){
      await status('조사 결과 댓글 등록 실패: '+short(error.message),{phase:'report-error'});
      return {ok:false,message:'댓글 등록 실패'};
    }
    try{await finishJob(config,secret,job.issue_number,result.status);}
    catch(error){await status('조사 댓글은 저장했으나 이슈를 닫지 못했습니다.',{phase:'close-error'});}
    await markProcessed(job.issue_number);
    return {ok:true,processed:1,result};
  }catch(error){
    await status('자동 조사 오류: '+short(error.message),{phase:'error'});
    return {ok:false,message:short(error.message)};
  }finally{running=false;}
}
async function ensureAlarm(){
  await chrome.alarms.create(ALARM,{periodInMinutes:1});
}
chrome.runtime.onInstalled.addListener(()=>{void ensureAlarm();});
chrome.runtime.onStartup.addListener(()=>{void ensureAlarm();});
void ensureAlarm();
chrome.alarms.onAlarm.addListener(event=>{
  if(event.name===ALARM)void poll();
});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(!message||!['AUTOPILOT_ENABLE','AUTOPILOT_DISABLE','AUTOPILOT_STATUS','AUTOPILOT_CHECK_NOW'].includes(message.type))return;
  (async()=>{
    if(message.type==='AUTOPILOT_STATUS'){
      const data=await chrome.storage.local.get([SETTINGS,STATUS,SEEN]);
      return {enabled:!!data[SETTINGS]?.enabled,
        repository:data[SETTINGS]?.repository||'',
        status:data[STATUS]||null,limits:{
          jobsPerDay:MAX_JOBS_PER_DAY,articlesPerJob:3
        }};
    }
    if(message.type==='AUTOPILOT_DISABLE'){
      await chrome.storage.local.set({[SETTINGS]:{enabled:false}});
      await status('자동 조사를 중지했습니다.',{phase:'disabled'});
      return {ok:true,enabled:false};
    }
    if(message.type==='AUTOPILOT_ENABLE'){
      const value=String(message.repository||'');
      const secret=await token();
      const config=await checkPrivateRepository({repository:value,token:secret});
      await ensureJobLabel(config,secret);
      await chrome.storage.local.set({[SETTINGS]:{
        enabled:true,repository:config.name,enabled_at:now()
      }});
      await status('자동 조사가 켜졌습니다. 전용 GitHub 요청만 실행합니다.',{phase:'enabled'});
      return {ok:true,enabled:true,repository:config.name};
    }
    return await poll();
  })().then(respond).catch(error=>respond({ok:false,error:short(error.message)}));
  return true;
});
