"""Conservative mobile Naver integrated-search BLOG section observer.

No CAPTCHA/access restriction bypass. DOM link order is never treated as confirmed
rank without identifying an explicit blog section and ten visible posts.
"""
from __future__ import annotations
import json, re, time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'web' / 'ops-data'
EVIDENCE_DIR = ROOT / 'monitor-evidence'
PEOPLE = {
    '건호': ['carrotmobile_', 'lifeon5g_'],
    '영은': ['esim99_', 'esim99', 'esim87_'],
    '하루': ['ntelecom59'],
    '수진': ['jjuny1253'],
}
GROUPS = {
    'KT바로유심': ['KT바로유심', '바로유심', 'KT바로유심 개통'],
    'LG모두의 원칩': ['LG모두의 원칩', '모두의 원칩', 'LG원칩 개통'],
    '태블릿소유자회원번호': ['태블릿소유자회원번호', '태블릿 소유자 회원번호', '태블릿소유자회원번호 입력'],
    '다이소 유심': ['다이소 유심', '다이소 선불유심', '다이소 유심 개통'],
}
USER_AGENT = ('Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36')

def blog_article(url: str) -> dict | None:
    """Return owner identifier only for an actual Naver Blog post link."""
    try:
        u = urlparse(url)
        if u.scheme not in ('http', 'https') or u.hostname not in ('blog.naver.com', 'm.blog.naver.com'):
            return None
        parts = [p for p in u.path.split('/') if p]
        if len(parts) >= 2 and re.fullmatch(r'\d{5,20}', parts[1]) and re.fullmatch(r'[A-Za-z\d_-]{2,40}', parts[0]):
            return {'id': parts[0].lower(), 'post': parts[1], 'url': f'https://blog.naver.com/{parts[0]}/{parts[1]}'}
        if parts and parts[0].lower() in ('postview.naver', 'postview.nhn'):
            p = parse_qs(u.query)
            bid, log = p.get('blogId', [''])[0], p.get('logNo', [''])[0]
            if re.fullmatch(r'[A-Za-z\d_-]{2,40}', bid) and re.fullmatch(r'\d{5,20}', log):
                return {'id': bid.lower(), 'post': log, 'url': f'https://blog.naver.com/{bid}/{log}'}
    except (TypeError, ValueError):
        pass
    return None

def people_from_urls(urls: list[str]) -> dict:
    result = {name: [] for name in PEOPLE}
    for pos, url in enumerate(urls[:10], 1):
        post = blog_article(url)
        if not post:
            continue
        for name, ids in PEOPLE.items():
            if post['id'] in ids:
                result[name].append({'rank': pos, **post})
    return result

def summarize_groups(records: dict, previous: dict | None = None) -> dict:
    """Missing means absent from all three valid top-ten observations."""
    previous = previous or {}
    groups = {}
    for name, queries in GROUPS.items():
        observations = [records.get(q, {}) for q in queries]
        complete = all(o.get('status') == 'auto_observed' and len(o.get('urls', [])) == 10 for o in observations)
        matches = {p: [] for p in PEOPLE}
        if complete:
            for query, observation in zip(queries, observations):
                for person, found in people_from_urls(observation['urls']).items():
                    matches[person].extend([{'query': query, **item} for item in found])
        exposed = [p for p, items in matches.items() if items] if complete else []
        missing = [p for p in PEOPLE if p not in exposed] if complete else []
        before = previous.get('groups', {}).get(name, {})
        dropped = [p for p in missing if before.get('complete') and before.get('matches', {}).get(p)] if complete else []
        groups[name] = {'complete': complete, 'queries': queries, 'matches': matches,
                        'exposed': exposed, 'missing': missing, 'dropped': dropped,
                        'status': 'assessable' if complete else 'unverified'}
    return groups

