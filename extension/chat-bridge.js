import {createGithubBridge} from './chat-bridge-github.js';
import {runNaverBridgeJob} from './chat-bridge-runner.js';
const $=id=>document.getElementById(id);
const node=(tag,klass,value)=>{
  const el=document.createElement(tag);
  if(klass)el.className=klass;
  if(value!==undefined)el.textContent=String(value);
  return el;
};
let connection=null,currentJob=null,currentResult=null,busy=false;
const origins=[
  'https://search.naver.com/*','https://m.search.naver.com/*',
  'https://blog.naver.com/*','https://m.blog.naver.com/*',
  'https://cafe.naver.com/*','https://m.cafe.naver.com/*'
];
function status(message,isError=false){
  $('bridge-status').textContent=message;
  $('bridge-status').style.color=isError?'#a22b44':'#46699b';
}
function progress(message){$('bridge-progress').textContent=message;}
function setBusy(value){
  busy=value;
  $('bridge-connect').disabled=value;
  $('bridge-refresh').disabled=value||!connection;
  $('bridge-upload').disabled=value||!currentResult||!$('bridge-approve').checked;
  $('bridge-export').disabled=value||!currentResult;
  for(const button of $('bridge-jobs').querySelectorAll('button'))button.disabled=value||button.dataset.done==='true';
}
async function refreshJobs(){
  if(!connection)return;
  const container=$('bridge-jobs');
  container.replaceChildren();
  const jobs=await connection.listJobs();
  if(!jobs.length){container.append(node('p','muted','연결된 저장소에 유효한 검색 요청이 없습니다. ChatGPT에서 요청 파일을 만들어야 합니다.'));return;}
  for(const entry of jobs){
    const row=node('article','bridge-job');
    const left=node('div');
    const label=node('strong',null,entry.job_id);
    const small=node('small',null,entry.done?'이미 결과 업로드 완료':'검색 요청 세부 내용 불러오는 중');
    left.append(label,small);row.append(left);
    const button=node('button','secondary',entry.done?'완료':'요청 확인 중');
    button.type='button';button.dataset.done=String(entry.done);button.disabled=true;row.append(button);
    container.append(row);
    if(entry.done)continue;
    try{
      const job=await connection.fetchJob(entry.job_id);
      label.textContent=job.query+' · 네이버 '+job.device;
      small.textContent='블로그·카페 본문 최대 '+job.max_articles+'건 · 요청: '+
        new Date(job.requested_at).toLocaleString('ko-KR');
      button.textContent='검색·본문 수집 실행';
      button.disabled=busy;
      button.addEventListener('click',()=>void executeJob(job));
    }catch(error){
      button.disabled=true;button.textContent='요청 오류';
      small.textContent=error.message;
    }
  }
}
function clearResult(){
  currentJob=null;currentResult=null;
  $('bridge-approve').checked=false;
  $('bridge-approve').disabled=true;
  $('bridge-upload').disabled=true;
  $('bridge-export').disabled=true;
  $('bridge-preview').replaceChildren();
}
function renderPreview(result){
  const root=$('bridge-preview');root.replaceChildren();
  root.append(node('h3',null,'검색 결과: '+result.query));
  root.append(node('p','muted',result.search.status+' · 검색 링크 후보 '+
    result.search.parsed_count+'건 · 읽은 문서 '+result.articles.length+'건'));
  if(!result.articles.length){
    root.append(node('p','muted','현재 파서가 방문 가능한 블로그·카페 링크를 찾지 못했습니다. 검색 결과가 0개인 뜻은 아닙니다.'));
  }
  for(const item of result.articles){
    const card=node('article','bridge-article');
    card.append(node('strong',null,item.title||item.serp_title||'제목 없음'));
    card.append(node('p','muted','수집 상태 '+item.fetch_status+
      ' · 추출 글자 '+(item.text||'').length+'자 · 신뢰도 '+item.content_confidence));
    const link=node('a',null,item.serp_url);
    link.href=item.serp_url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);
    card.append(node('p',null,(item.text||item.error||'추출 결과 없음').slice(0,650)));
    root.append(card);
  }
  $('bridge-approve').disabled=false;
  $('bridge-export').disabled=false;
}
async function executeJob(job){
  if(busy||!connection)return;
  // Chrome must request optional origins directly in the user click gesture.
  let granted=false;
  try{granted=await chrome.permissions.request({origins});}
  catch(error){status('Chrome 페이지 접근 권한 요청 실패: '+error.message,true);return;}
  if(!granted){status('네이버 검색·블로그·카페 접근 권한을 허용해야 수집할 수 있습니다.',true);return;}
  setBusy(true);clearResult();currentJob=job;
  try{
    if(await connection.resultExists(job.job_id))throw Error('이 요청은 이미 완료됐습니다. 재수집하지 않습니다.');
    progress('수집 작업 시작 · '+job.query);
    const result=await runNaverBridgeJob(job,progress);
    currentResult=result;
    renderPreview(result);
    status('본문 추출이 끝났습니다. 결과를 확인한 뒤 업로드 동의에 체크하세요.');
  }catch(error){
    clearResult();
    progress('수집 실패 · '+error.message);
    status('네이버 수집 실패: '+error.message,true);
  }finally{setBusy(false);}
}
$('bridge-connect').addEventListener('click',async()=>{
  if(busy)return;
  try{
    const token=$('bridge-token').value;
    const next=createGithubBridge({
      repository:$('bridge-repo').value,
      branch:$('bridge-branch').value,token
    });
    status('GitHub 비공개 저장소 접근을 확인하는 중…');
    await next.verifyPrivate();
    connection=next;
    // Avoid leaving the token displayed in the password input after validation.
    $('bridge-token').value='';
    $('bridge-refresh').disabled=false;
    clearResult();
    await refreshJobs();
    status('연결됨: '+next.repository+' ('+next.branch+'). 토큰은 이 탭을 닫으면 사라집니다.');
  }catch(error){connection=null;status('연결 실패: '+error.message,true);}
});
$('bridge-refresh').addEventListener('click',async()=>{
  if(busy)return;
  try{await refreshJobs();status('요청 목록을 새로고침했습니다.');}
  catch(error){status('요청 목록 오류: '+error.message,true);}
});
$('bridge-approve').addEventListener('change',()=>{
  $('bridge-upload').disabled=busy||!currentResult||!$('bridge-approve').checked;
});
$('bridge-upload').addEventListener('click',async()=>{
  if(busy||!connection||!currentJob||!currentResult||!$('bridge-approve').checked)return;
  setBusy(true);
  try{
    status('비공개 GitHub 저장소로 검토한 수집 자료를 전송하는 중…');
    const receipt=await connection.uploadResult(currentJob,currentResult);
    status('전송 완료: '+receipt.repository+'/'+receipt.path+
      ' · 이제 ChatGPT에 "수집 결과 읽어 줘"라고 요청하세요.');
    clearResult();
    await refreshJobs();
  }catch(error){status('GitHub 결과 전송 실패: '+error.message,true);}
  finally{setBusy(false);}
});
$('bridge-export').addEventListener('click',()=>{
  if(!currentResult)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(currentResult,null,2)],{type:'application/json;charset=utf-8'}));
  const a=document.createElement('a');
  a.href=url;a.download='naver-chat-bridge-'+currentResult.job_id+'.json';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
});
status('GitHub 비공개 저장소와 최소 권한 토큰을 입력해 연결하세요.');
