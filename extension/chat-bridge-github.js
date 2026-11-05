import {parseRepository,parseBranch,requestPath,resultPath,JOB_RE,validateJob} from './chat-bridge-protocol.js';

/**
 * GitHub REST proxy, restricted to one chosen PRIVATE repository.
 * Token is kept in JS memory only. Never included in files or logs.
 */
export function createGithubBridge({repository,branch='main',token},fetcher=fetch){
  const repo=parseRepository(repository),targetBranch=parseBranch(branch);
  const secret=String(token||'').trim();
  if(!secret||secret.length>300)throw Error('비공개 저장소에만 접근하는 최소 권한 토큰이 필요합니다.');
  const base='https://api.github.com/repos/'+repo;
  async function api(path,{method='GET',data=null,missingOK=false}={}){
    const uri=base+path;
    const headers={
      'Accept':'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
      'Authorization':'Bearer '+secret
    };
    if(data!==null)headers['Content-Type']='application/json';
    const result=await fetcher(uri,{method,headers,body:data===null?undefined:JSON.stringify(data),cache:'no-store'});
    if(result.status===404&&missingOK)return null;
    if(!result.ok)throw Error('GitHub API '+result.status+
      (result.status===401?' · 토큰 권한 확인':
      result.status===403?' · 접근 제한 또는 API 호출 한도':
      result.status===404?' · 비공개 저장소 또는 브랜치 확인':''));
    return result.json();
  }
  function base64Encode(content){
    const bytes=new TextEncoder().encode(content);
    let chars='';
    for(let i=0;i<bytes.length;i+=8192)chars+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(chars);
  }
  function base64Decode(encoded){
    const raw=atob(String(encoded||'').replace(/\s/g,''));
    const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  async function verifyPrivate(){
    const info=await api('');
    if(info.private!==true)throw Error('공개 저장소에는 본문을 전송하지 않습니다. 비공개(private) 저장소를 지정하세요.');
    if(info.archived||info.disabled)throw Error('보관·비활성화된 저장소는 사용할 수 없습니다.');
    return {repository:info.full_name,private:true};
  }
  async function listPath(subpath){
    const dir=await api('/contents/'+subpath+'?ref='+encodeURIComponent(targetBranch),{missingOK:true});
    return Array.isArray(dir)?dir.filter(f=>f.type==='file'&&/\.json$/.test(f.name)): [];
  }
  async function listJobs(){
    const [requested,finished]=await Promise.all([
      listPath('bridge/requests'),listPath('bridge/results')
    ]);
    const done=new Set(finished.map(x=>x.name));
    return requested.filter(f=>JOB_RE.test(f.name.replace(/\.json$/,''))).map(f=>({
      job_id:f.name.slice(0,-5),done:done.has(f.name)
    })).sort((a,b)=>b.job_id.localeCompare(a.job_id)).slice(0,30);
  }
  async function fetchJob(id){
    const path=requestPath(id);
    const info=await api('/contents/'+path+'?ref='+encodeURIComponent(targetBranch));
    if(info.type!=='file'||info.encoding!=='base64')throw Error('유효하지 않은 요청 파일입니다.');
    const job=validateJob(JSON.parse(base64Decode(info.content)));
    if(job.job_id!==id)throw Error('파일명과 요청 ID가 일치하지 않습니다.');
    return job;
  }
  async function resultExists(id){
    return !!(await api('/contents/'+resultPath(id)+'?ref='+encodeURIComponent(targetBranch),{missingOK:true}));
  }
  async function uploadResult(job,result){
    const id=validateJob(job).job_id;
    if(result.job_id!==id)throw Error('요청 ID와 결과 ID가 다릅니다.');
    // Refuse uploads if a repo changed from private to public after connection.
    await verifyPrivate();
    // Avoid unexpected overwrites, even if stale client tries to duplicate a job.
    if(await resultExists(id))throw Error('이미 결과가 존재합니다. 덮어쓰지 않습니다.');
    const content=base64Encode(JSON.stringify(result,null,2));
    const data=await api('/contents/'+resultPath(id),{
      method:'PUT',data:{
        message:'Naver Chat Bridge observed evidence '+id,
        content,branch:targetBranch
      }
    });
    return {sha:data.content?.sha||'',path:resultPath(id),repository:repo,branch:targetBranch};
  }
  return {verifyPrivate,listJobs,fetchJob,resultExists,uploadResult,
    repository:repo,branch:targetBranch};
}
