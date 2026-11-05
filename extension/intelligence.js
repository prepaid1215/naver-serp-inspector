import {listSearches,listPages,removeSearch,removePage} from './intelligence-store.js';
import {compareSearches,buildAIPrompt,pageStats} from './intelligence-analysis.js';
import {compareCapturedContent,gapReportText} from './content-gap.js';
import {analyzeRankingEvidence,rankLabPrompt} from './rank-lab.js';
import {makeExperiment,analyzeExperiment,experimentReportText,CHANGE_TYPES} from './experiment-lab.js';
import {saveExperiment,listExperiments,removeExperiment} from './intelligence-store.js';
const $=id=>document.getElementById(id);
const text=(node,value)=>{node.textContent=String(value??'');return node;};
const node=(tag,klass,value)=>{const e=document.createElement(tag);if(klass)e.className=klass;if(value!==undefined)text(e,value);return e;};
let searches=[],pages=[],contentComparison=null,rankReport=null,experiments=[],experimentReport=null;
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
    del.addEventListener('click',async()=>{await removePage(p.id);pages=pages.filter(item=>item.id!==p.id);renderPages();resetGap();clearRankLab();renderComparison();});
    card.append(del);$('pages').append(card);
  }
}

function renderGapControls(){
  const oldOwn=$('own-page').value;
  const oldRivals=[...$('rival-pages').selectedOptions].map(o=>o.value);
  const choices=pages.map(p=>option(p.id,p.title||p.url||p.id));
  $('own-page').replaceChildren(option('','내 문서 선택'),...choices);
  if(pages.some(p=>p.id===oldOwn))$('own-page').value=oldOwn;
  const ownId=$('own-page').value;
  $('rival-pages').replaceChildren(...pages.filter(p=>p.id!==ownId).map(p=>option(p.id,p.title||p.url||p.id)));
  for(const el of $('rival-pages').options){el.selected=oldRivals.includes(el.value);}
  $('compare-content').disabled=pages.length<2||!ownId;
}
function renderGapResult(){
  const root=$('gap-results');
  root.replaceChildren();
  const result=contentComparison;
  $('download-gap').disabled=!result;
  if(!result)return;
  const stats=node('p','muted','비교한 경쟁 문서 '+result.competitors.length+'개 · 검토 후보 '+result.review.length+'개 · 관련 표현 확인 '+result.related.length+'개');
  root.append(stats);
  const review=node('div','gap-cards');
  if(!result.review.length)review.append(node('p','empty','단어 기반 검토 후보가 없습니다. 실제 내용의 정확성이나 검색 경쟁력이 확인된 것은 아닙니다.'));
  for(const topic of result.review.slice(0,30)){
    const card=node('article','gap-card');
    card.append(node('h3',null,topic.topic));
    card.append(node('p','muted','내 문서에서 일치한 단어: '+(topic.mentioned.join(' · ')||'없음')+' · 검토 후보(정보 누락 확정 아님)'));
    for(const ref of topic.references){
      const link=node('a',null,(ref.title||ref.heading)+' · '+ref.heading);
      link.href=ref.url;link.target='_blank';link.rel='noopener noreferrer';
      card.append(link);
    }
    review.append(card);
  }
  root.append(review);
  if(result.related.length){
    const detail=node('details');
    detail.append(node('summary',null,'내 문서에 관련 표현이 발견된 주제 '+result.related.length+'개'));
    const list=node('ul');
    for(const x of result.related.slice(0,40))list.append(node('li',null,x.topic+' · '+x.status));
    detail.append(list);root.append(detail);
  }
  root.append(node('p','muted',result.limitations.join(' ')));
}
function compareGap(){
  const own=pages.find(p=>p.id===$('own-page').value);
  const rivals=[...$('rival-pages').selectedOptions].map(o=>pages.find(p=>p.id===o.value)).filter(Boolean).slice(0,8);
  if(!own||!rivals.length){
    contentComparison=null;renderGapResult();text($('gap-message'),'내 문서 1개와 경쟁 문서 1개 이상을 선택해 주세요.');updatePrompt();return;
  }
  contentComparison=compareCapturedContent(own,rivals,{keyword:$('gap-keyword').value});
  text($('gap-message'),'수집된 제목·소제목·본문 단어를 비교했습니다. 표시된 후보는 직접 읽고 판단해야 합니다.');
  renderGapResult();updatePrompt();
}
function resetGap(){
  contentComparison=null;
  renderGapControls();renderGapResult();
  text($('gap-message'),'문서를 선택하고 비교하기를 누르세요.');
  updatePrompt();
}
$('own-page').addEventListener('change',resetGap);
$('rival-pages').addEventListener('change',()=>{contentComparison=null;renderGapResult();updatePrompt();});
$('gap-keyword').addEventListener('input',()=>{contentComparison=null;renderGapResult();updatePrompt();});
$('compare-content').addEventListener('click',compareGap);
$('download-gap').addEventListener('click',()=>{
  if(contentComparison)download('naver-content-gap-evidence.txt',gapReportText(contentComparison),'text/plain;charset=utf-8');
});


