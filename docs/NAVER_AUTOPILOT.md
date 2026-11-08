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

## Chrome 재시작 후 연결 유지 (선택 사항)

- 연결 화면의 **이 기기에서 연결 유지**를 직접 선택하고 비공개 저장소를 확인하면 토큰을 `chrome.storage.local`에 보관합니다. 이후 Chrome을 다시 열었을 때 백그라운드 작업이 같은 저장소에 대해 토큰을 읽습니다. 토큰을 다시 입력할 필요는 없지만 **만료되거나 GitHub에서 취소된 경우에는 재연결**해야 합니다.
- 체크하지 않으면 기존처럼 `chrome.storage.session`만 사용하며 Chrome 종료 시 재연결이 필요합니다.
- **보안 주의:** 확장프로그램의 로컬 저장소는 Chrome 동기화 대상이 아니지만, 토큰 자체를 디스크에서 암호화하지 않습니다. 로그인 프로필 또는 기기에 접근 가능한 공격자는 토큰을 읽을 수 있습니다. 개인 PC에서만 사용하고, GitHub Fine-grained PAT를 비공개 자료 저장소 하나로 제한하며 유효기간을 설정하세요.
- 사용 중지 시 **저장된 연결 지우기**를 눌러 임시 저장소와 기기 저장소의 토큰을 함께 삭제합니다. GitHub에서 토큰을 취소하면 다른 곳에 유출된 토큰도 무효화할 수 있습니다.
- Chrome 확장프로그램을 삭제하거나 브라우저 프로필을 초기화하면 저장된 자격 증명도 사라집니다. 자동 조사는 Chrome이 실행되고 확장프로그램이 활성화돼 있을 때만 수행됩니다.
- GitHub 이슈로 조사 요청을 보내는 구조는 그대로이며, 조사 완료가 이 채팅에 실시간 응답을 푸시하는 기능은 아닙니다.

## v2.4.5: AI 생성 후기 카드 묶음 후보 탐지

사용자 제공 네이버 검색화면 '제주도 맛집 내돈내산 후기'에는 블록 오른쪽 AI 생성 표시와 여러 블로그 카드, 작성시간, 본문 발췌, 태그 칩, 썸네일이 함께 보입니다.

- `ai_generated_badge`: 검색 블록 제목 근처, 링크 외부의 작은 'AI 생성' 표시를 관측. 카드 내용에 같은 단어가 있다는 이유만으로 참으로 기록하지 않습니다.
- `blocks[].cards[]`: 검색 화면에 표시된 카드 최대 8개, 출처명, 시간, 제목, 발췌문, 태그, 썸네일 존재와 alt를 저장합니다.
- `signals`: 카드 개수와 제목, 발췌, 시간, 태그, 썸네일이 표시된 카드 수를 각각 저장합니다.
- `AI_REVIEW_CLUSTER_CANDIDATE`: 블록 제목 + AI 생성 배지 + 제목·발췌가 있는 카드 2개 이상 + 제목의 후기·경험 표현 또는 경험 발췌 2개 이상을 근거로 분류합니다.
- `AI_TOPIC_CLUSTER_CANDIDATE`: AI 카드 묶음은 있으나 후기라는 근거는 부족할 때 분류합니다. 태그만 있는 것은 후기 증거가 아닙니다.
- `ugc_observation.ai_review_candidate_count`, `ai_topic_candidate_count`: 검색어별 후보 수를 보고합니다.
- **네이버 공식 UGC 블록 확정이 아닙니다.** 스크린샷과 실제 DOM 대조가 필요하며, 탐지하지 못한 경우에도 '없음'이라고 판정하지 않습니다.

기존 토큰 유지: 확장프로그램 삭제/신규 로드 대신, Chrome에서 **같은 기존 설치 폴더에 파일을 덮어쓴 후 기존 카드 새로고침**을 실행하세요. 인증 토큰을 ZIP에 포함하거나 GitHub에 올리지 마세요.

## v2.4.4: 주제별 묶음 및 경험 근거의 분리

