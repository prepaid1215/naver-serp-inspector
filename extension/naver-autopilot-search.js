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
  // Record observable signals independently from any hypothesis about a
  // Naver product name. Neither terms in post titles nor comments imply a
  // platform-defined UGC block.
  const firstPerson=/제가|저는|나는|직접|해봤|써봤|다녀왔|다녀온|가봤|사용했|구매했|방문했|느꼈|좋았|아쉬웠|솔직|체험|실사용|경험했/i;
  const visible=node=>{
    if(!node)return false;
    const style=getComputedStyle(node);
    return style.display!=='none'&&style.visibility!=='hidden';
  };
  const controlsFor=node=>{
    let nodes=[];
    try{
      nodes=[...node.querySelectorAll(
        'button,a,[role="button"],[role="tab"],[class*="chip"],[class*="tag"],[class*="filter"]'
      )].slice(0,100);
    }catch{}
    let more=false,comments=false,reactions=false;
    const tags=[],seen=new Set();
    for(const el of nodes){
      if(!visible(el))continue;
      const label=clean(el.innerText||el.textContent).slice(0,65);
      if(!label)continue;
      if(/^(?:더보기|전체보기|모두보기|더 보기|전체 보기|결과 더보기)$/.test(label))more=true;
      if(/^(?:댓글|답글)\s*[0-9,]*$/.test(label))comments=true;
      if(/^(?:공감|좋아요|추천)\s*[0-9,]*$/.test(label))reactions=true;
      const cls=String(el.className?.baseVal||el.className||'');
      if(/chip|tag|filter|hashtag/i.test(cls)&&label.length>=2&&label.length<=35&&
         !/새 창 열림|더보기|로그인|인용|블로그|카페/.test(label)&&!seen.has(label)){
        seen.add(label);tags.push(label.slice(0,35));
      }
    }
    return {more_control_visible:more,comment_control_visible:comments,
      reaction_control_visible:reactions,topic_tags:tags.slice(0,8)};
  };
  const blocks=[...groups.values()].slice(0,30);
  for(const block of blocks){
    const matching=chosen.filter(r=>r.is_article_link&&r.block_id===block.id);
    const excerpts=matching.filter(r=>(r.snippet_text||'').length>=35);
    const firstHand=excerpts.filter(r=>firstPerson.test(r.snippet_text));
    const linkedNode=[...groupNodes].find(([node,id])=>id===block.id)?.[0];
    const controls=linkedNode?controlsFor(linkedNode):{
      more_control_visible:false,comment_control_visible:false,
      reaction_control_visible:false,topic_tags:[]
    };
    block.signals={
      visible_heading:Boolean(block.label),
      article_count:block.article_links,
      excerpt_count:excerpts.length,
      firsthand_excerpt_count:firstHand.length,
      source_diversity:block.source_types.length,
      ...controls
    };
    // Topic grouping only: at least 2 distinct linked article cards, an
    // observed section heading, and 2 visible excerpts (not mere profiles).
    if(block.kind==='OTHER_LABELED_BLOCK'&&block.article_links>=2&&excerpts.length>=2){
      block.kind='TOPIC_CLUSTER_CANDIDATE';
      block.confidence='structural_topic_group_candidate';
      matching.forEach(r=>{r.block_kind=block.kind;r.block_confidence=block.confidence;});
    }
    block.experience_evidence=block.kind==='EXPERIENCE_REVIEW_CANDIDATE'?
      'heading_word_candidate':
      block.kind==='TOPIC_CLUSTER_CANDIDATE'&&firstHand.length>=2?
      'multiple_firsthand_excerpts':'not_established';
  }
  const reviewHeadingBlocks=blocks.filter(b=>b.kind==='EXPERIENCE_REVIEW_CANDIDATE');
  const topicGroups=blocks.filter(b=>b.kind==='TOPIC_CLUSTER_CANDIDATE');
  const experienceSignals=blocks.filter(b=>b.experience_evidence==='multiple_firsthand_excerpts');
  const ugcObservation={
    // Preserve the conservative legacy state: platform UGC type remains
    // unverified even when a topical cluster and first-person text appear.
    state:reviewHeadingBlocks.length?'candidate_observed':'not_determined',
    candidate_block_count:reviewHeadingBlocks.length,
    observed_block_count:blocks.length,
    topic_cluster_candidate_count:topicGroups.length,
    experience_evidence_candidate_count:experienceSignals.length,
    topic_group_state:topicGroups.length?'topic_cluster_observed':'not_determined',
    note:'주제 묶음은 검색 섹션 제목·게시글 2개 이상·화면 발췌 2개 이상으로 분류합니다. 경험 표현은 별도 근거이며 네이버 공식 UGC 블록 여부는 미확정입니다.'
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
