import assert from 'node:assert/strict';
import {groupBlocks,toCSV,BLOCK_FIELDS} from '../web/engine.js';
const data={meta:{query:'선불폰 개통',device:'PC',observed_at_kst:'2026-10-10',evidence_file:'fixture.html',evidence_sha256:'example'},rows:[
{block_order:1,rank_in_block:1,block_type:'AD',result_url:'https://ads.example',is_target:'N'},
{block_order:2,rank_in_block:1,block_type:'CAFE',result_url:'https://cafe.naver.com/x/1',is_target:'Y'},
{block_order:2,rank_in_block:2,block_type:'CAFE',result_url:'https://cafe.naver.com/x/2',is_target:'N'},
{block_order:3,rank_in_block:1,block_type:'WEB',result_url:'https://www.59man.shop/',is_target:'Y'}]};
const groups=groupBlocks(data);
assert.equal(groups.length,3);
assert.deepEqual(groups.map(x=>x.card_count),[1,2,1]);
assert.deepEqual(groups.map(x=>x.target_count),[0,1,1]);
assert.equal(groups[1].visible_section_name,'미표시 / 확인 필요');
assert.equal(toCSV(groups,BLOCK_FIELDS).trim().split('\r\n').length,4);
const mixed=groupBlocks({meta:data.meta,rows:[
{block_order:4,rank_in_block:1,block_type:'BLOG',result_url:'https://blog.naver.com/x/1',is_target:'N'},
{block_order:4,rank_in_block:2,block_type:'CAFE',result_url:'https://cafe.naver.com/x/1',is_target:'Y'},
{block_order:4,rank_in_block:3,block_type:'CAFE',result_url:'https://cafe.naver.com/x/2',is_target:'N'}]});
assert.equal(mixed.length,1);
assert.equal(mixed[0].inferred_type,'MIXED');
assert.equal(mixed[0].type_breakdown,'BLOG 1 · CAFE 2');
console.log('BLOCK grouping tests PASS');
