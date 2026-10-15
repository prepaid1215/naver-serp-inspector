/* SERP Lens — shared analysis engine. All processing is in the browser/WebView. */
export const RESULT_FIELDS = ['query','device','observed_at_kst','block_order','block_type','rank_in_block','organic_rank','result_title','result_url','domain','is_target','confidence','evidence_file','evidence_sha256'];
export const SUMMARY_FIELDS = ['query','device','observed_at_kst','status','parsed_count','top10_web','top10_blog','top10_cafe','top10_kin','top10_news','top10_other','top10_unclassified','top10_target','evidence_file','evidence_sha256','notes'];
const MAIN_CARD_SELECTOR = '[data-template-id="ugcItem"],[data-template-id="kinItem"],[data-template-id="clipItem"],[data-template-id="videoItem"],[class*="fds-web-doc-root"],[class*="fds-web-normal-doc-root"],[class*="powerlink"],[class*="ad_group"],[class*="ad_item"]';
const SECTION_SELECTOR = '.api_subject_bx,[class*="fds-ugc-single-intention"],[class*="fds-web-root"],[class*="fds-kin-root"],[class*="fds-nnews-root"],[class*="sc_new"],[class*="section_area"]';
const HEADLINE_SELECTOR = 'a:has(.sds-comps-text-type-headline1),a[class*="title_link"],a[class*="link_tit"],a[class*="total_tit"],a[class*="title"],a[class*="tit_main"]';
const STRUCTURED_AREAS = new Set(['BLOG','CAFE','KIN','NEWS','CLIP','VIDEO']);
const NAVER_INFRA = new Set(['search.naver.com','m.search.naver.com','nid.naver.com','m.naver.com','naver.me','me2.do','help.naver.com','m.help.naver.com','nmap.place.naver.com','ad.search.naver.com','m.ad.search.naver.com']);
const BOT_WORDS = ['자동입력 방지','비정상적인 검색 요청','캡차를 입력'];
const strip = value => (value || '').replace(/\s+/g,' ').trim();
export function escapeCSV(value) { let v=String(value ?? ''); if (/^[=+@\-\t\r]/.test(v)) v="'"+v; return /[",\n\r]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; }
export function toCSV(rows,fields) { return '\uFEFF'+[fields.join(','),...rows.map(row=>fields.map(field=>escapeCSV(row[field])).join(','))].join('\r\n')+'\r\n'; }
export function safeDomain(value) { const v=strip(value).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[/?#:]/)[0];return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)?v:''; }
export function deviceFromName(filename) { const n=filename.toLowerCase();const m=n.match(/(?:^|[_-])(pc|mobile|mo)(?:[_\-.]|$)/);return m ? (m[1]==='pc'?'PC':'모바일') : '미확인'; }
export function queryFromName(filename) {
 const name=filename.replace(/\.(html?|mhtml)$/i,'');
 const m=name.match(/^(?:\d{8}-\d{4}|\d{3})[_-](?:pc|mo|mobile)[_-](.+)$/i);
 return m?m[1].replace(/_/g,' ').replace(/\s+/g,' ').trim():'';
}
export function observedAt(filename){const m=filename.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)/);return m?`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]} KST`:'미확인';}
export function normalizedURL(raw,base) {
  if (!raw) return null;
  try {
   if (/^\/\//.test(raw))raw='https:'+raw;
   if (!/^https?:\/\//i.test(raw))return null;
   const u=new URL(raw);const d=u.hostname.toLowerCase();
   if (!d || NAVER_INFRA.has(d) || d.endsWith('.pstatic.net') || d.endsWith('.naver.net'))return null;
   if ((/^(m\.)?(blog|cafe)\.naver\.com$/.test(d)) && !(/\/[^/]+\/\d+/.test(u.pathname)||/ArticleRead/i.test(u.pathname)))return null;
   if (/^(m\.)?kin\.naver\.com$/.test(d) && !(/\/qna\//.test(u.pathname)))return null;
   u.hash='';return u.toString();
  }catch{return null;}
}
export function classifyDomain(domain){
 if (/^(ader|adcr|adclk)\.naver\.com$/.test(domain))return 'AD';
 if (/^(m\.)?blog\.naver\.com$/.test(domain))return 'BLOG';
 if (/^(m\.)?cafe\.naver\.com$/.test(domain))return 'CAFE';
 if (/^(m\.)?kin\.naver\.com$/.test(domain))return 'KIN';
 if (/^(m\.)?(clip|mate)\.naver\.com$/.test(domain))return 'CLIP';
 if (/^(n\.news|media)\.naver\.com$/.test(domain))return 'NEWS';
 if (/(^|\.)youtube\.com$/.test(domain)||domain==='youtu.be')return 'VIDEO';
 if (domain==='naver.com'||domain.endsWith('.naver.com'))return 'UNCLASSIFIED';
 return 'WEB';
}
function marker(el){return String(el?.className?.baseVal||el?.className||'')+' '+(el?.getAttribute?.('data-template-id')||'');}
function hasAncestor(el,re,depth=6){let p=el;for(let i=0;p&&i<depth;i++,p=p.parentElement){if(re.test(marker(p)))return true;}return false;}
function closestSection(card){return card.closest(SECTION_SELECTOR)||card.parentElement;}
function classifyCard(card,urlType){
 if (urlType==='AD')return 'AD';
 if (hasAncestor(card,/powerlink|ad_group|sp_ad|ad_item|ad_link|ads_area/i,6))return 'AD';
 const c=marker(card);const s=marker(closestSection(card));
 if (/news|nnews/i.test(c+' '+s))return 'NEWS';
 if (/kinItem/i.test(c))return 'KIN';
 if (/clipItem/i.test(c))return 'CLIP';
 if (/videoItem/i.test(c))return 'VIDEO';
 return urlType;
}
function chooseResultAnchor(card){
 const anchors=[...card.querySelectorAll('a[href]')].map(a=>{
   const url=normalizedURL(a.getAttribute('href'));if(!url)return null;
   const d=new URL(url).hostname.toLowerCase();const text=strip(a.textContent||'');
   const klass=marker(a);const headline=/sds-comps-text-type-headline1|total_tit|link_tit|title_link|tit_main|title/i.test(klass+' '+(a.innerHTML||'').slice(0,200));
   const profile=hasAncestor(a,/profile|source|author|account|writer/i,4);
   const score=(headline?110:0)+(text.length>10?35:0)+(text.length>25?10:0)-(!text?90:0)-(profile?125:0)-(/새 창 열림|바로가기|더보기/.test(text)&&text.length<16?100:0);
   return {url,domain:d,text,score,headline};
 }).filter(Boolean).sort((a,b)=>b.score-a.score);
 return anchors[0]&&anchors[0].score>=0?anchors[0]:null;
}
function isNested(card){return card.parentElement?.closest(MAIN_CARD_SELECTOR)!=null;}
function fallbackCards(doc){
 const nodes=[...doc.querySelectorAll('.api_subject_bx a[href], [class*="sc_new"] a[href], [class*="section_area"] a[href]')];
 return nodes.filter(a=>/title|headline|link_tit|total_tit|tit_main/i.test(marker(a)) && !a.closest(MAIN_CARD_SELECTOR)).map(a=>({card:a.parentElement||a,anchor:a,confidence:'low'}));
}
export function parseSERP(html,{filename='input.html',query='',device='',domains=[],sha256='',observed='' }={}){
 const q=strip(query)||queryFromName(filename)||'미확인';
 const dev=device||deviceFromName(filename);
 const time=observed||observedAt(filename);
 const shared={query:q,device:dev,observed_at_kst:time,evidence_file:filename,evidence_sha256:sha256};
 const targets=domains.map(safeDomain).filter(Boolean);
 if(typeof html!=='string'||!html.trim())return {rows:[],status:'수집 실패',notes:'빈 HTML',meta:shared};
 // Meta CSP on our own app prevents any active network requests from inert source content.
 const doc=new DOMParser().parseFromString(html,'text/html');
 const pageText=strip(doc.body?.textContent||'').slice(0,25000);
 if(BOT_WORDS.some(word=>pageText.includes(word))){return {rows:[],status:'수집 실패',notes:'캡차/자동입력 방지 화면',meta:shared};}
 const cards=[...doc.querySelectorAll(MAIN_CARD_SELECTOR)].filter(x=>!isNested(x));
 const input=cards.map(card=>({card,anchor:chooseResultAnchor(card),confidence:'medium'}))
   .concat(fallbackCards(doc)).filter(x=>x.anchor);
 const seen=new Set(),items=[];
 for(const item of input){
   const selected=item.anchor?.url?item.anchor:chooseResultAnchor(item.card);if(!selected)continue;
   const url=selected.url;
   const key=url.replace(/\/$/,'');if(seen.has(key))continue;seen.add(key);
   let type=classifyCard(item.card,classifyDomain(selected.domain));
   const section=closestSection(item.card);
   // Identifiers are normalized by actual DOM identity, not HTML/text offsets.
   const group=section||item.card;
   items.push({...item,selected,type,group});
 }
 if(!items.length) return {rows:[],status:'수집 실패',notes:'지원되는 검색결과 카드 없음. HTML 원본/스크린샷 확인 필요',meta:shared};
 // DOM order, independent of extraction selectors and hash-map processing order.
 const position=(node)=>{let i=0,p=node;while((p=p.previousElementSibling))i++;return i;};
 items.sort((a,b)=>{const rel=a.card.compareDocumentPosition(b.card);return rel&Node.DOCUMENT_POSITION_FOLLOWING?-1:rel&Node.DOCUMENT_POSITION_PRECEDING?1:0;});
 const rows=[];let block=0,inBlock=0,organic=0,lastGroup=null,lastType=null;
 for(const item of items){
   // Different result types inside a section must not be merged into the same block.
   if(item.group!==lastGroup||item.type!==lastType){block++;inBlock=0;lastGroup=item.group;lastType=item.type;}
   inBlock++;if(item.type!=='AD')organic++;
   const domain=item.selected.domain.replace(/^www\./,'');
   const hit=targets.some(t=>domain===t||domain.endsWith('.'+t));
   rows.push({...shared,block_order:block,block_type:item.type,rank_in_block:inBlock,
     organic_rank:item.type==='AD'?'':organic,result_title:item.selected.text.replace(/새 창 열림/g,'').trim().slice(0,240),result_url:item.selected.url,domain:item.selected.domain,
     is_target:hit?'Y':'N',confidence:item.confidence});
 }
 const notes=`HTML에서 ${items.length}개 후보 링크 추출. 실제 시각적 순위·광고·AI 출처는 스크린샷 대조 전까지 잠정값`;
 return {rows,status:'분석됨 · 화면 검증 필요',notes,meta:shared};
}
export function summarize(result){
 const visible=result.rows.filter(r=>r.block_type!=='AD').slice(0,10);
 const counts={};for(const r of visible)counts[r.block_type]=(counts[r.block_type]||0)+1;
 const get=t=>counts[t]||0;
 return {...result.meta,status:result.status,parsed_count:result.rows.length,
  top10_web:get('WEB'),top10_blog:get('BLOG'),top10_cafe:get('CAFE'),top10_kin:get('KIN'),
  top10_news:get('NEWS'),top10_other:get('OTHER')+get('CLIP')+get('VIDEO'),
  top10_unclassified:get('UNCLASSIFIED'),top10_target:visible.filter(x=>x.is_target==='Y').length,
  notes:result.notes};
}
export async function sha256(bytes){const raw=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);const hash=await crypto.subtle.digest('SHA-256',raw);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
