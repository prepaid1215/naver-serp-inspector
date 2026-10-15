import {isNaverSearchURL,queryFromSearchURL,evidenceFileBase} from './capture-meta.js';
import {saveCapture} from './capture-store.js';

const $ = id => document.getElementById(id);
const captureButton = $('capture');
let currentTab = null;
const MAX_HTML_BYTES = 22 * 1024 * 1024;
const MAX_PNG_BYTES = 12 * 1024 * 1024;
function status(message, error=false) { $('status').textContent=message; $('status').classList.toggle('error',error); }
async function currentSearchTab() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab?.id || !isNaverSearchURL(tab.url)) return null;
  return tab;
}
try {
  currentTab=await currentSearchTab();
  if (currentTab) {
    $('query').textContent=queryFromSearchURL(currentTab.url);
    captureButton.disabled=false;
    status('현재 탭에서 직접 수집할 준비가 됐습니다.');
  } else {
    $('query').textContent='네이버 검색결과 페이지를 열어 주세요.';
  }
} catch(err) { status(`탭 확인 실패: ${err.message}`,true); }

captureButton.addEventListener('click', async()=>{
  captureButton.disabled=true;
  status('현재 열려 있는 검색결과 HTML을 읽는 중…');
  try {
    const tab=await currentSearchTab();
    if (!tab || tab.id!==currentTab?.id) throw Error('네이버 검색 탭이 바뀌었습니다. 다시 시도해 주세요.');
    const [execution]=await chrome.scripting.executeScript({
      target:{tabId:tab.id},
      func:()=>({
        url:location.href,
        html:document.documentElement?.outerHTML||'',
        title:document.title
      })
    });
    const result=execution?.result;
    if (!result?.html || !isNaverSearchURL(result.url)) throw Error('유효한 네이버 검색 HTML을 읽지 못했습니다.');
    const htmlBytes=new TextEncoder().encode(result.html).byteLength;
    if(htmlBytes>MAX_HTML_BYTES) throw Error('HTML이 22MB를 넘습니다. 파일 저장 방식으로 수집해 주세요.');
    status('현재 보이는 화면의 캡처를 저장하는 중…');
    const pngDataURL=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
    if (!pngDataURL?.startsWith('data:image/png;base64,')) throw Error('화면 캡처에 실패했습니다.');
    const binary=atob(pngDataURL.slice('data:image/png;base64,'.length));
    if(binary.length>MAX_PNG_BYTES) throw Error('화면 캡처가 12MB를 넘습니다.');
    const pngBytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const id="latest";  // Only the newest capture is retained; avoids growing local storage.
    const base=evidenceFileBase(result.url);
    await saveCapture({
      id, filename:`${base}.html`, screenshot:`${base}.png`, sourceURL:result.url,
      title:result.title, captured_at:new Date().toISOString(),
      html:result.html, pngBytes
    });
    status('수집 완료. SERP Lens 분석 화면을 여는 중…');
    await chrome.tabs.create({url:chrome.runtime.getURL(`web/index.html?serp_lens_capture=${encodeURIComponent(id)}`)});
    window.close();
  } catch(err) {
    status(`수집 실패: ${err.message}`,true);
    captureButton.disabled=false;
  }
});
