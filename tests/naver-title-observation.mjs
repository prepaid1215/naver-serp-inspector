import assert from 'node:assert/strict';
import {
  JOB_LABEL,parseNaverJob,titleCompareIssueBody,naverArticleIdentity,
  compareNaverQueryObservations
} from '../extension/naver-autopilot-core.js';

const body=titleCompareIssueBody(['KT 바로유심 개통','바로유심 개통방법','편의점 KT 유심'],6);
const issue={number:77,state:'open',labels:[{name:JOB_LABEL}],body};
assert.deepEqual(parseNaverJob(issue),{
  issue_number:77,query:'KT 바로유심 개통',
  queries:['KT 바로유심 개통','바로유심 개통방법','편의점 KT 유심'],
  limit:6,mode:'title_compare'
});
assert.throws(()=>parseNaverJob({...issue,body:
  'SERP_LENS_TITLE_COMPARE_V1\n{"queries":["x","y"],"limit":2}'}));
assert.throws(()=>parseNaverJob({...issue,body:
  'SERP_LENS_TITLE_COMPARE_V1\n{"queries":["KT 바로유심","KT 바로유심"],"limit":2}'}));
assert.throws(()=>parseNaverJob({...issue,body:
  'SERP_LENS_TITLE_COMPARE_V1\n{"queries":["a 2","b 2","c 2","d 2","e 2"],"limit":2}'}));
assert.throws(()=>parseNaverJob({...issue,body:
  'SERP_LENS_TITLE_COMPARE_V1\n{"queries":["KT 바로유심","바로유심 개통방법"],"limit":7}'}));
assert.throws(()=>parseNaverJob({...issue,body:
  'SERP_LENS_TITLE_COMPARE_V1\n{"queries":["KT 바로유심","바로유심 개통방법"],"limit":2,"url":"https://example.com"}'}));
assert.equal(
  naverArticleIdentity('https://blog.naver.com/SomeID/224465859329?ref=abc'),
  naverArticleIdentity('https://blog.naver.com/PostView.naver?blogId=SomeID&logNo=224465859329')
);
assert.equal(
  naverArticleIdentity('https://cafe.naver.com/dowajo/1614530?art=abc'),
  naverArticleIdentity('https://m.cafe.naver.com/dowajo/1614530?art=xyz')
);
assert.equal(naverArticleIdentity('https://cafe.naver.com/dowajo'),null);
assert.equal(naverArticleIdentity('https://evil.com/demo/224465859329'),null);
const observations=[
  {query:'KT 바로유심 개통',rows:[
    {type:'BLOG',url:'https://blog.naver.com/demo/224465859329',title:'KT 바로유심 개통 후기',
      visible_title:'KT 바로유심 개통 후기',title_confidence:'high',
      document_visual_order:2,source_visual_order:1},
    {type:'CAFE',url:'https://cafe.naver.com/dowajo/1614530?art=abc',
      title:'KT 바로유심 가격',title_confidence:'heuristic',
      document_visual_order:3,source_visual_order:1},
    {type:'BLOG',url:'https://blog.naver.com/demo',title:'프로필'},
    {type:'BLOG',url:'https://blog.naver.com/demo/224465859329?tracking=1',
      title:'중복 링크'}
  ]},
  {query:'바로유심 개통방법',rows:[
    {type:'BLOG',url:'https://blog.naver.com/demo/224465859329?tracked=2',
      visible_title:'바로유심 개통 후기',title_confidence:'heuristic',
      document_visual_order:5,source_visual_order:4},
    {type:'CAFE',url:'https://cafe.naver.com/elsewhere/12001',
      title:'다른 카페 글',document_visual_order:6}
  ]}
];
const c=compareNaverQueryObservations(observations);
assert.equal(c.counts[0].article_link_candidates,2);
assert.equal(c.counts[1].article_link_candidates,2);
assert.equal(c.all_unique_article_candidates,3);
assert.equal(c.repeated_article_count,1);
assert.equal(c.overlaps[0].shared_article_candidates,1);
assert.equal(c.repeated_articles[0].sightings[0].visual_order_candidate,2);
assert.equal(c.repeated_articles[0].sightings[1].visual_order_candidate,5);
assert.equal(c.repeated_articles[0].sightings[0].displayed_title,'KT 바로유심 개통 후기');
assert.equal(c.repeated_articles[0].sightings[1].displayed_title,'바로유심 개통 후기');
console.log('NAVER TITLE COMPARISON CONTRACT TESTS PASS');
