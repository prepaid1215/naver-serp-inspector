(() => {
  'use strict';

  const DATA_ROOT = './ops-data/';
  // Actions commits with GITHUB_TOKEN do not trigger a Pages deployment.
  const LIVE_DATA_ROOT = 'https://raw.githubusercontent.com/prepaid1215/naver-serp-inspector/main/web/ops-data/';
  const SECTION = 'INTEGRATED_BLOG_SECTION_TOP10';
  const FEED = 'INTEGRATED_FEED_BLOG_CARDS_TOP10';
  const ARTICLES = 'INTEGRATED_BLOG_ARTICLES_TOP10';
  const OWNERS = ['건호', '영은', '하루', '수진'];
  const TEAM_PUBLISH_KEYWORDS = ['KT바로유심', 'LG모두의 원칩', '태블릿소유자회원번호', '다이소 유심'];
  const BASE_GROUP_NAMES = ['KT바로유심', 'LG모두의 원칩', '태블릿소유자회원번호',
    '다이소 유심', '선불폰 개통', '요금미납 선불폰', '편의점 선불유심', '앤텔레콤 396'];
  const OWNER_BY_ID = {
    carrotmobile_: '건호', lifeon5g_: '건호', esim99_: '영은', esim99: '영은',
    esim87_: '영은', ntelecom59: '하루', jjuny1253: '수진'
  };
  const FRESH_MS = 45 * 60 * 1000;
  const $ = id => document.getElementById(id);
  let currentData = null;
  let currentHistory = [];

  function element(tag, parent, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    parent.appendChild(node);
    return node;
  }
  function clear(node) { node.replaceChildren(); }
  function formatTime(value) {
    if (!value || Number.isNaN(new Date(value).getTime())) return '시각 없음';
    return new Date(value).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul', hour12: false});
  }
  function statusLabel(status) {
    return ({
      VERIFIED: '검증 완료', CANDIDATE: '후보', PARTIAL: '부분 관측', BLOCKED: '접근 제한',
      ERROR: '수집 오류', STALE: '45분 경과', UNKNOWN: '미확인', READY: '2팀 추천', PENDING: '배정 보류'
    })[status] || status || '미확인';
  }
  function effective(observation) {
    if (!observation) return 'UNKNOWN';
    const status = observation.status || 'UNKNOWN';
    if (['BLOCKED', 'ERROR', 'UNKNOWN'].includes(status)) return status;
    const at = new Date(observation.observed_at).getTime();
    if (!Number.isFinite(at) || Date.now() - at > FRESH_MS) return 'STALE';
    return status;
  }
  function section(record) { return record?.surfaces?.[FEED]; }
  function legacySection(record) { return record?.surfaces?.[SECTION]; }
  function articles(record) { return record?.surfaces?.[ARTICLES]; }
  function badge(parent, status) { return element('span', parent, statusLabel(status), `status ${status}`); }
  function queryIsVerified(query) { return effective(section(currentData?.queries?.[query])) === 'VERIFIED'; }
  function groupIsFresh(group) { return (group?.queries || []).every(queryIsVerified); }
  function ownerFromRow(row) {
    if (row.owner) return row.owner;
    return OWNER_BY_ID[String(row.blog_id || '').toLowerCase()] || '';
  }

  function renderStats(data) {
    const records = Object.values(data.queries || {});
    const statuses = records.map(record => effective(section(record)));
    const verified = statuses.filter(status => status === 'VERIFIED').length;
    const stale = statuses.filter(status => status === 'STALE').length;
    const freshGroups = Object.values(data.groups || {}).filter(groupIsFresh).length;
    const assignments = (data.recommendation?.assignments || [])
      .filter(row => TEAM_PUBLISH_KEYWORDS.includes(row.keyword) && groupIsFresh(data.groups?.[row.keyword]));
    const total = records.length;
    const groupTotal = Object.keys(data.groups || {}).length;
    $('verified-count').textContent = verified + '/' + total;
    $('pending-count').textContent = String(records.length - verified - stale);
    $('stale-count').textContent = String(stale);
    $('group-count').textContent = freshGroups + '/' + groupTotal;
    $('group-detail-heading').textContent = groupTotal + '개 키워드 묶음의 담당자별 노출';
    $('query-detail-heading').textContent = total + '개 검색어의 원본 근거';
    $('team-count').textContent = `${data.recommendation?.assignment_mode === 'TWO_PERSON_KEYWORD_TEAMS' ? assignments.filter(row => (row.people || []).length === 2).length : 0}/2`;
    $('success-rate').textContent = (total ? Math.round((verified / total) * 100) : 0) + '%';
    $('updated').textContent = formatTime(data.captured_at_kst);
    $('slot').textContent = data.recommendation?.slot_at_kst ? `발행 ${formatTime(data.recommendation.slot_at_kst)}` : '배정 시각 없음';
  }

  function renderRecommendations(data) {
    const root = $('recommendations'); clear(root);
    const decision = data.recommendation || {};
    const all = decision.assignments || [];
    const flatOwners = all.flatMap(row => row.people || []);
    const properPairs = decision.assignment_mode === 'TWO_PERSON_KEYWORD_TEAMS'
      && all.length <= 2 && all.every(row => TEAM_PUBLISH_KEYWORDS.includes(row.keyword)
        && (row.people || []).length === 2
        && (row.titles || []).length === 2)
      && new Set(flatOwners).size === flatOwners.length
      && new Set(all.map(row => row.keyword)).size === all.length;
    const current = properPairs ? all.filter(row => groupIsFresh(data.groups?.[row.keyword])) : [];
    const isCurrent = current.length > 0 && ['READY', 'PARTIAL'].includes(decision.status);
    $('recommendation-heading').textContent = '키워드별 2인 팀 발행';
    $('decision-status').textContent = isCurrent
      ? (current.length === 2 ? '2팀 · 4명 발행 추천을 확인했습니다.' : '1팀만 추천됐습니다. 나머지는 보류합니다.')
      : '검색 결과를 다시 확인한 후 2인 팀을 배정합니다.';
    $('decision-status').className = isCurrent ? 'decision-ready' : 'decision-pending';

    if (!isCurrent) {
      const warning = element('div', root, undefined, 'simple-alert');
      element('b', warning, '최신 검색 결과가 없어 현재 발행은 보류합니다.');
      element('p', warning, '새 검색이 완료되면 같은 키워드에 두 명씩 배정합니다.');
    }
    if (!properPairs) {
      const warning = element('div', root, undefined, 'simple-alert');
      const wrongKeywords = all.some(row => !TEAM_PUBLISH_KEYWORDS.includes(row.keyword));
      element('b', warning, wrongKeywords
        ? '현재 저장 자료는 이전 발행 기준으로 추천됐습니다.'
        : '이전 배정 자료입니다. 2인 팀으로 재계산이 필요합니다.');
      element('p', warning, '팀 발행은 KT바로유심·모두의원칩·태블릿소유자회원번호·다이소 유심만 허용합니다. 새 검색 후 추천을 다시 확인하세요.');
      return;
    }
    const shown = isCurrent ? current : all;
    if (!shown.length) {
      const empty = element('div', root, undefined, 'simple-empty');
      element('h3', empty, '지금 추천할 팀이 없습니다.');
      element('p', empty, decision.note || '검증된 키워드가 확보되면 2명씩 추천합니다.', 'muted');
      return;
    }
    if (isCurrent && shown.length < 2) {
      const warning = element('div', root, undefined, 'simple-alert');
      element('b', warning, '서로 다른 검증 키워드가 부족하여 한 팀만 제안합니다.');
    }

    shown.forEach((assignment, index) => {
      const owners = assignment.people || [];
      const card = element('article', root, undefined,
        'simple-publish-card team-publish-card' + (isCurrent ? '' : ' past'));
      const top = element('div', card, undefined, 'publish-card-top');
      element('span', top, (index + 1) + '팀 · ' + assignment.keyword, 'publish-keyword');
      if (isCurrent) badge(top, 'VERIFIED');
      else element('span', top, '과거 추천 · 발행 보류', 'past-tag');
      element('h3', card, owners.join(' + ') + ' · 같은 키워드로 각각 글을 발행하세요');
      element('p', card, '핵심 키워드는 같고, 블로그와 글 제목은 서로 다르게 배정했습니다.', 'muted');

      const memberBox = element('div', card, undefined, 'team-members');
      owners.forEach(owner => {
        const row = (assignment.titles || []).find(t => t.owner === owner) || {};
        const person = element('section', memberBox, undefined, 'team-member');
        element('h4', person, owner);
        const blogId = row.blog_id || (assignment.blog_ids || {})[owner];
        const blogReason = row.blog_reason || (assignment.blog_reasons || {})[owner];
        const blogBox = element('div', person, undefined, 'simple-blog-target');
        element('b', blogBox, '발행할 블로그');
        if (blogId && /^[\w-]{2,40}$/.test(blogId)) {
          const link = element('a', blogBox, blogId + ' · 블로그 열기', 'simple-blog-id');
          link.href = 'https://blog.naver.com/' + encodeURIComponent(blogId);
          link.target = '_blank'; link.rel = 'noopener noreferrer';
          if (blogReason) element('p', blogBox, blogReason, 'simple-blog-reason');
        } else {
          element('span', blogBox, '발행 블로그 미지정 — 다시 검색 필요', 'muted');
        }
        element('p', person, row.title || '제목 추천 대기', 'simple-owner-title');
        const reasonBox = element('div', person, undefined, 'publish-reason');
        element('b', reasonBox, '추천 이유');
        element('p', reasonBox, (assignment.owner_reasons || {})[owner] ||
          '검증된 블로그 카드 순번을 기준으로 추천했습니다.');
        if (row.intent) element('p', person, '작성 방향: ' + row.intent, 'muted');
      });

      const foot = element('div', card, undefined, 'publish-card-foot');
      element('span', foot, '두 글은 서로 다른 내용으로 작성 · 발행 전 제목 확인', 'muted');
      const copy = element('button', foot, '2명 제목 복사', 'simple-copy');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        try {
          const lines = owners.map(owner => {
            const row = (assignment.titles || []).find(t => t.owner === owner) || {};
            return owner + ' (' + (row.blog_id || (assignment.blog_ids || {})[owner] || '미지정') + '): ' +
              (row.title || '제목 추천 대기');
          });
          await navigator.clipboard.writeText([assignment.keyword, ...lines].join('\n'));
          copy.textContent = '복사 완료';
        } catch (_) { copy.textContent = '복사 실패'; }
      });
    });
  }

  function renderGroups(data) {
    const root = $('keyword-cards'); clear(root);
    Object.entries(data.groups || {}).forEach(([keyword, group]) => {
      const card = element('article', root, undefined, 'keyword-card');
      const head = element('div', card, undefined, 'card-head');
      element('h3', head, keyword);
      const fresh = groupIsFresh(group);
      badge(head, fresh ? 'VERIFIED' : 'UNKNOWN');
      element('p', card, fresh ? '3개 변형 모두 최신 VERIFIED' : group.decision_note || '미노출 판정 대기', 'muted');
      const table = element('div', card, undefined, 'owner-table');
      OWNERS.forEach(owner => {
        const row = element('div', table, undefined, 'owner-row');
        element('b', row, owner);
        const matches = group.matches?.[owner] || [];
        let text = '미확인'; let cls = '';
        if (fresh) {
          text = matches.length ? matches.map(item => `${item.query} 블로그 ${item.rank}번째${item.feed_rank ? `(피드 ${item.feed_rank}번째)` : ''}`).join(' · ') : '블로그 카드 상위10 미노출(관측)';
          cls = matches.length ? 'found' : 'missing';
        }
        element('span', row, text, cls);
      });
      if (fresh && group.exits?.length) {
        element('p', card, `검증된 이탈: ${group.exits.map(row => `${row.owner}(${row.query})`).join(', ')}`, 'error');
      }
      const variants = element('ul', card, undefined, 'variant-list');
      (group.queries || []).forEach(query => {
        const row = element('li', variants);
        element('span', row, query);
        badge(row, effective(section(data.queries?.[query])));
      });
    });
  }

  function evidence0(observation) { return observation?.evidence || {}; }
  function renderSurface(root, observation, title) {
    const box = element('section', root, undefined, 'surface');
    const heading = element('h3', box);
    element('span', heading, title);
    const status = effective(observation); badge(heading, status);
    element('p', box, observation?.reason || '관측 자료 없음', 'muted');
    const list = element('ol', box, undefined, 'rank-list');
    (observation?.results || []).forEach(row => {
      const item = element('li', list);
      const link = element('a', item, row.post_url);
      link.href = row.post_url; link.target = '_blank'; link.rel = 'noopener';
      if (row.title) element('div', item, row.title, 'muted');
      const owner = ownerFromRow(row);
      if (row.feed_rank) element('span', item, ` · 피드 ${row.feed_rank}번째`, 'muted');
      if (owner) element('span', item, ` · ${owner} (${row.blog_id})`, 'owner');
    });
    if (!(observation?.results || []).length) element('li', list, '확정할 수 있는 게시글 순번 없음', 'muted');
    if (evidence0(observation).feed_audit) element('div', box, `카드 검증 ${Object.entries(evidence0(observation).feed_audit).map(([key, value]) => `${key}=${value}`).join(' ')}`, 'muted');
    const evidence = observation?.evidence || {};
    const evidenceBox = element('div', box, undefined, 'evidence');
    element('div', evidenceBox, `관측 ${formatTime(observation?.observed_at)}`);
    element('div', evidenceBox, `방법 ${evidence.verification_method || '없음'}`);
    if (evidence.section_name) element('div', evidenceBox, `영역 ${evidence.section_name}`);
    if (evidence.reviewed_by) element('div', evidenceBox, `검수 ${evidence.reviewed_by}`);
    if (evidence.screenshot_sha256) element('div', evidenceBox, `캡처 SHA-256 ${evidence.screenshot_sha256}`);
    if (evidence.source_url) {
      const link = element('a', evidenceBox, '네이버 모바일 검색 열기');
      link.href = evidence.source_url; link.target = '_blank'; link.rel = 'noopener';
    }
  }

  function renderQueries(data) {
    const root = $('query-details'); clear(root);
    Object.entries(data.queries || {}).forEach(([query, record], index) => {
      const details = element('details', root, undefined, 'query-detail');
      if (index === 0) details.open = true;
      const summary = element('summary', details);
      const line = element('span', summary, undefined, 'query-summary');
      element('span', line, query);
      badge(line, effective(section(record)));
      const body = element('div', details, undefined, 'query-body');
      renderSurface(body, section(record), '피드 블로그 카드 순번(관측·운영 기준)');
      renderSurface(body, articles(record), '통합검색 블로그 글 후보');
      if (legacySection(record)) renderSurface(body, legacySection(record), '블로그 영역 TOP10(별도 영역 없음·참고)');
    });
  }

  function historyEntries(history) {
    return Array.isArray(history) ? history : (Array.isArray(history?.entries) ? history.entries : []);
  }
  function populateFilters(data) {
    const select = $('history-keyword');
    if (select.options.length > 1) return;
    Object.keys(data.groups || {}).forEach(keyword => element('option', select, keyword).value = keyword);
  }
  function renderHistory() {
    const root = $('history'); clear(root);
    const keyword = $('history-keyword').value;
    const owner = $('history-owner').value;
    const status = $('history-status').value;
    const rows = historyEntries(currentHistory).slice().reverse().filter(row => {
      if (status && row.recommendation?.status !== status) return false;
      if (keyword && !row.summary?.[keyword]) return false;
      if (owner) {
        const assigned = (row.recommendation?.assignments || []).some(item => item.people?.includes(owner));
        const exposed = Object.values(row.summary || {}).some(item => item.exposed?.includes(owner));
        if (!assigned && !exposed) return false;
      }
      return true;
    }).slice(0, 30);
    rows.forEach(row => {
      const verifiedGroups = Object.values(row.summary || {}).filter(item => item.complete).length;
      const teams = row.recommendation?.assignments?.length || 0;
      element('li', root, `${formatTime(row.at)} · 검증 키워드 ${verifiedGroups}/${Object.keys(currentData?.groups || {}).length} · ${teams}팀 · ${statusLabel(row.recommendation?.status || 'PENDING')}`);
    });
    if (!rows.length) element('li', root, '조건에 맞는 이력이 없습니다.', 'muted');
  }

  function makeRequestUrl(group, query) {
    const title = '[SERP 키워드 추가] ' + query;
    const body = 'group: ' + group + '\nquery: ' + query + '\n\n' +
      '검색어를 이 묶음에 추가해 주세요. 저장소 운영자가 serp-approved 라벨을 붙이기 전에는 자동 수집하지 않습니다.';
    return 'https://github.com/prepaid1215/naver-serp-inspector/issues/new?' +
      new URLSearchParams({title, body}).toString();
  }

  function normalizedRequest(value) {
    const query = String(value || '').trim().replace(/\s+/g, ' ');
    return query.length >= 2 && query.length <= 60 ? query : '';
  }

  function openKeywordRequest(group, query) {
    const cleaned = normalizedRequest(query);
    const known = [...new Set([...BASE_GROUP_NAMES, ...Object.keys(currentData?.groups || {})])];
    const message = $('keyword-request-message');
    if (!cleaned || !known.includes(group)) {
      message.textContent = '2~60자의 키워드를 입력하고, 키워드 묶음을 선택하세요.';
      return;
    }
    if (Object.keys(currentData?.queries || {}).some(term => term.toLowerCase() === cleaned.toLowerCase())) {
      message.textContent = '이미 조사 목록에 등록된 키워드입니다.';
      return;
    }
    const link = document.createElement('a');
    link.href = makeRequestUrl(group, cleaned);
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
    message.textContent = 'GitHub 승인 요청 화면을 열었습니다. Submit new issue를 눌러야 접수됩니다. 승인 전에는 정기 조사 목록에 추가되지 않습니다.';
  }

  function populateKeywordRequestGroups(data) {
    const select = $('keyword-request-group');
    const previous = select.value;
    clear(select);
    const names = [...new Set([...BASE_GROUP_NAMES, ...Object.keys(data.groups || {})])];
    names.forEach(group => element('option', select, group).value = group);
    if (previous && [...select.options].some(option => option.value === previous)) {
      select.value = previous;
    }
  }

  function renderRelatedProposals(data) {
    const root = $('related-proposals');
    clear(root);
    const raw = Array.isArray(data.related_candidates) ? data.related_candidates : [];
    const valid = raw.filter(item =>
      item && typeof item.query === 'string' && typeof item.group === 'string' &&
      BASE_GROUP_NAMES.includes(item.group)).slice(0, 30);
    $('related-proposal-count').textContent = valid.length + '개' +
      (raw.length > 30 ? ' (상위 30개 표시)' : '');
    if (!valid.length) {
      element('p', root, '이번 수집에서 실제 연관검색어 영역을 확인하지 못했거나 후보가 없습니다.', 'muted');
      return;
    }
    for (const entry of valid) {
      const card = element('div', root, undefined, 'related-proposal');
      const info = element('div', card, undefined, 'related-proposal-info');
      element('strong', info, entry.query);
      element('small', info, entry.group + ' · 발견 검색어: ' + (entry.sources || []).join(', '));
      const controls = element('div', card, undefined, 'related-proposal-actions');
      const search = element('a', controls, '네이버 검색');
      search.href = 'https://m.search.naver.com/search.naver?where=nexearch&query=' +
        encodeURIComponent(entry.query);
      search.target = '_blank'; search.rel = 'noopener noreferrer';
      const approve = element('button', controls, '추가 승인 요청');
      approve.type = 'button';
      approve.addEventListener('click', () => {
        $('keyword-request-input').value = entry.query;
        $('keyword-request-group').value = entry.group;
        openKeywordRequest(entry.group, entry.query);
      });
    }
  }

  function render(data, history) {
    currentData = data; currentHistory = history;
    renderStats(data); renderRecommendations(data); renderGroups(data); renderQueries(data);
    populateFilters(data); renderHistory();
    populateKeywordRequestGroups(data); renderRelatedProposals(data);
    $('errors').textContent = (data.errors || []).join(' · ');
    const manual = $('manual-query'); clear(manual);
    Object.keys(data.queries || {}).forEach(query => element('option', manual, query).value = query);
  }

  async function fetchLatestJson(filename, suffix) {
    const sources = [
      {url: LIVE_DATA_ROOT + filename + suffix, label: 'GitHub 최신 원본'},
      {url: DATA_ROOT + filename + suffix, label: 'GitHub Pages 보관본'},
    ];
    let lastError = null;
    for (const source of sources) {
      try {
        const response = await fetch(source.url, {cache: 'no-store'});
        if (!response.ok) throw new Error(filename + ' HTTP ' + response.status);
        const data = await response.json();
        if (filename === 'latest.json' && data.schema !== 'naver-blog-ops-v2') {
          throw new Error('지원하지 않는 데이터 형식');
        }
        if (filename === 'latest.json' &&
            !Number.isFinite(new Date(data.captured_at_kst).getTime())) {
          throw new Error('수집 시각이 올바르지 않습니다');
        }
        return {data, source: source.label};
      } catch (caught) {
        lastError = caught;
      }
    }
    throw new Error(filename + ' 자료 접근 실패: ' + (lastError?.message || '알 수 없음'));
  }

  async function load() {
    $('refresh').disabled = true;
    $('message').textContent = 'GitHub 최신 검색 자료를 읽는 중…';
    try {
      const suffix = '?t=' + Date.now();
      const latest = await fetchLatestJson('latest.json', suffix);
      const data = latest.data;
      const history = await fetchLatestJson('history.json', suffix)
        .then(result => result.data).catch(() => ({entries: []}));
      render(data, history);
      const sourceNote = latest.source === 'GitHub Pages 보관본'
        ? ' · 최신 원본 연결 실패, 배포 시점 보관 자료'
        : ' · GitHub main 최신 검색 결과';
      $('message').textContent = '검색 자료 ' + formatTime(data.captured_at_kst) + sourceNote + ' · ' +
        (data.collector?.headed_browser ? '이 PC의 모바일 브라우저 화면 대조' : '클라우드 자동 검색') +
        ' · 새로고침 ' + formatTime(new Date().toISOString());
    } catch (error) {
      $('message').textContent = '자료 불러오기 실패: ' + error.message;
    } finally {
      $('refresh').disabled = false;
    }
  }

  function parsePost(url) {
    try {
      const value = new URL(url.trim());
      if (!['blog.naver.com', 'm.blog.naver.com'].includes(value.hostname.toLowerCase())) return null;
      const match = value.pathname.match(/^\/([\w-]{2,40})\/(\d{5,20})(?:\/|$)/);
      if (!match) return null;
      return `https://blog.naver.com/${match[1].toLowerCase()}/${match[2]}`;
    } catch (_) { return null; }
  }
  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function downloadJSON(value, filename) {
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  async function exportManual(event) {
    event.preventDefault();
    const message = $('manual-message'); message.textContent = '입력 검증 중…';
    try {
      const urls = $('manual-urls').value.split(/\r?\n/).map(parsePost).filter(Boolean);
      const unique = [...new Set(urls)];
      if (unique.length !== 10) throw new Error(`서로 다른 유효한 네이버 블로그 게시글 URL 10개가 필요합니다(현재 ${unique.length}개).`);
      const file = $('manual-screenshot').files[0];
      if (!file) throw new Error('전체 화면 캡처 파일이 필요합니다.');
      const localTime = new Date($('manual-time').value);
      if (Number.isNaN(localTime.getTime())) throw new Error('관측 시각을 확인해 주세요.');
      const payload = {
        schema: 'naver-blog-manual-evidence-v1', query: $('manual-query').value,
        observed_at: localTime.toISOString(), source_url: $('manual-source').value,
        section_name: $('manual-section').value.trim(), reviewed_by: $('manual-reviewer').value.trim(),
        screenshot_sha256: await sha256(file), screenshot_filename: file.name,
        review_note: $('manual-note').value.trim(), urls: unique,
        note: '이 파일은 자동으로 공유·승인되지 않으며 CLI 검증 후 감사 이력에 반영해야 합니다.'
      };
      downloadJSON(payload, `naver-blog-evidence-${Date.now()}.json`);
      message.textContent = '검증 JSON을 만들었습니다. GitHub Actions 수동 승인 입력 또는 CLI 절차로 반영하세요.';
    } catch (error) { message.textContent = error.message; }
  }

  $('keyword-request-form').addEventListener('submit', event => {
    event.preventDefault();
    openKeywordRequest($('keyword-request-group').value, $('keyword-request-input').value);
  });
  $('keyword-open-naver').addEventListener('click', () => {
    const query = normalizedRequest($('keyword-request-input').value);
    if (!query) {
      $('keyword-request-message').textContent = '네이버에서 검색할 키워드를 2~60자로 입력하세요.';
      return;
    }
    window.open('https://m.search.naver.com/search.naver?where=nexearch&query=' +
      encodeURIComponent(query), '_blank', 'noopener,noreferrer');
    $('keyword-request-message').textContent = '네이버 검색 화면을 열었습니다. 자동 추적은 별도의 승인 요청이 필요합니다.';
  });
  $('refresh').addEventListener('click', load);
  ['history-keyword', 'history-owner', 'history-status'].forEach(id => $(id).addEventListener('change', renderHistory));
  $('manual-form').addEventListener('submit', exportManual);
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  $('manual-time').value = now;
  load();
})();
