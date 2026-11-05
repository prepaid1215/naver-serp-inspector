# SERP Lens v2.2 — Chat-first research on ChatGPT Plus

## Goal

The user writes their desired NAVER search phrase in an ordinary ChatGPT conversation. The assistant, using an already-connected GitHub app, creates a labeled research issue in the user's private evidence repository. While Chrome is running and Naver Autopilot remains enabled, the extension opens the NAVER search results, visits up to three public Blog/Cafe article links, and uploads each captured page as JSON. The extension comments on the original issue with the result paths and **compact article metadata** so ChatGPT can fetch and analyze the exact evidence.

There is NO requirement to configure a custom MCP server or upgrade to Business. This is a bridge through the existing GitHub connector, not a new first-party ChatGPT plugin.

## What changed from v2.1.2

- Reduce browser queue check interval from 60 seconds to 30 seconds (Chrome may delay alarms; this is not a guaranteed completion time).
- Include title, source URL, source kind, raw/clean body lengths, headings, image count, completeness warning and exact JSON path for each captured article in the issue result comment.
- Scope processed issue numbers to the specific private repository.
- Prevent rerunning an issue if a completion comment was already posted before Chrome restarted. This also avoids duplicate document uploads during recovery.
- Keep the original raw and cleaned text in each evidence document for factual/structural comparisons.

## How to ask in ChatGPT

Say, for example:

"네이버에서 396요금제 검색하고 SERP Lens로 공개 블로그·카페 글 3개를 조사해 제목과 본문 근거를 비교해 줘."

Assistant workflow:
1. Create a private GitHub Issue with label serp-lens-request, body exactly:
   SERP_LENS_JOB_V1
   {"query":"396요금제","limit":3}
2. Read the result comment on that specific issue when available.
3. If the issue has not been processed, say that it is pending, instead of claiming an automatic follow-up or an immediately completed result.
4. If result status is completed/partial, fetch each listed serp-lens/pages/... JSON, compare the clean_text, text, headings and warnings, and answer with concrete source links. If there is no article result, report that accurately.
5. Do not treat search_candidates as confirmed rank; DOM anchor candidates and visual result order differ.
6. Keep Chrome open and automatic investigation enabled. The assistant cannot reach the local browser when Chrome is not running.

## Constraints

- GitHub private repository, explicit opt-in, session-only fine-grained token and allowlisted Naver hosts remain mandatory.
- No login/CAPTCHA bypass, no arbitrary external URLs, no user-uploaded file exfiltration.
- 3 articles per request and 8 requests per day remain the default safety/volume limits.
- Actual original article completeness is NOT verified; the extraction audit marks this.
- Raw search may include irrelevant page anchors; keyword relevance and visual rank must still be checked.
- ChatGPT cannot spontaneously insert a new message later in the same turn if the browser processes the issue after its reply. Another chat turn or an explicit scheduled task is needed to continue from pending evidence.

## Test coverage

- Offline simulated browser flow confirms the queue issue, 30-second alarm configuration, article metadata summaries and private JSON paths.
- A simulated restart after a result comment was written must not resubmit the same NAVER search.
- Existing Chromium tests for SmartEditor body and structural fidelity are retained.
- A real-world test of the v2.2 build is still required; earlier v2.1.2 search and article capture had been demonstrated separately.
