import {isNaverSearchURL,queryFromSearchURL,evidenceFileBase} from './capture-meta.js';
import {saveCapture} from './capture-store.js';
import {saveSearch,savePage} from './intelligence-store.js';
import {deviceFromSearchURL} from './capture-meta.js';
import {inspectVisibleSearch} from './visual-viewport.js';
import {saveVisualAudit} from './visual-store.js';

const $ = id => document.getElementById(id);
const captureButton = $('capture');
const visualButton = $('visual-capture');
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
    visualButton.disabled=false;
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



function auditGeometryChanged(before,after){
  if(!after||before.source_url!==after.source_url||before.query!==after.query)return true;
  const a=before.viewport,b=after.viewport;
  if(Math.abs(a.scroll_y-b.scroll_y)>2||Math.abs(a.scroll_x-b.scroll_x)>2||
    Math.abs(a.width-b.width)>2||Math.abs(a.height-b.height)>2||
    Math.abs(a.vv_scale-b.vv_scale)>0.02)return true;
  const previous=new Map(before.candidates.map(c=>[c.url+'|'+c.title,c]));
  const matches=after.candidates.map(c=>[previous.get(c.url+'|'+c.title),c]).filter(([x])=>x);
  if(matches.length<Math.min(3,before.candidates.length))return before.candidates.length>0;
  return matches.slice(0,25).some(([x,y])=>Math.abs(x.y-y.y)>18||Math.abs(x.x-y.x)>18);
}
function decodePng(dataURL){
  if(!dataURL?.startsWith('data:image/png;base64,'))throw Error('PNG 화면 캡처에 실패했습니다.');
  const binary=atob(dataURL.slice('data:image/png;base64,'.length));
  if(binary.length>MAX_PNG_BYTES)throw Error('화면 이미지가 12MB를 초과합니다.');
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
async function screenshotSize(dataURL){
  const img=new Image();img.src=dataURL;await img.decode();
  return {width:img.naturalWidth,height:img.naturalHeight};
}
visualButton.addEventListener('click',async()=>{
  visualButton.disabled=true;
  status('실제 네이버 화면의 제목·광고 후보 위치를 측정하는 중…');
  try{
    const tab=await currentSearchTab();
    if(!tab||tab.id!==currentTab?.id)throw Error('네이버 검색 탭이 바뀌었습니다. 확장프로그램을 다시 여세요.');
    const before=await chrome.scripting.executeScript({target:{tabId:tab.id},func:inspectVisibleSearch});
    const geometry=before?.[0]?.result;
    if(!geometry?.viewport||!isNaverSearchURL(geometry.source_url))throw Error('검색 화면의 위치 자료를 읽지 못했습니다.');
    status('스크린샷을 저장하고 위치가 바뀌지 않았는지 확인 중…');
    const pngDataURL=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
    const screenshot_png=decodePng(pngDataURL);
    const screenshot_image_size=await screenshotSize(pngDataURL);
    const after=await chrome.scripting.executeScript({target:{tabId:tab.id},func:inspectVisibleSearch});
    const capture_moved=auditGeometryChanged(geometry,after?.[0]?.result);
    const viewAspect=geometry.viewport.width/geometry.viewport.height;
    const imageAspect=screenshot_image_size.width/screenshot_image_size.height;
    const screenshot_dimension_mismatch=Math.abs(viewAspect-imageAspect)/viewAspect>0.055;
    let parsed_rows=[],parser_warning='';
    try{
      const [htmlResult]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({
        url:location.href,html:document.documentElement?.outerHTML||''
      })});
      const html=htmlResult?.result?.html||'';
      if(html.length>0&&new TextEncoder().encode(html).byteLength<=MAX_HTML_BYTES){
        const {parseSERP}=await import('../web/engine.js');
        const result=parseSERP(html,{query:geometry.query,device:geometry.url_device,
          filename:'viewport-audit.html',observed:new Date().toISOString()});
        parsed_rows=result.rows;
        if(result.status.startsWith('수집 실패'))parser_warning=result.notes||result.status;
      }else parser_warning='HTML을 읽지 못했거나 22MB를 초과했습니다.';
    }catch(error){parser_warning='DOM 파서 결과 없음: '+error.message;}
    const id=crypto.randomUUID();
    const record={
      id,captured_at:new Date().toISOString(),...geometry,
      screenshot_png,screenshot_image_size,capture_moved,screenshot_dimension_mismatch,
      reviews:{},added:[],checked_complete:false,parsed_rows,parser_warning,
      capture_scope:'visible_viewport_only'
    };
    await saveVisualAudit(record);
    const warnings=[capture_moved?'측정 중 화면 변화 감지':'',screenshot_dimension_mismatch?'이미지 비율 확인 필요':'',
      geometry.root_fallback?'검색 결과 영역 불확실':''].filter(Boolean).join(' · ');
    status('검수 화면 저장 완료'+(warnings?' · '+warnings:''));
    await chrome.tabs.create({url:chrome.runtime.getURL(
      'extension/visual-audit.html?audit='+encodeURIComponent(id))});
    window.close();
  }catch(error){status('위치 검수 수집 실패: '+error.message,true);visualButton.disabled=false;}
});

$('open-chat-bridge').addEventListener('click',async()=>{
  await chrome.tabs.create({url:chrome.runtime.getURL('extension/chat-bridge.html')});
  window.close();
});

$('open-full-validation').addEventListener('click',async()=>{
  await chrome.tabs.create({url:chrome.runtime.getURL('extension/full-validation.html')});
  window.close();
});

$('open-visual-audit').addEventListener('click',async()=>{
  await chrome.tabs.create({url:chrome.runtime.getURL('extension/visual-audit.html')});
  window.close();
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
  // Publication time must come from a document-declared field, not capture time.
  let publishedAt=meta('article:published_time')||meta('datePublished')||meta('pubdate')
    ||document.querySelector('time[datetime]')?.getAttribute('datetime')||'';
  if(!publishedAt) {
    for(const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,12)) {
      try {
        const parsed=JSON.parse(script.textContent||'{}');
        const candidates=Array.isArray(parsed)?parsed:[parsed];
        const items=candidates.flatMap(obj=>obj?.['@graph']||[obj]);
        const result=items.find(obj=>obj?.datePublished);
        if(result){publishedAt=String(result.datePublished);break;}
      }catch{}
    }
  }
  if(publishedAt && Number.isNaN(Date.parse(publishedAt)))publishedAt='';
  return {url:location.href,source_frame:location.href,title:norm(meta('og:title')||document.title).slice(0,300),
    description:norm(meta('description')||meta('og:description')).slice(0,500),robots:meta('robots'),canonical,published_at:publishedAt,
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
