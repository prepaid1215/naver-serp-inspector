/*
 * Human-review content evidence comparison.
 * This is NOT an SEO score, ranking explanation, or semantic embedding.
 * Only already captured, user-visited documents are compared.
 */
const STOP = new Set([
  '및','또는','그리고','하지만','대한','관련','하는','합니다','있는','에서',
  '으로','에게','까지','부터','자세히','알아보기','확인하기','정리','안내',
  '이것','그것','위해','있나요','있을까','무엇','어떻게','어떤','것은',
  'the','and','with','from','this','that','your','what','when','where','how'
]);
function words(value){
  return [...new Set((String(value||'').toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{2,}/g)||[])
    .map(s=>s.trim()).filter(s=>s.length>=2&&!STOP.has(s)))];
}
function normalize(value) {
  return String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
}
function comparableHeadings(page){
  const items=(page.headings||[]).filter(item=>item?.text)
    .filter(item=>/^(H1|H2|H3|TITLE)$/.test(item.level||''));
  const src=items.length?items:[{level:'TITLE',text:page.title||''}];
  const distinct=new Set();
  return src.map(item=>({level:item.level,text:String(item.text).replace(/\s+/g,' ').trim().slice(0,170)}))
    .filter(item=>{const k=normalize(item.text);if(!k||distinct.has(k))return false;distinct.add(k);return true;})
    .slice(0,35);
}
function urlName(page){
  return {title:page.title||page.url||'제목 없음',url:page.url||'',captured_at:page.captured_at||''};
}
function compareTopic(topic, own){
  const terms=words(topic);
  if(terms.length<2)return null;
  const titleHeadings=normalize([own.title,...(own.headings||[]).map(h=>h.text)].join(' '));
  const articleText=normalize(own.text);
  const mentioned=terms.filter(term=>titleHeadings.includes(term)||articleText.includes(term));
  const inHeading=terms.filter(term=>titleHeadings.includes(term));
  const ratio=mentioned.length/terms.length;
  // A surface-level review cue, not a semantic absence assertion.
  const status=ratio<0.5?'검토 후보':inHeading.length===terms.length?'제목·소제목에 유사 표현':'본문에 관련 표현';
  return {terms,mentioned,heading_terms:inHeading,ratio,status};
}
function excerptFor(page,term){
  const source=String(page.text||'');
  if(!term)return'';
  const pos=source.toLowerCase().indexOf(term.toLowerCase());
  if(pos<0)return'';
  return source.slice(Math.max(0,pos-70),Math.min(source.length,pos+125)).replace(/\s+/g,' ').trim();
}
export function compareCapturedContent(own, rivals, options={}){
  if(!own?.id||!Array.isArray(rivals))throw Error('내 문서 한 개와 경쟁 문서 목록이 필요합니다.');
  const competitors=rivals.filter(p=>p?.id&&p.id!==own.id).slice(0,8);
  const source=String(options.keyword||'').trim();
  const topics=new Map();
  for (const page of competitors){
    for (const item of comparableHeadings(page)){
      const checked=compareTopic(item.text,own);
      if(!checked)continue;
      const key=checked.terms.slice().sort().join('|');
      if(!key)continue;
      if(!topics.has(key))topics.set(key,{
        topic:item.text,terms:checked.terms,mentioned:checked.mentioned,
        heading_terms:checked.heading_terms,ratio:checked.ratio,status:checked.status,
        references:[]
      });
      const record=topics.get(key);
      if(!record.references.some(ref=>ref.url===page.url)){
        record.references.push({...urlName(page),level:item.level,
          heading:item.text,excerpt:excerptFor(page,checked.terms[0])});
      }
    }
  }
  const all=[...topics.values()].sort((a,b)=>{
    const statusOrder={'검토 후보':0,'본문에 관련 표현':1,'제목·소제목에 유사 표현':2};
    return statusOrder[a.status]-statusOrder[b.status] ||
      b.references.length-a.references.length || a.topic.localeCompare(b.topic,'ko');
  });
  const review=all.filter(x=>x.status==='검토 후보');
  const related=all.filter(x=>x.status!=='검토 후보');
  const ownHeadings=comparableHeadings(own);
  const suggestions=[
    ...review.slice(0,10).map(item=>({
      action:'경쟁 문서에서 관측한 주제를 내 문서에서 검토',
      topic:item.topic,
      evidence:item.references.map(r=>({title:r.title,url:r.url,heading:r.heading})),
      caution:'문서 내 정보 부재 및 네이버 노출 원인을 확정하는 분석이 아닙니다.'
    })),
    ...(own.description?[]:[{
      action:'내 문서의 설명 메타데이터 직접 검토',
      topic:'description 값 미수집/미표시',
      evidence:[urlName(own)],
      caution:'네이버 노출과 직접적인 인과 관계는 검증되지 않았습니다.'
    }])
  ];
  return {
    generated_at:new Date().toISOString(),keyword:source,
    own:urlName(own),own_headings:ownHeadings,
    competitors:competitors.map(p=>({
      ...urlName(p),heading_count:comparableHeadings(p).length,text_length:(p.text||'').length
    })),
    review,related,suggestions,
    limitations:[
      '검토 후보는 단어 포함 여부로만 계산합니다. 누락된 정보 또는 검색 순위의 이유가 아닙니다.',
      '비교 입력은 사용자가 직접 방문해 저장한 문서만 포함합니다.',
      '본문 추출 실패·중복 영역·iframe·콘텐츠 업데이트로 인한 오차가 발생할 수 있습니다.',
      '문서 내용의 정확성과 검색 의도 적합성은 사용자가 직접 검증해야 합니다.'
    ]
  };
}
export function gapReportText(result){
  const lines=[
    'NAVER Intelligence · 콘텐츠 비교 (관측 근거 기반)',
    '분석일: '+result.generated_at,
    '키워드: '+(result.keyword||'미입력'),
    '내 문서: '+result.own.title+' · '+result.own.url,
    '비교 문서: '+result.competitors.length+'개',''
  ];
  for(const item of result.review){
    lines.push('검토 후보: '+item.topic);
    lines.push('내 문서에서 일치한 표현: '+(item.mentioned.join(', ')||'없음'));
    for(const ref of item.references)lines.push('  근거: '+ref.heading+' · '+ref.url);
    lines.push('');
  }
  for(const item of result.related.slice(0,25)){
    lines.push('관련 표현 확인: '+item.topic+' · '+item.status);
  }
  lines.push('',...result.limitations.map(x=>'주의: '+x));
  return lines.join('\n');
}
