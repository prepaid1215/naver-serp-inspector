import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isNaverSearchURL,queryFromSearchURL,deviceFromSearchURL,evidenceFileBase,kstStamp} from '../extension/capture-meta.js';
const pc='https://search.naver.com/search.naver?query=%EC%84%A0%EB%B6%88%ED%8F%B0+%EA%B0%9C%ED%86%B5';
const mo='https://m.search.naver.com/search.naver?where=m&query=KT+%EC%84%A0%EB%B6%88%ED%8F%B0';
for(const url of [pc,mo]) assert.ok(isNaverSearchURL(url),url);
for(const url of [
 'https://search.naver.com.evil.example/search.naver?query=test',
 'https://naver.com/?query=test',
 'http://search.naver.com/search.naver?query=test',
 'https://search.naver.com/search.naver',
 'https://search.naver.com/other?query=test',
 'chrome://extensions/', 'file:///tmp/a.html'
]) assert.ok(!isNaverSearchURL(url),url);
assert.equal(queryFromSearchURL(pc),'선불폰 개통');
assert.equal(deviceFromSearchURL(mo),'mo');
assert.equal(kstStamp(new Date('2026-10-15T06:30:00Z')),'20261015-1530');
assert.equal(evidenceFileBase(pc,new Date('2026-10-15T06:30:00Z')),'20261015-1530_pc_선불폰 개통');
assert.equal(evidenceFileBase(mo,new Date('2026-10-15T06:30:00Z')),'20261015-1530_mo_KT 선불폰');
const manifest=JSON.parse(readFileSync(new URL('../extension/manifest.json',import.meta.url)));
assert.equal(manifest.manifest_version,3);
assert.deepEqual(manifest.permissions,['activeTab','scripting']);
assert.ok(!manifest.host_permissions && !manifest.background);
console.log('Extension URL permission, metadata and manifest tests passed');