def recommend(groups: dict) -> dict:
    """Assign two unexposed people to a keyword, without duplicate assignments."""
    ready = [(name, g) for name, g in groups.items() if g.get('complete') and len(g.get('missing', [])) >= 2]
    ready.sort(key=lambda pair: (-len(pair[1].get('dropped', [])),
                                abs(len(pair[1]['missing']) - 2),
                                list(GROUPS).index(pair[0])))
    taken, assignments = set(), []
    for name, g in ready:
        available = [p for p in g['missing'] if p not in taken]
        available.sort(key=lambda p: (p not in g.get('dropped', []), list(PEOPLE).index(p)))
        if len(available) >= 2:
            two = available[:2]
            assignments.append({'keyword': name, 'people': two,
                                'reason': '순위 이탈 복구 우선' if any(p in g['dropped'] for p in two)
                                          else '3개 검색어 모두 상위 10개 미노출'})
            taken.update(two)
        if len(taken) == 4:
            break
    return {'ready': len(assignments) == 2,
            'assignments': assignments,
            'unassigned': [p for p in PEOPLE if p not in taken],
            'note': '확인되지 않은 키워드는 미노출로 취급하지 않음'}

# Browser-visible rendered page observation. Explicit '블로그' heading + ten
# visible post links in a nearby container are required, not generic DOM order.
EXTRACT_JS = r'''() => {
 const main=document.querySelector('#main_pack') || document.querySelector('main') || document.body;
 const blocked=/자동입력 방지|비정상적인 검색 요청|캡차를 입력|captcha|접근이 제한/i.test((document.body.innerText||'').slice(0,25000));
 if(blocked) return {status:'blocked',reason:'access restriction or CAPTCHA',urls:[]};
 function parse(href){
  try {const u=new URL(href,location.href);if(!/^(m\.)?blog\.naver\.com$/i.test(u.hostname))return null;
   let m=u.pathname.match(/^\/([\w-]{2,40})\/(\d{5,20})(?:\/|$)/);
   if(m)return 'https://blog.naver.com/'+m[1]+'/'+m[2];
   if(/^\/PostView\.(naver|nhn)$/i.test(u.pathname)){
     const id=u.searchParams.get('blogId'),no=u.searchParams.get('logNo');
     if(/^[\w-]{2,40}$/.test(id||'')&&/^\d{5,20}$/.test(no||''))return 'https://blog.naver.com/'+id+'/'+no;
   }
  } catch(e){} return null;
 }
 function visible(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);
   return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';}
 const heads=[...main.querySelectorAll('h1,h2,h3,h4,strong,[role="heading"],.api_title')]
   .filter(x=>visible(x) && (x.innerText||'').trim()==='블로그');
 let candidates=[];
 for(const h of heads){
   let ancestor=h;
   for(let depth=0;depth<6 && ancestor;depth++,ancestor=ancestor.parentElement){
     if(ancestor===document.body||ancestor===main&&depth>3)break;
     const unique=new Map();
     for(const a of ancestor.querySelectorAll('a[href]')){
       if(!visible(a))continue;const u=parse(a.href);if(!u)continue;
       const y=a.getBoundingClientRect().top+scrollY;
       if(!unique.has(u)||y<unique.get(u))unique.set(u,y);
     }
     if(unique.size>=10 && unique.size<=30){
       const links=[...unique].sort((a,b)=>a[1]-b[1]);
       const bounds=ancestor.getBoundingClientRect();
       candidates.push({urls:links.slice(0,10).map(x=>x[0]),depth,all:unique.size,heading:'블로그',
         width:Math.round(bounds.width),height:Math.round(bounds.height)});
       break;
     }
   }
 }
 if(candidates.length!==1)return {status:'needs_review',reason:candidates.length?'multiple blog sections':'explicit blog section with ten posts not found',urls:[],heading_count:heads.length,candidate_count:candidates.length};
 return {status:'auto_observed',reason:'ten distinct visible posts under an explicit blog heading; mobile viewport y-order',...candidates[0]};
}'''

