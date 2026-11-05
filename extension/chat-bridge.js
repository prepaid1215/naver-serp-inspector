import {listSearches,listPages} from './intelligence-store.js';
import {
  validateRepository,prepareSharedRecord,checkPrivateRepository,
  uploadEvidence,updateEvidenceIndex
} from './github-evidence-sync.js';

const $=id=>document.getElementById(id);
const node=(tag,klass,txt)=>{
  const out=document.createElement(tag);
  if(klass)out.className=klass;
  if(txt!==undefined)out.textContent=String(txt);
  return out;
};
let searches=[],pages=[],verified=null,selected=[],uploadBusy=false,readyToShare=false;
const STATUS='serp-lens-chat-bridge-token';
const REPO_KEY='serp-lens-private-evidence-repository';
const AUTOPILOT_KEY='serp-autopilot-settings-v1';
const DEFAULT_REPO='prepaid1215/serp-lens-private-data';
async function restoreRepository(){
  // The repository's full name is not a secret and may be persisted. The
  // fine-grained token must stay exclusively in chrome.storage.session.
  const cached=await chrome.storage.local.get([REPO_KEY,AUTOPILOT_KEY]);
  const configured=cached?.[AUTOPILOT_KEY]?.repository;
  const saved=cached?.[REPO_KEY];
  const legacy=localStorage.getItem(REPO_KEY);
  const candidate=[configured,saved,legacy,DEFAULT_REPO].find(value=>{
    try{return Boolean(validateRepository(value));}catch{return false;}
  });
  $('bridge-repo').value=candidate||DEFAULT_REPO;
}
function setStatus(text,isError=false){
  const el=$('bridge-status');
  el.textContent=text;
  el.classList.toggle('is-error',Boolean(isError));
}
function repoStatus(message,mode=''){
  const el=$('repo-status');
  const chip=$('repo-connection-chip');
  el.textContent=message;
  el.classList.toggle('is-ok',mode==='ok');
  el.classList.toggle('is-error',mode==='error');
  chip.classList.toggle('is-ok',mode==='ok');
  chip.textContent=mode==='ok'?'비공개 연결 확인':mode==='error'?'연결 확인 필요':'연결 정보';
}
function actionState(){
  const nonempty=selected.length>0,active=Boolean(verified)&&nonempty&&!uploadBusy;
  $('download-selected').disabled=!nonempty;
  $('share-confirm').disabled=!active;
  $('upload-selected').disabled=!active||!$('share-confirm').checked;
  $('copy-chat-request').disabled=!readyToShare;
}
function makeChoice(item,type){
  const row=node('label','bridge-choice');
  const checkbox=document.createElement('input');checkbox.type='checkbox';
  checkbox.value=item.id;checkbox.dataset.kind=type;
  const content=node('span');
  content.append(node('strong',null,
    type==='pages'?(item.title||'제목 미확인'):(item.query||'검색어 미확인')+' · '+(item.device||'기기 미확인')));
  const details=type==='pages'?
    ((item.url||'')+' · 본문 '+(item.text||'').length+'자'):
    ((item.rows?.length||0)+'개 추출 결과 · '+(item.sourceURL||''));
  content.append(node('small',null,details+' · '+(item.captured_at||'').slice(0,16)));
  row.append(checkbox,content);
  checkbox.addEventListener('change',()=>{
    readyToShare=false;
    $('share-confirm').checked=false;
    selected=[];
    const checked=[...document.querySelectorAll('.bridge-choice input:checked')].slice(0,15);
    if(document.querySelectorAll('.bridge-choice input:checked').length>15){
      checkbox.checked=false;setStatus('한 번에 최대 15개 기록까지 선택할 수 있습니다.',true);
    }else for(const input of checked){
      const collection=input.dataset.kind==='pages'?pages:searches;
      const value=collection.find(x=>x.id===input.value);
      if(value)selected.push({type:input.dataset.kind,raw:value});
    }
    $('preview-stats').textContent='선택 '+selected.length+'개 · 선택 후 전송할 내용을 먼저 미리보기로 확인하세요.';
    $('selection-preview').textContent='';
    actionState();
  });
  return row;
}
async function loadRecords(){
  try{
    [searches,pages]=await Promise.all([listSearches(),listPages()]);
    const searchesView=searches.slice(0,50),pagesView=pages.slice(0,50);
    $('search-count').textContent=String(searches.length);
    $('page-count').textContent=String(pages.length);
    $('search-items').replaceChildren(...(searchesView.length?
      searchesView.map(item=>makeChoice(item,'searches')):
      [node('p','bridge-empty','저장한 검색 결과가 없습니다.')]));
    $('page-items').replaceChildren(...(pagesView.length?
      pagesView.map(item=>makeChoice(item,'pages')):
      [node('p','bridge-empty','저장한 게시글 본문이 없습니다.')]));
    await restoreRepository();
    const session=await chrome.storage.session.get(STATUS);
    if(session?.[STATUS]){
      $('bridge-token').placeholder='세션 토큰 저장됨 · 변경 시 다시 입력';
      repoStatus('세션 토큰이 저장돼 있습니다. 수동 전송 전에는 저장소 연결을 확인해 주세요.');
    }
    setStatus('로컬 검색 '+searches.length+'건 · 게시글 '+pages.length+'건을 불러왔습니다. 선택 전에는 자료가 전송되지 않습니다.');
  }catch(error){setStatus('로컬 자료 읽기 실패: '+error.message,true);}
}
function evidence(){
  if(!selected.length)throw Error('공유할 자료를 선택하세요.');
  const list=selected.map(({type,raw})=>prepareSharedRecord(type,raw));
  const size=new TextEncoder().encode(JSON.stringify(list)).byteLength;
  if(size>700000)throw Error('선택한 자료가 700KB를 초과합니다. 기록을 나누어 전송하세요.');
  return list;
}
$('preview-selection').addEventListener('click',()=>{
  try{
    const output=evidence();
    $('selection-preview').textContent=JSON.stringify({records:output},null,2);
    $('preview-stats').textContent='자료 '+output.length+'개 · '+Math.round(
      new TextEncoder().encode($('selection-preview').textContent).byteLength/1024
    )+'KB · 실제 검색어·제목·본문을 꼭 검토하세요.';
    $('preview-details').open=true;
    setStatus('전송할 내용을 표시했습니다. 검토 후 비공개 저장소를 연결하세요.');
  }catch(error){setStatus(error.message,true);}
});
function download(filename,content){
  const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=filename;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
}
$('download-selected').addEventListener('click',()=>{
  try{download('serp-lens-selected-evidence.json',JSON.stringify({records:evidence()},null,2));}
  catch(error){setStatus(error.message,true);}
});
async function getToken(){
  const entered=$('bridge-token').value.trim();
  if(entered)return entered;
  const session=await chrome.storage.session.get(STATUS);
  return String(session?.[STATUS]||'');
}
$('bridge-repo').addEventListener('input',()=>{
  verified=null;readyToShare=false;$('share-confirm').checked=false;actionState();
  repoStatus('저장소 주소가 변경됐습니다. 연결 확인이 필요합니다.');
});
$('bridge-token').addEventListener('input',()=>{
  verified=null;readyToShare=false;$('share-confirm').checked=false;actionState();
  repoStatus('토큰을 변경했습니다. 다시 연결 확인을 진행하세요.');
});
$('verify-repo').addEventListener('click',async()=>{
  $('verify-repo').disabled=true;verified=null;readyToShare=false;
  $('share-confirm').checked=false;actionState();
  try{
    const repository=validateRepository($('bridge-repo').value);
    const token=await getToken();
    const config=await checkPrivateRepository({repository,token});
    verified=config;
    await chrome.storage.session.set({[STATUS]:token});
    $('bridge-token').value='';$('bridge-token').placeholder='이 세션에만 토큰 보관 중';
    await chrome.storage.local.set({[REPO_KEY]:config.name});
    localStorage.setItem(REPO_KEY,config.name);
    repoStatus('확인 완료: '+repository+' (비공개 저장소 / 기본 브랜치 '+config.branch+')','ok');
    setStatus('비공개 저장소 연결을 확인했습니다. 선택한 자료를 미리 보고 공유 동의 후 전송하세요.');
  }catch(error){
    repoStatus('연결 실패: '+error.message,'error');
    setStatus('GitHub 저장소를 확인하지 못했습니다.',true);
  }finally{$('verify-repo').disabled=false;actionState();}
});
$('clear-token').addEventListener('click',async()=>{
  await chrome.storage.session.remove(STATUS);
  $('bridge-token').value='';$('bridge-token').placeholder='github_pat_...';
  verified=null;readyToShare=false;$('share-confirm').checked=false;
  repoStatus('세션 토큰을 지웠습니다. 다시 연결하려면 토큰을 입력하세요.');
  actionState();
});
$('share-confirm').addEventListener('change',actionState);
$('upload-selected').addEventListener('click',async()=>{
  if(uploadBusy||!verified||!$('share-confirm').checked)return;
  let output;
  try{output=evidence();}catch(error){setStatus(error.message,true);return;}
  const titles=output.map(x=>x.data.title||x.data.query).slice(0,6).join(' / ');
  if(!confirm('아래 자료 '+output.length+'건을 '+verified.name+
    ' 비공개 GitHub 저장소에 전송할까요?\n'+titles))return;
  uploadBusy=true;actionState();
  const token=await getToken(),result=[];
  try{
    if(!token)throw Error('세션 토큰이 만료됐습니다. 다시 연결하세요.');
    for(const [i,item] of selected.entries()){
      $('upload-result').textContent=(i+1)+'/'+selected.length+'건 전송 중…';
      result.push(await uploadEvidence({
        config:verified,token,type:item.type,record:item.raw
      }));
    }
    await updateEvidenceIndex({config:verified,token,entries:result});
    const repo=verified.name;
    readyToShare=true;
    $('upload-result').textContent='전송 완료: '+result.length+
      '건. GitHub 연결이 이 비공개 저장소를 읽을 수 있어야 ChatGPT가 조회할 수 있습니다.';
    $('open-github-index').href='https://github.com/'+repo+'/blob/'+
      encodeURIComponent(verified.branch)+'/serp-lens/index.json';
    $('open-github-index').hidden=false;
    setStatus('선택한 자료를 비공개 GitHub 저장소에 전송했습니다.');
  }catch(error){
    $('upload-result').textContent='전송 실패: '+error.message+
      ' · 이미 전송된 '+result.length+'건의 파일은 남아 있을 수 있습니다.';
    setStatus('전송 또는 인덱스 갱신에 실패했습니다.',true);
  }finally{uploadBusy=false;actionState();}
});
$('copy-chat-request').addEventListener('click',async()=>{
  if(!readyToShare||!verified)return;
  const request='연결된 GitHub 저장소 '+verified.name+
    '의 serp-lens/index.json을 읽어 최신 네이버 검색 결과와 개별 게시글 본문 증거를 확인해 줘. '+
    '필요한 records/pages 또는 records/searches가 아니라 인덱스에 있는 실제 path를 따라 읽고, '+
    '각 문서의 제목·본문·검색어·수집 시각을 인용해 경쟁사 공통점과 반례를 분석해 줘. '+
    '검색 화면 전체 순위나 네이버 내부 알고리즘을 추정해 확정하지 마.';
  try{await navigator.clipboard.writeText(request);setStatus('이 채팅에 입력할 분석 요청문을 복사했습니다.');}
  catch{setStatus('클립보드 복사가 지원되지 않습니다. 비공개 인덱스 주소를 이 채팅에 알려주세요.',true);}
});
actionState();void loadRecords();