실측 예시: `제주도 혼자 여행`에서 "제주도 혼자여행 일정 짜는 법" 아래 3개 블로그 카드와 발췌문이 발견됐으나, 제목에 "후기"라는 표현이 없었습니다. 기존 v2.4.3의 `OTHER_LABELED_BLOCK`은 이 구조를 반영하지 못했습니다.

- `TOPIC_CLUSTER_CANDIDATE`: **섹션 제목 + 서로 다른 글 링크 2개 이상 + 화면 발췌문 2개 이상**이 관측될 때의 *일반 주제별 묶음 후보*입니다. 공식 네이버 UGC 블록이라는 뜻이 아닙니다.
- `EXPERIENCE_REVIEW_CANDIDATE`: 블록 제목에 후기·경험 관련 표현이 직접 포함된 경우의 후보이며, 공식 블록명 판정이 아닙니다.
- `experience_evidence=multiple_firsthand_excerpts`: 주제 묶음 내부에서 직접 사용·방문 등을 나타내는 발췌문이 2개 이상 발견된 경우입니다. 정교한 문맥 이해가 아닌 제한적 패턴 관측입니다.
- `signals`: 게시글/발췌문 수, 주관적 경험 표현이 있는 발췌문 수, 화면의 더보기·댓글·공감 버튼 표시 여부와 태그 텍스트(최대 8개)를 **표시됐을 때만** 저장합니다. 댓글 본문이나 비공개 데이터는 읽지 않습니다.
- `ugc_observation.topic_group_state=topic_cluster_observed`: 주제별 묶음 후보를 관측했다는 뜻으로 네이버가 공지한 신설 UGC 블록의 존재를 확인했다는 뜻은 아닙니다.
- `ugc_observation.state`는 여전히 보수적으로 관리하며 검색 블록을 못 찾았다고 해서 `UGC 없음`으로 판정하지 않습니다.

실제 DOM 구조와 분류 정확도는 새로운 Chrome 빌드 설치 후 검색결과 스크린샷과 대조해야 합니다. 시각적 카드 경계가 DOM에 드러나지 않으면 일부 카드/태그를 놓칠 수 있습니다. 검색 순위를 측정하지 않습니다.

## 네이버 경험·후기형 UGC 블록 관측 (v2.4.3 베타)

SERP Lens는 검색 결과 DOM에서 확인되는 **섹션 제목, 블로그/카페 링크, 카드 요약 문구**를 함께 기록합니다.
각 검색 결과의 비공개 자료 JSON에는 `blocks`, `ugc_observation`, 그리고 게시글 행별
`block_id`, `block_kind`, `block_label`, `snippet_text`, `snippet_basis`가 포함됩니다.

- `EXPERIENCE_REVIEW_CANDIDATE`: 게시글 **제목이 아니라 검색 블록 제목**에 경험·후기·리뷰 표현이 보였을 때에만 표기하는 후보. 네이버 공식 블록 유형 판정이 아닙니다.
- `GENERAL_UGC_CANDIDATE`: 블로그·카페 등 출처를 나타내는 블록 제목이 표시된 경우.
- `OTHER_LABELED_BLOCK`: 다른 섹션 제목이 있지만 경험형으로 분류할 근거는 없는 경우.
- `UNCLASSIFIED`: 제목이나 섹션 경계를 확실히 확인하지 못한 경우.
- `ugc_observation.state=not_determined`: **UGC 블록이 없다는 뜻이 아닙니다.** 캡처 화면과 실제 DOM을 대조해야 합니다.

`snippet_text`는 검색 화면에서 직접 보이는 카드 문구 일부이며 원문 게시글 본문은 아닙니다.
UI 변경·광고·개인화로 누락 가능성이 있고, 순위나 네이버 알고리즘을 판정하지 않습니다.
수집 결과의 실제 블록 배치는 화면 캡처로 수동 검증하세요.
동시 자동 조사 중 `serp-lens/index.json`에 GitHub HTTP 409가 발생하면 최신 인덱스를 다시 읽고 병합을 재시도합니다.

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
