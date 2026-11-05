# SERP Lens ChatGPT Bridge beta

## Workflow

Open a Naver search page and capture it with SERP Lens. Open individual public blog/cafe pages and click the article capture control. In the extension choose "네이버 자료 → ChatGPT 연결", select entries, inspect the preview, verify a separate PRIVATE GitHub repository, then explicitly approve and upload the selection.

The remote record index is serp-lens/index.json. In a ChatGPT conversation with access to this repository through the GitHub connector, ask to read the index and fetch its listed records. Only records selected and approved for upload can be retrieved.

## Privacy

Uploading never happens automatically. Public repositories are rejected. Authentication credentials are held only in extension session storage and are not included in exported JSON. Raw HTML, cookies, and screenshots are not uploaded.

## Limitations

Only user-opened pages are captured. This version does not let ChatGPT trigger new Naver searches or crawl arbitrary articles. Live Naver DOM extraction, real private repository permissions, and ChatGPT GitHub connector access all still need real-world verification. Offline Chromium and mocked GitHub API tests are separate from such live verification.
