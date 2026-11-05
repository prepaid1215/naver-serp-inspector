import {listVisualAuditSummaries,readVisualAudit,saveVisualAudit,removeVisualAudit} from './visual-store.js';
import {TYPES,summarizeVisualAudit,compareViewportParser} from './visual-audit-core.js';

const $=id=>document.getElementById(id);
const text=(el,value)=>{el.textContent=String(value??'');return el;};
const el=(tag,klass,value)=>{const x=document.createElement(tag);if(klass)x.className=klass;if(value!==undefined)text(x,value);return x;};
const labelFor={AD:'광고',BLOG:'블로그',CAFE:'카페',WEB:'웹문서',NEWS:'뉴스',KIN:'지식iN',
 CLIP:'클립',VIDEO:'동영상',UNCLASSIFIED:'미분류',AI:'AI 요약',MIXED:'혼합',OTHER:'기타·블록'};
let audits=[],audit=null,screenshotURL=null,picking=false,picked=null,activeCandidate=null;
const params=new URL(location.href).searchParams;
function message(msg,warning=false){text($('message'),msg);$('message').style.color=warning?'#9e4250':'#3d65a5';}
function option(value,name){const o=el('option',null,name);o.value=value;return o;}
function download(name,data,mime){
 const src=URL.createObjectURL(new Blob([data],{type:mime}));
 const link=document.createElement('a');link.href=src;link.download=name;
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(src),5000);
}
function auditName(a){
 return (a.query||'검색어 없음')+' · '+(a.url_device||'기기 미확인')+
 ' / '+(a.layout_device||'너비 미확인')+' · '+new Date(a.captured_at).toLocaleString('ko-KR');
}
function controls(enabled){
 for(const id of ['download-image','download-json','remove-audit','pick-location','add-missing','audit-complete','save-review','download-json-bottom'])
  $(id).disabled=!enabled;
}
function clearAudit(){
 if(screenshotURL){URL.revokeObjectURL(screenshotURL);screenshotURL=null;}
 audit=null;controls(false);$('screenshot').removeAttribute('src');
 for(const id of ['screenshot-overlays','candidate-list','block-list','manual-list','parser-report','audit-status'])$(id).replaceChildren();
 text($('metadata'),'수집한 네이버 검색 화면이 없습니다. 실제 검색 결과 화면에서 위치 검수 캡처를 시작하세요.');
 $('audit-complete').checked=false;$('show-blocks').checked=false;setPickMode(false);
}
async function reloadOptions(wanted){
 audits=await listVisualAuditSummaries();
 const select=$('audit-picker');
 select.replaceChildren(option('','검수할 검색 화면을 선택하세요'),...audits.map(a=>option(a.id,auditName(a))));
 if(audits.some(x=>x.id===wanted))select.value=wanted;
}
async function loadAudit(id){
 if(!id){clearAudit();return;}
 const next=await readVisualAudit(id);
 if(!next){message('선택한 검수 기록을 찾을 수 없습니다.',true);clearAudit();return;}
 clearAudit();audit=next;controls(true);
 screenshotURL=URL.createObjectURL(new Blob([audit.screenshot_png],{type:'image/png'}));
 $('screenshot').src=screenshotURL;
 $('audit-complete').checked=!!audit.checked_complete;
 text($('metadata'),
   auditName(audit)+' · 스크롤 '+Math.round(audit.viewport.scroll_y||0)+'px · '+
   '측정 화면 '+audit.viewport.width+'×'+audit.viewport.height+' CSS px · '+
   '이미지 '+audit.screenshot_image_size?.width+'×'+audit.screenshot_image_size?.height+' px'+
   ' · 검색 결과 컨테이너 '+audit.root_used+
   (audit.capture_moved?' · 측정 중 화면 변화 감지':'')+
   (audit.screenshot_dimension_mismatch?' · 화면 비율 불일치':'')+
   (audit.parser_warning?' · 파서: '+audit.parser_warning:''));
 picked=null;activeCandidate=null;text($('picked-coordinate'),'위치를 아직 선택하지 않았습니다.');
 renderAll();
}
function scrollToCandidate(id){
 activeCandidate=id;
 const list=$('candidate-list'),card=list.querySelector('[data-candidate-id="'+CSS.escape(id)+'"]');
 if(card)card.scrollIntoView({block:'nearest',behavior:'smooth'});
 drawOverlay();
 for(const item of list.querySelectorAll('.candidate-card'))item.classList.toggle('active',item.dataset.candidateId===id);
}
function drawOverlay(){
 const board=$('screenshot-overlays');board.replaceChildren();
 if(!audit)return;
 const vw=audit.viewport.width,vh=audit.viewport.height;
 if(!vw||!vh)return;
 if($('show-blocks').checked){
   for(const block of audit.blocks||[]){
     const verdict=audit.block_reviews?.[block.id]?.verdict||'unreviewed';
     const rect=el('div','block-rect '+verdict);
     rect.style.left=100*Math.max(0,block.x)/vw+'%';
     rect.style.top=100*Math.max(0,block.y)/vh+'%';
     rect.style.width=100*Math.max(0,Math.min(block.width,vw-Math.max(0,block.x)))/vw+'%';
     rect.style.height=100*Math.max(0,Math.min(block.height,vh-Math.max(0,block.y)))/vh+'%';
     rect.title='블록 '+block.id+' · '+(block.type_hints||[]).join('/');
     board.append(rect);
   }
 }
 for(const [i,c] of audit.candidates.entries()){
  const review=audit.reviews?.[c.id]||{},state=review.verdict||'unreviewed';
  const box=el('div','candidate-rect '+state);
  box.style.left=100*Math.max(0,c.x)/vw+'%';
  box.style.top=100*Math.max(0,c.y)/vh+'%';
  box.style.width=100*Math.min(c.width,vw-Math.max(0,c.x))/vw+'%';
  box.style.height=100*Math.min(c.height,vh-Math.max(0,c.y))/vh+'%';
  board.append(box);
  const pin=el('button','candidate-pin '+state+(activeCandidate===c.id?' active':''),String(i+1));
  pin.type='button';pin.title=c.title+' · '+(labelFor[c.type_hint]||c.type_hint);
  pin.style.left=100*Math.max(0,c.x)/vw+'%';pin.style.top=100*Math.max(0,c.y)/vh+'%';
  pin.addEventListener('click',event=>{
    if(picking)return;
    event.preventDefault();event.stopPropagation();scrollToCandidate(c.id);
  });
  board.append(pin);
 }
 for(const [i,c] of (audit.added||[]).entries()){
  const pin=el('button','candidate-pin manual','+'+(i+1));
  pin.style.left=100*c.x/vw+'%';pin.style.top=100*c.y/vh+'%';
  pin.type='button';pin.title=c.title||'수동 추가';pin.addEventListener('click',event=>{
    if(picking)return;
    event.preventDefault();event.stopPropagation();
    $('manual-list').scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  board.append(pin);
 }
}
function makeSelect(options,value,handle){
 const select=el('select');select.replaceChildren(...options.map(([v,t])=>option(v,t)));
 select.value=value;
 select.addEventListener('change',()=>handle(select.value));
 return select;
}
async function persist(msg){
 if(!audit)return;
 try{await saveVisualAudit(audit);message(msg||'검수 자료를 브라우저에 저장했습니다.');}
 catch(error){message('검수 자료 저장 실패: '+error.message,true);}
}
function editReview(c,field,value){
 const original=audit.reviews?.[c.id]||{};
 audit.reviews={...(audit.reviews||{}),[c.id]:{...original,[field]:value}};
 if(field==='correct_type'&&!original.verdict)audit.reviews[c.id].verdict='confirmed';
 if(field==='verdict'&&value==='unreviewed')delete audit.reviews[c.id];
 audit.checked_complete=false;
 $('audit-complete').checked=false;
 renderAll();void persist('검수 변경사항을 저장했습니다.');
}
function editBlock(block,field,value){
  const original=audit.block_reviews?.[block.id]||{};
  audit.block_reviews={...(audit.block_reviews||{}),[block.id]:{...original,[field]:value}};
  if(field==='correct_type'&&!original.verdict)audit.block_reviews[block.id].verdict='confirmed';
  if(field==='verdict'&&value==='unreviewed')delete audit.block_reviews[block.id];
  audit.checked_complete=false;
  $('audit-complete').checked=false;
  renderAll();void persist('검색 블록 검수 변경사항을 저장했습니다.');
}
function renderBlocks(){
  const root=$('block-list');
  root.replaceChildren();
  text($('count-blocks'),(audit.blocks||[]).length+'개 블록');
  if(!(audit.blocks||[]).length)root.append(el('p','muted','자동 추출한 블록 경계가 없습니다. 제목 후보는 따로 검수하세요.'));
  for(const block of audit.blocks||[]){
    const r=audit.block_reviews?.[block.id]||{},item=el('div','block-item');
    const suggested=block.type_hints?.length===1?block.type_hints[0]:'MIXED';
    const meta=el('div','block-meta');
    meta.append(el('strong',null,block.id+' · 화면 Y='+Math.round(block.y)+'px'),
      el('span',null,'후보 '+(block.candidates||0)+'개 · 자동 유형 '+(block.type_hints||[]).join(' / ')));
    const verdict=el('label',null,'화면에 보이는 블록?');
    verdict.append(makeSelect([
      ['unreviewed','미검수'],['confirmed','화면에 보임'],['rejected','잘못 감지'],['uncertain','불명확']
    ],r.verdict||'unreviewed',v=>editBlock(block,'verdict',v)));
    const kind=el('label',null,'블록 유형');
    kind.append(makeSelect(TYPES.map(t=>[t,labelFor[t]||t]),
      r.correct_type||suggested,v=>editBlock(block,'correct_type',v)));
    item.append(meta,verdict,kind);root.append(item);
  }
}
function renderCandidates(){
 const list=$('candidate-list');const oldScroll=list.scrollTop;
 list.replaceChildren();
 if(!audit.candidates?.length){list.append(el('p','muted','자동 탐지한 제목 후보가 없습니다. 누락 항목을 수동으로 표시하세요.'));}
 for(const [i,c] of audit.candidates.entries()){
  const review=audit.reviews?.[c.id]||{},card=el('article','candidate-card'+(activeCandidate===c.id?' active':''));
  card.dataset.candidateId=c.id;
  const header=el('div','candidate-title');
  const button=el('button',null,String(i+1));button.type='button';button.addEventListener('click',()=>scrollToCandidate(c.id));
  header.append(button,el('span',null,c.title));card.append(header);
  const link=el('a','candidate-url',c.url);
  if(/^https?:\/\//.test(c.url)){link.href=c.url;link.target='_blank';link.rel='noopener noreferrer';}
  card.append(link);
  const editor=el('div','candidate-edit');
  const verdictLabel=el('label',null,'실제 화면 검수');
  verdictLabel.append(makeSelect([
   ['unreviewed','미검수'],['confirmed','화면에 보임'],['rejected','잘못 감지'],['uncertain','불명확']
  ],review.verdict||'unreviewed',v=>editReview(c,'verdict',v)));
  const typeLabel=el('label',null,'문서/광고 유형');
  typeLabel.append(makeSelect(TYPES.map(t=>[t,labelFor[t]||t]),
    review.correct_type||c.type_hint||'OTHER',v=>editReview(c,'correct_type',v)));
  editor.append(verdictLabel,typeLabel);card.append(editor);
  card.append(el('small',null,'화면 위치 Y='+Math.round(c.y)+'px · 블록 '+(c.block_id||'미확인')+' · 자동 유형 '+(labelFor[c.type_hint]||c.type_hint)));
  list.append(card);
 }
 list.scrollTop=oldScroll;
}
function renderManual(){
 const root=$('manual-list');root.replaceChildren();
 for(const c of audit.added||[]){
  const row=el('div','manual-row',c.title+' · '+(labelFor[c.type]||c.type)+' · Y='+Math.round(c.y)+'px');
  const button=el('button','quiet','삭제');button.addEventListener('click',()=>{
    audit.added=audit.added.filter(x=>x.id!==c.id);
    audit.checked_complete=false;$('audit-complete').checked=false;
    renderAll();void persist('수동 추가 항목을 삭제했습니다.');
  });row.append(button);root.append(row);
 }
}
function renderSummary(){
 if(!audit)return;
 const result=summarizeVisualAudit(audit),comp=compareViewportParser(result);
 text($('count-candidates'),audit.candidates.length);
 text($('count-confirmed'),result.counts.confirmed);
 text($('count-unreviewed'),result.counts.unreviewed+result.counts.uncertain);
 text($('count-missed'),result.counts.manual);
 text($('count-blocks'),(audit.blocks||[]).length+'개 블록 · 미검수 '+result.block_counts.unreviewed+'개');
 const parser=$('parser-report');parser.replaceChildren();
 parser.append(el('div','report-row',
   '화면에서 확인한 제목 후보 '+result.counts.confirmed+'개 중 HTML 파서와 주소가 일치한 항목 '+
   comp.matched+'개 / 파서 목록에서 찾지 못한 항목 '+comp.unmatched_in_screenshot+'개. '+
   '이는 화면 안의 후보만 비교한 값이며 실제 전체 검색 순위가 아닙니다.'));
 parser.append(el('div','report-row',comp.unknown_under_fold));
 const status=$('audit-status');status.classList.toggle('warning',!result.verified_viewport);
 text(status,result.verified_viewport?
   '이 캡처에서 사용자가 검수한 제목 후보의 화면 순서를 확정했습니다. 검색 결과 전체 순위는 아닙니다.':
   '검수 미완료 · '+result.warnings.filter(w=>!w.startsWith('순서는')).join(' / '));
}
function renderAll(){if(!audit)return;drawOverlay();renderBlocks();renderCandidates();renderManual();renderSummary();}
function setPickMode(enabled){
 picking=enabled;$('screenshot-board').classList.toggle('pick-mode',enabled);
 text($('pick-location'),enabled?'위치 선택 중 · 취소':'화면에서 위치 선택');
}
$('screenshot-board').addEventListener('click',event=>{
 if(!picking||!audit)return;
 const rect=$('screenshot').getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 const x=Math.max(0,Math.min(audit.viewport.width,((event.clientX-rect.left)/rect.width)*audit.viewport.width));
 const y=Math.max(0,Math.min(audit.viewport.height,((event.clientY-rect.top)/rect.height)*audit.viewport.height));
 picked={x:Math.round(x*10)/10,y:Math.round(y*10)/10};
 text($('picked-coordinate'),'선택한 화면 위치: X '+Math.round(x)+' · Y '+Math.round(y)+' px');
 setPickMode(false);
});
$('pick-location').addEventListener('click',()=>{if(audit)setPickMode(!picking);});
$('show-blocks').addEventListener('change',drawOverlay);
$('add-missing').addEventListener('click',()=>{
 if(!audit||!picked){message('먼저 스크린샷에서 누락된 항목의 위치를 선택하세요.',true);return;}
 const title=$('missing-title').value.trim(),type=$('missing-type').value,url=$('missing-url').value.trim();
 if(title.length<3){message('스크린샷에 표시된 제목을 세 글자 이상 입력하세요.',true);return;}
 if(url){try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))throw Error();}catch{message('URL은 https:// 또는 http:// 주소로 입력하세요.',true);return;}}
 audit.added=[...(audit.added||[]),{id:'manual-'+crypto.randomUUID(),title,type,url,x:picked.x,y:picked.y}];
 audit.checked_complete=false;$('audit-complete').checked=false;
 $('missing-title').value='';$('missing-url').value='';picked=null;
 text($('picked-coordinate'),'위치를 아직 선택하지 않았습니다.');
 renderAll();void persist('누락된 화면 항목을 추가했습니다.');
});
$('audit-complete').addEventListener('change',()=>{
 if(!audit)return;
 audit.checked_complete=$('audit-complete').checked;renderSummary();
 void persist('화면 점검 상태를 저장했습니다.');
});
$('save-review').addEventListener('click',()=>{void persist('검수 결과를 저장했습니다.');});
function evidenceJSON(){
 const result=summarizeVisualAudit(audit);
 const {screenshot_png,...metadata}=audit;
 return JSON.stringify({
   schema:'naver-viewport-audit-v1',generated_at:new Date().toISOString(),
   audit:metadata,report:result,parser_validation:compareViewportParser(result),
   screenshot_not_embedded:true,
   limitation:'별도 저장된 PNG를 함께 제출해야 실제 화면과 비교할 수 있습니다.'
 },null,2);
}
function exportJSON(){
 if(audit)download('naver-serp-screen-audit-'+audit.id.slice(0,8)+'.json',evidenceJSON(),'application/json;charset=utf-8');
}
$('download-json').addEventListener('click',exportJSON);
$('download-json-bottom').addEventListener('click',exportJSON);
$('download-image').addEventListener('click',()=>{
 if(audit)download('naver-serp-screen-'+audit.id.slice(0,8)+'.png',audit.screenshot_png,'image/png');
});
$('remove-audit').addEventListener('click',async()=>{
 if(!audit||!confirm('이 화면 검수 기록과 스크린샷을 삭제할까요?'))return;
 const id=audit.id;await removeVisualAudit(id);clearAudit();await reloadOptions();
 message('화면 검수 기록 '+id.slice(0,8)+'를 삭제했습니다.');
});
$('audit-picker').addEventListener('change',()=>{void loadAudit($('audit-picker').value);});
async function init(){
 try{
  const wanted=params.get('audit')||'';
  await reloadOptions(wanted);
  const id=$('audit-picker').value||audits[0]?.id||'';
  $('audit-picker').value=id;
  if(id)await loadAudit(id);else clearAudit();
  message('검색 화면 검수 자료 '+audits.length+'개를 읽었습니다. 실제 스크린샷을 보고 검수해 주세요.');
 }catch(error){clearAudit();message('검수 자료 로드 실패: '+error.message,true);}
}
void init();
