import {listSearches,listPages,listExperiments} from './intelligence-store.js';
import {listVisualAuditSummaries,readVisualAudit} from './visual-store.js';
import {summarizeVisualAudit} from './visual-audit-core.js';
import {verifyCompletePipeline} from './full-verification.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=String(value);return e;};
let lastReport=null;
function showMessage(msg,error=false){
  $('message').textContent=String(msg);
  $('message').style.color=error?'#a64653':'#45689d';
}
const metricName={
  records:'검색 수집 기록',parsed:'문서 파싱 기록',naver_urls:'네이버 URL 근거',
  distinct_query_device:'검색어·기기 조건',captured:'수집 문서',matched_to_search:'검색 결과 연결',
  keyword_device_groups:'키워드·기기 그룹',matched_results:'연결된 문서',
  comparable_pairs:'비교 가능한 문서쌍',qualified_features:'반복된 관측 특성',
  registered:'실험 등록 수',analyzed:'비교 실행 가능한 실험',
  comparable:'전후 비교 가능',insufficient:'자료 부족 실험',
  screenshot_records:'검수 화면',manually_verified:'화면 수동 검수 완료',
  pc_verified:'PC 검수 완료',mobile_verified:'모바일 검수 완료',
  verified_with_matching_query:'검색이력·화면 연결',
  confirmed_headlines:'확인한 제목',parser_url_matches:'파서에서 매칭',
  unresolved_visible_url_mismatches:'검토할 불일치'
};
const label={ready:'증거 요건 충족',review:'오류·불일치 점검',pending:'수집 자료 추가 필요'};
function render(report){
  $('completed').textContent=String(report.completed);
  $('total').textContent=String(report.total);
  $('overall').textContent=report.completed===report.total?'자료 조건 충족':'현장 증거 보완 필요';
  const root=$('stages');root.replaceChildren();
  for(const stage of report.stages){
    const card=el('article','stage '+stage.status);
    card.append(el('h3',null,stage.title),el('p','state',label[stage.status]));
    const metrics=el('div','metrics');
    for(const [key,value] of Object.entries(stage.metrics)){
      const cell=el('div','metric');
      cell.append(el('strong',null,value),el('span',null,metricName[key]||key));
      metrics.append(cell);
    }
    card.append(metrics);
    if(stage.problems.length){
      for(const problem of stage.problems)card.append(el('p','problem',problem));
    }
    if(!stage.ready)card.append(el('p','next','다음 행동: '+stage.next));
    root.append(card);
  }
}
function download(name,content){
  const src=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));
  const a=document.createElement('a');a.href=src;a.download=name;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(src),5000);
}
$('verify-all').addEventListener('click',async()=>{
  $('verify-all').disabled=true;
  $('export-summary').disabled=true;
  showMessage('검색·문서·실험 기록과 실제 화면 검수 결과를 확인하는 중입니다.');
  try{
    const [searches,pages,experiments,visualSummaries]=await Promise.all([
      listSearches(),listPages(),listExperiments(),listVisualAuditSummaries()
    ]);
    const visualReports=[],problems=[];
    // Read each stored PNG only long enough to verify whether it is present.
    // Never retain all large images in memory at once.
    for(const a of visualSummaries){
      try{
        const original=await readVisualAudit(a.id);
        if(!original){problems.push('검수 기록 원본 없음: '+a.id);continue;}
        visualReports.push(summarizeVisualAudit(original));
      }catch(error){
        problems.push('검수 기록 '+a.id+' 분석 실패: '+error.message);
      }
    }
    const report=verifyCompletePipeline({
      searches,pages,experiments,visualAudits:visualSummaries,visualReports
    });
    if(problems.length){
      report.storage_errors=problems;
      const stage=report.stages.find(s=>s.key==='viewport');
      stage.problems.push(...problems);
      stage.status='review';stage.ready=false;
      report.completed=report.stages.filter(s=>s.ready).length;
      report.overall='incomplete';
    }
    report.manual_reverification_required=true;
    report.next_live_action='실제 네이버 검색 페이지에서 PC와 모바일 각각 수집하고 실제 PNG와 JSON을 직접 확인해야 합니다.';
    lastReport=report;
    render(report);
    $('export-summary').disabled=false;
    showMessage('로컬 통합 검증 완료: '+report.completed+'/'+report.total+
      '개 단계가 증거 조건을 충족합니다. 현장 화면·공식 노출 정확성은 별도 검증이 필요합니다.');
  }catch(error){
    showMessage('검증 자료 읽기 실패: '+error.message,true);
  }finally{$('verify-all').disabled=false;}
});
$('export-summary').addEventListener('click',()=>{
  if(!lastReport)return;
  const stamp=new Date().toISOString().slice(0,10);
  download('serp-lens-six-stage-verification-'+stamp+'.json',JSON.stringify(lastReport,null,2));
});
