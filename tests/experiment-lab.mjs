import assert from 'node:assert/strict';
import {makeExperiment,analyzeExperiment,experimentReportText,CHANGE_TYPES} from '../extension/experiment-lab.js';

const exp=makeExperiment({
  title:'제목만 바꾸기',query:'선불폰 개통',device:'PC',change_type:'title',
  changed_at:'2026-11-03T12:00:00+09:00',
  target_url:'https://blog.naver.com/mine/1234',
  control_urls:['https://blog.naver.com/control/5678','https://m.blog.naver.com/PostView.naver?blogId=control&logNo=5678'],
  change_note:'제목만 변경',controls_unchanged_asserted:true
},new Date('2026-11-03T03:00:00Z'));
assert.equal(exp.control_urls.length,1,'duplicate blog URL forms should be merged');
assert.equal(CHANGE_TYPES[exp.change_type],'제목 변경');
assert.throws(()=>makeExperiment({...exp,target_url:exp.control_urls[0],control_urls:[exp.control_urls[0]]}),/달라야/);
assert.throws(()=>makeExperiment({...exp,change_type:'all'}),/변경 유형/);
const createRows=(targetPos,controlPos,includeAd=true)=>{
  const urls=Array.from({length:9},(_,i)=>({block_type:'BLOG',result_url:'https://blog.naver.com/other'+i+'/10'+i,result_title:'다른 문서 '+i}));
  if(targetPos)urls[targetPos-1]={block_type:'BLOG',result_url:'https://m.blog.naver.com/PostView.naver?blogId=mine&logNo=1234',result_title:'수정한 글'};
  if(controlPos)urls[controlPos-1]={block_type:'BLOG',result_url:'https://blog.naver.com/control/5678',result_title:'대조 문서'};
  return includeAd?[{block_type:'AD',result_url:'https://ad.example.com'} ,...urls]:urls;
};
const captured=(id,date,targetPos,controlPos)=>({
  id,query:'선불폰 개통',device:'PC',captured_at:date,sourceURL:'https://search.naver.com/search.naver?query=example',
  evidence_sha256:'a'.repeat(64),rows:createRows(targetPos,controlPos)
});
const searches=[
 captured('b1','2026-11-01T03:00:00Z',4,5),
 captured('b2','2026-11-02T03:00:00Z',3,6),
 captured('a1','2026-11-04T03:00:00Z',2,5),
 captured('a2','2026-11-05T03:00:00Z',1,5),
 {...captured('mobile','2026-11-05T03:00:00Z',1,5),device:'모바일'},
 {...captured('other','2026-11-05T03:00:00Z',1,5),query:'다른 키워드'}
];
const result=analyzeExperiment(exp,searches);
assert.equal(result.counts.before,2);
assert.equal(result.counts.after,2);
assert.equal(result.target.before.median_position,3.5);
assert.equal(result.target.after.median_position,1.5);
assert.equal(result.target.delta,2);
assert.equal(result.controls[0].before.median_position,5.5);
assert.equal(result.controls[0].after.median_position,5);
assert.equal(result.controls[0].delta,0.5);
assert.equal(result.relative_delta,1.5);
assert.equal(result.enough_repeated_observations,true);
assert.equal(result.evidence.before[0].positions[result.target.key],4);
assert.equal(result.evidence.after[0].positions[result.target.key],2);
assert.match(result.interpretation,/앞쪽/);
assert.match(experimentReportText(result),/SHA-256/);
assert.match(experimentReportText(result),/인과/);
const sparse=analyzeExperiment(exp,[searches[0],searches[2]]);
assert.equal(sparse.enough_repeated_observations,false);
assert.match(sparse.interpretation,/횟수/);
const missing=analyzeExperiment(exp,[
  captured('before','2026-11-01T03:00:00Z',4,5),
  captured('after','2026-11-05T03:00:00Z',null,5)
]);
assert.equal(missing.target.after.median_position,null);
assert.equal(missing.relative_delta,null);
assert.equal(missing.target.after.missing,1);
assert.match(missing.interpretation,/노출이 부족/);

const narrow=analyzeExperiment({...exp,window_days:3},searches);
assert.equal(narrow.window_days,3);
assert.equal(narrow.counts.before,2);
assert.equal(narrow.counts.after,2);
const wrongType=captured('type-other','2026-11-05T03:00:00Z',1,5);
wrongType.rows[5].block_type='CAFE'; // control shown with a different result type in after window
const incompatible=analyzeExperiment(exp,[searches[0],wrongType]);
assert.equal(incompatible.controls[0].same_document_type,false);
assert.equal(incompatible.relative_delta,null);
const outside=captured('outside','2026-10-01T03:00:00Z',1,5);
const bounded=analyzeExperiment({...exp,window_days:3},[outside,searches[2]]);
assert.equal(bounded.counts.before,0);
assert.equal(bounded.counts.after,1);
const absent=analyzeExperiment(exp,[searches[0]]);
assert.equal(absent.relative_delta,null);
assert.equal(absent.counts.after,0);
console.log('RANK EXPERIMENT LEDGER TESTS PASS');
