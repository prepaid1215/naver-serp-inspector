import assert from 'node:assert/strict';
import {summarizeVisualAudit,compareViewportParser} from '../extension/visual-audit-core.js';
const sample={
 id:'visual-1',captured_at:'2026-11-05T09:00:00Z',
 source_url:'https://search.naver.com/search.naver?query=sample',
 query:'sample',url_device:'PC',layout_device:'데스크톱 너비',
 viewport:{width:900,height:600}, screenshot_image_size:{width:900,height:600},
 screenshot_png:new Uint8Array([137,80,78,71]),capture_moved:false,
 screenshot_dimension_mismatch:false,root_fallback:false,
 candidates:[
  {id:'one',url:'https://ads.example.com/1',title:'광고',type_hint:'AD',y:70,x:10},
  {id:'two',url:'https://blog.naver.com/demo/123',title:'블로그',type_hint:'BLOG',y:140,x:10},
  {id:'three',url:'https://example.com/3',title:'웹',type_hint:'WEB',y:220,x:10}
 ],
 parsed_rows:[
  {result_url:'https://ads.example.com/1',block_type:'AD'},
  {result_url:'https://m.blog.naver.com/PostView.naver?blogId=demo&logNo=123',block_type:'BLOG'},
  {result_url:'https://example.com/lower-fold',block_type:'WEB'}
 ],
 reviews:{},added:[],checked_complete:false
};
let report=summarizeVisualAudit(sample);
assert.equal(report.verified_viewport,false);
assert.equal(report.counts.unreviewed,3);
assert.equal(report.visible_items.length,0);
const annotated={...sample,
 reviews:{
  one:{verdict:'confirmed'},two:{verdict:'confirmed',correct_type:'CAFE'},
  three:{verdict:'rejected'}
 },
 added:[{id:'manual-1',x:13,y:180,title:'직접 표시한 항목',type:'WEB'}],
 checked_complete:true
};
report=summarizeVisualAudit(annotated);
assert.equal(report.verified_viewport,true);
assert.equal(report.counts.confirmed,2);
assert.equal(report.counts.rejected,1);
assert.equal(report.counts.manual,1);
assert.deepEqual(report.visible_items.map(x=>x.viewport_order),[1,2,3]);
assert.equal(report.visible_items[1].actual_type,'CAFE');
assert.equal(report.visible_non_ad_count,2);
assert.equal(report.counts.parser_matched,2);
assert.equal(compareViewportParser(report).unmatched_in_screenshot,0);
const withBlock={...annotated,blocks:[{id:'b1',type_hints:['AD'],x:0,y:15,candidates:1}]};
assert.equal(summarizeVisualAudit(withBlock).verified_viewport,false);
const reviewedBlock={...withBlock,block_reviews:{b1:{verdict:'confirmed',correct_type:'AD'}}};
assert.equal(summarizeVisualAudit(reviewedBlock).verified_viewport,true);
assert.equal(summarizeVisualAudit(reviewedBlock).block_counts.confirmed,1);
assert.equal(summarizeVisualAudit(reviewedBlock).verified_blocks[0].actual_type,'AD');
assert.equal(summarizeVisualAudit({...annotated,capture_moved:true}).verified_viewport,false);
assert.equal(summarizeVisualAudit({...annotated, screenshot_dimension_mismatch:true}).verified_viewport,false);
assert.equal(summarizeVisualAudit({...annotated, reviews:{...annotated.reviews,two:{verdict:'uncertain'}}}).verified_viewport,false);
console.log('VISUAL VIEWPORT REVIEW TESTS PASS');
