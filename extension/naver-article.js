/*
 * Extract rendered article text from the CURRENT user-authorized page/frame.
 * Serializable for chrome.scripting.executeScript({allFrames:true,func:extractOpenArticle}).
 * Raw text is preserved, with a separately cleaned analysis view. Neither is
 * proof that every paragraph/media element in the original post was captured.
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
  const selectors=[
    '.se-main-container','#postViewArea','#post-view',
    '.se_component_wrap','.se3_view','.se_doc_viewer',
    '.post-view','.post_ct','.ArticleContentBox',
    '.article_viewer','.article_view','.articleBody',
    '[itemprop="articleBody"]','.entry-content','article','main'
  ];
  const candidates=[];
  for(const [index,selector] of selectors.entries()){
    for(const node of [...document.querySelectorAll(selector)].slice(0,12)){
      const body=plain(node.innerText||node.textContent||'');
      if(body.length<90)continue;
      const style=getComputedStyle(node);
      if(style.display==='none'||style.visibility==='hidden')continue;
      const priority=index<=2?40000:index<=8?26000:index<=12?12000:4000;
      const score=priority+Math.min(body.length,35000)-
        node.querySelectorAll('nav,footer,aside').length*500;
      candidates.push({node,selector,score,body});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const selected=candidates[0];
  const root=selected?.node||document.querySelector('main')||document.body;
  if(!root)return null;
  const fullText=plain(selected?.body||root.innerText||root.textContent||'');
  if(fullText.length<90)return null;
  if((blog||cafe)&&!selected)return null;
  // Preserve exactly what we observed from the rendered root (within cap).
  const textLimit=60000;
  const rawText=fullText.slice(0,textLimit);
  // Analysis-only view: do not silently remove link cards or author text.
  // "AI 활용" is a Naver-generated disclosure marker, not post prose.
  const cleaned=plain(rawText
    .replace(/[\u200b\u200c\u200d\ufeff]/g,'')
    .split(/\n/)
    .map(line=>line.trim())
    .filter(line=>line!=='AI 활용')
    .join('\n')
    .replace(/\n{3,}/g,'\n\n'));
  const titleSelectors=[
    '.se-title-text','.se_documentTitle','.se-documentTitle',
    '.pcol1 .htitle','.ArticleTitle .title_text','.ArticleTitle',
    '.article_header .title','h1[itemprop="headline"]','h1'
  ];
  let articleTitle='';
  for(const selector of titleSelectors){
    const t=document.querySelector(selector);
    const value=oneLine(t?.innerText||t?.textContent||'');
    if(value.length>=3){articleTitle=value;break;}
  }
  const title=oneLine(articleTitle||meta('og:title')||document.title).slice(0,300);
  // The actual 396요금제 article has numbered section labels in SE text
  // paragraphs. Aligned text in table cells is NOT a section heading.
  const headingNodes=[...root.querySelectorAll(
    'h1,h2,h3,h4,.se-section-title,.se-title-text,.se-text-paragraph'
  )].slice(0,1500);
  const headings=[],headingSeen=new Set();
  const numericSection=/^\d{1,2}[.)]\s+\S.{0,120}$/;
  for(const node of headingNodes){
    if(node.closest('table,.se-table,.se-table-container,.se-table-content,'+
      '.se-module-oglink,.se-module-image,.se-module-caption'))continue;
    const value=oneLine(node.innerText||node.textContent||'');
    if(value.length<3||value.length>160)continue;
    const tag=node.tagName.toUpperCase();
    const semantic=/^H[1-4]$/.test(tag)||node.matches('.se-section-title,.se-title-text');
    const numbered=!semantic&&node.matches('.se-text-paragraph')&&numericSection.test(value);
    if(!semantic&&!numbered)continue;
    if(headingSeen.has(value))continue;
    headingSeen.add(value);
    headings.push({
      level:/^H[1-4]$/.test(tag)?tag:'SECTION',
      text:value.slice(0,180),
      basis:semantic?'DOM_HEADING':'NUMBERED_TEXT_CANDIDATE'
    });
    if(headings.length>=90)break;
  }
  // Some editor layouts split a numbered section across inner text nodes.
  // Use the observed text as a fallback if no DOM section labels were found.
  if(!headings.some(h=>h.basis==='NUMBERED_TEXT_CANDIDATE')){
    for(const line of rawText.split(/\n/)){
      const text=oneLine(line);
      if(!numericSection.test(text)||headingSeen.has(text))continue;
      headingSeen.add(text);
      headings.push({level:'SECTION',text,basis:'NUMBERED_TEXT_CANDIDATE'});
      if(headings.length>=90)break;
    }
  }
  const imageNodes=[...root.querySelectorAll('img')].filter(img=>{
    const st=getComputedStyle(img);
    return st.display!=='none'&&st.visibility!=='hidden';
  });
  const imageAlts=imageNodes.map(img=>oneLine(img.alt).slice(0,100))
    .filter(Boolean).slice(0,30);
  const captions=[...root.querySelectorAll(
    '.se-module-caption,.se-caption,.se-image-caption,figcaption'
  )].map(el=>oneLine(el.innerText||el.textContent).slice(0,250))
    .filter(Boolean).slice(0,40);
  let internal=0,external=0;
  for(const a of [...root.querySelectorAll('a[href]')].slice(0,500)){
    try{
      const url=new URL(a.getAttribute('href'),location.href);
      if(!/^https?:$/.test(url.protocol))continue;
      if(url.hostname===location.hostname)internal++;else external++;
    }catch{}
  }
  let published=meta('article:published_time')||meta('datePublished')||
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
  let canonical=document.querySelector('link[rel="canonical"]')?.href||'';
  if(blog){
    const u=new URL(location.href);
    let id=u.searchParams.get('blogId'),number=u.searchParams.get('logNo');
    const m=u.pathname.match(/^\/([^/]+)\/(\d{8,})/);
    if(m){id=m[1];number=m[2];}
    if(id&&number&&/^[\w-]{2,80}$/.test(id)&&/^\d{8,20}$/.test(number))
      canonical='https://blog.naver.com/'+encodeURIComponent(id)+'/'+number;
  }
  const warnings=['원문 전체와 대조하지 않아 완전성을 검증하지 않았습니다.'];
  if(imageNodes.length)warnings.push('이미지 안의 글자는 OCR로 추출하지 않았습니다.');
  if(fullText.length>textLimit)warnings.push('본문 텍스트가 60000자를 넘어 잘렸습니다.');
  return {
    url:canonical||location.href,source_frame:location.href,
    title,description:oneLine(meta('description')||meta('og:description')).slice(0,500),
    robots:oneLine(meta('robots')).slice(0,120),
    canonical,published_at:published,
    text:rawText,clean_text:cleaned,clean_text_length:cleaned.length,
    truncated:fullText.length>textLimit,text_length:fullText.length,
    headings,images:imageNodes.length,image_alt_samples:imageAlts,
    image_captions:captions,internal_links:internal,external_links:external,
    extraction_selector:selected?.selector||'body-fallback',
    extraction_quality:selected?'article':'fallback',
    extraction_audit:{
      comparison_to_original:'not_verified',
      source:'rendered_dom',
      images_ocr:false,
      root_candidates:candidates.length,
      numbered_section_candidates:headings.filter(h=>h.basis==='NUMBERED_TEXT_CANDIDATE').length,
      warnings
    },
    source_kind:blog?'NAVER_BLOG':cafe?'NAVER_CAFE':'WEB',
    score:(selected?.score||0)+(articleTitle?2500:0)
  };
}
