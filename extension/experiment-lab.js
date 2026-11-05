/*
 * Rank Lab experiment ledger v1.
 * Computes observational before/after differences against unchanged controls
 * from user-captured SERP snapshots. No private rank scores or causal claims.
 */
import {documentKey} from './rank-lab.js';

export const CHANGE_TYPES=Object.freeze({
  title:'제목 변경',
  body:'본문 변경',
  internal_links:'내부링크 변경',
  other:'기타 변경'
});
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const normalizedQuery=value=>clean(value).toLowerCase();
function safeURL(value){
  let url;
  try{url=new URL(clean(value));}catch{throw Error('올바른 문서 URL을 입력해 주세요.');}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname)throw Error('http 또는 https 문서 URL만 지원합니다.');
  url.hash='';
  return url.href;
}
function time(value){
  const n=new Date(value).getTime();
  return Number.isFinite(n)?n:null;
}
function median(values){
  const xs=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!xs.length)return null;
  const m=Math.floor(xs.length/2);
  return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;
}
function round(value){return value===null?null:Math.round(value*100)/100;}
function uniqueByDoc(urls){
  const keys=new Set();
  const results=[];
  for(const raw of urls){
    const url=safeURL(raw),key=documentKey(url);
    if(!keys.has(key)){keys.add(key);results.push(url);}
  }
  return results;
}
export function makeExperiment(fields,now=new Date()){
  const title=clean(fields.title),query=clean(fields.query);
  const device=fields.device,change_type=fields.change_type;
  if(title.length<3)throw Error('실험 이름을 세 글자 이상 입력해 주세요.');
  if(query.length<2)throw Error('검색어를 두 글자 이상 입력해 주세요.');
  if(!['PC','모바일'].includes(device))throw Error('PC 또는 모바일 기기를 선택해 주세요.');
  if(!Object.hasOwn(CHANGE_TYPES,change_type))throw Error('변경 유형을 선택해 주세요.');
  if(!fields.changed_at||time(fields.changed_at)===null)throw Error('실제로 변경한 날짜와 시간을 입력해 주세요.');
  const target_url=safeURL(fields.target_url);
  const inputControls=Array.isArray(fields.control_urls)?fields.control_urls:[];
  const control_urls=uniqueByDoc(inputControls.map(clean).filter(Boolean));
  if(control_urls.length<1||control_urls.length>5)throw Error('수정하지 않을 대조 문서 URL을 1~5개 입력해 주세요.');
  if(control_urls.some(u=>documentKey(u)===documentKey(target_url)))throw Error('실험 문서와 대조 문서는 달라야 합니다.');
  const created=now.toISOString();
  return {
    id:crypto.randomUUID(),created_at:created,
    title:title.slice(0,120),query:query.slice(0,120),device,change_type,
    changed_at:new Date(fields.changed_at).toISOString(),
    target_url,control_urls,
    change_note:clean(fields.change_note).slice(0,1200),
    control_note:clean(fields.control_note).slice(0,500),
    // User affirmation is a plan statement; actual lack of change is not verified.
    controls_unchanged_asserted:!!fields.controls_unchanged_asserted
  };
}
function snapshotPositions(snapshot,targets){
  const out=new Map();
  const ids=new Map(targets.map(t=>[documentKey(t),t]));
  let position=0;
  for(const row of snapshot.rows||[]){
    if(row.block_type==='AD'||!row.result_url)continue;
    position++;
    const key=documentKey(row.result_url);
    if(ids.has(key)&&!out.has(key))out.set(key,{position,url:row.result_url,block_type:row.block_type});
  }
  return out;
}
function periodMetric(records,key){
  const positions=records.map(r=>r.positions[key]??null);
  const visible=positions.filter(x=>x!==null);
  return {observations:records.length,found:visible.length,missing:records.length-visible.length,
    median_position:round(median(visible)),positions};
}
function phase(records,keys){
  return keys.map(key=>periodMetric(records,key));
}
export function analyzeExperiment(experiment,searches){
  if(!experiment||!experiment.target_url)throw Error('유효한 실험 기록이 필요합니다.');
  const changedAt=time(experiment.changed_at);
  if(changedAt===null)throw Error('변경 시각을 확인해 주세요.');
  const targets=[experiment.target_url,...experiment.control_urls];
  const keys=targets.map(documentKey);
  const relevant=(searches||[]).filter(s=>normalizedQuery(s.query)===normalizedQuery(experiment.query)
    &&s.device===experiment.device&&time(s.captured_at)!==null
    &&Array.isArray(s.rows)&&s.rows.length>0&&!String(s.status||'').startsWith('수집 실패'))
    .sort((a,b)=>time(a.captured_at)-time(b.captured_at));
  const before=[],after=[];
  for(const s of relevant){
    const pos=snapshotPositions(s,targets);
    const record={id:s.id,captured_at:s.captured_at,source_url:s.sourceURL||'',
      evidence_sha256:s.evidence_sha256||'',document_count:(s.rows||[]).filter(r=>r.block_type!=='AD').length,
      positions:Object.fromEntries(keys.map(k=>[k,pos.get(k)?.position??null]))};
    if(time(s.captured_at)<changedAt)before.push(record);else after.push(record);
  }
  const beforeMetrics=phase(before,keys),afterMetrics=phase(after,keys);
  const docResults=targets.map((url,i)=>{
    const prior=beforeMetrics[i],following=afterMetrics[i];
    const comparable=prior.median_position!==null&&following.median_position!==null;
    const delta=comparable?round(prior.median_position-following.median_position):null;
    return {role:i===0?'target':'control',url,key:keys[i],before:prior,after:following,
      delta,comparison_available:comparable,
      note:comparable?'양수=노출 순서가 앞쪽으로 이동':
        '미등장/수집 부족: 해당 기간에서 위치 변화 계산 불가'};
  });
  const target=docResults[0],controls=docResults.slice(1);
  const eligibleControls=controls.filter(c=>c.comparison_available);
  const controlMedian=round(median(eligibleControls.map(c=>c.delta)));
  const relative=target.delta!==null&&controlMedian!==null?
    round(target.delta-controlMedian):null;
  const enough=before.length>=2&&after.length>=2&&eligibleControls.length>=1;
  let interpretation;
  if(!before.length||!after.length)interpretation='변경 전후 중 한쪽의 검색 화면 수집이 없습니다.';
  else if(relative===null)interpretation='실험·대조 문서의 전후 노출이 부족해 상대 변화를 계산할 수 없습니다.';
  else if(!enough)interpretation='상대 변화는 계산했지만 반복 관측 횟수가 부족합니다.';
  else if(relative>0)interpretation='대조 문서보다 실험 문서가 앞쪽으로 이동하는 변화가 관측됐습니다.';
  else if(relative<0)interpretation='대조 문서보다 실험 문서가 뒤쪽으로 이동하는 변화가 관측됐습니다.';
  else interpretation='대조 문서 대비 관측한 상대 위치 변화가 0입니다.';
  return {
    experiment:{...experiment},analyzed_at:new Date().toISOString(),
    query:experiment.query,device:experiment.device,
    counts:{before:before.length,after:after.length,eligible_controls:eligibleControls.length},
    target,controls,
    control_median_delta:controlMedian,relative_delta:relative,
    enough_repeated_observations:enough,
    interpretation,
    evidence:{before,after},
    limitations:[
      '네이버 검색의 HTML 순서에서 계산한 추정 위치이며 실제 화면 노출 위치와 다를 수 있습니다.',
      '수집되지 않은 결과는 미등장으로 기록합니다. 검색 순위 하락이나 색인 제외를 뜻하지 않습니다.',
      '이 비교는 인과 추정이 아닙니다. 검색 시스템 변화, 개인화, 의도 변화, 문서 수정 등 통제하지 못한 요인이 존재합니다.',
      '대조 문서가 실제로 변경되지 않았는지는 자동 검증하지 못합니다.',
      '실험 전후 수집 시각, 기기, 검색어를 일치시켜야 하고, 한 번에 한 변수만 바꾸는 것이 좋습니다.',
      '사용자가 브라우저에서 직접 수집한 결과만 사용합니다. 자동 검색 및 비공개 점수 추출 기능은 없습니다.'
    ]
  };
}
export function experimentReportText(report){
  const r=report,percent=v=>v===null?'계산 불가':String(v);
  const lines=[
    'NAVER Rank Lab · 변경 전후 실험 기록',
    '실험: '+r.experiment.title,
    '검색어: '+r.query+' / '+r.device,
    '수정 시각: '+r.experiment.changed_at,
    '변경 유형: '+(CHANGE_TYPES[r.experiment.change_type]||r.experiment.change_type),
    '실험 문서: '+r.target.url,
    '변경 내용: '+(r.experiment.change_note||'미기재'),
    '변경 전 수집 '+r.counts.before+'건 / 변경 후 '+r.counts.after+'건',
    '실험 문서의 위치 변화: '+percent(r.target.delta),
    '대조 문서 변화 중앙값: '+percent(r.control_median_delta),
    '상대 변화(실험-대조): '+percent(r.relative_delta),
    '해석: '+r.interpretation,'',
    '대조 문서 관측 기록:'
  ];
  for(const c of r.controls)lines.push(' - '+c.url+' (전 '+percent(c.before.median_position)+' / 후 '+percent(c.after.median_position)+' / 변화 '+percent(c.delta)+')');
  lines.push('','원본 수집 근거:');
  for(const side of ['before','after']){
    for(const row of r.evidence[side])lines.push(' - '+side+' '+row.captured_at+' '+row.source_url+' SHA-256 '+row.evidence_sha256);
  }
  lines.push('',...r.limitations.map(s=>'주의: '+s));
  return lines.join('\n');
}