function renderRankLab(report){
  const factors=$('rank-factors'),sources=$('rank-sources'),groups=$('rank-query-groups');
  factors.replaceChildren();sources.replaceChildren();groups.replaceChildren();
  $('rank-keywords').textContent=report.used_latest_capture_count;
  $('rank-matched').textContent=report.matched_page_count;
  $('rank-pairs').textContent=report.pair_comparisons;
  const evidence=report.factors.slice().sort((a,b)=>b.pairs-a.pairs);
  for(const f of evidence){
    const card=node('article','factor-card');
    card.append(node('h4',null,f.label));
    card.append(node('p','factor-verdict',f.interpretation));
    card.append(node('p','muted','비교 '+f.pairs+'쌍 · 검색 조건 '+f.observed_queries+'개 · 상위 문서 값이 더 큼 '+f.higher_greater+'쌍 · 하위 문서 값이 더 큼 '+f.lower_greater+'쌍'));
    if(f.examples.length){
      const details=node('details');
      details.append(node('summary',null,'관측 근거 사례'));
      for(const example of f.examples.slice(0,3)){
        const v=node('div','factor-example');
        const a=node('a',null,example.higher.title||example.higher.url);
        a.href=example.higher.url;a.target='_blank';a.rel='noopener noreferrer';
        const b=node('a',null,example.lower.title||example.lower.url);
        b.href=example.lower.url;b.target='_blank';b.rel='noopener noreferrer';
        v.append(node('strong',null,example.query+' · '+example.device),
          node('small',null,'추정 위치 '+example.higher.estimated_order+' vs '+example.lower.estimated_order),
          a,node('small',null,'관측 값: '+example.higher.value),
          b,node('small',null,'관측 값: '+example.lower.value));
        details.append(v);
      }
      card.append(details);
    }
    factors.append(card);
  }
  if(!evidence.length)factors.append(node('p','empty','비교할 문서의 본문 자료가 없습니다.'));
  if(!report.top_sources.length)sources.append(node('p','empty','출처 집계 자료 없음'));
  for(const source of report.top_sources.slice(0,15)){
    const div=node('div','source-record');
    div.append(node('strong',null,source.source),
      node('span',null,'검색어 '+source.query_count+'개 · 노출 후보 '+source.appearances+'건 · 서로 다른 문서 '+source.distinct_urls+'건 · 최상단 추정 위치 '+source.best_estimated_order));
    sources.append(div);
  }
  if(!report.groups.length)groups.append(node('p','empty','검색 기록이 없습니다.'));
  for(const group of report.groups.slice(0,70)){
    const div=node('div','source-record');
    div.append(node('strong',null,group.query+' · '+group.device),
      node('span',null,'문서 '+group.result_count+'건 · 본문 연결 '+group.captured_document_count+'건 · 출처 '+group.distinct_sources+'곳 · 유형 '+Object.entries(group.types).map(([k,n])=>k+' '+n).join(', ')));
    groups.append(div);
  }
}
function runRankLab(){
  rankReport=analyzeRankingEvidence(searches,pages,{device:$('rank-device').value,keyword:$('rank-filter').value});
  renderRankLab(rankReport);
  $('copy-rank-lab').disabled=false;$('download-rank-lab').disabled=false;
  text($('rank-message'),
    '최신 검색 화면 '+rankReport.used_latest_capture_count+'건의 관측치와 방문 문서 '+rankReport.matched_page_count+'건을 비교했습니다. 공식 순위나 로직의 가중치를 표시하는 자료가 아닙니다.');
}
function clearRankLab(){
  rankReport=null;
  $('copy-rank-lab').disabled=true;$('download-rank-lab').disabled=true;
  $('rank-keywords').textContent='—';$('rank-matched').textContent='—';$('rank-pairs').textContent='—';
  for(const id of ['rank-factors','rank-sources','rank-query-groups'])$(id).replaceChildren();
  text($('rank-message'),'검색 이력 또는 본문 자료가 달라졌습니다. 다시 분석해 주세요.');
}
$('run-rank-lab').addEventListener('click',runRankLab);
$('rank-filter').addEventListener('input',clearRankLab);
$('rank-device').addEventListener('change',clearRankLab);
$('copy-rank-lab').addEventListener('click',async()=>{
  if(!rankReport)return;
  try{await navigator.clipboard.writeText(rankLabPrompt(rankReport));text($('rank-message'),'관측 근거와 가설 검증 요청문이 복사됐습니다.');}
  catch(error){text($('rank-message'),'클립보드 실패: JSON 내보내기를 이용하세요.');}
});
$('download-rank-lab').addEventListener('click',()=>{
  if(!rankReport)return;
  download('naver-rank-lab-evidence.json',JSON.stringify(rankReport,null,2),'application/json;charset=utf-8');
});


