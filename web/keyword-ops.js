(() => {
  'use strict';

  const DATA_ROOT = './ops-data/';
  const SECTION = 'INTEGRATED_BLOG_SECTION_TOP10';
  const FEED = 'INTEGRATED_FEED_BLOG_CARDS_TOP10';
  const ARTICLES = 'INTEGRATED_BLOG_ARTICLES_TOP10';
  const OWNERS = ['건호', '영은', '하루', '수진'];
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
      ERROR: '수집 오류', STALE: '45분 경과', UNKNOWN: '미확인', READY: '2팀 제안', PENDING: '배정 보류'
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
    const assignments = (data.recommendation?.assignments || []).filter(row => groupIsFresh(data.groups?.[row.keyword]));
    $('verified-count').textContent = `${verified}/12`;
    $('pending-count').textContent = String(records.length - verified - stale);
    $('stale-count').textContent = String(stale);
    $('group-count').textContent = `${freshGroups}/4`;
    $('team-count').textContent = `${assignments.length}/2`;
    $('success-rate').textContent = `${Math.round((verified / 12) * 100)}%`;
    $('updated').textContent = formatTime(data.captured_at_kst);
    $('slot').textContent = data.recommendation?.slot_at_kst ? `발행 ${formatTime(data.recommendation.slot_at_kst)}` : '배정 시각 없음';
  }

  function renderRecommendations(data) {
    const root = $('recommendations'); clear(root);
    const decision = data.recommendation || {};
    const assignments = decision.assignments || [];
    const current = assignments.filter(row => groupIsFresh(data.groups?.[row.keyword]));
    const isCurrent = current.length > 0 && ['READY', 'PARTIAL'].includes(decision.status);
    const shown = isCurrent ? current : assignments;
    $('recommendation-heading').textContent = isCurrent ? '이번에 발행할 글' : '최근 분석 결과';
    $('decision-status').textContent = isCurrent
      ? '검색을 확인했습니다. 아래 글을 추천합니다.'
      : '최근 검색이 아닙니다. 발행 전 재확인이 필요합니다.';
    $('decision-status').className = isCurrent ? 'decision-ready' : 'decision-pending';

    if (!isCurrent) {
      const warning = element('div', root, undefined, 'simple-alert');
      element('b', warning, '최신 검색 결과가 없어 현재 발행은 보류합니다.');
      element('p', warning, '자동 검색이 다시 완료되면 다음 발행 글을 확정해 표시합니다. 아래에 보이는 지난 추천은 참고용입니다.');
    }
    if (!shown.length) {
      const empty = element('div', root, undefined, 'simple-empty');
      element('h3', empty, '지금 추천할 글이 없습니다.');
      element('p', empty, data.errors?.length
        ? '검색 수집에 오류가 있습니다. 자세한 근거에서 상태를 확인해 주세요.'
        : '충분한 검색 결과가 확인되면 담당자와 제목을 자동으로 안내합니다.');
      element('p', empty, decision.note || '', 'muted');
      element('span', empty, '발행자 자동 배정 보류', 'visually-hidden');
      return;
    }

    shown.forEach((assignment, index) => {
      const group = data.groups?.[assignment.keyword] || {};
      const card = element('article', root, undefined,
        'simple-publish-card' + (isCurrent ? '' : ' past'));
      const top = element('div', card, undefined, 'publish-card-top');
      element('span', top, '추천 ' + (index + 1) + ' · ' + assignment.keyword, 'publish-keyword');
      if (isCurrent) badge(top, 'VERIFIED');
      else element('span', top, '과거 추천 · 발행 보류', 'past-tag');

      const owners = (assignment.people || []).join(' · ');
      element('h3', card, isCurrent ? owners + '님, 이 글을 발행하세요' : owners + '님께 지난번 추천했던 글');

      const reason = element('div', card, undefined, 'publish-reason');
      element('b', reason, '왜 추천하나요?');
      const appeared = (group.exposed || []).join('·');
      const absent = (group.missing || []).join('·');
      let explanation = '';
      if (appeared && absent) {
        explanation = (isCurrent ? '최근' : '마지막') + ' 조사에서 ‘' + assignment.keyword + '’ 관련 검색어 3개를 비교했습니다. '
          + appeared + '님의 글은 블로그 카드 상위 10개에 나타났지만, ' + absent + '님의 글은 보이지 않았습니다. '
          + '따라서 ' + owners + '님이 이 키워드를 맡는 것이 좋습니다.';
      } else {
        explanation = '이 키워드의 세 가지 검색어에서 ' + owners + '님의 글이 블로그 카드 상위 10개에 나타나지 않아 발행을 제안합니다.';
      }
      element('p', reason, explanation);
      if (group.exits?.length) {
        element('p', reason, '이전에 관측되던 글의 노출 이탈도 감지되어 우선 확인 대상으로 선정했습니다.', 'muted');
      }

      element('p', card, '담당자별 추천 제목', 'publish-title-heading');
      const titles = element('div', card, undefined, 'simple-title-list');
      for (const row of (assignment.titles || [])) {
        const line = element('div', titles, undefined, 'simple-title-item');
        element('strong', line, row.owner);
        const name = element('div', line);
        element('span', name, row.title, 'simple-draft-title');
        if (row.intent) element('small', name, row.intent + ' 중심', 'muted');
      }
      if (!(assignment.titles || []).length) element('p', titles, '추천 제목 생성 대기', 'muted');

      const foot = element('div', card, undefined, 'publish-card-foot');
      element('span', foot, '제목은 규칙 기반 초안 · 실제 발행 전 확인', 'muted');
      if ((assignment.titles || []).length) {
        const copy = element('button', foot, '제목 복사', 'simple-copy');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
          try {
            const lines = (assignment.titles || []).map(row => row.owner + ': ' + row.title);
            await navigator.clipboard.writeText([assignment.keyword, ...lines].join('\n'));
            copy.textContent = '복사 완료';
          } catch (_) {
            copy.textContent = '복사 실패';
          }
        });
      }
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
      element('li', root, `${formatTime(row.at)} · 검증 키워드 ${verifiedGroups}/4 · ${teams}팀 · ${statusLabel(row.recommendation?.status || 'PENDING')}`);
    });
    if (!rows.length) element('li', root, '조건에 맞는 이력이 없습니다.', 'muted');
  }

  function render(data, history) {
    currentData = data; currentHistory = history;
    renderStats(data); renderRecommendations(data); renderGroups(data); renderQueries(data);
    populateFilters(data); renderHistory();
    $('errors').textContent = (data.errors || []).join(' · ');
    const manual = $('manual-query'); clear(manual);
    Object.keys(data.queries || {}).forEach(query => element('option', manual, query).value = query);
  }

  async function load() {
    $('refresh').disabled = true;
    $('message').textContent = 'GitHub Pages 관측 자료를 읽는 중…';
    try {
      const suffix = `?t=${Date.now()}`;
      const response = await fetch(`${DATA_ROOT}latest.json${suffix}`, {cache: 'no-store'});
      if (!response.ok) throw new Error(`latest.json HTTP ${response.status}`);
      const data = await response.json();
      if (data.schema !== 'naver-blog-ops-v2') throw new Error(`지원하지 않는 데이터 형식: ${data.schema || '없음'}`);
      const history = await fetch(`${DATA_ROOT}history.json${suffix}`, {cache: 'no-store'})
        .then(result => result.ok ? result.json() : {entries: []}).catch(() => ({entries: []}));
      render(data, history);
      $('message').textContent = `최신 저장 자료 ${formatTime(data.captured_at_kst)} · ${data.collector?.headed_browser ? '이 PC의 모바일 브라우저 화면 대조' : '클라우드 자동 검색'} · 새로고침 ${formatTime(new Date().toISOString())}`;
    } catch (error) {
      $('message').textContent = `자료 불러오기 실패: ${error.message}`;
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

  $('refresh').addEventListener('click', load);
  ['history-keyword', 'history-owner', 'history-status'].forEach(id => $(id).addEventListener('change', renderHistory));
  $('manual-form').addEventListener('submit', exportManual);
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  $('manual-time').value = now;
  load();
})();
