/**
 * Vercel server-only control for the fixed Naver SERP collection workflow.
 * Required Vercel Production environment variables:
 *   SERP_GITHUB_TOKEN: fine-grained PAT, only prepaid1215/naver-serp-inspector,
 *                      Actions: read/write
 *   SERP_RUN_SECRET: independently generated, high-entropy operator password,
 *                    at least 24 characters
 *
 * Never embed these values in browser JavaScript, Git, URLs, or logs.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const REPO = 'prepaid1215/naver-serp-inspector';
const WORKFLOW = 'mobile-blog-monitor.yml';
const API_ROOT = 'https://api.github.com/repos/' + REPO;
const RUNS_API = API_ROOT + '/actions/workflows/' + WORKFLOW + '/runs?per_page=10';
const DISPATCH_API = API_ROOT + '/actions/workflows/' + WORKFLOW + '/dispatches';
const WORKFLOW_UI = 'https://github.com/' + REPO + '/actions/workflows/' + WORKFLOW;
const ACTIVE = new Set(['requested', 'waiting', 'queued', 'in_progress', 'pending']);
const SESSION_COOKIE = '__Host-serp_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
function sessionSignature(payload) {
  return createHmac('sha256', process.env.SERP_RUN_SECRET)
    .update('59man-serp:session:v1:' + payload).digest('hex');
}
function issueSessionCookie() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = 'v1.' + exp;
  return SESSION_COOKIE + '=' + payload + '.' + sessionSignature(payload) +
    '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + SESSION_SECONDS;
}
function clearSessionCookie() {
  return SESSION_COOKIE + '=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0';
}
function authenticatedByCookie(request) {
  if (!configured()) return false;
  const cookies = request.headers.get('cookie') || '';
  const pair = cookies.split(';').map(p => p.trim())
    .find(p => p.startsWith(SESSION_COOKIE + '='));
  if (!pair) return false;
  const value = pair.slice(SESSION_COOKIE.length + 1);
  const match = /^v1\.(\d{10})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return false;
  const exp = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);
  if (exp <= now || exp > now + SESSION_SECONDS) return false;
  const expected = sessionSignature('v1.' + match[1]);
  return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(expected, 'hex'));
}

function json(data, status = 200, cookie = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(cookie ? {'Set-Cookie': cookie} : {}),
    },
  });
}
function configured() {
  return Boolean(
    process.env.SERP_GITHUB_TOKEN &&
    typeof process.env.SERP_RUN_SECRET === 'string' &&
    process.env.SERP_RUN_SECRET.length >= 24
  );
}
function compareSecret(provided, expected) {
  if (typeof provided !== 'string' || provided.length > 512 ||
      typeof expected !== 'string') return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
async function githubFetch(url, method, token, body) {
  return fetch(url, {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': '59man-operator-workflow-dispatch/1.0',
      'Authorization': 'Bearer ' + token,
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(12000),
    cache: 'no-store',
  });
}

export default {
  async fetch(request) {
    if (request.method === 'GET') {
      return json({configured: configured(), authenticated: authenticatedByCookie(request),
        workflow_url: WORKFLOW_UI});
    }
    if (request.method !== 'POST') {
      return json({error: '허용되지 않은 요청입니다.'}, 405);
    }
    // A cross-origin web page cannot operate this control. Require an explicit
    // same-origin JSON POST as well as the high-entropy operator secret.
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin ||
        !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return json({error: '관제판에서만 실행할 수 있습니다.'}, 403);
    }
    if (!configured()) {
      return json({error: '관리자 연결 설정이 완료되지 않았습니다. Vercel 환경변수를 확인하세요.'}, 503);
    }
    let action = 'dispatch';
    try {
      const body = await request.json();
      if (body && typeof body.action === 'string') action = body.action;
    } catch (_) {
      return json({error: '요청 형식이 올바르지 않습니다.'}, 400);
    }
    if (!['login', 'logout', 'dispatch'].includes(action)) {
      return json({error: '허용되지 않은 기능입니다.'}, 400);
    }
    if (action === 'logout') {
      return json({authenticated: false, message: '이 컴퓨터에서 로그아웃했습니다.'},
        200, clearSessionCookie());
    }
    const validCode = compareSecret(
      request.headers.get('x-serp-run-secret'), process.env.SERP_RUN_SECRET);
    const authenticated = validCode || authenticatedByCookie(request);
    if (!authenticated) {
      return json({error: '관리자 코드가 올바르지 않거나 로그인 기간이 만료됐습니다.'}, 401);
    }
    if (action === 'login') {
      return json({authenticated: true, expires_in_days: 30,
        message: '이 브라우저에 로그인 상태를 저장했습니다.'}, 200, issueSessionCookie());
    }
    const renewCookie = validCode ? issueSessionCookie() : null;
    try {
      const token = process.env.SERP_GITHUB_TOKEN;
      const runsResponse = await githubFetch(RUNS_API, 'GET', token);
      if (!runsResponse.ok) {
        return json({error: 'GitHub 실행 상태를 확인할 수 없습니다. 토큰의 Actions 권한을 확인하세요.'}, 502);
      }
      const runs = await runsResponse.json();
      const running = (Array.isArray(runs.workflow_runs) ? runs.workflow_runs : [])
        .find(run => run.head_branch === 'main' && ACTIVE.has(run.status));
      if (running) {
        return json({
          error: '이미 네이버 검색 작업이 진행 중입니다.',
          running: true,
          run_url: running.html_url || WORKFLOW_UI,
        }, 409, renewCookie);
      }

      // No user-controlled workflow/ref/inputs: never allow arbitrary Actions.
      const dispatched = await githubFetch(DISPATCH_API, 'POST', token, {ref: 'main'});
      if (!dispatched.ok) {
        return json({
          error: dispatched.status === 401 || dispatched.status === 403
            ? 'GitHub 토큰이 만료됐거나 실행 권한이 없습니다.'
            : 'GitHub 검색 실행 요청이 실패했습니다. GitHub Actions 기록을 확인하세요.',
        }, 502);
      }
      let payload = {};
      if (dispatched.status !== 204) {
        try { payload = await dispatched.json(); } catch (_) { /* 204-style response */ }
      }
      const candidate = payload.html_url;
      const safeUrl = typeof candidate === 'string' &&
        /^https:\/\/github\.com\/prepaid1215\/naver-serp-inspector\/actions\/runs\/\d+$/.test(candidate)
        ? candidate : WORKFLOW_UI;
      return json({
        accepted: true,
        run_url: safeUrl,
        message: '검색 실행 요청을 GitHub에 전달했습니다. 수집 완료 후 관제판이 자동 갱신됩니다.',
      }, 202, renewCookie);
    } catch (_error) {
      // Do not send tokens, upstream content, or internal error details to clients.
      return json({error: 'GitHub 연결에 실패했습니다. 잠시 후 다시 시도하거나 실행 기록을 확인하세요.'}, 502);
    }
  },
};