function selectedExperiment(){return experiments.find(e=>e.id===$('exp-select').value);}
function renderExperimentOptions(){
  const chosen=$('exp-select').value;
  $('exp-select').replaceChildren(option('','실험을 선택하세요'),...experiments.map(e=>
    option(e.id,e.title+' · '+e.query+' · '+e.device+' · '+new Date(e.changed_at).toLocaleString('ko-KR'))));
  if(experiments.some(e=>e.id===chosen))$('exp-select').value=chosen;
  $('exp-run').disabled=!selectedExperiment();
  $('exp-delete').disabled=!selectedExperiment();
}
function showExperimentMessage(msg,error=false){
  const el=$('exp-form-message');
  text(el,msg);el.classList.toggle('error',error);
}
function expText(value){return value===null||value===undefined?'계산 불가':String(value);}
function exportAvailable(enabled){
  for(const id of ['exp-export-txt','exp-export-json','exp-copy-prompt'])$(id).disabled=!enabled;
}
function renderExperimentReport(){
  const root=$('exp-summary'),evidence=$('exp-evidence');
  root.replaceChildren();evidence.replaceChildren();
  const report=experimentReport;
  exportAvailable(!!report);
  if(!report)return;
  const experiment=report.experiment;
  root.append(node('h3',null,experiment.title));
  root.append(node('p','muted',
    '변경 유형: '+(CHANGE_TYPES[experiment.change_type]||experiment.change_type)+
    ' · 수정 시각: '+new Date(experiment.changed_at).toLocaleString('ko-KR')));
  root.append(node('p','muted','대조 문서 미수정 여부: 사용자 계획에 따른 입력 · 자동 검증하지 않음'));
  const metrics=node('div','exp-metrics');
  const entries=[
    ['변경 전 수집',report.counts.before+'회'],
    ['변경 후 수집',report.counts.after+'회'],
    ['비교 가능한 대조 문서',report.counts.eligible_controls+'개'],
    ['실험 문서 변화',expText(report.target.delta)],
    ['대조 문서 변화 중앙값',expText(report.control_median_delta)],
    ['대조군 대비 상대 변화',expText(report.relative_delta)]
  ];
  for(const [label,value] of entries){
    const card=node('div','exp-metric');
    card.append(node('strong',null,value),node('span',null,label));
    metrics.append(card);
  }
  root.append(metrics);
  root.append(node('p','exp-interpretation',report.interpretation));
  if(!report.enough_repeated_observations)root.append(node('p','muted',
    '반복 수집 기준 미달: 전후 각각 2회 이상과 비교 가능한 대조 문서 1개 이상이 필요합니다. 이 기준은 통계적 유의성을 보장하지 않습니다.'));
  const rows=node('div','exp-document-list');
  for(const item of [report.target,...report.controls]){
    const card=node('div','exp-document');
    card.append(node('strong',null,item.role==='target'?'실험 문서':'대조 문서'));
    const a=node('a',null,item.url);a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';
    card.append(a,node('span',null,
      '전: '+expText(item.before.median_position)+' (발견 '+item.before.found+'/'+item.before.observations+') · '+
      '후: '+expText(item.after.median_position)+' (발견 '+item.after.found+'/'+item.after.observations+') · '+
      '변화: '+expText(item.delta)));
    rows.append(card);
  }
  root.append(rows);
  evidence.append(node('h3',null,'원본 검색 화면 근거'));
  for(const part of ['before','after']){
    const wrap=node('div','exp-evidence-group');
    wrap.append(node('h4',null,part==='before'?'변경 전 수집 기록':'변경 후 수집 기록'));
    const observations=report.evidence[part];
    if(!observations.length)wrap.append(node('p','empty','수집 기록 없음'));
    for(const snap of observations){
      const entry=node('div','source-record');
      entry.append(node('strong',null,new Date(snap.captured_at).toLocaleString('ko-KR')+
        ' · 문서 후보 '+snap.document_count+'건'));
      const positions=Object.entries(snap.positions).map(([key,pos])=>
        (key===report.target.key?'실험':'대조')+' '+(pos===null?'미등장':pos+'번째')).join(' · ');
      entry.append(node('span',null,positions));
      if(/^https?:\/\//.test(snap.source_url)){
        const link=node('a',null,'검색 화면 출처 URL');
        link.href=snap.source_url;link.target='_blank';link.rel='noopener noreferrer';entry.append(link);
      }
      if(snap.evidence_sha256)entry.append(node('small',null,'SHA-256 '+snap.evidence_sha256));
      wrap.append(entry);
    }
    evidence.append(wrap);
  }
  evidence.append(node('p','muted',report.limitations.join(' ')));
}
function resetExperimentReport(){
  experimentReport=null;
  renderExperimentReport();
}
$('experiment-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const record=makeExperiment({
      title:$('exp-title').value,query:$('exp-query').value,device:$('exp-device').value,
      change_type:$('exp-type').value,changed_at:$('exp-changed-at').value,
      target_url:$('exp-target-url').value,
      control_urls:$('exp-control-urls').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),
      change_note:$('exp-change-note').value,control_note:$('exp-control-note').value,
      controls_unchanged_asserted:$('exp-controls-unchanged').checked
    });
    await saveExperiment(record);
    experiments=await listExperiments();
    renderExperimentOptions();
    $('exp-select').value=record.id;
    renderExperimentOptions();
    $('exp-run').disabled=false;$('exp-delete').disabled=false;
    $('experiment-form').reset();
    resetExperimentReport();
    showExperimentMessage('실험을 저장했습니다. 변경 전후에 수집한 같은 키워드·기기 기록이 있으면 비교할 수 있습니다.');
  }catch(error){showExperimentMessage('실험 저장 실패: '+error.message,true);}
});
$('exp-select').addEventListener('change',()=>{
  $('exp-run').disabled=!selectedExperiment();
  $('exp-delete').disabled=!selectedExperiment();
  resetExperimentReport();
});
$('exp-run').addEventListener('click',()=>{
  const selected=selectedExperiment();if(!selected)return;
  try{experimentReport=analyzeExperiment(selected,searches);renderExperimentReport();
    showExperimentMessage('검색 기록을 이용해 전후 관측과 대조군 변화를 계산했습니다. 원본 기록을 확인하세요.');
  }catch(error){resetExperimentReport();showExperimentMessage('비교 실패: '+error.message,true);}
});
$('exp-delete').addEventListener('click',async()=>{
  const selected=selectedExperiment();if(!selected)return;
  await removeExperiment(selected.id);
  experiments=await listExperiments();
  renderExperimentOptions();resetExperimentReport();
  showExperimentMessage('선택한 실험 기록을 삭제했습니다. 검색 이력은 유지됩니다.');
});
$('exp-export-txt').addEventListener('click',()=>{
  if(experimentReport)download('naver-rank-experiment-report.txt',experimentReportText(experimentReport),'text/plain;charset=utf-8');
});
$('exp-export-json').addEventListener('click',()=>{
  if(experimentReport)download('naver-rank-experiment-evidence.json',JSON.stringify(experimentReport,null,2),'application/json;charset=utf-8');
});
$('exp-copy-prompt').addEventListener('click',async()=>{
  if(!experimentReport)return;
  const txt=[
    '네이버 검색 로직 실험 분석 요청',
    '다음 결과는 내가 직접 수집한 검색화면의 DOM 순서와 대조 문서 변화에서 계산한 관측값이다.',
    '관측된 사실, 반례, 가능한 교란 요인을 구분하고 순위 변화와 수정 작업 사이의 인과관계를 단정하지 마라.',
    '다음 반복 실험에서 고정할 키워드·기기·검색 시점·대조 문서 및 검증 기준을 제안해 줘.',
    experimentReportText(experimentReport)
  ].join('\n\n');
  try{await navigator.clipboard.writeText(txt);showExperimentMessage('ChatGPT 분석용 요청문을 복사했습니다.');}
  catch{showExperimentMessage('클립보드 접근 실패: TXT 보고서를 저장해 활용하세요.',true);}
});

