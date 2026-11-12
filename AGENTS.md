# AGENTS.md — Codex implementation instructions

This repository contains an existing Naver SERP Lens plus an in-progress 4-person blog publishing monitor.

## Read first
- `docs/CODEX_MASTER_SPEC.md` — binding product requirements, design, acceptance tests, and phased implementation plan.
- `automation/mobile_monitor.py` and `automation/test_mobile_monitor.py`.
- `web/keyword-ops.html`, `web/ops-data/latest.json`, `web/ops-data/history.json`.
- `.github/workflows/mobile-blog-monitor.yml`, `.github/workflows/test.yml`.
- Existing `README.md`, `web/engine.js`, `desktop/`, and `extension/` before changing shared behavior.

## Mission
Implement the design end-to-end (P0–P5), not just a mock-up or static HTML. Preserve working SERP Lens features and tests. Prefer an additive, modular upgrade; avoid duplicating automation schedules.

## Nonnegotiable correctness
1. Mobile **integrated search blog-section top 10** is not the same as mobile integrated-page blog-link order or the Blog tab. Store all as different metrics; never upgrade candidates to verified without evidence.
2. Incomplete, stale, blocked, or unverified observations never mean an owner is absent. Do not automatically publish or assign using invented ranks.
3. Maintain the four people/seven blog IDs and eight baseline keyword groups/24 queries, plus only maintainer-approved tracked phrases from config/approved-keywords.json.
4. Recommend exactly two two-author teams for two DIFFERENT verified keyword groups when enough evidence exists. Each team must have exactly two of the four owners; each owner appears in exactly one team, with exactly one configured publishing blog ID and distinct article title. Optimize the complete pairing across owners and keywords using observed owner exposure: fully absent first, weak 8–10 blog-card visibility next, partial-query presence next, stronger visibility last. Do not force a 4-person one-keyword group or declare an owner missing on incomplete/unverified evidence; if only one group is verified, show only one 2-person team and hold the other two owners. Preserve `blog_id`, `blog_url`, and the selection reason in data and UI. Never infer publication from a recommendation.
5. Never bypass CAPTCHA/access restrictions, scrape private data, or publish raw browser evidence/secrets in a public repo or site.
6. Keep current GitHub Pages operational, do not silently break its CSP, and do not put secrets in client JS.
7. Preserve the existing ChatGPT automation; do not create duplicate tasks. Use current data interfaces or document migration clearly.

## Execution and proof
- Inspect real latest main and GitHub Actions failures first.
- Implement production code + unit, integration, UI, and CI tests. Verify against actual evidence plus synthetic fixtures.
- Fix unrelated currently failing CI only as needed for full green verification; do not claim that a test suite is green unless run.
- Provide actionable fallback when Naver blocks scripted collection.
- Report changed files, tests passed/failed, real query states and timestamp, current live URL, remaining blockers and approvals.
- Finish only when `docs/CODEX_MASTER_SPEC.md` acceptance criteria have been evaluated and evidenced. If blocked, state the precise limit instead of a success claim.

## Keyword expansion policy (2026-11-12 override)

- The active canonical query groups are loaded from automation/models.py: eight baseline groups with three variants each, plus approved extras in config/approved-keywords.json. Do not reimpose the historical four-group/twelve-query limit in the original spec.
- The public operator dashboard must provide an input at its TOP for new keywords, Naver search and GitHub Issue submission. A public Issue is merely a proposal; the maintainers must apply serp-approved before the approval workflow can add it to config. Never put credentials in the Pages JavaScript.
- Extract related-search candidates only from visible, grounded Naver related-search areas; do not fabricate suggestions or treat them as approved search queries.
- Every configured variant in a keyword group must be fresh VERIFIED before treating absence as confirmed. The publishing policy remains EXACTLY two people per distinct keyword, two distinct keyword teams total where evidence permits.
- The baseline 24-query version does not retroactively validate an old 12-query saved snapshot. Preserve timestamp/evidence truth and all historical audit data.

## Team publication keyword whitelist (2026-11-12 operator correction)

Team recommendations MUST be chosen ONLY from `KT바로유심`, `LG모두의 원칩`, `태블릿소유자회원번호`, `다이소 유심`. Other eight-group baseline queries, including payment arrears, remain observation-only. Preserve two 2-person teams using two distinct whitelisted keywords when sufficient VERIFIED evidence exists. Do not show old non-whitelisted assignments even as recommendations in the public dashboard. Vercel site must show `오늘은 이 글을 발행하세요`, not an unrelated 59man SERP analysis app.
