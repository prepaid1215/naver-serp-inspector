/*
 * Read-only Naver PC search observation. Search-result card heuristics may
 * change with Naver's markup, personalisation, ads and smart blocks.
 *
 * IMPORTANT: document_visual_order is the order of *detected post links*
 * by page-Y, NOT official rank, organic rank or a top-N guarantee.
 * The displayed title can be unverified when a card's title is not exposed.
 */
export function collectNaverSearchDOM(){
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const root=document.querySelector('#main_pack')||
    document.querySelector('#main_pack_m')||
    document.querySelector('#content')||document.querySelector('main')||document.body;
  const anchors=[...root.querySelectorAll('a[href]')].slice(0,3000);
  const titleTerms=/total_tit|link_tit|title_link|tit_main|headline|sds-comps-text-type-headline|lnk_head/i;
  const meaningless=/^(?:새 창 열림|링크 이동|더보기|블로그|카페|관련도순|최신순|\d+\s*(?:초|분|시간|일|주|개월|년)\s*전(?:\s*새 창 열림)?)$/;
  const good=t=>t.length>=7&&t.length<=250&&!meaningless.test(t)&&
    !/^(?:https?:\/\/|www\.)/.test(t);
  const articleURL=(u,type)=>{
    const path=u.pathname;
    if(type==='BLOG')return /^\/[\w-]{2,80}\/\d{8,20}\/?$/.test(path)||
      (/^\/PostView\.(?:naver|nhn)$/i.test(path)&&
        /^[\w-]{2,80}$/.test(u.searchParams.get('blogId')||'')&&
        /^\d{8,20}$/.test(u.searchParams.get('logNo')||''));
    return /^\/[\w-]{2,80}\/\d{1,20}\/?$/.test(path)||
      /^\/ca-fe\/cafes\/\d+\/articles\/\d+\/?$/i.test(path)||
      (/^\/ArticleRead\.(?:naver|nhn)$/i.test(path)&&
        /^\d{1,20}$/.test(u.searchParams.get('clubid')||'')&&
        /^\d{1,20}$/.test(u.searchParams.get('articleid')||''));
  };
  const titleFromCard=(anchor,rawTitle,targetURL)=>{
    // In live Naver PC DOM, the post href often belongs to an invisible
    // "새 창 열림" link; a nearby heading may be the BLOG/CAFE name, not the
    // actual post headline. Never treat neighbouring headings as proof.
    const safeTitle=value=>good(value)&&
      !/(?:^|\\s)새 창 열림$/.test(value)&&
      !/(?:^|\\s)(?:블로그|카페)\\s*새 창 열림$/.test(value);
    const attr=String(anchor.className?.baseVal||anchor.className||'')+' '+
      String(anchor.parentElement?.className||'');
    const anchorIsHeadline=titleTerms.test(attr)||
      Boolean(anchor.querySelector('h3,h4,strong,[class*="headline"]'));
    if(safeTitle(rawTitle)&&anchorIsHeadline)
      return {visible_title:rawTitle,title_confidence:'high',title_source:'headline_anchor'};
    // A sibling title is allowed only if it explicitly links to this SAME
    // article. The shared card may contain author/cafe heading labels.
    let current=anchor.parentElement;
    for(let level=0;level<3&&current;level++,current=current.parentElement){
      if(current.querySelectorAll('a[href]').length>14)break;
      for(const other of [...current.querySelectorAll('a[href]')].slice(0,14)){
        let same=false;
        try{same=new URL(other.href,location.href).href===targetURL;}catch{}
        if(!same)continue;
        const value=clean(other.innerText||other.textContent).slice(0,260);
        const klass=String(other.className?.baseVal||other.className||'');
        if(other!==anchor&&safeTitle(value)&&
          (titleTerms.test(klass)||other.querySelector('h3,h4,strong,[class*="headline"]')))
          return {visible_title:value,title_confidence:'high',title_source:'same_url_headline'};
      }
    }
    // An unlabelled anchor may provide a headline but can also be an author.
    // Keep only the raw text as an explicitly uncertain anchor observation.
    if(safeTitle(rawTitle))
      return {visible_title:rawTitle,title_confidence:'medium',title_source:'anchor_text_unverified'};
    return {visible_title:'',title_confidence:'unverified',
      title_source:'no_reliable_article_title'};
  };
  // A block is a visible group heading plus links observed beneath it.
  // Classify only the *group label*, never an article headline or snippet.
  // Without an observed heading, UGC presence remains undetermined.
  const groupNodes=new Map();
  const blockKind=label=>{
    if(!label)return 'UNCLASSIFIED';
    if(/사용자 경험|실사용|사용 후기|이용 후기|경험담|직접 써본|리뷰|후기|경험/i.test(label))
      return 'EXPERIENCE_REVIEW_CANDIDATE';
    if(/블로그|카페|지식iN|인기글|게시글|커뮤니티|콘텐츠/i.test(label))
      return 'GENERAL_UGC_CANDIDATE';
    return 'OTHER_LABELED_BLOCK';
  };
  const groupHeading=node=>{
    const els=[...node.querySelectorAll(
      'h2,h3,[class*="api_title"],[class*="group_title"],[class*="section_title"],'+
      '[class*="sds-comps-text-type-headline"],[class*="fds-comps-text-type-headline"]'
    )].slice(0,25);
    for(const heading of els){
      if(heading.closest('a[href]'))continue;
      const klass=String(heading.className?.baseVal||heading.className||'');
      // Plain H3s are often individual post titles, not section headings.
      if(heading.tagName==='H3'&&!/group|section|api_title|headline/i.test(klass))continue;
      const style=getComputedStyle(heading);
      if(style.display==='none'||style.visibility==='hidden')continue;
      const label=clean(heading.innerText||heading.textContent).slice(0,100);
      if(label.length<2||label.length>95||meaningless.test(label))continue;
      return {heading,label};
    }
    return null;
  };
  const blockInfo=anchor=>{
    let node=anchor.parentElement;
    for(let n=0;n<11&&node&&node!==root;n++,node=node.parentElement){
      const klass=String(node.className?.baseVal||node.className||'');
      if(!/api_subject_bx|sc_new|section|sds-comps-group|fds-comps|_content_root|_search_block/i.test(klass)&&
         node.tagName!=='SECTION')continue;
      // A huge search root is not a section. Avoid attributing its heading
      // to unrelated articles further down the search results.
      if(node.querySelectorAll('a[href]').length>100)continue;
      const picked=groupHeading(node);
      if(!picked)continue;
      const headRect=picked.heading.getBoundingClientRect();
      const linkRect=anchor.getBoundingClientRect();
      if(headRect.top>linkRect.top+10)continue;
      if(!groupNodes.has(node))groupNodes.set(node,'group-'+(groupNodes.size+1));
      return {
        block_id:groupNodes.get(node),block_label:picked.label,
        block_kind:blockKind(picked.label),
        block_confidence:'heuristic_heading',
        block_heading_hint:picked.label,
        block_heading_confidence:'heuristic'
      };
    }
    return {
      block_id:'unclassified',block_label:'',block_kind:'UNCLASSIFIED',
      block_confidence:'unverified',
      block_heading_hint:'',block_heading_confidence:'unverified'
    };
  };
  const cardSnippet=(anchor,title)=>{
    let node=anchor.parentElement,best='';
    for(let n=0;n<5&&node&&node!==root;n++,node=node.parentElement){
      if(node.querySelectorAll('a[href]').length>7)break;
      const sample=clean(node.innerText||node.textContent);
      if(sample.length>Math.max(30,title.length+12)&&sample.length<=850)
        best=sample;
    }
    if(!best)return '';
    // The source is visible card text, not the fetched article body.
    const rest=best.replace(title,'').replace(/새 창 열림/g,'').trim();
    return rest.slice(0,220);
  };
  const rows=[],seen=new Set();
  for(const [index,anchor] of anchors.entries()){
    let u;try{u=new URL(anchor.href,location.href);}catch{continue;}
    if(u.protocol!=='https:')continue;
    const host=u.hostname.toLowerCase();
    const type=['blog.naver.com','m.blog.naver.com'].includes(host)?'BLOG':
      ['cafe.naver.com','m.cafe.naver.com'].includes(host)?'CAFE':null;
    if(!type)continue;
    if(anchor.closest('header,nav,footer,[role="navigation"]'))continue;
    const style=getComputedStyle(anchor);
    if(style.display==='none'||style.visibility==='hidden')continue;
    const rect=anchor.getBoundingClientRect();
    if(rect.width<10||rect.height<8)continue;
    const rawTitle=clean(anchor.innerText||anchor.textContent).slice(0,260);
    if(rawTitle.length<2)continue;
    u.hash='';
    const key=u.href;
    if(seen.has(key))continue;
    seen.add(key);
    const isArticle=articleURL(u,type);
    const titleInfo=isArticle?titleFromCard(anchor,rawTitle,key):
      {visible_title:rawTitle,title_confidence:'unverified',title_source:'profile_or_context_link'};
    const block=isArticle?blockInfo(anchor):
      {block_id:'unclassified',block_label:'',block_kind:'UNCLASSIFIED',
        block_confidence:'unverified',block_heading_hint:'',
        block_heading_confidence:'unverified'};
    const snippet=isArticle?cardSnippet(anchor,rawTitle):'';
    rows.push({url:key,title:titleInfo.visible_title||'',
      anchor_text:rawTitle,type,is_article_link:isArticle,
      ...titleInfo,...block,
      snippet_text:snippet,snippet_basis:snippet?'visible_card_text':'not_observed',
      headline_hint:titleInfo.title_confidence==='high',
      y:Math.round(rect.top+scrollY),x:Math.round(rect.left+scrollX),
      dom_index:index+1});
  }
  // This ordering approximates top-to-bottom physical page layout only.
  rows.sort((a,b)=>a.y-b.y||a.x-b.x||a.dom_index-b.dom_index);
  const counts={BLOG:0,CAFE:0},articleSeen=new Set();
  for(const row of rows){
    if(!row.is_article_link)continue;
    // Drop referral and navigation tokens for candidate deduplication.
    let u;try{u=new URL(row.url);}catch{continue;}
    const id=u.hostname+u.pathname.replace(/\/$/,'')+
      (/\/(?:PostView|ArticleRead)\./i.test(u.pathname)?
        '?'+['blogId','logNo','clubid','articleid'].map(k=>u.searchParams.get(k)||'').join(':'):'');
    if(articleSeen.has(id))continue;
    articleSeen.add(id);
    counts[row.type]++;
    row.document_visual_order=articleSeen.size;
    row.source_visual_order=counts[row.type];
  }
  const chosen=rows.slice(0,100),groups=new Map();
  for(const row of chosen){
    if(!row.is_article_link)continue;
    const id=row.block_id||'unclassified';
    if(!groups.has(id))groups.set(id,{
      id,label:row.block_label,kind:row.block_kind,
      confidence:row.block_confidence,article_links:0,
      source_types:[],sample_links:[]
    });
    const group=groups.get(id);
    group.article_links++;
    if(!group.source_types.includes(row.type))group.source_types.push(row.type);
    if(group.sample_links.length<5)group.sample_links.push({
      url:row.url,title:row.title||'',snippet:row.snippet_text||''
    });
  }
  const blocks=[...groups.values()].slice(0,30);
  const candidateBlocks=blocks.filter(b=>b.kind==='EXPERIENCE_REVIEW_CANDIDATE');
  const ugcObservation={
    state:candidateBlocks.length?'candidate_observed':'not_determined',
    candidate_block_count:candidateBlocks.length,
    observed_block_count:blocks.length,
    note:'섹션 제목에 후기/경험 관련 표현이 직접 표시된 후보만 기록합니다. 후보가 없더라도 네이버 UGC 블록 부재를 뜻하지 않습니다.'
  };
  return {
    source_url:location.href,query:new URL(location.href).searchParams.get('query')||'',
    page_title:document.title,document_ready:document.readyState,
    viewport:{width:innerWidth,height:innerHeight,scroll_y:scrollY},
    blocks,ugc_observation:ugcObservation,
    rows:chosen,observed_at:new Date().toISOString(),
    capture_scope:'rendered_dom_visible_article_link_candidates',
    position_basis:'approximate_document_y_order_of_detected_links',
    warning:'관측된 링크의 화면 세로 위치 순서 후보입니다. 광고/스마트블록/개인화/누락 가능성 때문에 공식 순위나 유기적 순위로 간주할 수 없습니다.'
  };
}
