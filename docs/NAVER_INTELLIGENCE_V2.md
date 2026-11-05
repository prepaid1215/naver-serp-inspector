# NAVER Intelligence v1.4 beta — Local evidence workflow

Existing SERP Lens v1.3.2 browser capture, web viewer, and Windows collector are retained.

## Purpose

Separate the observed search-result page, user-visited document evidence, and AI-generated hypotheses. This is not an official Naver rank, index, or algorithm diagnosis.

## User steps

1. In Chrome/Edge, go to chrome://extensions or edge://extensions, turn on Developer mode and load this repository root as an unpacked extension. If upgrading, refresh the existing extension.
2. Open a real Naver PC/mobile search page, click SERP Lens, then **현재 네이버 검색 수집 · 기록 저장**. The original SERP Lens HTML/PNG viewer opens as before. The Intelligence store saves compact extracted cards, title, URL, approximate DOM order, capture time, and evidence SHA-256.
3. Repeat the same keyword/device search another day. Open **Intelligence 분석 대시보드 열기**, choose the newer and older snapshots. New, missing, and shifted links are shown. This is a comparison of captured observations, not a confirmed change in official rankings.
4. Open a public blog, cafe, or website article manually. In the popup click **현재 문서 분석용 저장**. The extension reads only the currently visited page and frames the activeTab permission allows, then stores visible text (up to 18,000 characters), headings, title, description, canonical, robots meta, image count, and link counts locally. The longest relevant article frame is preferred where available.
5. In the Intelligence dashboard, review saved article structures. Enter own domains if helpful. Click **AI 분석 요청문 복사** and paste into your ChatGPT conversation, or download the TXT/JSON evidence file.

## Storage and safety

- Only user-click capture. No automated batch browsing, Naver scraping service, hidden crawling, CAPTCHA bypass, or external analytics upload.
- Original SERP HTML and one visible-viewport PNG are still stored in the legacy latest slot. Intelligence history stores parsed rows, not historical full HTML/PNG; preserve manual evidence exports if visual re-checks are required.
- Local IndexedDB database naver-intelligence-v2 keeps the newest 100 search snapshots and 60 visited pages; older records are pruned. Page text is only transmitted when the user explicitly shares an export or copies it to another service.
- The ChatGPT handoff contains up to 2,200 characters of text per visited page plus headings and metadata. No ChatGPT API key, direct ChatGPT message delivery, or background AI analysis is configured.
- Never capture an account, login, private document, or page containing personal data. Delete captures from the dashboard.
- Naver DOM markup changes can lead to incomplete results, card-type misclassification, or misleading DOM order. The new history does not certify rank positions.
- Naver blog iframes may not be accessible on some page configurations. If extraction fails, open the actual post URL in the current tab and retry.
- This beta needs real-device tests with live PC/mobile Naver result pages; passing code and offline tests alone is not live verification.

## Code layout

- extension/popup.js: existing search capture with compact history + manually visited article capture.
- extension/intelligence-store.js: local-only bounded search/article IndexedDB store.
- extension/intelligence-analysis.js: deterministic snapshot diff, evidence minimization, ChatGPT handoff.
- extension/intelligence.html, intelligence.js, intelligence.css: local dashboard.
- tests/intelligence.mjs: offline data comparator and prompt contract tests.

## Next milestones

- Evaluate visual-versus-DOM accuracy against anonymized captures and build a review UI.
- Add source-specific extraction regression tests for Naver blog and cafe variations.
- Compare user-owned content against competitors with evidence-backed topic coverage, with a manual review step.
- Optional scheduled collection only after separate scope, policy and consent design. This release does not do that.
