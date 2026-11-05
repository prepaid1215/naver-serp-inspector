import assert from 'node:assert/strict';
import {
  validateRepository,prepareSharedRecord,evidencePath,
  checkPrivateRepository,uploadEvidence,updateEvidenceIndex
} from '../extension/github-evidence-sync.js';

assert.equal(validateRepository('tester/private-evidence'),'tester/private-evidence');
for(const name of ['','public','../../attack','person/repo/contents','person//repo'])
  assert.throws(()=>validateRepository(name));

const page={id:'one',url:'https://blog.naver.com/demo/224123456789',
  origin_url:'https://blog.naver.com/demo',
  title:'다이소 유심과 LG 원칩 차이',text:'다이소 고고비 유심 비교 본문입니다. '.repeat(12),
  captured_at:'2026-11-05T10:00:00Z',source_frame:'https://blog.naver.com/PostView.naver?logNo=224123456789',
  clean_text:'다이소 고고비 유심 비교 본문입니다.'.repeat(12),
  clean_text_length:204,image_captions:['유심 포장 사진'],
  extraction_audit:{comparison_to_original:'not_verified',source:'rendered_dom',
    images_ocr:false,root_candidates:2,numbered_section_candidates:3,
    warnings:['이미지 안의 글자는 OCR로 추출하지 않았습니다.']},
  headings:[{level:'H2',text:'NFC 기능 비교'}],images:3,score:90000,
  sensitive_unknown_field:'must not be exported'};
const prepared=prepareSharedRecord('pages',page);
assert.equal(prepared.kind,'pages');
assert.equal(prepared.data.title,page.title);
assert.ok(prepared.data.text.includes('고고비'));
assert.equal(prepared.data.score,undefined);
assert.equal(prepared.data.sensitive_unknown_field,undefined);
assert.equal(prepared.data.origin_url,page.origin_url);
assert.equal(prepared.data.clean_text,page.clean_text);
assert.deepEqual(prepared.data.image_captions,['유심 포장 사진']);
assert.equal(prepared.data.extraction_audit.comparison_to_original,'not_verified');
assert.equal(prepared.data.extraction_audit.images_ocr,false);
assert.equal(prepared.data.extraction_audit.root_candidates,2);
assert.match(await evidencePath('pages',page),/^serp-lens\/pages\/2026-11\/[a-f0-9]{24}\.json$/);
assert.equal(await evidencePath('pages',page),await evidencePath('pages',page));
assert.throws(()=>prepareSharedRecord('pages',{url:page.url,title:'title',text:'abc'}),/본문/);
assert.throws(()=>prepareSharedRecord('searches',{query:'a',device:'PC',rows:[]}),/검색/);

const search=prepareSharedRecord('searches',{
  id:'2',query:'다이소 유심',device:'PC',
  rows:[{result_url:page.url,block_type:'BLOG',organic_rank:2,secret:'do not share'}]});
assert.equal(search.data.rows[0].secret,undefined);
let uploads=[],getCount=0;
const fakeFetch=async(url,request={})=>{
  if(url==='https://api.github.com/repos/example/private'){
    getCount++;
    assert.match(request.headers.Authorization,/^Bearer secret-token$/);
    return {ok:true,status:200,json:async()=>({
      private:true,default_branch:'main',permissions:{push:true}
    })};
  }
  if(url.includes('/contents/serp-lens/index.json')&&request.method!=='PUT')
    return {ok:false,status:404,json:async()=>({message:'Not Found'})};
  if(url.includes('/contents/serp-lens/pages/')&&request.method!=='PUT')
    return {ok:false,status:404,json:async()=>({message:'Not Found'})};
  if(request.method==='PUT'){
    const body=JSON.parse(request.body);
    assert.equal(body.branch,'main');
    const binary=atob(body.content);
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const payload=JSON.parse(new TextDecoder().decode(bytes));
    uploads.push({url,payload});
    return {ok:true,status:201,json:async()=>({content:{sha:'abc'}})};
  }
  return {ok:false,status:500,json:async()=>({message:'unexpected route '+url})};
};
const config=await checkPrivateRepository({repository:'example/private',token:'secret-token',fetcher:fakeFetch});
assert.equal(config.name,'example/private');
assert.equal(getCount,1);
const item=await uploadEvidence({
  config,token:'secret-token',type:'pages',record:page,fetcher:fakeFetch
});
assert.equal(item.kind,'pages');
assert.ok(item.path.startsWith('serp-lens/pages/'));
assert.equal(uploads.length,1);
assert.equal(uploads[0].payload.data.text,page.text.trim());
assert.equal(uploads[0].payload.data.sensitive_unknown_field,undefined);
await updateEvidenceIndex({config,token:'secret-token',entries:[item],fetcher:fakeFetch});
assert.equal(uploads[1].payload.records[0].path,item.path);
const publicFetch=async()=>({ok:true,status:200,json:async()=>({private:false,default_branch:'main'})});
await assert.rejects(()=>checkPrivateRepository({
  repository:'example/public',token:'secret-token',fetcher:publicFetch
}),/공개 GitHub 저장소/);
await assert.rejects(()=>checkPrivateRepository({repository:'example/private',token:''}),/토큰/);
console.log('PRIVATE GITHUB CHAT BRIDGE EVIDENCE TESTS PASS');
