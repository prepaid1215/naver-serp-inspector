import assert from 'node:assert/strict';
import {compareSearches,buildAIPrompt,pageStats} from '../extension/intelligence-analysis.js';

const older={id:'old',query:'선불폰 개통',device:'PC',captured_at:'2026-11-01T00:00:00Z',
  rows:[
    {block_type:'BLOG',result_title:'블로그 A',result_url:'https://blog.naver.com/test/123',organic_rank:1},
    {block_type:'WEB',result_title:'웹 B',result_url:'https://example.com/b',organic_rank:2}
  ]};
const newer={id:'new',query:'선불폰 개통',device:'PC',captured_at:'2026-11-05T00:00:00Z',
  rows:[
    {block_type:'WEB',result_title:'웹 B',result_url:'https://example.com/b?utm_source=test',organic_rank:1},
    {block_type:'WEB',result_title:'웹 C',result_url:'https://example.com/c',organic_rank:2},
    {block_type:'AD',result_title:'광고',result_url:'https://ads.example.com',organic_rank:''}
  ]};
const diff=compareSearches(newer,older);
assert.equal(diff.added.length,1);
assert.equal(diff.removed.length,1);
assert.equal(diff.changed.length,1);
assert.equal(diff.changed[0].delta,1);
assert.throws(()=>compareSearches({...newer,query:'다른 검색'},older),/키워드/);
const page={url:'https://example.com/post',title:'예시',captured_at:newer.captured_at,
  headings:[{level:'H2',text:'구매 방법'}],text:'테스트 본문',images:3,internal_links:2,external_links:1};
assert.equal(pageStats(page).images,3);
const prompt=buildAIPrompt([newer,older],[page],diff);
assert.match(prompt,/관측된 사실과 해석 가설/);
assert.match(prompt,/구매 방법/);
assert.match(prompt,/네이버 내부 랭킹/);
console.log('NAVER Intelligence evidence comparison tests passed');
