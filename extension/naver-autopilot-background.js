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
import {readGitHubToken} from './github-token-store.js';
import {JOB_LABEL,JOB_RESULT_MARKER,MAX_ARTICLES,MAX_CANDIDATES,parseNaverJob,naverSearchURL,pickNaverArticles,validNaverArticleURL,naverArticleIdentity,compareNaverQueryObservations} from './naver-autopilot-core.js';

const SETTINGS='serp-autopilot-settings-v1';
const STATUS='serp-autopilot-status-v1';
const SEEN='serp-autopilot-processed-v1';
const LAST_RESULT='serp-autopilot-last-result-v1';
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
async function token(repository){
  return readGitHubToken(repository);
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
async function currentProcessed(repository){
  const value=await chrome.storage.local.get(SEEN);
  const previous=value?.[SEEN];
  // Issue numbers are repo-local. Never skip #1 in a new private repository
  // just because a previous repository had a processed issue #1.
  if(previous?.repository!==repository)
    return {repository,day:now().slice(0,10),numbers:[],today_count:0};
  return previous;
}
async function markProcessed(number,repository){
  const existing=await currentProcessed(repository),today=now().slice(0,10);
  const next={
    repository,day:today,
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
async function existingJobResult(config,secret,number){
  const url=raw(config.name,'issues/'+number+'/comments?per_page=100');
  const comments=await github(url,secret);
  if(!Array.isArray(comments))throw Error('기존 작업 댓글을 확인하지 못했습니다.');
  for(const comment of comments){
    const body=String(comment.body||'');
    if(!body.startsWith(JOB_RESULT_MARKER+'\n'))continue;
    try{
      const data=JSON.parse(body.slice(JOB_RESULT_MARKER.length+1));
      if(data.issue_number===number &&
         ['completed','partial','incomplete','failed'].includes(data.status))
        return data;
    }catch{}
  }
  return null;
}
async function fetchJobs(config,secret){
  const url=raw(config.name,'issues')+'?state=open&labels='+encodeURIComponent(JOB_LABEL)+
    '&per_page=20&sort=created&direction=asc';
  const issues=await github(url,secret);
  if(!Array.isArray(issues))throw Error('검색 요청 목록 응답이 올바르지 않습니다.');
  return issues.filter(x=>!x.pull_request);
}
// Search fields are persisted through github-evidence-sync's strict whitelist.
function searchEvidenceRows(rows){
  return (rows||[]).slice(0,100).map((r,index)=>({
    result_url:r.url,result_title:r.visible_title||r.title||'',
    block_type:r.type,block_order:index+1,
    anchor_text:r.anchor_text||'',
    title_confidence:r.title_confidence||'unverified',
    title_source:r.title_source||'unknown',
    is_article_link:r.is_article_link===true,
    document_visual_order:r.document_visual_order||null,
    source_visual_order:r.source_visual_order||null,
    observed_y_px:Number.isFinite(r.y)?r.y:null,
    block_heading_hint:r.block_heading_hint||'',
    block_heading_confidence:r.block_heading_confidence||'unverified',
    block_id:r.block_id||'unclassified',
    block_label:r.block_label||'',
    block_kind:r.block_kind||'UNCLASSIFIED',
    block_confidence:r.block_confidence||'unverified',
    snippet_text:r.snippet_text||'',
    snippet_basis:r.snippet_basis||'not_observed',
    note:'관측된 DOM 링크의 화면 순서 후보이며 실제 네이버 검색 순위가 아님'
  }));
}
function searchRecord(serp,jobQuery,issueNumber,index=0){
  return {
    id:'issue-'+issueNumber+'-serp-'+index,
    query:jobQuery,device:'PC',
    sourceURL:serp.source_url,captured_at:serp.observed_at||now(),
    status:'visual_link_observation',
    notes:'화면 Y 순서에 따른 게시글 링크 후보. 실제 네이버 통합검색/블로그탭 순위 아님.',
    position_basis:serp.position_basis||'unverified',
    viewport:serp.viewport||null,
    blocks:serp.blocks||[],
    ugc_observation:serp.ugc_observation||{
      state:'not_determined',candidate_block_count:0,observed_block_count:0,
      note:'검색 결과에서 블록 구조를 판별할 수 없었습니다.'
    },
    rows:searchEvidenceRows(serp.rows)
  };
}
async function executeJob(job,config,secret){
  await ensureEnabled();
  await status('네이버 검색 중: '+job.query,{issue_number:job.issue_number,phase:'search'});
  const [serp]=await openAndRead(naverSearchURL(job.query),collectNaverSearchDOM);
  if(!serp||!Array.isArray(serp.rows))throw Error('검색 결과를 읽지 못했습니다.');
  // Collect more validated candidates than requested so a blocked/inaccessible
  // post can be replaced without reporting an avoidable incomplete result.
  // The upper bound limits navigation and stays within the user's job scope.
  const articles=pickNaverArticles(serp.rows,
    Math.min(MAX_CANDIDATES,Math.max(job.limit+2,job.limit*2)));
  const discovered={BLOG:0,CAFE:0};
  for(const row of serp.rows){
    if(validNaverArticleURL(row.url)&&Object.hasOwn(discovered,row.type))
      discovered[row.type]++;
  }
  let attempted=0;
  const captured_at=now();
  const rows=searchEvidenceRows(serp.rows);
  const uploaded=[],failures=[],article_summaries=[];
  if(rows.length){
    uploaded.push(await uploadEvidence({
      config,token:secret,type:'searches',
      record:searchRecord(serp,job.query,job.issue_number,0)
    }));
  }
  for(const [index,article] of articles.entries()){
    if(article_summaries.length>=job.limit)break;
    await ensureEnabled();
    attempted++;
    await status('게시글 본문 수집 '+(article_summaries.length+1)+'/'+job.limit+' — '+job.query,{
      issue_number:job.issue_number,phase:'articles',completed:article_summaries.length,total:job.limit,attempted
    });
    try{
      const frames=await openAndRead(article.url,extractOpenArticle,true);
      const candidate=frames.filter(x=>x?.text?.length>=90)
        .sort((a,b)=>(b.score||0)-(a.score||0))[0];
      if(!candidate||candidate.extraction_quality!=='article')
        throw Error('게시글 본문을 확인할 수 없습니다.');
      delete candidate.score;
      candidate.origin_url=article.url;
      const saved=await uploadEvidence({
        config,token:secret,type:'pages',
        record:{
          id:'issue-'+job.issue_number+'-article-'+index,
          captured_at:now(),...candidate
        }
      });
      uploaded.push(saved);
      article_summaries.push({
        title:String(candidate.title||'').slice(0,250),
        url:String(candidate.url||article.url).slice(0,2048),
        source_kind:candidate.source_kind||article.type,
        path:saved.path,
        raw_characters:candidate.text?.length||0,
        clean_characters:candidate.clean_text?.length||0,
        heading_candidates:(candidate.headings||[]).slice(0,8).map(h=>String(h.text||'').slice(0,130)),
        images:Number.isInteger(candidate.images)?candidate.images:0,
        completeness:'not_verified',
        search_observation:{
          displayed_title:article.title||'',
          title_confidence:article.title_confidence||'unverified',
          document_visual_order:article.document_visual_order||null,
          source_visual_order:article.source_visual_order||null,
          block_heading_hint:article.block_heading_hint||''
        },
        extraction_warnings:(candidate.extraction_audit?.warnings||[]).slice(0,4)
      });
    }catch(error){
      failures.push({url:article.url,reason:short(error.message)});
    }
  }
  if(uploaded.length)await updateEvidenceIndex({config,token:secret,entries:uploaded});
  const captured=article_summaries.length;
  return {
    status:captured>=job.limit?'completed':captured?'partial':'incomplete',
    query:job.query,limit:job.limit,issue_number:job.issue_number,
    captured_at,search_candidates:serp.rows.length,
    ugc_observation:serp.ugc_observation||{state:'not_determined'},
    observed_blocks:(serp.blocks||[]).slice(0,20).map(b=>({
      label:b.label,kind:b.kind,article_links:b.article_links
    })),
    // These are visible DOM link candidates, never a measured Naver ranking.
    search_article_links:discovered,
    candidate_articles:articles.length,
    requested_articles:job.limit,
    attempted_articles:attempted,
    captured_articles:captured,
    captured_sources:{
      BLOG:article_summaries.filter(x=>x.source_kind==='NAVER_BLOG').length,
      CAFE:article_summaries.filter(x=>x.source_kind==='NAVER_CAFE').length
    },
    selection_strategy:'alternate_blog_cafe_retry_on_failure',
    position_basis:serp.position_basis||'not_verified',
    article_summaries,
    paths:uploaded.map(x=>x.path),
    failed_articles:failures,
    warning:'네이버 검색 페이지의 DOM 링크 후보에서 블로그와 카페를 번갈아 조사했습니다. 수집 순서는 네이버 노출 순위가 아니며 원문 완전성은 검증되지 않았습니다.'
  };
}
// Title comparison is an explicitly authorized 2-4 query request.
// It records cross-query presence; observed vertical order is NOT official rank.
async function executeTitleComparison(job,config,secret){
  await ensureEnabled();
  const snapshots=[],uploaded=[],failures=[],article_summaries=[];
  const captured_at=now();
  for(const [index,query] of job.queries.entries()){
    await ensureEnabled();
    await status('제목 비교 검색 '+(index+1)+'/'+job.queries.length+': '+query,{
      issue_number:job.issue_number,phase:'compare-search',
      completed:index,total:job.queries.length
    });
    try{
      const [serp]=await openAndRead(naverSearchURL(query),collectNaverSearchDOM);
      if(!serp||!Array.isArray(serp.rows))throw Error('검색 화면을 읽지 못했습니다.');
      snapshots.push({query,rows:serp.rows,serp});
      const saved=await uploadEvidence({
        config,token:secret,type:'searches',
        record:searchRecord(serp,query,job.issue_number,index)
      });
      uploaded.push(saved);
    }catch(error){failures.push({query,reason:short(error.message)});}
  }
  if(snapshots.length===0)throw Error('검색어 비교 결과를 수집하지 못했습니다.');
  const comparison=compareNaverQueryObservations(snapshots);
  const all=new Map();
  for(const snap of snapshots){
    for(const row of snap.rows){
      const identity=naverArticleIdentity(row.url);
      if(!identity)continue;
      if(!all.has(identity))all.set(identity,{...row,identity,seen_queries:[]});
      all.get(identity).seen_queries.push({
        query:snap.query,displayed_title:row.visible_title||row.title||'',
        title_confidence:row.title_confidence||'unverified',
        document_visual_order:row.document_visual_order||null,
        source_visual_order:row.source_visual_order||null,
        block_heading_hint:row.block_heading_hint||''
      });
    }
  }
  // Read commonly detected articles first; retain one-query-only candidates.
  // Source diversity and bounded retries are enforced by pickNaverArticles.
  const candidates=[...all.values()].sort((a,b)=>b.seen_queries.length-a.seen_queries.length||
    (a.document_visual_order||999)-(b.document_visual_order||999));
  const selected=pickNaverArticles(candidates,
    Math.min(MAX_CANDIDATES,Math.max(job.limit+2,job.limit*2)));
  let attempted=0;
  for(const [index,article] of selected.entries()){
    if(article_summaries.length>=job.limit)break;
    await ensureEnabled();
    attempted++;
    await status('제목 비교 본문 수집 '+(article_summaries.length+1)+'/'+job.limit,{
      issue_number:job.issue_number,phase:'compare-articles',
      attempted,total:job.limit
    });
    const identity=naverArticleIdentity(article.url);
    const observations=all.get(identity)?.seen_queries||[];
    try{
      const frames=await openAndRead(article.url,extractOpenArticle,true);
      const candidate=frames.filter(x=>x?.text?.length>=90)
        .sort((a,b)=>(b.score||0)-(a.score||0))[0];
      if(!candidate||candidate.extraction_quality!=='article')
        throw Error('게시글 본문을 확인할 수 없습니다.');
      delete candidate.score;
      candidate.origin_url=article.url;
      const saved=await uploadEvidence({
        config,token:secret,type:'pages',
        record:{id:'issue-'+job.issue_number+'-article-'+index,
          captured_at:now(),...candidate}
      });
      uploaded.push(saved);
      article_summaries.push({
        title:String(candidate.title||'').slice(0,250),
        url:String(candidate.url||article.url).slice(0,2048),
        source_kind:candidate.source_kind||article.type,
        path:saved.path,
        raw_characters:candidate.text?.length||0,
        clean_characters:candidate.clean_text?.length||0,
        observed_queries:observations,
        // Only a directly observed headline can support a comparison.
        // Missing/uncertain titles must not become false mismatches.
        title_disagreement:observations.some(x=>x.title_confidence==='high')?
          observations.some(x=>x.title_confidence==='high'&&
            x.displayed_title&&x.displayed_title!==candidate.title):null,
        completeness:'not_verified'
      });
    }catch(error){failures.push({url:article.url,reason:short(error.message)});}
  }
  if(uploaded.length)await updateEvidenceIndex({config,token:secret,entries:uploaded});
  return {
    status:snapshots.length===job.queries.length&&article_summaries.length>=job.limit?'completed':
      snapshots.length?'partial':'incomplete',
    mode:'title_compare',query:job.query,queries:job.queries,
    issue_number:job.issue_number,captured_at,
    requested_articles:job.limit,attempted_articles:attempted,
    captured_articles:article_summaries.length,
    captured_sources:{
      BLOG:article_summaries.filter(x=>x.source_kind==='NAVER_BLOG').length,
      CAFE:article_summaries.filter(x=>x.source_kind==='NAVER_CAFE').length
    },
    search_candidate_counts:comparison.counts,
    ugc_observations:snapshots.map(s=>({
      query:s.query,...(s.serp.ugc_observation||{state:'not_determined'}),
      blocks:(s.serp.blocks||[]).slice(0,20).map(b=>({
        label:b.label,kind:b.kind,article_links:b.article_links
      }))
    })),
    query_comparison:comparison,
    article_summaries,
    paths:uploaded.map(x=>x.path),
    failed_articles:failures,
    warning:'검색 결과의 게시글 후보 출현 여부와 화면 배치 순서만 관측했습니다. 광고·스마트블록·개인화가 혼합된 실제 순위나 알고리즘 가중치를 판정하지 않습니다. 카페 별칭 URL은 교집합을 과소 집계할 수 있습니다.'
  };
}
async function poll(){
  if(running)return {ok:false,message:'이미 요청을 처리하고 있습니다.'};
  running=true;
  try{
    const settings=await enabled();
    if(!settings.enabled)return {ok:false,message:'자동 조사가 비활성화돼 있습니다.'};
    const secret=await token(settings.repository);
    if(!secret){
      await status('GitHub 연결이 필요합니다. 연결 화면에서 토큰을 확인하세요.',{phase:'paused'});
      return {ok:false,message:'토큰이 없습니다.'};
    }
    const config=await checkPrivateRepository({
      repository:settings.repository,token:secret
    });
    const progress=await currentProcessed(config.name),today=now().slice(0,10);
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
      await markProcessed(item.number,config.name);
      return {ok:false,skipped:item.number,message:short(error.message)};
    }
    // A browser crash or restart after writing a result comment should not
    // cause a second search and duplicate GitHub uploads for the same issue.
    const previous=await existingJobResult(config,secret,job.issue_number);
    if(previous){
      await finishJob(config,secret,job.issue_number,previous.status);
      await markProcessed(job.issue_number,config.name);
      await status('이미 처리된 조사 요청 #'+job.issue_number+'을 정리했습니다.',{
        phase:'already-reported',issue_number:job.issue_number,last_result:previous
      });
      return {ok:true,processed:0,already_reported:true,result:previous};
    }
    let result;
    try{
      result=job.mode==='title_compare'?
        await executeTitleComparison(job,config,secret):
        await executeJob(job,config,secret);
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
    await markProcessed(job.issue_number,config.name);
    return {ok:true,processed:1,result};
  }catch(error){
    await status('자동 조사 오류: '+short(error.message),{phase:'error'});
    return {ok:false,message:short(error.message)};
  }finally{running=false;}
}
async function ensureAlarm(){
  // Chrome 120+ supports 30-second alarms; actual dispatch can be delayed.
  await chrome.alarms.create(ALARM,{periodInMinutes:0.5});
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
          jobsPerDay:MAX_JOBS_PER_DAY,articlesPerJob:MAX_ARTICLES
        }};
    }
    if(message.type==='AUTOPILOT_DISABLE'){
      await chrome.storage.local.set({[SETTINGS]:{enabled:false}});
      await status('자동 조사를 중지했습니다.',{phase:'disabled'});
      return {ok:true,enabled:false};
    }
    if(message.type==='AUTOPILOT_ENABLE'){
      const value=String(message.repository||'');
      const secret=await token(value);
      const config=await checkPrivateRepository({repository:value,token:secret});
      await ensureJobLabel(config,secret);
      await chrome.storage.local.set({
        [SETTINGS]:{enabled:true,repository:config.name,enabled_at:now()},
        'serp-lens-private-evidence-repository':config.name
      });
      await status('자동 조사가 켜졌습니다. 전용 GitHub 요청만 실행합니다.',{phase:'enabled'});
      return {ok:true,enabled:true,repository:config.name};
    }
    return await poll();
  })().then(respond).catch(error=>respond({ok:false,error:short(error.message)}));
  return true;
});
