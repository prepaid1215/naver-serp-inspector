# SERP Lens v2.3 — Naver as a supplementary ChatGPT source

## Primary purpose

Use the user's authorized running Chrome + private GitHub queue to supplement ordinary ChatGPT web research with public Naver Blog/Cafe content. This is a **source retrieval bridge**, not a Naver rank predictor, algorithm reverse-engineering tool or native ChatGPT plugin.

## Chat usage

Example: “공식 웹사이트 자료와 네이버 블로그·카페 글을 같이 확인해서 KT 바로유심 개통방법을 정리해 줘.”

The assistant may create a private GitHub issue:

```text
SERP_LENS_JOB_V1
{"query":"KT 바로유심 개통","limit":6}
```

Label: `serp-lens-request`. A user must explicitly enable the extension and keep Chrome running with a valid session-only token. Requests are polled approximately every 30 seconds but can be delayed by Chrome/browser scheduling. No background work is promised by ChatGPT.

The extension reads Naver search DOM links and selects eligible individual posts from Blog and Cafe. Where both source types occur, selection alternates by type. For inaccessible articles it tries the next eligible candidate until the requested number is collected or the bounded candidate pool is exhausted. Max **6 successful articles**, max **12 candidate visits**, max **8 jobs per day**. Does not bypass login, robots access checks or CAPTCHA.

The result comment includes `article_summaries`, `captured_sources`, `attempted_articles`, `failed_articles`, and saved JSON `paths` in the private repository. The assistant reads the saved JSON and gives a cited synthesis, keeping official sources and third-party claims distinct.

## Reliability and limits

- `search_candidates` represents DOM links, NOT actual Naver position or organic ranking; links can include author profiles, duplicates and other context.
- `search_article_links` records eligible link candidates by type (not a deduplicated or exhaustive count).
- `captured_articles` is actual successful extraction, `requested_articles` is the target, `attempted_articles` counts attempted post visits.
- Raw text (`text`) is preserved; `clean_text` is lightly normalized. A Naver link preview may still be mixed into either; `embedded_link_preview_count` and `extraction_warnings` flag this uncertainty.
- OCR for text baked into images is not performed. `headings` are observed DOM headings or *candidate* labels, not guaranteed heading hierarchy.
- An article's original completeness cannot be verified from the DOM extraction alone.
- GitHub repository and token are user-scoped. Never paste a token into a chat, an issue or an artifact.
- The assistant should not claim that browser retrieval is instant, that all post text was collected or that source observations establish SEO ranking causality.

## Release notes relative to v2.2.1

- Increase user-authorized per-request article limit from 3 to 6.
- Mix Blog/Cafe results for broader coverage when both are present.
- Retry alternate eligible articles when an article fails.
- Include accurate requested / attempted / captured counts and source mix in the completion comment.
- Recognize emoji-numbered section markers as candidate headings and flag embedded link previews.

## Testing and rollout

The GitHub PR CI must pass Node autopilot tests and Chromium UI tests before recommending install. This branch is stacked on `feat/bridge-ui-redesign-v221`. Existing installations do not auto-update; users must install the validated extension ZIP.