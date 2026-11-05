/*
 * User-triggered viewport-only Naver SERP geometry collector.
 * Serialized by chrome.scripting.executeScript as a function, so no imports.
 * No scrolling, network, interaction, ranking claim or page modification.
 */
export function inspectVisibleSearch() {
  const norm = value => String(value||'').replace(/\s+/g,' ').trim();
  const rawQuery = new URL(location.href).searchParams.get('query')||'';
  const viewport = {
    width:innerWidth,height:innerHeight,device_pixel_ratio:devicePixelRatio,
    scroll_x:scrollX,scroll_y:scrollY,
    vv_width:visualViewport?.width||innerWidth,
    vv_height:visualViewport?.height||innerHeight,
    vv_scale:visualViewport?.scale||1
  };
  const roots=[
    '#main_pack','#main_pack_m','.api_search',
    '#content','main','.search_result','#container'
  ];
  let root=null;
  for(const selector of roots){
    const element=document.querySelector(selector);
    if(element && element.querySelectorAll('a[href]').length>2){root=element;break;}
  }
  const fallback=!root;
  root=root||document.body;
  const terms=/total_tit|link_tit|title_link|tit_main|title|headline|lnk_head|sds-comps-text-type-headline/i;
  const blockTerms=/api_subject_bx|spw_fsolid|fds-[\w-]*root|ugc|web-root|kin-root|ad_section|ad_group|ad_item|section_area|sc_new|powerlink/i;
  function marker(el){return String(el?.className?.baseVal||el?.className||'')+' '+(el?.getAttribute?.('data-template-id')||'');}
  function candidateBlock(a){
    let n=a;
    for(let level=0;n&&n!==root&&level<11;level++,n=n.parentElement){
      if(blockTerms.test(marker(n)))return n;
    }
    return a.parentElement||a;
  }
  function kindOf(url,a){
    for(let n=a,level=0;n&&level<9;level++,n=n.parentElement){
      if(/powerlink|ad_group|ad_section|ad_item|sp_ad|ads_area/i.test(marker(n)))return 'AD';
    }
    const host=url.hostname.toLowerCase().replace(/^m\./,'');
    if(host==='blog.naver.com')return 'BLOG';
    if(host==='cafe.naver.com')return 'CAFE';
    if(host==='kin.naver.com')return 'KIN';
    if(host==='n.news.naver.com'||host==='news.naver.com')return 'NEWS';
    if(host==='clip.naver.com')return 'CLIP';
    if(host==='youtube.com'||host==='youtu.be')return 'VIDEO';
    if(host.endsWith('.naver.com')||host==='naver.com')return 'UNCLASSIFIED';
    return 'WEB';
  }
  const all=[...root.querySelectorAll('a[href]')].slice(0,2500);
  const seen=new Set(),results=[];
  for(const a of all){
    const href=a.href;
    let u;
    try{u=new URL(href,location.href);}catch{continue;}
    if(!['http:','https:'].includes(u.protocol))continue;
    const text=norm(a.innerText||a.textContent).replace(/새 창 열림/g,'').slice(0,180);
    if(text.length<5)continue;
    const mark=marker(a);
    const descendant=a.querySelector('.sds-comps-text-type-headline1,[class*="headline"],[class*="title"]');
    const headline=terms.test(mark)||Boolean(descendant)||
      /^(?:\.title|\.link)$/.test(a.getAttribute('data-heatmap-target')||'');
    if(!headline)continue;
    const style=getComputedStyle(a);
    if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
    const rect=a.getBoundingClientRect();
    if(rect.width<12||rect.height<8||rect.bottom<=0||rect.top>=viewport.height||
      rect.right<=0||rect.left>=viewport.width)continue;
    const centerX=Math.max(0,Math.min(viewport.width-1,(Math.max(0,rect.left)+Math.min(viewport.width,rect.right))/2));
    const centerY=Math.max(0,Math.min(viewport.height-1,(Math.max(0,rect.top)+Math.min(viewport.height,rect.bottom))/2));
    const key=u.href.split('#')[0]+'|'+Math.round(rect.top/6);
    if(seen.has(key))continue;
    seen.add(key);
    const block=candidateBlock(a);
    const br=block.getBoundingClientRect();
    const id='item-'+(results.length+1);
    const blockName=(block.querySelector('h2,h3,[class*="title"]')?.textContent||'').replace(/\s+/g,' ').trim().slice(0,70);
    results.push({
      id,url:u.href,title:text,type_hint:kindOf(u,a),
      dom_index:all.indexOf(a)+1,headline_signal:headline,block_name:blockName,
      block_marker:marker(block).slice(0,120),
      x:Math.round(rect.left*100)/100,y:Math.round(rect.top*100)/100,
      width:Math.round(rect.width*100)/100,height:Math.round(rect.height*100)/100,
      block_y:Math.round(br.top*100)/100,
      center_x:Math.round(centerX),center_y:Math.round(centerY),
      clipped:rect.left<0||rect.top<0||rect.right>viewport.width||rect.bottom>viewport.height
    });
  }
  results.sort((a,b)=>a.y-b.y||a.x-b.x);
  return {
    source_url:location.href,query:norm(rawQuery),
    title:document.title,
    viewport,document_ready:document.readyState,
    captured_page_time:new Date().toISOString(),
    root_used:root.id?'#'+root.id:root.tagName?.toLowerCase()||'unknown',
    root_fallback:fallback,
    url_device:location.hostname==='m.search.naver.com'?'모바일':'PC',
    layout_device:viewport.width<760?'모바일 너비':'데스크톱 너비',
    candidates:results.slice(0,160),
    total_candidates:results.length,
    truncated:results.length>160,
    errors:results.length===0?['화면에서 제목 링크 후보를 찾지 못했습니다. 실제 검색 화면의 HTML 구조를 확인해야 합니다.']:[]
  };
}
