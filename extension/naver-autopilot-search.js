/*
 * Read-only DOM extraction executed inside a user browser tab opened for a
 * validated Naver query. Does not click, scroll, or request other resources.
 * Use outer search-result anchors only, without navigation overlays where possible.
 */
export function collectNaverSearchDOM(){
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const root=document.querySelector('#main_pack')||
    document.querySelector('#main_pack_m')||
    document.querySelector('#content')||document.querySelector('main')||document.body;
  const rows=[],seen=new Set();
  const anchors=[...root.querySelectorAll('a[href]')].slice(0,3000);
  const titleTerms=/total_tit|link_tit|title_link|tit_main|title|headline|sds-comps-text-type-headline|lnk_head/i;
  for(const anchor of anchors){
    if(rows.length>=100)break;
    let url;try{url=new URL(anchor.href,location.href);}catch{continue;}
    if(url.protocol!=='https:')continue;
    const host=url.hostname.toLowerCase();
    const type=['blog.naver.com','m.blog.naver.com'].includes(host)?'BLOG':
      ['cafe.naver.com','m.cafe.naver.com'].includes(host)?'CAFE':null;
    if(!type)continue;
    const title=clean(anchor.innerText||anchor.textContent).slice(0,260);
    if(title.length<5)continue;
    const attr=(anchor.className?.baseVal||anchor.className||'')+' '+(anchor.parentElement?.className||'');
    // Prefer headings, but allow title-free anchors to avoid missing Naver's new DOM variants.
    const strongTitle=titleTerms.test(String(attr))||
      Boolean(anchor.querySelector('strong,h3,h4,[class*="title"],[class*="headline"]'));
    const style=getComputedStyle(anchor);
    if(style.display==='none'||style.visibility==='hidden')continue;
    const rect=anchor.getBoundingClientRect();
    if(rect.width<10||rect.height<8)continue;
    if(anchor.closest('header,nav,footer,[role="navigation"]'))continue;
    const key=url.href.split('#')[0];
    if(seen.has(key))continue;
    seen.add(key);
    rows.push({url:key,title,type,headline_hint:strongTitle,
      y:Math.round(rect.top+scrollY),x:Math.round(rect.left+scrollX),
      dom_index:anchors.indexOf(anchor)+1});
  }
  rows.sort((a,b)=>Number(b.headline_hint)-Number(a.headline_hint)||a.y-b.y||a.dom_index-b.dom_index);
  return {
    source_url:location.href,query:new URL(location.href).searchParams.get('query')||'',
    page_title:document.title,document_ready:document.readyState,
    rows,observed_at:new Date().toISOString(),capture_scope:'rendered_dom_anchor_candidates',
    warning:'DOM 링크 후보 목록이며 실제 시각적 순위나 네이버 공식 검색순위가 아닙니다.'
  };
}
