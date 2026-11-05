/* SERP Lens ChatGPT bridge controls. All browser search requires opt-in. */
const $=id=>document.getElementById(id);
const manifest=chrome.runtime.getManifest();
const versionElement=$('installed-extension-version');
if(versionElement){
  versionElement.textContent='v'+manifest.version+' · ChatGPT 연결';
}
const buttonIds=['autopilot-enable','autopilot-disable','autopilot-check-now'];
const safeRepo=value=>/^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(value||'');
const dateLabel=value=>{
  if(!value)return '—';
  const d=new Date(value);
  return Number.isNaN(d.valueOf())?'—':d.toLocaleString('ko-KR',{
    month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'
  });
};
let pending=false;
function status(message,error=false){
  const el=$('autopilot-status');
  el.textContent=String(message||'');
  el.classList.toggle('is-error',Boolean(error));
}
function state(label,kind){
  const el=$('autopilot-state-label');
  el.className='state-chip state-'+kind;
  el.innerHTML='<span class="state-dot" aria-hidden="true"></span>';
  el.append(document.createTextNode(label));
}
async function message(type,extra={}){
  return await chrome.runtime.sendMessage({type,...extra});
}
function enableState(){
  const enable=$('autopilot-enable');
  enable.disabled=pending||!$('autopilot-consent').checked||
    !$('bridge-repo').value.trim();
}
$('autopilot-consent').addEventListener('change',enableState);
$('bridge-repo').addEventListener('input',enableState);
function renderSummary(response){
  const s=response?.status||{};
  const result=s.last_result||s.result||null;
  const last=$('autopilot-last-issue');
  if(result){
    $('autopilot-last-query').textContent=result.query||'검색어 미확인';
    const count=Number.isInteger(result.captured_articles)?result.captured_articles:0;
    const attempted=Number.isInteger(result.attempted_articles)?result.attempted_articles:0;
    $('autopilot-last-count').textContent=count+' / '+attempted+'건';
    $('autopilot-last-updated').textContent=dateLabel(result.captured_at||s.updated_at);
    const repo=response?.repository||'';
    if(safeRepo(repo)&&Number.isInteger(result.issue_number)&&result.issue_number>0){
      last.href='https://github.com/'+repo+'/issues/'+result.issue_number;
      last.hidden=false;
    }else last.hidden=true;
  }else{
    $('autopilot-last-query').textContent='아직 없음';
    $('autopilot-last-count').textContent='—';
    $('autopilot-last-updated').textContent='—';
    last.hidden=true;
  }
}
async function refresh(){
  try{
    const response=await message('AUTOPILOT_STATUS');
    const enabled=Boolean(response?.enabled);
    const s=response?.status||{};
    const problem=s.phase==='error'||s.phase==='report-error'||s.phase==='close-error'||s.phase==='paused';
    state(enabled?'자동 조사 켜짐':'자동 조사 꺼짐',enabled?(problem?'error':'on'):'off');
    $('autopilot-enable').hidden=enabled;
    $('autopilot-disable').hidden=!enabled;
    const preferences=$('autopilot-preferences');
    if(!enabled)preferences.open=true;
    else if(preferences.open)preferences.open=false;
    renderSummary(response);
    let info=s.message|| (enabled?'GitHub 조사 요청을 확인하고 있습니다.':'자동 조사가 꺼져 있습니다.');
    if(s.phase==='idle')info=info.replace(/^새 요청 없음 · /,'')+' · 새 요청 대기 중';
    status(info,problem);
  }catch(error){
    state('상태 확인 오류','error');
    status('자동 조사 상태를 확인할 수 없습니다: '+error.message,true);
  }
  enableState();
}
async function busy(task){
  pending=true;
  for(const id of buttonIds)$(id).disabled=true;
  let errorText='';
  try{await task();}
  catch(error){errorText=error.message||String(error);}
  finally{
    pending=false;
    await refresh();
    if(errorText)status(errorText,true);
  }
}
$('autopilot-enable').addEventListener('click',()=>busy(async()=>{
  if(!$('autopilot-consent').checked)throw Error('자동 조사 활성화 동의가 필요합니다.');
  const repository=$('bridge-repo').value.trim();
  if(!repository)throw Error('비공개 저장소 주소를 입력하세요.');
  const response=await message('AUTOPILOT_ENABLE',{repository});
  if(!response?.ok)throw Error(response?.error||response?.message||'자동 조사 활성화에 실패했습니다.');
}));
$('autopilot-disable').addEventListener('click',()=>busy(async()=>{
  const response=await message('AUTOPILOT_DISABLE');
  if(!response?.ok)throw Error(response?.error||'자동 조사 중지 실패');
  $('autopilot-consent').checked=false;
}));
$('autopilot-check-now').addEventListener('click',()=>busy(async()=>{
  status('비공개 저장소의 새 조사 요청을 확인하고 있습니다.');
  const response=await message('AUTOPILOT_CHECK_NOW');
  if(!response?.ok)throw Error(response?.error||response?.message||'조사 요청 확인 실패');
}));
$('copy-autopilot-example').addEventListener('click',async()=>{
  const button=$('copy-autopilot-example');
  try{
    await navigator.clipboard.writeText($('autopilot-example').textContent.trim());
    button.textContent='복사 완료';
  }catch{
    button.textContent='직접 문장을 선택해 복사하세요';
  }
});
void refresh();
