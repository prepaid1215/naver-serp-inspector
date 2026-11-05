import {isNaverSearchURL,queryFromSearchURL,evidenceFileBase} from './capture-meta.js';
import {saveCapture} from './capture-store.js';
import {saveSearch,savePage} from './intelligence-store.js';
import {deviceFromSearchURL} from './capture-meta.js';

const $ = id => document.getElementById(id);
const captureButton = $('capture');
const pageButton = $('capture-page');
const dashboardButton = $('open-intelligence');
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
    $('query').textContent='네이버 검색결과 또는 분석할 문서를 열어 주세요.';
  }
  const [active] = await chrome.tabs.query({active:true,currentWindow:true});
  pageButton.disabled = !active?.id || !/^https?:\/\//i.test(active.url||'') || isNaverSearchURL(active.url);
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
    // The original evidence stays in the one-capture legacy viewer.
    // Intelligence stores compact parsed rows per search, not another raw 22MB HTML.
    let historyWarning='';
    try {
      const {parseSERP,sha256}=await import('../web/engine.js');
      const digest=await sha256(new TextEncoder().encode(result.html));
      const analyzed=parseSERP(result.html,{
        filename:base+'.html',query:queryFromSearchURL(result.url),
        device:deviceFromSearchURL(result.url)==='pc'?'PC':'모바일',
        sha256:digest,observed:new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST'
      });
      await saveSearch({id:crypto.randomUUID(),captured_at:new Date().toISOString(),
        query:queryFromSearchURL(result.url),device:analyzed.meta.device,
        sourceURL:result.url,status:analyzed.status,notes:analyzed.notes,
        evidence_sha256:digest,rows:analyzed.rows});
    } catch(e) {historyWarning=' · 검색 이력 저장 실패: '+e.message;}
    status('수집 완료'+historyWarning+'. SERP Lens 분석 화면을 여는 중…');
    await chrome.tabs.create({url:chrome.runtime.getURL(`web/index.html?serp_lens_capture=${encodeURIComponent(id)}`)});
    window.close();
  } catch(err) {
    status(`수집 실패: ${err.message}`,true);
    captureButton.disabled=false;
  }
});


dashboardButton.addEventListener('click',async()=>{
  await chrome.tabs.create({url:chrome.runtime.getURL('extension/intelligence.html')});
  window.close();
});

// Runs only after an explicit user click. No remote fetch or background crawling.
function inspectOpenArticle() {
  const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  const meta=(key)=>document.querySelector('meta[property="'+key+'"],meta[name="'+key+'"]')?.getAttribute('content')||'';
  const selectors=['.se-main-container','#postViewArea','.se_component_wrap',
    '[itemprop="articleBody"]','article','.article_viewer','main'];
  let root=null;
  for (const selector of selectors) {
    const candidates=[...document.querySelectorAll(selector)];
    const best=candidates.sort((a,b)=>(b.innerText||'').length-(a.innerText||'').length)[0];
    if (best && (best.innerText||'').length>=120) {root=best;break;}
  }
  root=root||document.body;
  if(!root)return null;
  const allText=String(root.innerText||root.textContent||'').trim();
  const headingNodes=[...root.querySelectorAll('h1,h2,h3,.se-title-text,.se-documentTitle')].slice(0,90);
  const headings=headingNodes.map(h=>({level:/^H[123]$/.test(h.tagName)?h.tagName:'TITLE',text:norm(h.innerText||h.textContent).slice(0,200)})).filter(h=>h.text);
  const links=[...root.querySelectorAll('a[href]')].slice(0,300);
  let internal=0,external=0;
  for (const a of links) {
    try {
      const u=new URL(a.getAttribute('href'),location.href);
      if(!/^https?:$/.test(u.protocol))continue;
      if(u.hostname===location.hostname)internal++;else external++;
    }catch{}
  }
  const canonical=document.querySelector('link[rel="canonical"]')?.href||'';
  return {url:location.href,source_frame:location.href,title:norm(meta('og:title')||document.title).slice(0,300),
    description:norm(meta('description')||meta('og:description')).slice(0,500),canonical,
    text:allText.slice(0,18000),truncated:allText.length>18000,
    headings,images:root.querySelectorAll('img').length,
    internal_links:internal,external_links:external,
    score:allText.length+(root===document.body?0:10000)};
}
pageButton.addEventListener('click',async()=>{
  pageButton.disabled=true;
  status('현재 방문한 문서의 구조와 본문을 읽는 중…');
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:\/\//i.test(tab.url||'')||isNaverSearchURL(tab.url))
      throw Error('분석할 블로그·카페·웹문서 페이지를 열어 주세요.');
    let executed;
    try {executed=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:inspectOpenArticle});}
    catch {executed=await chrome.scripting.executeScript({target:{tabId:tab.id},func:inspectOpenArticle});}
    const candidate=executed.map(e=>e.result).filter(Boolean).sort((a,b)=>b.score-a.score)[0];
    if(!candidate || candidate.text.length<60)throw Error('본문 추출 결과가 부족합니다. 실제 게시글 화면에서 다시 실행해 주세요.');
    delete candidate.score;
    await savePage({id:crypto.randomUUID(),captured_at:new Date().toISOString(),...candidate});
    await chrome.tabs.create({url:chrome.runtime.getURL('extension/intelligence.html')});
    window.close();
  }catch(error){status('문서 수집 실패: '+error.message,true);pageButton.disabled=false;}
});
