// Evidence-based snapshot comparison. HTML order != verified visual ranking.
function urlKey(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString().replace(/\/$/, '');
  } catch { return String(raw || ''); }
}
export function compareSearches(newer, older) {
  if (!newer || !older || newer.query !== older.query || newer.device !== older.device) {
    throw Error('같은 키워드·기기 유형의 검색 기록 두 개가 필요합니다.');
  }
  const newRows = (newer.rows || []).filter(r => r.block_type !== 'AD');
  const oldRows = (older.rows || []).filter(r => r.block_type !== 'AD');
  const fresh = new Map(newRows.map((r, i) => [urlKey(r.result_url), {...r, position: i + 1}]));
  const previous = new Map(oldRows.map((r, i) => [urlKey(r.result_url), {...r, position: i + 1}]));
  const added = [...fresh].filter(([key]) => !previous.has(key)).map(([, row]) => row);
  const removed = [...previous].filter(([key]) => !fresh.has(key)).map(([, row]) => row);
  const changed = [...fresh].filter(([key]) => previous.has(key)).map(([key, row]) => ({
    title: row.result_title, url: row.result_url, before: previous.get(key).position,
    after: row.position, delta: previous.get(key).position - row.position,
    type: row.block_type
  })).filter(x => x.delta !== 0);
  return {query:newer.query, device:newer.device, newer_at:newer.captured_at,
    older_at:older.captured_at, added, removed, changed,
    warning:'DOM 추정 노출 순서 변화이며 공식 순위 변동·색인 여부는 확인하지 않았습니다.'};
}
export function pageStats(page) {
  const text = String(page.text || '');
  return {
    title:page.title, url:page.url, captured_at:page.captured_at,
    description:page.description || '', canonical:page.canonical || '',
    headings:page.headings || [], images:page.images || 0,
    internal_links:page.internal_links || 0, external_links:page.external_links || 0,
    text_length:text.length, text_excerpt:text.slice(0, 2200),
    truncated:!!page.truncated, source_frame:page.source_frame || '',
    warning:'사용자가 방문해 수집한 페이지의 화면 내용입니다. 네이버 노출 원인을 확정할 수 없습니다.'
  };
}
export function buildAIPrompt(snapshots, pages, compared) {
  const payload = {
    collected_at:new Date().toISOString(),
    kind:'naver-intelligence-user-initiated-evidence',
    limitation:'DOM 기반 SERP 순서는 잠정 추정, 직접 방문한 문서만 분석. 네이버 내부 랭킹 신호와 공식 색인 확인은 불가.',
    searches:snapshots.slice(0, 5).map(s => ({
      query:s.query, device:s.device, captured_at:s.captured_at, source:s.sourceURL,
      rows:(s.rows || []).slice(0, 40).map(r => ({
        type:r.block_type, block:r.block_order, estimated_order:r.organic_rank,
        title:r.result_title, url:r.result_url, domain:r.domain
      }))
    })),
    comparison:compared || null,
    visited_pages:pages.slice(0, 15).map(pageStats)
  };
  return '네이버 검색 분석 요청\n\n아래 수집 자료에서 관측된 사실과 해석 가설을 분리해 분석해 줘. 상위 문서의 실제 제목·소제목·본문 정보와 검색 결과 구성을 비교하고, 내가 다음에 작성하거나 수정할 콘텐츠의 키워드·제목·목차·차별 정보·우선순위를 근거별로 제안해 줘. 추정 순위를 공식 순위로 표현하거나, 수집하지 않은 콘텐츠를 읽었다고 주장하지 마.\n\n' + JSON.stringify(payload, null, 2);
}
