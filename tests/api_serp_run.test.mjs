import test from 'node:test';
import assert from 'node:assert/strict';
import api from '../api/serp-run.js';

const ADDRESS = 'https://59man-serp-v1-download.vercel.app/api/serp-run';
const TOKEN = 'github_pat_example_test_only';
const CODE = 'abcdefghijklmnopqrstuvwxyz1234567890';
const previous = {
  token: process.env.SERP_GITHUB_TOKEN,
  code: process.env.SERP_RUN_SECRET,
};
const originalFetch = globalThis.fetch;
function restore() {
  if (previous.token === undefined) delete process.env.SERP_GITHUB_TOKEN;
  else process.env.SERP_GITHUB_TOKEN = previous.token;
  if (previous.code === undefined) delete process.env.SERP_RUN_SECRET;
  else process.env.SERP_RUN_SECRET = previous.code;
  globalThis.fetch = originalFetch;
}
function request({method = 'POST', origin = new URL(ADDRESS).origin, secret = CODE,
                  contentType = 'application/json'} = {}) {
  return new Request(ADDRESS, {
    method,
    headers: {
      ...(origin ? {Origin: origin} : {}),
      ...(secret ? {'X-SERP-Run-Secret': secret} : {}),
      ...(contentType ? {'Content-Type': contentType} : {}),
    },
    ...(method === 'POST' ? {body: '{}'} : {}),
  });
}
function configure() {
  process.env.SERP_GITHUB_TOKEN = TOKEN;
  process.env.SERP_RUN_SECRET = CODE;
}

test('GET exposes only configured state; no token or password', async () => {
  try {
    delete process.env.SERP_GITHUB_TOKEN;
    delete process.env.SERP_RUN_SECRET;
    const res = await api.fetch(request({method: 'GET'}));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.configured, false);
    assert.equal(JSON.stringify(data).includes('github_pat_'), false);
    configure();
    const ok = await api.fetch(request({method: 'GET'}));
    assert.equal((await ok.json()).configured, true);
  } finally { restore(); }
});

test('not configured or wrong operator code never calls GitHub', async () => {
  try {
    globalThis.fetch = () => { throw new Error('must not call GitHub'); };
    delete process.env.SERP_RUN_SECRET;
    process.env.SERP_GITHUB_TOKEN = TOKEN;
    assert.equal((await api.fetch(request())).status, 503);
    configure();
    assert.equal((await api.fetch(request({secret: 'wrong'}))).status, 401);
    assert.equal((await api.fetch(request({origin: 'https://attacker.invalid'}))).status, 403);
    assert.equal((await api.fetch(request({origin: null}))).status, 403);
    assert.equal((await api.fetch(request({contentType: 'text/plain'}))).status, 403);
    assert.equal((await api.fetch(request({method: 'DELETE'}))).status, 405);
  } finally { restore(); }
});

test('authorized request checks existing runs and dispatches only fixed main workflow', async () => {
  try {
    configure();
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({url: String(url), method: options.method, authorization: options.headers.Authorization, body: options.body});
      if (options.method === 'GET') return Response.json({workflow_runs: []});
      return new Response(null, {status: 204});
    };
    const res = await api.fetch(request());
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.equal(json.accepted, true);
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /mobile-blog-monitor\.yml\/runs/);
    assert.match(requests[1].url, /mobile-blog-monitor\.yml\/dispatches/);
    assert.equal(requests[1].body, '{"ref":"main"}');
    assert.equal(requests[1].authorization, 'Bearer ' + TOKEN);
  } finally { restore(); }
});

test('active run prevents duplicate dispatch', async () => {
  try {
    configure();
    let count = 0;
    globalThis.fetch = async () => {
      count += 1;
      return Response.json({workflow_runs: [{
        head_branch: 'main', status: 'in_progress',
        html_url: 'https://github.com/prepaid1215/naver-serp-inspector/actions/runs/12345',
      }]});
    };
    const res = await api.fetch(request());
    assert.equal(res.status, 409);
    assert.equal((await res.json()).running, true);
    assert.equal(count, 1);
  } finally { restore(); }
});

test('upstream API failure is handled without leaking token', async () => {
  try {
    configure();
    globalThis.fetch = async () => new Response('upstream secret', {status: 403});
    const res = await api.fetch(request());
    assert.equal(res.status, 502);
    const body = JSON.stringify(await res.json());
    assert.equal(body.includes(TOKEN), false);
    assert.equal(body.includes('upstream secret'), false);
  } finally { restore(); }
});

test('one-time login issues HttpOnly Secure session; cookie works across visits without resending code', async () => {
  try {
    configure();
    globalThis.fetch = async (url, options) => options.method === 'GET'
      ? Response.json({workflow_runs: []})
      : new Response(null, {status: 204});
    const login = await api.fetch(new Request(ADDRESS, {
      method: 'POST', headers: {
        Origin: new URL(ADDRESS).origin, 'Content-Type': 'application/json',
        'X-SERP-Run-Secret': CODE,
      }, body: '{"action":"login"}',
    }));
    assert.equal(login.status, 200);
    assert.equal((await login.json()).authenticated, true);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /^__Host-serp_session=v1\./);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=2592000/);
    const cookieValue = cookie.split(';')[0];

    const status = await api.fetch(new Request(ADDRESS, {headers: {Cookie: cookieValue}}));
    assert.equal((await status.json()).authenticated, true);
    const execute = await api.fetch(new Request(ADDRESS, {method: 'POST', headers: {
      Origin: new URL(ADDRESS).origin, 'Content-Type': 'application/json',
      Cookie: cookieValue,
    }, body: '{"action":"dispatch"}'}));
    assert.equal(execute.status, 202);
    assert.equal((await execute.json()).accepted, true);
    const logout = await api.fetch(new Request(ADDRESS, {method: 'POST', headers: {
      Origin: new URL(ADDRESS).origin, 'Content-Type': 'application/json',
      Cookie: cookieValue,
    }, body: '{"action":"logout"}'}));
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  } finally { restore(); }
});

test('modified or expired session cookie is rejected', async () => {
  try {
    configure();
    const login = await api.fetch(new Request(ADDRESS, {method: 'POST', headers: {
      Origin: new URL(ADDRESS).origin, 'Content-Type': 'application/json',
      'X-SERP-Run-Secret': CODE,
    }, body: '{"action":"login"}'}));
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const modified = cookie.slice(0,-1) + (cookie.slice(-1)==='a'?'b':'a');
    const res = await api.fetch(new Request(ADDRESS, {method: 'POST', headers: {
      Origin: new URL(ADDRESS).origin, 'Content-Type': 'application/json',
      Cookie: modified,
    }, body: '{"action":"dispatch"}'}));
    assert.equal(res.status, 401);
    assert.equal((await (await api.fetch(new Request(ADDRESS, {headers: {Cookie: modified}}))).json()).authenticated, false);
  } finally { restore(); }
});
