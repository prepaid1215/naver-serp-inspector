import {initDesktopCollector} from './desktop-ui.js';
import {parseSERP,summarize,sha256,RESULT_FIELDS,SUMMARY_FIELDS,BLOCK_FIELDS,groupBlocks,toCSV,safeDomain} from './engine.js';
import {readZip} from './zip.js';
const $=id=>document.getElementById(id);
const els={drop:$('drop'),input:$('files'),list:$('file-list'),button:$('analyze'),status:$('status'),domains:$('domains'),query:$('query-fallback'),device:$('device-fallback'),results:$('results'),files:$('selected-file'),filter:$('type-filter'),rows:$('rows'),dist:$('distribution'),summary:$('file-summary'),screenshot:$('screenshot-wrap'),screenshotMessage:$('screenshot-message'),reviewed:$('reviewed'),reviewedMessage:$('reviewed-message')};
const items=[];let analyzed=[];const screenshots=new Map(),reviewed=new Set();let screenURL=null;
const MAX_FILE=50*1024*1024, MAX_ZIP_FILE=160*1024*1024, MAX_FILES=120;
function setStatus(s){els.status.textContent=s;}
function prettySize(bytes){return bytes>1024*1024?(bytes/1024/1024).toFixed(1)+' MB':Math.round(bytes/1024)+' KB';}
function paintFiles(){els.list.replaceChildren();if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='아직 불러온 파일이 없습니다.';els.list.append(p);}
else for(const item of items){const div=document.createElement('div');div.className='file-record';const name=document.createElement('span');name.title=item.name;name.textContent=item.name;const size=document.createElement('b');size.textContent=prettySize(item.bytes.length);div.append(name,size);els.list.append(div);}
els.button.disabled=items.length===0;}
async function loadFiles(fileList){let errors=[],added=0;
 for(const file of Array.from(fileList).slice(0,MAX_FILES)){
  const lower=file.name.toLowerCase();
  if(file.size>(lower.endsWith('.zip')?MAX_ZIP_FILE:MAX_FILE)){errors.push(`${file.name}: 용량 제한 초과`);continue;}
  if(lower.endsWith('.png')){screenshots.set(file.name.replace(/\.png$/i,'').toLowerCase(),file);continue;}
  if(lower.endsWith('.zip')){
   try{const parsed=await readZip(file);for(const x of parsed.files){if(items.length>=MAX_FILES)break;items.push(x);added++;}for(const x of parsed.images){screenshots.set(x.name.replace(/\.png$/i,'').toLowerCase(),new Blob([x.bytes],{type:'image/png'}));}errors.push(...parsed.errors);}catch(err){errors.push(`${file.name}: ${err.message}`);}continue;
  }
  if(!/\.html?$/i.test(lower)){errors.push(`${file.name}: 지원하지 않는 확장자`);continue;}
  if(items.length>=MAX_FILES){errors.push('파일 개수 제한을 초과했습니다.');break;}
  items.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});added++;
 }
 paintFiles();setStatus(`${added}개 HTML 추가, 캡처 ${screenshots.size}개 · ${errors.length}개 경고${errors.length?' — '+errors.slice(0,2).join('; '):''}`);
}
function triggerChooser(){els.input.click();}
els.drop.addEventListener('click',e=>{if(e.target.closest('button'))return;triggerChooser();});
els.drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();triggerChooser();}});
$('choose-files').addEventListener('click',e=>{e.stopPropagation();triggerChooser();});
els.input.addEventListener('change',async e=>{await loadFiles(e.target.files);e.target.value='';});
for(const name of ['dragenter','dragover'])els.drop.addEventListener(name,e=>{e.preventDefault();els.drop.classList.add('active');});
for(const name of ['dragleave','drop'])els.drop.addEventListener(name,e=>{e.preventDefault();els.drop.classList.remove('active');});
els.drop.addEventListener('drop',async e=>{if(e.dataTransfer?.files)await loadFiles(e.dataTransfer.files);});
function domains(){return els.domains.value.split(/[\s,;]+/).map(safeDomain).filter(Boolean);}
function setText(id,v){$(id).textContent=String(v);}
const typeColors={WEB:'#285bd7',BLOG:'#1aa779',CAFE:'#7e64ce',KIN:'#eda54b',NEWS:'#3b91a7',AD:'#b8c2d1',OTHER:'#8592a9',UNCLASSIFIED:'#d66472',CLIP:'#dd7f86',VIDEO:'#c95581'};
function renderSelect(){els.files.replaceChildren();analyzed.forEach((x,i)=>{const opt=document.createElement('option');opt.value=String(i);opt.textContent=`${x.meta.query} · ${x.meta.device} (${x.meta.evidence_file})`;els.files.append(opt);});}
function cell(tag,text,klass){const el=document.createElement(tag);if(klass)el.className=klass;el.textContent=String(text);return el;}
function renderTable(result){els.rows.replaceChildren();const f=els.filter.value;const visible=result.rows.filter(r=>f==='ALL'||r.block_type===f);if(!visible.length){const row=document.createElement('tr');const c=cell('td','해당 유형의 결과가 없습니다.');c.colSpan=5;row.append(c);els.rows.append(row);return;}
 for(const rec of visible){const tr=document.createElement('tr');tr.append(cell('td',rec.organic_rank||'광고'),cell('td',`${rec.block_order} / ${rec.rank_in_block}`));const ty=document.createElement('td');const chip=cell('span',rec.block_type,'chip');chip.style.background=typeColors[rec.block_type]+'18';chip.style.color=typeColors[rec.block_type]||'#5470aa';ty.append(chip);tr.append(ty);
 const url=cell('td','', 'url-cell');const host=cell('strong',rec.result_title||rec.domain);const domainEl=cell('small',rec.domain);const a=document.createElement('a');a.href=rec.result_url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=rec.result_url.length>135?rec.result_url.slice(0,135)+'…':rec.result_url;url.append(host,domainEl,a);tr.append(url);const target=document.createElement('td');target.append(cell('span',rec.is_target==='Y'?'발견':'—',rec.is_target==='Y'?'chip hit':'chip'));tr.append(target);els.rows.append(tr);}
}
function renderDistribution(result){els.dist.replaceChildren();const top=result.rows.filter(r=>r.block_type!=='AD').slice(0,10);const count={};for(const r of top)count[r.block_type]=(count[r.block_type]||0)+1;
 if(top.length){for(const [key,n] of Object.entries(count)){const b=document.createElement('div');b.style.width=(100*n/top.length)+'%';b.style.background=typeColors[key]||'#a8b7ce';b.title=`${key}: ${n}`;els.dist.append(b);}}
 const legend=document.createElement('div');legend.className='legend';for(const [type,n] of Object.entries(count)){const span=document.createElement('span');span.className='tag';const dot=document.createElement('i');dot.style.background=typeColors[type]||'#94a3b8';span.append(dot,document.createTextNode(`${type} ${n}`));legend.append(span);}els.dist.parentElement.querySelector('.legend')?.remove();els.dist.after(legend);
 els.summary.textContent=`${result.status} · ${result.rows.length}개 링크 추출 · 대상 도메인 ${result.rows.filter(r=>r.is_target==='Y').length}개 · SHA-256 ${result.meta.evidence_sha256.slice(0,16)}…`;
}
function renderSections(result) {
 const root=$('section-blocks'); root.replaceChildren();
 const blocks=groupBlocks(result);
 if(!blocks.length){root.append(cell('p','구분할 수 있는 블록이 없습니다. HTML을 확인하세요.'));return;}
 for(const group of blocks){
   const box=document.createElement('section');box.className='section-block';
   const heading=document.createElement('div');heading.className='section-block-heading';
   const num=cell('strong',`블록 ${group.block_order}`);
   const typ=cell('span',`${group.inferred_type==='MIXED'?'혼합 유형':group.inferred_type} · ${group.type_breakdown} · 유형 추정`,'chip');
   const count=cell('span',`${group.card_count}개 문서 · 대상 ${group.target_count}개`,'section-count');
   heading.append(num,typ,count);box.append(heading);
   const list=document.createElement('ol');list.className='section-items';
   for(const row of group.items){
     const li=document.createElement('li');
     const rank=cell('b',`${row.rank_in_block}번째`,'section-rank');
     const body=document.createElement('div');const title=cell('strong',row.result_title||row.domain);
     const d=cell('span',`${row.block_type} · ${row.domain}`+(row.is_target==='Y'?' · 대상 발견':''),'section-domain');
     body.append(title,d);li.append(rank,body);list.append(li);
   }
   box.append(list);root.append(box);
 }
}
function renderScreenshot(result){if(screenURL){URL.revokeObjectURL(screenURL);screenURL=null;}
 els.screenshot.replaceChildren();const base=result.meta.evidence_file.replace(/\.html?$/i,'').toLowerCase(),f=screenshots.get(base);
 els.reviewed.disabled=!f;
 if(!f){els.screenshot.append(cell('span','화면 캡처 없음 — HTML 순서와 실제 스크린샷을 대조하면 신뢰도를 높일 수 있습니다.'));els.screenshotMessage.textContent='일치하는 PNG를 함께 선택하면 로컬에서 표시합니다.';return;}
 screenURL=URL.createObjectURL(f);const img=document.createElement('img');img.src=screenURL;img.alt=`${result.meta.query} 원본 캡처`;els.screenshot.append(img);els.screenshotMessage.textContent=`${f.name||'ZIP 포함 PNG'} (브라우저에서만 표시)`;
}
function renderOne(){if(!analyzed.length)return;const index=Number(els.files.value||0),result=analyzed[index];if(!result)return;
 renderTable(result);renderDistribution(result);renderSections(result);renderScreenshot(result);const key=result.meta.evidence_file;els.reviewed.checked=reviewed.has(key);els.reviewedMessage.textContent=els.reviewed.checked?'사람이 화면 대조 완료':'미검증';els.reviewedMessage.style.color=els.reviewed.checked?'#14834a':'#b07830';
}
els.files.addEventListener('change',renderOne);els.filter.addEventListener('change',renderOne);els.reviewed.addEventListener('change',()=>{const result=analyzed[Number(els.files.value)];if(!result)return;els.reviewed.checked?reviewed.add(result.meta.evidence_file):reviewed.delete(result.meta.evidence_file);renderOne();setText('metric-review',analyzed.filter(x=>!reviewed.has(x.meta.evidence_file)).length);});
function csvDownload(filename,content,type='text/csv;charset=utf-8'){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2500);}
$('download-blocks').addEventListener('click',()=>csvDownload('serp_blocks.csv',toCSV(analyzed.flatMap(groupBlocks),BLOCK_FIELDS)));
$('download-rows').addEventListener('click',()=>csvDownload('serp_results.csv',toCSV(analyzed.flatMap(x=>x.rows),RESULT_FIELDS)));
$('download-summary').addEventListener('click',()=>csvDownload('serp_share.csv',toCSV(analyzed.map(summarize),SUMMARY_FIELDS)));
$('download-json').addEventListener('click',()=>csvDownload('serp_results.json',JSON.stringify({generated_at:new Date().toISOString(),analysis_version:'1.3.2-beta',warning:'오프라인 HTML 추정. 현재 순위 및 색인 상태 아님',results:analyzed,reviewed_evidence:[...reviewed]},null,2),'application/json;charset=utf-8'));
$('analyze').addEventListener('click',async()=>{
 els.button.disabled=true;setStatus('브라우저 안에서 분석하고 있습니다…');await new Promise(r=>setTimeout(r,20));
 const selected=domains(),out=[];const decoder=new TextDecoder('utf-8',{fatal:false});
 for(const item of items){try{const digest=await sha256(item.bytes);const html=decoder.decode(item.bytes);
 const result=parseSERP(html,{filename:item.name,query:els.query.value.trim(),device:els.device.value==='미확인'?'':els.device.value,domains:selected,sha256:digest});out.push(result);
 }catch(err){out.push({meta:{query:item.name,device:'미확인',observed_at_kst:'미확인',evidence_file:item.name,evidence_sha256:''},rows:[],status:'수집 실패',notes:err.message});}}
 analyzed=out;renderSelect();els.results.classList.remove('hidden');setText('metric-files',out.length);setText('metric-results',out.reduce((n,x)=>n+x.rows.length,0));setText('metric-target',out.reduce((n,x)=>n+x.rows.filter(r=>r.is_target==='Y').length,0));setText('metric-review',out.filter(x=>!reviewed.has(x.meta.evidence_file)).length);renderOne();setStatus(`분석 완료: HTML ${out.length}개. 저장된 HTML의 잠정 추출 결과이며 현재 검색 순위를 뜻하지 않습니다.`);els.button.disabled=false;
});

