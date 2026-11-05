import assert from 'node:assert/strict';
import {buildFullValidation} from '../extension/full-validation.js';

const page=(id,url)=>({
 id,url,title:'선불폰 개통 방법 '+id,
 text:'선불폰 개통 방법을 자세하게 설명합니다.'.repeat(10),
 captured_at:'2026-11-05T09:00:00Z',
 headings:[{level:'H2',text:'선불폰 개통 순서'}],images:2,external_links:1
});
const pages=[
 page('one','https://blog.naver.com/first/123'),
 page('two','https://blog.naver.com/second/123'),
 page('three','https://blog.naver.com/third/123')
];
const queryNames=['선불폰 개통','앤텔레콤 선불폰','선불유심 개통'];
const rows=pages.map(p=>({
 block_type:'BLOG',result_url:p.url,result_title:p.title
}));
const searches=queryNames.flatMap((query,i)=>[
 {id:'before-'+i,query,device:'PC',captured_at:'2026-11-03T03:00:00Z',
  evidence_sha256:'a'.repeat(64),rows},
 {id:'after-'+i,query,device:'모바일',captured_at:'2026-11-04T03:00:00Z',
  evidence_sha256:'b'.repeat(64),rows}
]);
const screenshot=new Uint8Array([137,80,78,71]);
const visual=device=>({
 id:'visual-'+device,query:'선불폰 개통',url_device:device,
 layout_device:device==='PC'?'데스크톱 너비':'모바일 너비',
 captured_at:'2026-11-05T04:00:00Z',
 viewport:{width:device==='PC'?1200:390,height:790},
 screenshot_png:screenshot,
 screenshot_image_size:{width:device==='PC'?1200:390,height:790},
 checked_complete:true,capture_moved:false,screenshot_dimension_mismatch:false,
 reviews:{first:{verdict:'confirmed',correct_type:'BLOG'}},
 block_reviews:{block:{verdict:'confirmed',correct_type:'BLOG'}},
 candidates:[{id:'first',url:pages[0].url,title:pages[0].title,type_hint:'BLOG',x:40,y:150}],
 blocks:[{id:'block',x:20,y:140,width:300,height:100,candidates:1,type_hints:['BLOG']}],
 added:[],parsed_rows:[{block_type:'BLOG',result_url:pages[0].url}]
});
const empty=buildFullValidation();
assert.equal(empty.ready,false);
assert.equal(empty.stages.length,5);
assert.ok(empty.stages.every(s=>s.status==='미검증'));
const partial=buildFullValidation(searches,pages,[],[visual('PC')]);
assert.equal(partial.stages[1].ready,true);
assert.equal(partial.stages[2].ready,true);
assert.equal(partial.stages[0].ready,false);
assert.match(partial.stages[0].note,/모바일 실화면 0개/);
const both=buildFullValidation(searches,pages,[],[visual('PC'),visual('모바일')]);
assert.equal(both.stages[0].ready,true);
assert.equal(both.stages[4].ready,false);
assert.equal(both.ready,false); // experiments are still absent; no fake 5/5
const noReview=buildFullValidation(searches,pages,[],[
 {...visual('PC'),reviews:{}},visual('모바일')
]);
assert.equal(noReview.stages[0].ready,false);
const fakeMobile=buildFullValidation(searches,pages,[],[
 visual('PC'),{...visual('모바일'),layout_device:'데스크톱 너비'}
]);
assert.equal(fakeMobile.stages[0].ready,false);
assert.ok(both.limitations.some(t=>t.includes('GitHub 자동 테스트')));
console.log('FIVE-STAGE EVIDENCE READINESS TESTS PASS');
