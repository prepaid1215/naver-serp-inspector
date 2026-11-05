import assert from 'node:assert/strict';
import {documentKey,sourceKey,pageFeatures,analyzeRankingEvidence,rankLabPrompt} from '../extension/rank-lab.js';

assert.equal(
  documentKey('https://m.blog.naver.com/PostView.naver?blogId=demo&logNo=12345&navType=by'),
  documentKey('https://blog.naver.com/demo/12345')
);
assert.equal(sourceKey({result_url:'https://m.blog.naver.com/demo/12345'}),'blog:demo');
assert.equal(sourceKey({result_url:'https://www.example.com/a'}),'site:example.com');
const p0={id:'doc-0',url:'https://blog.naver.com/author0/10000',title:'선불폰 개통 앤텔레콤',
  text:'선불폰 개통 앤텔레콤 소개',headings:[{text:'선불폰 개통'},{text:'준비'}],images:3,external_links:3};
assert.equal(pageFeatures(p0,'선불폰 개통').title_match,1);
assert.equal(pageFeatures(p0,'선불폰 개통').heading_match,1);
assert.equal(pageFeatures(p0,'선불폰 개통').published_at,null);
const terms=['선불폰 개통','선불폰 셀프개통','앤텔레콤 신규가입'];
const pageRows = [];
const searches=[];
for(let k=0;k<terms.length;k++){
  const query=terms[k],rows=[];
  for(let i=0;i<4;i++){
    const url='https://blog.naver.com/author'+i+'/'+(10000+k);
    rows.push({result_url:url,result_title:'문서 '+i,block_type:'BLOG',organic_rank:i+1});
    pageRows.push({id:'page-'+k+'-'+i,url,title:i===0?query+' 신청방법':i===1?query+' 후기':i===2?'휴대폰 이야기':'가입 안내',
      headings:Array.from({length:4-i},(_,j)=>({text:j===0&&i<2?query:'안내 '+j})),
      text:'가나다 '.repeat((5-i)*100),images:5-i,external_links:4-i,captured_at:'2026-11-05T00:00:00Z'});
  }
  searches.push({query,device:'PC',captured_at:'2026-11-05T09:00:00Z',rows});
}
const report=analyzeRankingEvidence(searches,pageRows,{device:'PC'});
assert.equal(report.keyword_count,3);
assert.equal(report.used_latest_capture_count,3);
assert.equal(report.results_count,12);
assert.equal(report.matched_page_count,12);
assert.equal(report.pair_comparisons,18); // same type, different source, four pages per query
assert.equal(report.top_sources[0].query_count,3);
assert.ok(report.factors.find(x=>x.key==='image_count').qualified);
assert.ok(report.factors.find(x=>x.key==='image_count').interpretation.includes('상위'));
assert.ok(report.factors.find(x=>x.key==='published_at').interpretation.includes('표본 부족'));
assert.match(rankLabPrompt(report),/관측치/);
assert.match(rankLabPrompt(report),/반대 사례/);
assert.ok(report.limitations.some(s=>s.includes('인과관계')));
const refreshed=[...searches,{...searches[0],captured_at:'2026-11-05T12:00:00Z',rows:searches[0].rows.slice(0,2)}];
const latest=analyzeRankingEvidence(refreshed,pageRows,{device:'PC'});
assert.equal(latest.used_latest_capture_count,3);
assert.equal(latest.search_capture_count,4);
assert.equal(latest.results_count,10);
assert.equal(analyzeRankingEvidence(searches,pageRows,{keyword:'해당없는키워드'}).matched_page_count,0);
assert.equal(analyzeRankingEvidence(searches,[],{}).matched_page_count,0);
assert.equal(analyzeRankingEvidence(searches,[],{}).pair_comparisons,0);
console.log('NAVER RANK LAB OBSERVATIONAL CHECKS PASS');
