/* Deliberately separate screenshot storage; no migration of existing search experiments. */
const DB='naver-visual-audit-v1',STORE='audits',LIMIT=24;
function openDB(){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'});};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('화면 검수 로컬 DB 열기 실패'));
 });
}
async function transaction(mode,doAction){
 const db=await openDB();
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,mode),req=doAction(tx.objectStore(STORE));
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||Error('화면 검수 자료 요청 실패'));
   tx.onerror=()=>reject(tx.error||Error('검수 자료 저장 실패'));
  });
 }finally{db.close();}
}
export async function saveVisualAudit(record){
 if(!record?.id||!(record.screenshot_png instanceof Uint8Array)||!record.screenshot_png.length)
   throw Error('캡처 ID 또는 PNG 자료가 없습니다.');
 await transaction('readwrite',s=>s.put(record));
 const all=await listVisualAuditSummaries();
 for(const old of all.slice(LIMIT)) await removeVisualAudit(old.id);
}
export async function readVisualAudit(id){return transaction('readonly',s=>s.get(id));}
export async function removeVisualAudit(id){return transaction('readwrite',s=>s.delete(id));}
export async function listVisualAuditSummaries(){
 const audits=await transaction('readonly',s=>s.getAll());
 return audits.map(({screenshot_png,parsed_rows,candidates,added,reviews,...rest})=>({
  ...rest,candidate_count:candidates?.length||0,manual_count:added?.length||0,
  reviewed_count:Object.values(reviews||{}).filter(r=>r?.verdict).length,
  has_screenshot:!!screenshot_png?.byteLength
 })).sort((a,b)=>String(b.captured_at).localeCompare(String(a.captured_at)));
}
