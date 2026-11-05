/*
 * Read the CURRENT user-opened page/frame. This function is serializable for
 * chrome.scripting.executeScript({allFrames:true,func:extractOpenArticle}).
 * No requests, iframe traversal, remote scripts, or private browser APIs.
 */
export function extractOpenArticle() {
  const normalize = v=>String(v||'').replace(/[\t\u00a0 ]+/g,' ').trim();
  const plain = v=>normalize(v).replace(/\n{4,}/g,'\n\n\n');
  const oneLine = v=>plain(v).replace(/\s+/g,' ').trim();
  const meta = key=>document.querySelector(
    'meta[property="'+key+'"],meta[name="'+key+'"]'
  )?.getAttribute('content')||'';
  const blog=/^(?:m\.)?blog\.naver\.com$/i.test(location.hostname);
  const cafe=/^(?:m\.)?cafe\.naver\.com$/i.test(location.hostname);
  const selectors = [
    '.se-main-container','#postViewArea','#post-view',
    '.se_component_wrap','.post-view','.post_ct','.ArticleContentBox',
    '.article_viewer','.article_view','.articleBody',
    '[itemprop="articleBody"]','.entry-content','article','main'
  ];
  const candidates=[];
  for(const [index,selector] of selectors.entries()) {
    for(const node of [...document.querySelectorAll(selector)].slice(0,12)) {
      const body=plain(node.innerText||node.textContent||'');
      if(body.length<90)continue;
      const style=getComputedStyle(node);
      if(style.display==='none'||style.visibility==='hidden')continue;
      const preferred = index<=2 ? 40000:index<=7?26000:index<=10?12000:4000;
      const textSize = Math.min(body.length,35000);
      const score = preferred + textSize - (node.querySelectorAll('nav,footer,aside').length*500);
      candidates.push({node,selector,score,body});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const selected=candidates[0];
  const root=selected?.node||document.querySelector('main')||document.body;
  if(!root)return null;
  const rawText=plain(selected?.body||root.innerText||root.textContent||'');
  if(rawText.length<90)return null;
  // Reject frames that contain only site navigation, even if they are long.
  if((blog||cafe)&&!selected) return null;
  const textLimit=90000;
  const titleSelectors=[
    '.se-title-text','.se_documentTitle','.se-documentTitle',
    '.pcol1 .htitle','.ArticleTitle .title_text','.ArticleTitle',
    '.article_header .title','h1[itemprop="headline"]','h1'
  ];
  let articleTitle='';
  for(const selector of titleSelectors){
    const title=document.querySelector(selector);
    const t=oneLine(title?.innerText||title?.textContent||'');
    if(t.length>=3){articleTitle=t;break;}
  }
  const title=oneLine(articleTitle||meta('og:title')||document.title).slice(0,300);
  const headings=[...root.querySelectorAll(
    'h1,h2,h3,h4,.se-text-paragraph.se-text-paragraph-align-center,.se-title-text'
  )].slice(0,80).map(h=>({
    level:/^H[1-4]$/.test(h.tagName)?h.tagName:'TITLE',
    text:oneLine(h.innerText||h.textContent).slice(0,180)
  })).filter(h=>h.text.length>2);
  const images=[...root.querySelectorAll('img')].filter(img=>{
    const st=getComputedStyle(img);
    return st.display!=='none'&&st.visibility!=='hidden';
  });
  const imageAlts=images.map(img=>oneLine(img.alt).slice(0,100)).filter(Boolean).slice(0,30);
  let internal=0,external=0;
  for(const a of [...root.querySelectorAll('a[href]')].slice(0,500)){
    try{
      const url=new URL(a.getAttribute('href'),location.href);
      if(!/^https?:$/.test(url.protocol))continue;
      if(url.hostname===location.hostname) internal++; else external++;
    }catch{}
  }
  let published = meta('article:published_time')||meta('datePublished')||
    meta('pubdate')||document.querySelector('time[datetime]')?.getAttribute('datetime')||'';
  if(!published){
    for(const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,10)){
      try{
        const data=JSON.parse(script.textContent||'null');
        const top=Array.isArray(data)?data:[data];
        const all=top.flatMap(x=>x?.['@graph']||[x]);
        const d=all.find(x=>x?.datePublished)?.datePublished;
        if(d){published=String(d);break;}
      }catch{}
    }
  }
  if(published&&!Number.isFinite(Date.parse(published)))published='';
  let canonical = document.querySelector('link[rel="canonical"]')?.href||'';
  if(blog){
    const u=new URL(location.href);
    let id=u.searchParams.get('blogId'),number=u.searchParams.get('logNo');
    const m=u.pathname.match(/^\/([^/]+)\/(\d{8,})/);
    if(m){id=m[1];number=m[2];}
    if(id&&number&&/^[\w-]{2,80}$/.test(id)&&/^\d{8,20}$/.test(number))
      canonical='https://blog.naver.com/'+encodeURIComponent(id)+'/'+number;
  }
  const source=location.href;
  const record={
    url:canonical||source,
    source_frame:source,
    title,description:oneLine(meta('description')||meta('og:description')).slice(0,500),
    robots:oneLine(meta('robots')).slice(0,120),
    canonical,published_at:published,
    text:rawText.slice(0,textLimit),truncated:rawText.length>textLimit,
    text_length:rawText.length,
    headings,images:images.length,image_alt_samples:imageAlts,
    internal_links:internal,external_links:external,
    extraction_selector:selected?.selector||'body-fallback',
    extraction_quality:selected?'article':'fallback',
    source_kind:blog?'NAVER_BLOG':cafe?'NAVER_CAFE':'WEB',
    score:(selected?.score||0)+(articleTitle?2500:0)
  };
  return record;
}
