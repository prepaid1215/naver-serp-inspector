/* Small native ZIP reader for local archives; no network and no remote library. */
const decode=new TextDecoder('utf-8',{fatal:false});
const u16=(v,o)=>v.getUint16(o,true),u32=(v,o)=>v.getUint32(o,true);
const SIG_EOCD=0x06054b50,SIG_CENTRAL=0x02014b50,SIG_LOCAL=0x04034b50;
export async function readZip(file,{maxEntries=500,maxEntryBytes=40*1024*1024,maxTotalBytes=250*1024*1024}={}){
 const raw=new Uint8Array(await file.arrayBuffer());const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
 const limit=Math.max(0,raw.length-65557);let e=-1;
 for(let i=raw.length-22;i>=limit;i--){if(u32(v,i)===SIG_EOCD){e=i;break;}}
 if(e<0)throw Error('ZIP 중앙 디렉터리를 찾지 못했습니다.');
 const count=u16(v,e+10),start=u32(v,e+16);
 if(count>maxEntries)throw Error(`ZIP 파일 개수가 너무 많습니다 (최대 ${maxEntries}개).`);
 let cursor=start,total=0;const result=[],images=[],errors=[];
 for(let i=0;i<count;i++){
  if(cursor+46>raw.length||u32(v,cursor)!==SIG_CENTRAL)throw Error('ZIP 구조가 손상되었습니다.');
  const flags=u16(v,cursor+8),method=u16(v,cursor+10),comp=u32(v,cursor+20),uncomp=u32(v,cursor+24);
  const nameLen=u16(v,cursor+28),extra=u16(v,cursor+30),comment=u16(v,cursor+32),offset=u32(v,cursor+42);
  const name=decode.decode(raw.subarray(cursor+46,cursor+46+nameLen));cursor+=46+nameLen+extra+comment;
  if(!/\.(?:html?|png)$/i.test(name) || name.includes('__MACOSX/') || uncomp===0 || /_target_subtrees\.html?$/i.test(name))continue;
  if(name.includes('..')||name.startsWith('/')||name.includes('\\')){errors.push(`${name}: 안전하지 않은 경로`);continue;}
  if(uncomp>maxEntryBytes||total+uncomp>maxTotalBytes){errors.push(`${name}: 용량 제한 초과`);continue;}
  if(flags&1){errors.push(`${name}: 암호화 ZIP 미지원`);continue;}
  if(![0,8].includes(method)){errors.push(`${name}: 미지원 압축 방식 ${method}`);continue;}
  if(offset+30>raw.length||u32(v,offset)!==SIG_LOCAL){errors.push(`${name}: 헤더 오류`);continue;}
  const lo=offset+30+u16(v,offset+26)+u16(v,offset+28);
  if(lo+comp>raw.length){errors.push(`${name}: 압축 데이터 범위 오류`);continue;}
  let data=raw.slice(lo,lo+comp);
  if(method===8){
   if(typeof DecompressionStream!=='function') {errors.push(`${name}: 브라우저 ZIP 압축 해제 미지원`);continue;}
   try {const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));data=new Uint8Array(await new Response(stream).arrayBuffer());}
   catch(err){errors.push(`${name}: 압축 해제 실패 (${err.message})`);continue;}
  }
  if(data.length!==uncomp){errors.push(`${name}: 해제 길이 불일치`);continue;}
  total+=data.length;const item={name:name.split('/').pop(),bytes:data};if(/\.png$/i.test(name))images.push(item);else result.push(item);
 }
 return {files:result,images,errors};
}
