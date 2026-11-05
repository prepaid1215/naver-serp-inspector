/**
 * Executed only within browser tabs the user explicitly authorized opening.
 * Inspects currently rendered article DOM, including blog's iframe when allowed.
 * No network fetch, no hidden private-page access, no page mutation.
 */
export function inspectNaverArticle() {
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const meta=(name)=>document.querySelector(
    'meta[property="'+name+'"],meta[name="'+name+'"]'
  )?.getAttribute('content')||'';
  const selectors=[
    '.se-main-container','#postViewArea','.se_component_wrap',
    '[itemprop="articleBody"]','#tbody','.article_viewer',
    '.article_content','.content_view','article','main'
  ];
  let root=null;
  for(const selector of selectors){
    const options=[...document.querySelectorAll(selector)];
    const best=options.sort((a,b)=>clean(b.innerText||b.textContent).length-clean(a.innerText||a.textContent).length)[0];
    if(best&&clean(best.innerText||best.textContent).length>=120){root=best;break;}
  }
  const fallback=!root;
  root=root||document.body;
  const bodyText=clean(root?.innerText||root?.textContent);
  const bodyHost=location.hostname.toLowerCase();
  const containsLogin=/로그인이 필요합니다|비공개 게시글|접근 권한이 없습니다|삭제된 게시글|차단된 콘텐츠/i.test(bodyText.slice(0,600));
  const hostAllowed=['blog.naver.com','m.blog.naver.com','cafe.naver.com','m.cafe.naver.com'].includes(bodyHost);
  const headings=[...root.querySelectorAll('h1,h2,h3,.se-title-text,.se-documentTitle,.tit_area')]
    .map(n=>clean(n.innerText||n.textContent)).filter(Boolean).slice(0,50);
  let publishedAt=meta('article:published_time')||meta('datePublished')||
    document.querySelector('time[datetime]')?.getAttribute('datetime')||'';
  if(publishedAt&&!Number.isFinite(Date.parse(publishedAt)))publishedAt='';
  const title=clean(meta('og:title')||headings[0]||document.title).slice(0,300);
  const valid=hostAllowed&&!containsLogin&&bodyText.length>=120;
  const confidence=valid?(fallback?'low':'medium'):'unavailable';
  return {
    source_url:location.href,
    article_url:location.href,
    title,
    text:valid?bodyText.slice(0,15000):'',
    headings:valid?headings:[],
    images:valid?root.querySelectorAll('img').length:0,
    published_at:valid?publishedAt:'',
    content_confidence:confidence,
    frame_hostname:bodyHost,
    content_chars:valid?bodyText.length:0,
    truncated:valid&&bodyText.length>15000,
    fetch_status:valid?(fallback?'partial':'ok'):'unavailable',
    error:!hostAllowed?'외부 프레임은 제외됨':containsLogin?'비공개·로그인·접근 제한 콘텐츠':
      bodyText.length<120?'본문 추출량 부족':'',
    scored_length:valid?bodyText.length+(fallback?0:10000):0
  };
}
