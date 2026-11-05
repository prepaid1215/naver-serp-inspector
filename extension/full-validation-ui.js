import {listSearches,listPages,listExperiments} from './intelligence-store.js';
import {listVisualAuditSummaries,readVisualAudit} from './visual-store.js';
import {buildFullValidation} from './full-validation.js';

const $=id=>document.getElementById(id);
const make=(tag,cls,value)=>{
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(value!==undefined)n.textContent=String(value);
  return n;
};
let report=null;
function save(name,content){
  const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}
function render(){
  const summary=$('validation-summary'),stages=$('validation-stages');
  summary.replaceChildren();stages.replaceChildren();
  const h=make('strong',null,report.status);
  const detail=make('p','muted','5단계 중 자료 확보 '+report.stages.filter(s=>s.ready).length+'단계 / 5단계');
  summary.append(h,detail);
  for(const stage of report.stages){
    const card=make('article','validation-stage');
    card.append(make('strong',null,stage.name),
      make('span','validation-state',stage.status),
      make('p','muted',stage.note));
    const stats=make('details');
    stats.append(make('summary',null,'세부 근거 수치'));
    const pre=make('pre',null,JSON.stringify(stage.evidence,null,2));
    stats.append(pre);card.append(stats);
    stages.append(card);
  }
  const audits=$('validation-audits');audits.replaceChildren();
  if(!report.reviewed_audits.length)audits.append(make('p','muted','아직 화면 검수 자료가 없습니다.'));
  for(const a of report.reviewed_audits){
    const row=make('div','source-record');
    row.append(make('strong',null,(a.query||'검색어 없음')+' · '+a.url_device+
      ' / '+a.layout),
      make('span',null,'사용자 검수 '+(a.summary.verified_viewport?'완료':'미완료')+
      ' · 확인한 제목 '+a.summary.counts.confirmed+'개 · 블록 '+a.summary.block_counts.confirmed+
      '개 · 파서 미일치 '+a.mismatch_count+'개'));
    const link=make('a',null,'이 화면 열기');
    link.href='visual-audit.html?audit='+encodeURIComponent(a.id);
    row.append(link);audits.append(row);
  }
  const limits=$('validation-limitations');
  limits.replaceChildren();
  for(const text of report.limitations)limits.append(make('p',null,'· '+text));
  $('download-validation').disabled=false;
}
async function run(){
  $('run-validation').disabled=true;
  $('download-validation').disabled=true;
  $('validation-status').textContent='검색 이력, 경쟁 문서, 실험, 실제 화면 검수 기록을 점검하는 중입니다.';
  try{
    const [searches,pages,experiments,summaries]=await Promise.all([
      listSearches(),listPages(),listExperiments(),listVisualAuditSummaries()
    ]);
    // 24 saved viewport screenshots at most. Load one record at a time to limit peak memory.
    const audits=[];
    for(const s of summaries){
      const item=await readVisualAudit(s.id);
      if(item)audits.push(item);
    }
    report=buildFullValidation(searches,pages,experiments,audits);
    render();
    $('validation-status').textContent='자료 점검 완료: '+report.status+
      '. 이는 실제 검색 알고리즘이나 전체 순위의 검증이 아닙니다.';
  }catch(error){
    report=null;
    $('validation-status').textContent='통합 검증 실패: '+error.message;
  }finally{$('run-validation').disabled=false;}
}
$('run-validation').addEventListener('click',()=>void run());
$('download-validation').addEventListener('click',()=>{
  if(!report)return;
  // Evidence manifest only. Do not embed entire collected article text or PNG in summary.
  save('naver-serp-full-validation.json',JSON.stringify(report,null,2));
});
void run();
