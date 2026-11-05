import {listSearches,listPages,removeSearch,removePage} from './intelligence-store.js';
import {compareSearches,buildAIPrompt,pageStats} from './intelligence-analysis.js';
const $=id=>document.getElementById(id);
const text=(node,value)=>{node.textContent=String(value??'');return node;};
const node=(tag,klass,value)=>{const e=document.createElement(tag);if(klass)e.className=klass;if(value!==undefined)text(e,value);return e;};
let searches=[],pages=[];
function showMessage(value){text($('message'),value);}
function option(id,label){const e=node('option',null,label);e.value=id;return e;}
function selected(){return searches.find(s=>s.id===$('newer').value);}
function older(){return searches.find(s=>s.id===$('older').value);}
function renderOptions(){
  const current=$('newer').value;
  $('newer').replaceChildren(...searches.map(s=>option(s.id,s.query+' · '+s.device+' · '+new Date(s.captured_at).toLocaleString('ko-KR'))));
  if(searches.some(s=>s.id===current))$('newer').value=current;
  renderOlder();
}
function renderOlder(){
  const source=selected(),old=$('older').value;
  const candidates=source?searches.filter(s=>s.query===source.query&&s.device===source.device&&s.id!==source.id&&s.captured_at<source.captured_at):[];
  $('older').replaceChildren(option('','비교할 이전 기록 없음'),...candidates.map(s=>option(s.id,new Date(s.captured_at).toLocaleString('ko-KR'))));
  if(candidates.some(s=>s.id===old))$('older').value=old;
  else if(candidates.length)$('older').value=candidates[0].id;
  renderComparison();
}
function records(title,items,format){
  const col=node('section','col');
  col.append(node('h3',null,title));
  if(!items.length){col.append(node('p',null,'변경 없음 / 자료 없음'));return col;}
  for(const entry of items.slice(0,30)){
    const item=node('div','record');const a=node('a',null,entry.result_title||entry.title||entry.url);
    a.href=entry.result_url||entry.url;a.target='_blank';a.rel='noopener noreferrer';
    const detail=node('small',null,format?format(entry):(entry.block_type||entry.type||''));
    item.append(a,detail);col.append(item);
  }
  return col;
}
function renderComparison(){
  const target=selected(),reference=older();
  $('search-count').textContent=searches.length;
  $('doc-count').textContent=pages.length;
  $('remove-search').disabled=!target;
  $('comparison').replaceChildren();
  if(!target){$('diff-count').textContent='—';$('comparison').append(node('p','empty','검색 기록이 없습니다. 네이버 검색 화면에서 수집 버튼을 눌러 주세요.'));updatePrompt();return;}
  if(!reference){$('diff-count').textContent='—';$('comparison').append(records('현재 수집한 검색 링크',(target.rows||[]).filter(x=>x.block_type!=='AD'),r=>r.block_type+' · DOM 추정 '+r.organic_rank));updatePrompt();return;}
  const diff=compareSearches(target,reference);$('diff-count').textContent=String(diff.added.length);
  $('comparison').append(
    records('새롭게 등장한 링크',diff.added,r=>r.block_type+' · 추정 순서 '+r.position),
    records('사라진 링크',diff.removed,r=>r.block_type+' · 이전 추정 순서 '+r.position),
    records('공통 링크 순서 변화',diff.changed.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)),r=>'이전 '+r.before+' → 최근 '+r.after+' (변화 '+(r.delta>0?'+':'')+r.delta+')')
  );
  updatePrompt();
}
function renderPages(){
  $('pages').replaceChildren();
  if(!pages.length){$('pages').append(node('p','empty','아직 방문 문서를 저장하지 않았습니다.'));return;}
  for(const p of pages){
    const card=node('article','page');
    card.append(node('h3',null,p.title||p.url));
    const a=node('a',null,p.url);a.href=p.url;a.target='_blank';a.rel='noopener noreferrer';card.append(a);
    card.append(node('p','muted',new Date(p.captured_at).toLocaleString('ko-KR')+' · 본문 '+String((p.text||'').length)+'자 · 이미지 '+p.images+'개 · 내부 링크 '+p.internal_links+'개'));
    const details=node('details');details.append(node('summary',null,'소제목과 본문 발췌 보기'));
    const list=node('ul');for(const h of (p.headings||[]).slice(0,24))list.append(node('li',null,h.level+' '+h.text));
    details.append(list,node('pre',null,(p.text||'').slice(0,2400)));card.append(details);
    const del=node('button','secondary','삭제');del.type='button';
    del.addEventListener('click',async()=>{await removePage(p.id);pages=pages.filter(item=>item.id!==p.id);renderPages();renderComparison();});
    card.append(del);$('pages').append(card);
  }
}
function createPrompt(){
  const s=selected();
  const diff=s&&older()?compareSearches(s,older()):null;
  const selectedSearches=[s,older()].filter(Boolean);
  const own=$('own-domains').value.trim();
  return buildAIPrompt(selectedSearches,pages,diff)+'\n\n내 사이트 도메인: '+(own||'미입력');
}
function updatePrompt(){text($('preview'),createPrompt());}
function download(name,data,type){
  const url=URL.createObjectURL(new Blob([data],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
$('newer').addEventListener('change',renderOlder);
$('older').addEventListener('change',renderComparison);
$('own-domains').addEventListener('input',updatePrompt);
$('remove-search').addEventListener('click',async()=>{
  const s=selected();if(!s)return;
  await removeSearch(s.id);searches=searches.filter(x=>x.id!==s.id);renderOptions();
});
$('copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(createPrompt());showMessage('분석 요청문을 클립보드에 복사했습니다. ChatGPT 대화에 붙여넣으세요.');}
  catch(error){showMessage('클립보드 접근 실패: 미리보기 내용을 직접 복사하거나 TXT 저장을 이용하세요.');}
});
$('download').addEventListener('click',()=>download('naver-intelligence-ai-prompt.txt',createPrompt(),'text/plain;charset=utf-8'));
$('export-json').addEventListener('click',()=>{
  const s=selected(),prior=older();
  download('naver-intelligence-evidence.json',JSON.stringify({
    generated_at:new Date().toISOString(),selected_searches:[s,prior].filter(Boolean),
    selected_comparison:s&&prior?compareSearches(s,prior):null,
    pages:pages.map(pageStats),warning:'사용자 수집 자료 · DOM 추정 · 공식 검색 순위 아님'
  },null,2),'application/json;charset=utf-8');
});
async function init(){
  try{
    [searches,pages]=await Promise.all([listSearches(),listPages()]);
    renderOptions();renderPages();
    showMessage('검색 기록 '+searches.length+'개, 방문 문서 '+pages.length+'개를 이 브라우저에서 불러왔습니다.');
  }catch(error){showMessage('로컬 분석 자료 로드 실패: '+error.message);}
}
void init();
