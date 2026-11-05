import assert from 'node:assert/strict';
import {validateJob,parseRepository,parseBranch,requestPath,resultPath,selectArticles,buildResult,
  BRIDGE_JOB_SCHEMA,summarizeRows} from '../extension/chat-bridge-protocol.js';
import {createGithubBridge} from '../extension/chat-bridge-github.js';

const id='20261105T093000Z-abcdef12';
const job={
 schema:BRIDGE_JOB_SCHEMA,job_id:id,
 mode:'search_and_read',query:'다이소 유심',device:'PC',max_articles:10,
 requested_at:new Date().toISOString()
};
assert.equal(validateJob(job).query,'다이소 유심');
assert.equal(requestPath(id),'bridge/requests/'+id+'.json');
assert.equal(resultPath(id),'bridge/results/'+id+'.json');
assert.equal(parseRepository('prepaid1215/naver-private'),'prepaid1215/naver-private');
assert.equal(parseBranch('main'),'main');
assert.throws(()=>parseRepository('evil/../../secrets'),/형식/);
assert.throws(()=>requestPath('../../private'),/올바르지/);
assert.throws(()=>validateJob({...job,device:'모바일'}),/PC/);
assert.throws(()=>validateJob({...job,max_articles:11}),/1~10/);
assert.throws(()=>validateJob({...job,requested_at:'2020-01-01T00:00:00Z'}),/7일/);
const rows=[
 {block_type:'AD',result_url:'https://ads.example.com',result_title:'광고'},
 {block_type:'BLOG',result_url:'https://blog.naver.com/demo/123',result_title:'첫 블로그',organic_rank:1},
 {block_type:'WEB',result_url:'https://example.org/a',result_title:'외부 웹문서'},
 {block_type:'CAFE',result_url:'https://m.cafe.naver.com/test/123',result_title:'두번째 카페',organic_rank:3},
 {block_type:'BLOG',result_url:'https://blog.naver.com/admin/write',result_title:'관리자 페이지'},
 {block_type:'BLOG',result_url:'https://blog.naver.com/demo/123',result_title:'중복'}
];
assert.deepEqual(selectArticles(rows,10).map(x=>x.block_type),['BLOG','CAFE']);
assert.equal(summarizeRows(rows).length,5);
const report=buildResult(job,{url:'https://search.naver.com',status:'parsed',rows},[
 {serp_url:'https://blog.naver.com/demo/123',serp_title:'블로그 글',
  serp_type:'BLOG',fetch_status:'ok',article_url:'https://blog.naver.com/demo/123',
  title:'본문 제목',text:'abc '.repeat(6000),headings:['제목'],images:3}
]);
assert.equal(report.articles.length,1);
assert.equal(report.articles[0].text.length,15000);
assert.equal(report.search.rows.length,5);
const requests=[];
const privateRepo={private:true,full_name:'prepaid1215/private-data'};
const resultFile=()=>({type:'file',encoding:'base64',content:btoa(JSON.stringify(job))});
const fakeFetch=async (url,opts)=>{
 requests.push({url,method:opts.method,headers:opts.headers,body:opts.body});
 let body;
 if(url==='https://api.github.com/repos/prepaid1215/private-data')body=privateRepo;
 else if(url.includes('/contents/bridge/requests/')&&opts.method==='GET')body=resultFile();
 else if(url.includes('/contents/bridge/requests?'))body=[{name:id+'.json',type:'file'}];
 else if(url.includes('/contents/bridge/results?'))body=[];
 else if(url.includes('/contents/bridge/results/')&&opts.method==='GET')
   return {status:404,ok:false,json:async()=>({message:'not found'})};
 else if(url.includes('/contents/bridge/results/')&&opts.method==='PUT')
   body={content:{sha:'saved-sha'}};
 else throw Error('Unexpected URL '+url);
 return {status:opts.method==='PUT'?201:200,ok:true,json:async()=>body};
};
const connection=createGithubBridge({repository:'prepaid1215/private-data',token:'memory-token'},fakeFetch);
assert.equal((await connection.verifyPrivate()).private,true);
assert.equal((await connection.listJobs()).length,1);
assert.equal((await connection.fetchJob(id)).query,'다이소 유심');
const saved=await connection.uploadResult(job,report);
assert.equal(saved.sha,'saved-sha');
const payload=JSON.parse(requests.find(x=>x.method==='PUT').body);
const decoded=JSON.parse(atob(payload.content));
assert.equal(decoded.articles[0].title,'본문 제목');
assert.equal(payload.branch,'main');
assert.ok(!JSON.stringify(payload).includes('memory-token'));
const publicConnection=createGithubBridge({repository:'prepaid1215/private-data',token:'memory-token'},
 async()=>({status:200,ok:true,json:async()=>({...privateRepo,private:false})}));
await assert.rejects(publicConnection.verifyPrivate(),/공개 저장소/);
console.log('NAVER CHAT BRIDGE PROTOCOL AND PRIVATE GITHUB TESTS PASS');