def collect_search(page, query: str, evidence_dir: Path) -> dict:
    url = 'https://m.search.naver.com/search.naver?' + urlencode({'where': 'nexearch', 'query': query})
    page.goto(url, wait_until='domcontentloaded', timeout=35000)
    page.wait_for_timeout(1500)
    for _ in range(6):
        page.mouse.wheel(0, 850)
        page.wait_for_timeout(350)
    page.wait_for_timeout(400)
    data = page.evaluate(EXTRACT_JS)
    safe = re.sub(r'[^a-z0-9가-힣]+', '-', query.lower()).strip('-')[:50]
    evidence_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(evidence_dir / (safe + '.png')), full_page=True, timeout=30000)
    item = {'query': query, 'url': url, 'observed_at': datetime.now(KST).isoformat(),
            'device': 'mobile-emulation', 'surface': 'integrated_blog_section',
            'status': data.get('status', 'needs_review'), 'reason': data.get('reason',''),
            'urls': data.get('urls', []), 'section_heading': data.get('heading'),
            'candidate_count': data.get('candidate_count', 1),
            'evidence_file': safe + '.png'}
    if item['status'] == 'auto_observed' and (len(item['urls']) != 10 or not all(blog_article(u) for u in item['urls'])):
        item.update(status='needs_review', reason='post link validation failed', urls=[])
    return item

def run() -> dict:
    from playwright.sync_api import sync_playwright
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(KST).strftime('%Y-%m-%d_%H%M')
    evidence = EVIDENCE_DIR / stamp
    old = {}
    latest = DATA_DIR / 'latest.json'
    if latest.exists():
        try:
            old = json.loads(latest.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            pass
    records, errors = {}, []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=['--no-sandbox'])
            try:
                context = browser.new_context(user_agent=USER_AGENT, viewport={'width': 390, 'height': 844},
                                              device_scale_factor=2, is_mobile=True, has_touch=True, locale='ko-KR')
                page = context.new_page()
                for i, query in enumerate(q for sub in GROUPS.values() for q in sub):
                    if i: time.sleep(6)
                    try:
                        result = collect_search(page, query, evidence)
                    except Exception as exc:
                        result = {'query':query,'device':'mobile-emulation','surface':'integrated_blog_section',
                                  'status':'error','reason':f'{type(exc).__name__}: {str(exc)[:200]}','urls':[]}
                    records[query] = result
                    print(query, result['status'], result.get('reason',''), flush=True)
                    if result['status'] == 'blocked':
                        errors.append('네이버 접근 제한 감지: 추가 요청 중단')
                        break
                context.close()
            finally:
                browser.close()
    except Exception as exc:
        errors.append(f'{type(exc).__name__}: {str(exc)[:200]}')
    groups = summarize_groups(records, old)
    recommendations = recommend(groups)
    now = datetime.now(KST).isoformat()
    output = {'schema':'naver-mobile-integrated-blog-top10-v1','captured_at_kst':now,
              'source':'Playwright mobile-emulation, browser-visible Naver integrated search',
              'trust':'automatic DOM observation only; screenshots required for independent audit',
              'people':PEOPLE,'groups':groups,'queries':records,
              'recommendation':recommendations,'errors':errors}
    latest.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    history_file = DATA_DIR / 'history.json'
    try:
        history = json.loads(history_file.read_text(encoding='utf-8')) if history_file.exists() else []
        if not isinstance(history, list):history=[]
    except (ValueError,OSError):
        history=[]
    history.append({'at':now,'summary':{g:{'complete':x['complete'],'exposed':x['exposed'],'missing':x['missing']} for g,x in groups.items()},'recommendation':recommendations})
    history_file.write_text(json.dumps(history[-90:],ensure_ascii=False,indent=2),encoding='utf-8')
    print('assessable_groups',sum(g['complete'] for g in groups.values()),'recommendation_ready',recommendations['ready'])
    return output

if __name__ == '__main__':
    run()
