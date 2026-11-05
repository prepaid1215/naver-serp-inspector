# SERP Lens 2.1: Chat-driven Naver Autopilot (beta)

## What changes

The user no longer has to open individual result articles. After initial opt-in, ChatGPT can create a **GitHub issue** in the user's designated private evidence repository. The Chrome extension checks for queued requests while Chrome is running, opens a normal Naver search in a background tab, extracts public blog/cafe candidates, opens up to 3 matched articles, and saves evidence JSON into that private repository. A completion comment on the issue lists the saved paths. ChatGPT can read the issue comment and the JSON files through its connected GitHub app if it has access.

The extension does not connect directly to ChatGPT, and it cannot guarantee a result within a chat turn. Processing starts when the running Chrome extension next polls the repository (approximately once per minute). Login/CAPTCHA restrictions are not bypassed. Only links on approved Naver blog and cafe hosts can be followed.

## One-time setup

1. Download the v2.1 extension package from a successful GitHub Actions package run and load its root manifest.json via Chrome's extensions page in Developer mode.
2. Create a separate **private** GitHub repository for evidence, with its own main branch and README. Never use the public source repository to store captured posts.
3. Create a short-lived GitHub fine-grained personal access token restricted to that one private repository, with **Contents: Read/Write** and **Issues: Read/Write**. Never paste it into this chat.
4. In the extension choose '네이버 자료 → ChatGPT 연결'. Enter the private repository and token; verify access.
5. In the new '자동 조사' section, review the permission notice and check its opt-in box. Click '네이버 자동 조사 켜기'. This creates the request label (if needed) and enables polling.
6. Ensure ChatGPT's connected GitHub app is allowed to access the same private repository.

## How to request research in this chat

Ask the assistant to create a GitHub issue in the private evidence repository. Use label **serp-lens-request** and body EXACTLY two lines:

SERP_LENS_JOB_V1
{"query":"396요금제","limit":3}

The query must be 2-70 characters. Limits are 1, 2 or 3 articles. The extension only follows https blog.naver.com, m.blog.naver.com, cafe.naver.com, m.cafe.naver.com. Nothing outside those hosts is opened automatically. Each private repository request triggers a single search and at most 3 article visits. Total limit is 8 jobs/day.

When the issue is processed, the extension adds a comment starting with SERP_LENS_JOB_RESULT_V1 and a JSON object containing its index paths and any failed article URLs, then closes the issue. The assistant reads that issue and the saved files from GitHub. If the extension is offline, disabled or the token expired, the issue remains pending.

## Security and controls

This is opt-in automation. When enabled, future valid issues in the private repository with the special label and exact versioned body can open Naver pages in the user's browser without additional per-page prompts. Turn it off at any time using '자동 조사 끄기'. The extension does not click logins, post comments or send messages on Naver. It does not bypass authentication or access limits.

Only public/visible article text from the browser is uploaded, not credentials, cookies or raw HTML. Captured text may contain personal information, so use a private repository and do not share its access tokens. Because the capture is rendered through the browser, the user may be logged in and personalized search results may differ from other users.

## Validation scope

- tests/naver-autopilot.mjs validates exact job envelope, host allowlist, browser navigation and repository evidence writing with simulated Chrome/GitHub APIs.
- All other tests from earlier SERP Lens versions remain active.
- Live Naver compatibility, token permissions, and ChatGPT reading real pending/completed issues are still unverified until one private-repo end-to-end pilot.

A GitHub issue is a request and a completed issue a report. Neither is proof of Naver's ranking logic.
