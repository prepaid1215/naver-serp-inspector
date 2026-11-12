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
3. Maintain the four people/seven blog IDs and four groups/twelve queries from the spec.
4. Recommend exactly one justified keyword/title per person (건호, 영은, 하루, 수진) when current VERIFIED feed evidence supports it. Recommend exactly one of the owner's configured Naver blog IDs per assignment, prioritizing weaker visibility in the selected verified keyword, recording the chosen `blog_id`, `blog_url`, and blog-specific reason. Never infer publication from a recommendation. Priority: missing from all variants > weak 8-10th visibility > partial-variant weakness > rank improvement > different-intent expansion. Never double-assign an owner; without valid evidence hold only affected owners.
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
