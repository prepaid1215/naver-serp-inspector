/* Windows-only controls; this module does nothing on public GitHub Pages. */
const desktopEl = id => document.getElementById(id);
export function initDesktopCollector({ingestHTML,analyze}) {
  const panel=desktopEl('desktop-collector');
  if (!panel) return;
  let api=null,importedRun='';
  let isImporting=false;
  const msg=desktopEl('collect-status');
  const start=desktopEl('collect-start');
  const stop=desktopEl('collect-stop');
  const folder=desktopEl('collect-open-folder');
  const count=desktopEl('collect-count');
  const setMessage=value=>{msg.textContent=value;};
  const decodeBase64=text=>{
    const binary=atob(text),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return bytes;
  };
  async function importResults(status) {
    if(!status.files?.length||status.run_id===importedRun||isImporting)return;
    // Once per run. Incomplete (blocked/cancelled) runs may have valid saved HTML.
    isImporting=true;importedRun=status.run_id;
    try {
      for (let i=0;i<status.files.length;i++) {
        const file=await api.read_collected_html(status.files[i]);
        ingestHTML({name:file.name,bytes:decodeBase64(file.base64)},i===0);
        setMessage(`${status.message} · ${i+1}/${status.files.length} HTML 불러오는 중`);
        // Give the browser an opportunity to render the status without blocking.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      analyze();
      setMessage(`${status.message} · HTML ${status.files.length}개 분석 실행. PNG는 저장 폴더에서 확인하세요.`);
    } catch(error) {
      setMessage(`자동 불러오기 실패: ${error.message}. 저장 폴더의 HTML을 직접 선택할 수 있습니다.`);
    } finally {isImporting=false;}
  }
  async function poll() {
    if(!api)return;
    try {
      const state=await api.collect_status();
      count.textContent=`${state.completed}/${state.total}`;
      if(!isImporting)setMessage(state.message);
      const running=state.state==='running';
      start.disabled=running||isImporting;stop.disabled=!running;
      folder.disabled=!state.folder;
      if(!running&&['completed','cancelled','blocked','error'].includes(state.state)) {
        await importResults(state);
      }
    } catch(error) {setMessage(`Windows 수집기 연결 오류: ${error.message}`);}
  }
  start.addEventListener('click',async()=>{
    if(!api)return;
    const keywords=desktopEl('collect-keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const devices=[];
    if(desktopEl('collect-pc').checked)devices.push('pc');
    if(desktopEl('collect-mo').checked)devices.push('mo');
    start.disabled=true;
    try {
      const response=await api.start_collect(keywords,devices);
      if(!response.ok){setMessage(response.error);start.disabled=false;return;}
      importedRun='';
      setMessage('Microsoft Edge에서 네이버 검색을 시작합니다. 제한 화면이 나타나면 중단됩니다.');
      await poll();
    } catch(error){setMessage(`실행 실패: ${error.message}`);start.disabled=false;}
  });
  stop.addEventListener('click',async()=>{if(api){await api.stop_collect();setMessage('중지 요청됨 · 현재 화면 작업을 마치면 종료합니다.');}});
  folder.addEventListener('click',async()=>{if(api)await api.open_run_folder();});
  const initialize=()=>{
    if(api||!window.pywebview?.api)return;
    api=window.pywebview.api;
    panel.hidden=false;
    void poll();
    setInterval(()=>void poll(),1400);
  };
  window.addEventListener('pywebviewready',initialize,{once:true});
  initialize();
}
