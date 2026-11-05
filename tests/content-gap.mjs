import assert from 'node:assert/strict';
import {compareCapturedContent,gapReportText} from '../extension/content-gap.js';

const own={
  id:'mine',url:'https://my.example.com/first',title:'선불폰 신규가입 방법',
  text:'편의점 유심을 준비해서 웹으로 신청하는 방법을 설명합니다.',
  description:'',headings:[{level:'H2',text:'유심 준비하기'}],
  captured_at:'2026-11-05T00:00:00Z'
};
const rivalA={
  id:'a',url:'https://other.example.com/a',title:'가입 후 승인 대기',
  text:'신청서 접수 후 승인 순서를 확인합니다.',
  headings:[
    {level:'H2',text:'태블릿번호 입력 순서'},
    {level:'H2',text:'유심 준비 방법'}
  ]
};
const rivalB={
  id:'b',url:'https://other.example.com/b',title:'앱 가입 단계',
  text:'태블릿번호 입력에 대해 설명합니다.',
  headings:[{level:'H2',text:'태블릿번호 입력 순서'}]
};
const result=compareCapturedContent(own,[rivalA,rivalB],{keyword:'선불폰 신규가입'});
assert.equal(result.competitors.length,2);
assert.equal(result.keyword,'선불폰 신규가입');
const topic=result.review.find(t=>t.topic==='태블릿번호 입력 순서');
assert.ok(topic, 'missing candidate from competitor headings');
assert.equal(topic.references.length,2, 'same competitor topic retains 2 distinct sources');
assert.ok(result.related.find(t=>t.topic==='유심 준비 방법'), 'own text gives a related term');
assert.ok(result.suggestions.every(x=>x.evidence.length), 'all tasks have observed evidence');
assert.ok(result.limitations.some(x=>x.includes('검색 순위')));
assert.match(gapReportText(result),/other.example.com\/a/);
assert.throws(()=>compareCapturedContent({},[]),/내 문서/);
assert.equal(compareCapturedContent(own, [own]).competitors.length,0);
console.log('CONTENT GAP LOCAL EVIDENCE TESTS PASS');
