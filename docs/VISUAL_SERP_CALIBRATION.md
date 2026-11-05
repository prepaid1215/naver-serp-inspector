# SERP Lens v1.8 beta — Naver visual SERP calibration

## Purpose and exact limitation

This is **Step 1** of observational Naver ranking research: establish which
links actually appear in a **single user-captured visible viewport**, compare
their on-screen positions with selectors/parsed HTML, and record disagreements.

This does **not** measure a whole-page ranking; screenshot captures only the
currently visible section of the page. It does not extract Naver's secret rank.

## How to capture on real Naver

1. Unpack the GitHub Actions extension ZIP (folder with root manifest.json) and
   load as an unpacked Chrome or Edge extension.
2. On PC, open a real Naver search URL: search.naver.com/search.naver?query=...
   Do not use search personalization/incognito changes across comparison runs.
3. Scroll to the region you want to test. If you want the top of SERP, ensure
   scrollY=0. Wait until the results stop shifting.
4. Click the extension → **현재 화면 위치 검수용 캡처 (PC·모바일)**.
5. A screenshot and visible title-link candidates with rectangles are stored locally,
   then the separate review page opens.
6. Verify each candidate on the screenshot:
   - **화면에 보임** if the candidate matches an actually visible result title.
   - **잘못 감지** if the element is not a visible search result.
   - **불명확** if you cannot decide.
   - Correct its content type (AD/BLOG/CAFE/WEB etc.) when necessary.
7. For a result in the screenshot that does not have a numbered rectangle,
   click **화면에서 위치 선택**, click its screen position, enter its title/type
   and optional URL, then **누락 항목 추가**.
8. Only when you have inspected the **whole screenshot**, check the completion
   confirmation. A capture with moved viewport, image dimension mismatch,
   unreviewed/uncertain cards is never marked as verified.
9. Export the **PNG and JSON together** for an evidence-backed parser debugging report.
   JSON does not embed the screenshot.
10. Repeat separately for PC and mobile screenshots, and for other scroll positions
    when necessary. A capture from mobile Naver URL in a wide desktop viewport is
    **not equivalent to a phone screenshot**.

## Data and diagnostics

For each screenshot, the extension saves:
- Search URL, query, timestamp, the URL's device mode and observed layout width.
- Browser innerWidth/innerHeight, viewport scale, DPR, scroll X/Y.
- Current visible result anchors with bounding rectangle and inferred type.
- Explicit user verdicts and corrected types, manually added missing results.
- HTML parser row candidates, to highlight visible links **not present** in parser output.
- A warning if geometry moved between initial measurement and screenshot/after measurement,
  if screenshot aspect ratio disagrees with measured viewport, if DOM root fallback
  is used, or if card extraction hits a cap.

The review report gives an observed top-to-bottom order **within this screenshot
only**. A link that is in HTML but not in this viewport might simply be below
the fold and is **not** treated as a false positive for the whole-page parser.

The data is retained in a dedicated local IndexedDB (up to 24 screenshots).
The prior legacy HTML/PNG latest capture and existing Rank Lab experiment data
remain in their own stores. The program never automatically searches Naver,
crawls unvisited pages, bypasses restrictions, or sends evidence to a server.
Avoid capturing account names or personal information; extension is local-only
until you explicitly export a file or share it.

## Practical calibration plan

Use at least:
- PC: 396요금제, 선불폰 개통, 앤텔레콤 개통방법 (top viewport + lower scroll)
- Mobile: same terms under an actual mobile layout (verify browser width) (top viewport + lower scroll)
- Record block labels (광고, 블로그, 카페, 웹문서), missing/incorrect cards,
  the observed visual order, and whether visible candidates match the HTML parser.
- When live sample data is available, update parser selectors **only for demonstrated
  mismatches** and re-run offline regression fixtures.

## Test coverage

- tests/visual-audit.mjs: review decisions, correction, manually added items, full
  viewport-only verification gating, moved/dimension mismatch warnings.
- tests/browser_visual_audit.py: Chromium offline screenshot with ad/blog/web and
  below-fold item, visual rectangles, explicit human review, persistence, PNG+JSON.

Offline fixture tests **do not prove** compatibility with live Naver PC/mobile DOM.
Live manual verification is required.