// Windows-only workflow: after user-initiated capture, import saved HTML
// through the native bridge and run the SAME parser used by GitHub Pages.
initDesktopCollector({
 ingestHTML(item,reset){
   if(reset)items.length=0;
   if(items.length<MAX_FILES)items.push(item);
   paintFiles();
 },
 analyze(){if(!els.button.disabled)els.button.click();}
});

// Extension-only bridge. Its module is absent from GitHub Pages deployments by design.
// The extension opens the SAME web/index.html and feeds a locally captured File
// through the ordinary file-loader, without network uploads or duplicated parsers.
async function importExtensionCapture() {
  if (location.protocol!=='chrome-extension:') return;
  const id=new URLSearchParams(location.search).get('serp_lens_capture');
  if (id!=='latest') return;
  const panel=$('extension-evidence');
  panel.hidden=false;
  try {
    const {readCapture,deleteCapture}=await import('../extension/capture-store.js');
    const record=await readCapture(id);
    if(!record) throw Error('브라우저에 보관된 수집 기록이 없습니다. 네이버 검색 화면에서 다시 수집하세요.');
    if(!record.html || !record.filename || !record.pngBytes) throw Error('수집 기록이 완전하지 않습니다.');
    $('extension-capture-info').textContent=`수집: ${new Date(record.captured_at).toLocaleString('ko-KR')} · ${record.sourceURL}`;
    const htmlFile=new File([record.html],record.filename,{type:'text/html'});
    const pngFile=new File([new Uint8Array(record.pngBytes)],record.screenshot,{type:'image/png'});
    await loadFiles([htmlFile,pngFile]);
    const downloadBlob=(name,blob)=>{
      const url=URL.createObjectURL(blob);const a=document.createElement('a');
      a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),2500);
    };
    $('save-extension-html').addEventListener('click',()=>downloadBlob(record.filename,htmlFile));
    $('save-extension-png').addEventListener('click',()=>downloadBlob(record.screenshot,pngFile));
    $('erase-extension-capture').addEventListener('click',async()=>{
      try {
        await deleteCapture(id);
        $('extension-capture-info').textContent='브라우저에 저장된 원본을 삭제했습니다. 이미 열린 화면은 닫을 때까지 메모리에 남습니다.';
        for(const n of ['save-extension-html','save-extension-png','erase-extension-capture']) $(n).disabled=true;
      }catch(error){setStatus(`원본 삭제 실패: ${error.message}`);}
    });
    if(!els.button.disabled)els.button.click();
  } catch(error) {
    $('extension-capture-info').textContent=`확장 프로그램 원본을 읽지 못했습니다: ${error.message}`;
    for(const n of ['save-extension-html','save-extension-png','erase-extension-capture']) $(n).disabled=true;
  }
}
void importExtensionCapture();
