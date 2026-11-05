# NAVER Rank Lab v1.6 beta — Search ranking observational research

This extends SERP Lens + NAVER Intelligence from branch feat/naver-intelligence-v2.
It does **not** reveal or replicate Naver's private C-Rank, D.I.A., RRA or ranking weights.

## Why an observational tool?

Naver officially discusses document relevance, source-level credibility, experience/information richness, and re-ranking, but not their internal score values or feature weights.

Official sources:
- C-Rank: https://help.naver.com/service/5626/contents/22927
- D.I.A.: https://help.naver.com/service/5626/contents/22926
- LLM re-ranking research: https://d2.naver.com/helloworld/0556679
- Naver Search Advisor site guidance: https://searchadvisor.naver.com/guide/report-seo

## What works

1. User manually searches Naver for multiple keywords and captures each result with the popup.
2. User manually opens and saves the article contents from a subset of results (blog, cafe or web).
3. The **NAVER Rank Lab** panel uses the most recent capture per keyword and device.
4. It tallies the observed page types and source-level recurrence across queries (including Naver blog IDs when present).
5. Within **the same keyword + same content type + different sources**, it compares article features of a higher and lower observed result:
   - presence of query words in title/headings/body,
   - captured visible body length,
   - number of captured headings/images/outbound links,
   - declared publication date when available.
6. Each feature lists observed pair counts, higher-value counts and lower-value counts and links to a few individual comparisons.
7. When a feature has **at least 8 comparable pairs across at least 3 query/device groups**, it displays an *observed directional tendency*. With insufficient data it says **표본 부족**. Thresholds are conservative UI thresholds, not calibrated statistical significance.
8. Export a local JSON and a ChatGPT evidence-based hypothesis-testing prompt.

## What cannot be concluded

- An observed correlation **does not imply causation**. It cannot tell whether text length, images, headings, keyword words or freshness caused a result's position.
- A DOM position is an estimate, not visual rank or official rank. Ads and non-document blocks may be omitted.
- Feature comparison is sample-biased: only documents you visited and successfully collected participate.
- No internal C-Rank, D.I.A., RRA value can be retrieved.
- Captured URL content may be stale or incomplete; unpublished dates are explicitly unknown, not replaced by capture time.
- Full-site topical authority is not assessed by a single saved article. Source recurrence in observed search results is a proxy for visibility only.
- This release does not automate repeated searches, crawl unvisited pages, bypass CAPTCHA, access private Naver data, or guarantee SEO outcomes.
- Any experimental change should be tracked with a control group, unchanged comparison keywords, publication date, and repeated measurements to distinguish hypotheses from noise.

## Test and install

- The test suite includes tests/rank-lab.mjs and browser dashboard tests.
- Use the Package Chrome and Edge extension GitHub Actions artifact from this feature branch; unpack and load the directory containing manifest.json into Chrome Developer mode.
- In the popup, open **Intelligence 분석 대시보드 열기**, then scroll to **NAVER Rank Lab**.
- For meaningful results collect at least 3 keyword groups and multiple competitor article pages per query; the actual needed volume may be much greater.

## Planned follow-up

- Human-confirmed visual rank markup and search-block positions (screenshot calibration).
- Manual experiment ledger: title-only, content-only, internal-link-only changes with before/after observation and explicit controls.
- Improved page extractors and source-level document inventories, without treating an undisclosed score as measurable.