function createPrompt(){
  const s=selected();
  const diff=s&&older()?compareSearches(s,older()):null;
  const selectedSearches=[s,older()].filter(Boolean);
  const own=$('own-domains').value.trim();
  return buildAIPrompt(selectedSearches,pages,diff)+'\n\n내 사이트 도메인: '+(own||'미입력')+ (contentComparison?'\n\n수집 문서의 단어 기반 비교 (관측 근거, 검색 원인 아님):\n'+JSON.stringify({keyword:contentComparison.keyword,own:contentComparison.own,competitors:contentComparison.competitors,review:contentComparison.review.slice(0,20),limitations:contentComparison.limitations},null,2):'');
}
function updatePrompt(){$('preview').value=createPrompt();}
function download(name,data,type){
  const url=URL.createObjectURL(new Blob([data],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
$('newer').addEventListener('change',renderOlder);
$('older').addEventListener('change',renderComparison);
$('own-domains').addEventListener('input',updatePrompt);
$('remove-search').addEventListener('click',async()=>{
  const s=selected();if(!s)return;
  await removeSearch(s.id);searches=searches.filter(x=>x.id!==s.id);clearRankLab();resetExperimentReport();renderOptions();
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
    pages:pages.map(pageStats),content_comparison:contentComparison,warning:'사용자 수집 자료 · DOM 추정 · 공식 검색 순위 아님'
  },null,2),'application/json;charset=utf-8');
});
async function init(){
  try{
    [searches,pages,experiments]=await Promise.all([listSearches(),listPages(),listExperiments()]);
    renderOptions();renderPages();renderGapControls();renderExperimentOptions();
    showMessage('검색 기록 '+searches.length+'개, 방문 문서 '+pages.length+'개를 이 브라우저에서 불러왔습니다.');
  }catch(error){showMessage('로컬 분석 자료 로드 실패: '+error.message);}
}
void init();
