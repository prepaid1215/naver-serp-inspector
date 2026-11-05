/* UI for explicitly arming and monitoring Github Issue -> Naver browser jobs. */
const $=id=>document.getElementById(id);
const STATUS='serp-lens-chat-bridge-token';
const loadedVersion=chrome.runtime.getManifest().version;
const versionElement=$('installed-extension-version');
if(versionElement)versionElement.textContent='설치된 확장프로그램 v'+loadedVersion+
  (loadedVersion==='2.2.0'?' · Plus 채팅 조사 연결·결과 요약 개선 적용':' · 이전 버전: 최신 채팅 조사 개선이 적용되지 않았습니다.');

const buttonIds=['autopilot-enable','autopilot-disable','autopilot-check-now'];
function status(message,error=false){
 const element=$('autopilot-status');
 element.textContent=message;
 element.style.color=error?'#a12b45':'#43617e';
}
async function message(type,extra={}){
 return await chrome.runtime.sendMessage({type,...extra});
}
function enableState(){
 $('autopilot-enable').disabled=!$('autopilot-consent').checked||
   !$('bridge-repo').value.trim();
}
$('autopilot-consent').addEventListener('change',enableState);
$('bridge-repo').addEventListener('input',enableState);
async function refresh(){
 try{
  const response=await message('AUTOPILOT_STATUS');
  const s=response?.status||{};
  status((response?.enabled?'켜짐 · ':'꺼짐 · ')+
    (s.message||'아직 처리한 네이버 조사 요청 없음')+
    (s.updated_at?' · '+new Date(s.updated_at).toLocaleString('ko-KR'):'')+
    (response?.repository?' · 저장소 '+response.repository:''));
 }catch(error){status('백그라운드 조사 상태 확인 실패: '+error.message,true);}
 enableState();
}
async function busy(task){
 for(const id of buttonIds)$(id).disabled=true;
 try{await task();}
 catch(error){status(error.message,true);}
 finally{for(const id of buttonIds)$(id).disabled=false;await refresh();}
}
$('autopilot-enable').addEventListener('click',()=>busy(async()=>{
 if(!$('autopilot-consent').checked)throw Error('자동 조사 동의가 필요합니다.');
 const repository=$('bridge-repo').value.trim();
 if(!repository)throw Error('비공개 저장소를 입력하세요.');
 const response=await message('AUTOPILOT_ENABLE',{repository});
 if(!response?.ok)throw Error(response?.error||response?.message||'자동 조사 활성화 실패');
 status('자동 조사를 켰습니다. 이후 비공개 GitHub 작업 요청이 있으면 Chrome이 실행합니다.');
}));
$('autopilot-disable').addEventListener('click',()=>busy(async()=>{
 const response=await message('AUTOPILOT_DISABLE');
 if(!response?.ok)throw Error(response?.error||'자동 조사 중지 실패');
 status('자동 조사를 중지했습니다.');
}));
$('autopilot-check-now').addEventListener('click',()=>busy(async()=>{
 status('새 네이버 조사 요청을 확인 중…');
 const response=await message('AUTOPILOT_CHECK_NOW');
 if(!response?.ok)throw Error(response?.error||response?.message||'요청 확인 실패');
 status(response?.processed?'새 네이버 조사 요청을 처리했습니다.':'대기 중인 새 조사 요청이 없습니다.');
}));
void refresh();
