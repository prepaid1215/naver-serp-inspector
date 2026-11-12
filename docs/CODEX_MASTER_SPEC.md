# CODEX MASTER SPEC — 네이버 모바일 블로그 발행 관제 시스템

> **최신 운영 정책 (2026-11-12 업데이트):** 아래 본문의 초창기 `블로그 영역 TOP10`, `2명씩 2팀` 설명은 설계 당시 기록입니다. 최신 확정 구현은 `INTEGRATED_FEED_BLOG_CARDS_TOP10`(네이버 모바일 통합검색에서 관측된 블로그 카드 순번)을 판단 지표로 삼고, **건호·영은·하루·수진 각각 한 건씩** 키워드/제목/추천 이유를 제시합니다. 검증이 부족한 담당자만 보류합니다. 별도 블로그 섹션 공식 순위로 표시하지 않습니다. 자세한 기준은 `automation/scheduler.py`와 `docs/CHATGPT_AUTOMATION_PROMPT.md`를 우선 적용합니다.
버전: 2026-11-12 / 상태: 구현 지시서 / 대상 저장소: `prepaid1215/naver-serp-inspector`

## 0. 이 문서의 목적
Codex가 **기존 GitHub 저장소를 이어받아** 모바일 네이버 통합검색 키워드 조사 → 블로그 실제 게시글 URL 검증 → 소유자/순위 매칭 → 4인 개별 발행 배정 → 제목 추천 → 09·11·14시 확인 → UI/알림 → 운영 검증까지 가능한 한 끝까지 구현하게 한다. 사용자에게 단순한 HTML 파일을 전달하는 것이 아니라 실제로 호스팅되는 운영 서비스를 완성한다.

**반드시 지킬 기준:**
- 추출한 모든 네이버 블로그 링크를 해당 검색어의 **블로그 영역 공식 순위**로 간주하지 않는다. 순위 근거/검색 화면 구조가 불확실하면 `CANDIDATE` 또는 `UNKNOWN`으로 둔다.
- 데이터가 없거나 네이버가 제한한 것은 **미노출이 아니다**.
- 자동 수집/실제 서비스 접근이 불가능하면 테스트 가능한 부분까지 구현하고 원인, 증거, 인간이 해야 할 한 가지 행동을 정확하게 보고한다. 캡차 우회·프록시 회전·비정상 대량 요청을 구현하지 않는다.
- 기존 저장소의 작동 중인 화면·기능을 보존하고 단계별 테스트 후 배포한다. 실측 확인 없이 '완전 자동 운영 완료'라고 말하지 않는다.

## 1. 범위와 고정 운영 정보

### 1.1 인원/블로그 — 관리자 데이터에서 수정 가능, 초기값 고정
| 담당자 | 블로그 ID |
|---|---|
| 건호 | `carrotmobile_`, `lifeon5g_` |
| 영은 | `esim99_`, `esim99`, `esim87_` |
| 하루 | `ntelecom59` |
| 수진 | `jjuny1253` |

`https://blog.naver.com/id`와 `https://m.blog.naver.com/id`는 동일 블로그다. `esim99`와 `esim99_`는 **서로 다른 ID**이고 같은 사람(영은)에게 속한다. 포스트 URL에 포함된 원 소유자 ID로 매칭한다. 프로필 링크는 게시글로 세지 않는다.

### 1.2 키워드 4개 × 변형 3개
| 대표 키워드 | 검색어 |
|---|---|
| KT바로유심 | KT바로유심 / 바로유심 / KT바로유심 개통 |
| LG모두의 원칩 | LG모두의 원칩 / 모두의 원칩 / LG원칩 개통 |
| 태블릿소유자회원번호 | 태블릿소유자회원번호 / 태블릿 소유자 회원번호 / 태블릿소유자회원번호 입력 |
| 다이소 유심 | 다이소 유심 / 다이소 선불유심 / 다이소 유심 개통 |

각 검색어 결과는 **독립적으로 순위를 기록**한다. `A 검색어 3위`를 `B 검색어 3위`로 전파하지 않는다. 대표 키워드의 확인 여부와 3개 변형 검색어 전체 확인 여부를 분리한다.

### 1.3 예약 시각(Asia/Seoul)
- 사전 수집: **08:30, 10:30, 13:30** KST. 기존 `.github/workflows/mobile-blog-monitor.yml` 참고. Github Actions cron은 정시 실행을 보장하지 않음.
- 발행 권고/리포트: **08:55, 10:55, 13:55** KST. 기존 ChatGPT 자동화 `네이버 4인 발행 키워드 배정`(ID `6af51febd6308191a5d6655dad3101d5`) 재사용. **중복 자동화 생성 금지**.
- 사용자의 발행 시각: **09:00, 11:00, 14:00**. 리포트는 실제 검색 시각 및 최신성 표시.
- 수집이 늦거나 45분 넘게 지난 자료는 `STALE` 상태로 표시하고 **현재 순위로 단정하지 않음**.

## 2. 현재 저장소 실사와 문제 정의
Codex가 시작할 때 아래 파일과 GitHub Actions 최근 결과를 먼저 읽고 실제 최신 상태를 다시 확인한다.
- `automation/mobile_monitor.py`: Playwright 기반 모바일 에뮬레이션 검색. 현재 블로그 URL 수집 및 4인 매칭.
- `automation/test_mobile_monitor.py`: 기본 매칭/배정 단위테스트.
- `.github/workflows/mobile-blog-monitor.yml`: 자동 조사.
- `web/keyword-ops.html`: 기존 관제 UI.
- `web/ops-data/latest.json` 및 `history.json`: 공개 관제용 요약 관측 데이터.
- `desktop/collector.py`, `extension/`, `web/engine.js`: 기존 SERP Lens 호환 및 수집기 참고.
- `.github/workflows/test.yml`: CI. 최근 'Validate web parser' 실패 기록이 있으므로 정확한 실패 로그 확인 후 수정.

2026-11-12 11:27 KST 스냅샷: 12개 중 11개 검색어에서 10개의 블로그 링크를 추출, `KT바로유심` 단일 검색어는 10개 미만으로 `needs_review`. 나머지 결과도 `mobile_integrated_blog_cards_visual_order` 기준인 **자동 링크 후보**로서, 사용자가 요구한 '모바일 통합검색 블로그 영역 첫 10개'와 동일하다고 아직 확인되지 않음. 현재 추천 `다이소 유심 → 영은·하루`도 **잠정 계산값**이며 검증 전 확정 배정으로 표시하지 말 것.

## 3. 도달할 사용자 경험
1. 운영자가 `https://prepaid1215.github.io/naver-serp-inspector/keyword-ops.html` 접속.
2. 별도 검색·URL 복사 없이 각 키워드별 `최근 수집시각`, `검증 수준`, `상위10 블로그 URL`, `건호/영은/하루/수진 노출 순위` 표시.
3. 검색어를 눌러 실제 네이버 모바일 검색 결과와 게시글 링크 열기.
4. 1~10위 URL 및 근거(실제 모바일 스크린샷, 게시글 URL, 섹션 이름) 상세 보기. 섹션이 없는 화면은 `통합검색 블로그 글 후보`로 별도 표시.
5. 추천 섹션: 검증된 피드 관측 근거를 바탕으로 건호·영은·하루·수진 **각자 1개 키워드·중복 없는 제목·추천 이유**를 표시. 미노출 2인 팀 구성이 불가능해도 다른 검증된 키워드에서 보강/확장 주제를 추천한다. 미검증 담당자만 보류한다.
6. 운영자가 `발행 예정`, `발행 완료`, `보류` 표시. 가능하면 해당 블로그 게시글 URL 및 시각 기록. 발행 자체는 사용자 통제(자동 Naver 발행 제외).
7. 다음 수집 때 본인 글 순위 변화 확인 및 다음 키워드 자동 재계산.
8. 데이터 부재/네이버 제한 시 `확인 실패`와 실제 오류 보여주고 과거 데이터를 최신으로 재사용하지 않음.
9. PC와 390px 모바일에 모두 편리한 관제판.

## 4. 데이터 수집/판정 아키텍처
권장: **현 저장소 안에서 순수 분석 엔진(테스트 가능)과 수집 어댑터를 분리**한다.

```text
GitHub Actions (KST 08:30 / 10:30 / 13:30)
  └─ Naver mobile integrated SERP observer (Playwright, compliant)
       ├─ query/viewport/observed_at
       ├─ rendered blog cards / article canonical URL / DOM section evidence
       ├─ screenshot audit artifact (private/restricted storage)
       └─ failure, CAPTCHA or uncertain state
             ↓
      Evidence validator + rank semantics
             ↓
     Owner matcher + historical comparator
             ↓
      per-owner publication scheduler (4 authors)
             ↓
      Versioned latest / append-only history / recommendations
             ├─ Hosted web dashboard
             └─ Existing ChatGPT scheduled publisher assignment
```

### 4.1 핵심 구분: 검색 결과의 어떤 순위인가
서로 다른 3가지 숫자를 혼동하지 않는다.
- `INTEGRATED_BLOG_SECTION_TOP10`: **모바일 통합검색에 명시적으로 식별된 블로그 영역의 게시글 1~10위**. 사용자가 원하는 최우선 지표. 명확한 섹션 경계와 실제 게시글 목록을 확인했을 때만 VERIFIED.
- `INTEGRATED_BLOG_ARTICLES_TOP10`: 전체 모바일 통합검색에 노출된 Naver 블로그 게시글만 순서대로 모은 상위 10개. 별도 블로그 섹션과 같지 않을 수 있으므로 **보조 후보 지표**이며 확정 발행 근거에 섞지 않는다.
- `BLOG_TAB_TOP10`: 네이버 별도 블로그 검색 탭 결과. 통합검색 순위와 다르므로 별도 보관하고 사용자가 요청한 기본 판단에서 제외.

네이버가 블로그 섹션을 별도로 제공하지 않는 검색어라면 `SECTION_NOT_PRESENT`를 명시하고 `INTEGRATED_BLOG_ARTICLES_TOP10`으로 **지표를 자동 대체하지 않는다**. 변경 필요 시 관리자가 정책을 선택하게 할 것.

### 4.2 유효한 관측 최소 조건
- 사용자 에이전트/뷰포트/검색 URL/수집시각 + 수집 결과 화면 캡처.
- 블로그 게시글 URL은 `blog.naver.com/<id>/<number>`, `m.blog.naver.com/<id>/<number>` 및 안전한 `PostView.naver?blogId=...&logNo=...` 형태만 수락. 프로필, 썸네일, 기사 재공유/카페, 광고, 미리보기 링크, 동일 게시글 중복 제외.
- 섹션 경계를 DOM 의미구조 및 실화면/카드 좌표와 대조. DOM 정렬만으로 `VERIFIED` 단정 금지. 별도 시각 확인(초기 골든 샘플 검수 포함).
- 페이지에 광고·카페·웹문서가 섞여도 블로그 게시글만 정확히 식별하되, **어느 영역의 블로그 링크인지** 증거로 남긴다.
- 10개를 못 얻거나 구조가 불명확하면 `PARTIAL`/`UNKNOWN`, Naver 차단 시 `BLOCKED`로 표기. 화면에 보이지 않는 게시글을 추정해 채우지 말 것.
- 요청 제한, 네이버 정책 준수; 비정상 우회 금지. GitHub Actions 환경에서 지속적 제한이 발생하면 **운영자의 브라우저 확장프로그램 또는 수동 증거 업로드 경로**를 폴백으로 구현한다. 기계가 정확히 읽지 못한 순위는 직접 검증 가능한 인터페이스 제공.

### 4.3 상태·신뢰도
`VERIFIED` = 사용자가 정의한 영역의 10개를 정확히 확인한 증거가 있는 경우.
`CANDIDATE` = 자동 블로그 링크 10개 추출, 영역/시각순서 미검증.
`PARTIAL` = 링크 10개 미만.
`BLOCKED` = 접근 제한.
`ERROR` = 기술 오류.
`STALE` = 기준보다 오래된 관측.
`NOT_FOUND` = **해당 검색어에 대해 VERIFIED 결과 10개를 확인했으나 7개 소유 블로그가 그 집합에 없는 경우에만** 사용.

단일 검색어 `VERIFIED`와 대표 키워드에 속한 3개 변형의 `VERIFIED`를 구별. 특정 작성자를 '해당 키워드 묶음 전체 미노출'이라 부르려면 세 개 모두 최신 VERIFIED여야 한다.

## 5. 소유자 매칭과 자동 배정 규칙 (테스트 가능한 순수 함수)
- 동일 사람의 복수 블로그는 하나로 묶어 배정하되, 실제 발견 게시글마다 `검색어/블로그ID/글URL/순위`를 분리 표시.
- 순위가 존재하면 그 사람은 그 검색어에서 `노출`; 집계에서 1개라도 나오면 해당 키워드 묶음에 `노출`.
- **7개 블로그 ID**를 모두 확인하고도 등장하지 않은 소유자는 `미노출`. 단 모든 변형의 결과가 VERIFIED일 때만 판정 가능.
- 관련 검색어 3개가 모두 최신 VERIFIED라면 미노출자가 1명이어도 그 사람에게 해당 키워드를 추천할 수 있다. 같은 키워드로 복수 담당자가 배정될 수 있으나 각 사람에게는 1개씩만 추천한다.
- 노출 유지 시 이미 노출 중인 사람에게 같은 검색 의도 반복 발행을 권하지 않고, 다른 미노출 담당자 또는 다음 키워드로 이동.
- 이전 VERIFIED와 현재 VERIFIED 두 스냅샷을 비교하여 10위권 이탈 탐지; 현재 미검증인 경우 순위 하락으로 단정하지 않음. 일시 변동 시 '관측된 이탈'을 표시하고 재확인 우선권 지정.
- 건호·영은·하루·수진 각각 1개씩 총 4개 발행 추천. 2인 팀이 되지 않아도 모두에게 적합한 키워드를 찾고, 최신 검증 자료가 전혀 없을 때만 해당 담당자의 추천을 보류한다. 담당자 중복 배정 금지.
- 09/11/14시 시점마다 별도 추천/이력. 단순 동일 제목 복제 방지: 같은 사람·최근 발행 URL·직전 제목을 조회하여 제목 중복 제외. 추천 텍스트는 운영자가 수정 가능.
- 결정 우선순위: 3개 변형 모두 미노출 > 최고 관측 순번 8~10위 보강 > 일부 변형 검색어 미노출·하위권 > 최고 4~7위 보강 > 상위권이면 다른 검색 의도로 확장. 동률이면 최근 추천 반복과 같은 키워드 과밀을 줄이고 결정적으로 정렬한다.
- 추천은 **'제안'**이며 포스팅으로 확정하지 않음. 관리자 확인·발행 완료 기록이 별도로 존재해야 함.

## 6. 추천 제목과 GPT 역할
- 1차 자동 배정은 테스트 가능한 코드/명시적 규칙으로 수행(LLM에만 의존 금지).
- GPT는 **검증된 검색 결과 요약 및 사용자의 실제 발행 이력**을 입력받아 담당자별 중복되지 않는 콘텐츠 의도/제목/주요 소제목을 작성.
- 키워드마다 작성자 2명에게 서로 다른 검색 의도 제공. 제목에 자연스럽게 키워드 포함, 과장/허위 개통 약속 금지.
- 제목에 없는 가격/서비스 변경을 임의 사실로 단정하지 않음. 불확실하면 제목만 추천하거나 확인 필요 표시.
- AI API 키가 없다면 기존 ChatGPT 예약 작업이 GitHub 데이터를 읽어 보고하도록 유지. API 키 없이 서버에서 GPT가 직접 작동한다고 주장하지 않는다.
- 서버 기반 OpenAI API 호출을 추가하는 경우에만 운영자 승인 후 환경변수/Secret으로 보호, GitHub Pages 클라이언트에 키 삽입 금지.

## 7. 파일·저장 방식과 보안
권장 개편 파일(기존 파일 재사용 가능):
```
automation/
  collector.py            # I/O 어댑터(Playwright/확장프로그램 관측)
  extractor.py            # 섹션/URL 후보 추출
  verify.py               # 영역·증거 검증 / VERIFIED 정책
  owners.py               # blog ID → 담당자
  scheduler.py            # 2명씩 추천, 순위 이탈, 전환, 중복 방지
  models.py               # JSON 스키마 검증 및 버전
  cli.py                  # collect / validate / recommend / replay
  test_*.py
web/
  keyword-ops.html        # 현 UI 개선, 데이터 최신성/근거/추천/이력
  ops-data/
    latest.json
    history.json
docs/
  CODEX_MASTER_SPEC.md
.github/workflows/
  mobile-blog-monitor.yml
  test.yml
```
실행할 때 오래된 `mobile_monitor.py`에 모든 기능을 무작정 덧붙이지 말고 핵심 파서와 배정 순수 함수를 분리한다.

### 7.1 스키마 예시(정확한 구현에 맞게 버전 관리)
```json
{
  "schema": "naver-blog-ops-v2",
  "run_id": "2026-11-12T10:30:00+09:00",
  "captured_at_kst": "2026-11-12T10:31:12+09:00",
  "query": "KT바로유심",
  "surface": "INTEGRATED_BLOG_SECTION_TOP10",
  "status": "VERIFIED",
  "evidence": {
    "source_url": "https://m.search.naver.com/search.naver?query=...",
    "viewport": "390x844",
    "screenshot_sha256": "...",
    "verification_method": "section_boundaries_and_visual_order"
  },
  "results": [
    {
      "rank": 3,
      "post_url": "https://blog.naver.com/esim99_/224000000000",
      "blog_id": "esim99_",
      "owner": "영은"
    }
  ]
}
```
위 예시의 순위·게시글 URL은 **샘플**이며 실제 관측값이 아니다.

- 결과는 시간순 append-only 스냅샷(고유 run id)으로 관리하고 latest는 최근 스냅샷의 인덱스/요약만 제공.
- 공용 GitHub Pages에는 공개 블로그 URL 및 요약 통계만 제공. 쿠키, 계정 정보, 브라우저 세션, 원본 검색 HTML 및 전체 스크린샷 등을 공개 `web/`에 커밋하지 않는다.
- GitHub Actions 공개 저장소 artifact에 남는 캡처의 노출 위험을 검토하여 필요 시 **private 저장소** 또는 비공개 스토리지로 이전. 보존기간 최소화. 사용자 제공 자료에 민감정보가 있으면 제거.
- 예약 작업의 `git push` 경합 해소(작업 직후 원격 변경 재조회, 보존, 재시도); 히스토리 덮어쓰기로 서로 다른 실행 내역 소실 방지.
- 수집 중간 실패도 실패 이유/진행률을 남김. 마지막 성공 자료를 오늘의 자료로 위장하지 않는다.

## 8. 관리 화면 요구사항
모바일 퍼스트(390px) 및 데스크톱. 별도 로컬 HTML 다운로드 강요하지 말 것.
- 요약: 마지막 관측시각, 성공/검증/미확인 검색어 수, 신규 이탈, 확정/보류 팀 수.
- 핵심키워드 카드: `KT바로유심` 등 4개, 변형 3개, 작성자 4명에 대해 최신 확정 순위·수집 기준·링크.
- 4인 개별 추천 카드: 담당자 이름, 키워드 1개, 제목 1개, 개인별 추천 이유. 원시 검색 근거는 접힌 고급 메뉴에 보관한다.
- 이력/필터: 시간(09·11·14), 작성자, 키워드, 날짜, 검색어, 변형, 상태.
- 관측 증거 표시: VERIFIED/CANDIDATE 구분, 결과 기반/캡처 링크, 오류 사유.
- 수동 검증·폴백 UI: 불확실할 때 운영자가 네이버 모바일에서 확인한 **10개 게시글 URL/검색어/시간/영역 타입**을 입력하여 승인 가능. 승인은 감사 이력으로 남고 다음 자동 수집과 명확히 구분.
- 모바일 390px에서 가로 스크롤 없이 읽을 수 있어야 함. 무의미한 '자동 검색 중' 표시 금지.
- 공용 정적 사이트에서 편집 기능을 구현하려면 안전한 저장/로그인 백엔드 필요. 없으면 **읽기 전용으로 표시하고 저장 버튼 비활성화**. `localStorage`는 개인 로컬 캐시에만 사용하고 전체 팀 공유 데이터처럼 보이지 않게 함.

## 9. 배포 운영
- 기본은 기존 GitHub Actions(수집) + GitHub Pages(읽기 전용 관제판) 유지. 변경 비용 최소화.
- 다중 사용자 쓰기/수동 승인/발행 기록 공유가 요구되는 경우에만 선택한 백엔드(Supabase/Cloudflare Worker 등)를 추가하고 인증/권한/비용 제시. 동의 없이 외부 서비스 생성·유료 결제·API 토큰 요구하지 말 것.
- 08:30/10:30/13:30 예약 실행 및 수동 `workflow_dispatch` 테스트.
- 08:55/10:55/13:55 ChatGPT 자동화는 중복 생성하지 말고, 기존 작업이 최신 요약을 읽도록 안내/필요 시 업데이트.
- 수집 12개가 늘 실패하면 호출량을 기계적으로 늘리지 말고 화면 규칙/실행 환경을 진단. 캡차/접근 제한이면 사용자 브라우저 기반 보조 수집으로 전환.
- 배포 전 해당 GitHub Pages URL, 실행/작업 로그, 주요 시나리오 스크린샷으로 확인.

## 10. Codex 구현 순서(P0~P5)
**P0: 감사**
- GitHub 최신 main과 Actions 상태 확인, 최근 실패 로그 확보.
- 현재 `latest.json` 11/12 수집은 후보 지표이며 verified로 승격하지 말 것.
- 기존 CI `Validate web parser` 실패 원인 식별. 현재 코드와 사이트/확장프로그램 간 결합 확인.

**P1: 수집 검증 강화**
- `INTEGRATED_BLOG_SECTION_TOP10`와 `INTEGRATED_BLOG_ARTICLES_TOP10`를 분리 저장.
- 실제 모바일 화면 캡처와 HTML을 맞춰 섹션 경계/순서/진짜 게시글 링크 검증.
- 실패/부분/차단/기간 경과 상태 처리, 정확도 측정용 골든 샘플(익명화 가능한 구조) 추가.

**P2: 배정 엔진**
- 정확한 URL 정규화, 다중블로그 동일 소유자, 3개 변형 독립 집계, 미노출/이탈 오판 방지.
- 담당자 4명 각 1개 키워드·제목. 미노출/노출 보강/검색 의도 확장에 따른 우선순위, 중복 방지, 결정적 재실행.
- 결과 리포트 JSON 스키마와 호환성 문서.

**P3: 관제 UX**
- 4개 키워드·7개 블로그·각 변형의 노출과 근거를 볼 수 있게 수정.
- 4인 개별 배정·제목·추천 이유·발행 기록 및 완료상태. 백엔드 없는 경우 읽기 전용.
- 수동 검증 폴백 제공, 화면 반응형 테스트.

**P4: 자동 실행 및 GPT 연결**
- GitHub Actions 재시도/중복실행/히스토리 무결성 개선, 예약 시간 점검.
- 기존 ChatGPT 자동화 연계. 요약에 입력한 실제 `captured_at`, VERIFIED 여부 및 배정 상태 필수.
- AI 제목 추천이 불가능하면 규칙기반 제목 초안을 분명히 표시.

**P5: 완료 검증 및 인수**
- 자동화 테스트/실제 샘플/모바일 UI/Actions/배포 확인.
- 운영 안내 문서 및 장애 대응·재실행 절차 정리.
- PR 생성/CI 확인 → 가능한 경우 병합/배포(저장소 권한과 요구 승인 준수). 불가능하면 PR 및 남은 승인 한 가지 명시.

## 11. 수용 테스트 — Codex 완료 기준
아래 테스트를 **실행 및 통과**시켜야 '완료'로 보고한다.

1. `esim99_`·`esim99`·`esim87_`는 영은으로 매칭. `carrotmobile_`·`lifeon5g_`는 건호.
2. 포스트 URL만 매칭. `https://blog.naver.com/esim99_` 프로필 링크는 노출 아님.
3. 예시: `KT바로유심` 검증 순위 영은 3위·하루 7위, 건호·수진 10위 밖 → **건호+수진 추천**, 다른 검색 의도 제목 2개.
4. 키워드 A=영은·하루 노출, 키워드 B=건호·수진 노출 → A에 건호·수진, B에 영은·하루 배정. 중복 없음.
5. 한 변형 `UNKNOWN`이면 해당 대표 키워드의 **미노출 확정 금지**.
6. 통합검색 블로그 링크 10개를 찾았지만 블로그 영역 10개인지 미검증이면 **CANDIDATE**. VERIFIED로 표시/배정하지 않음.
7. 광고/카페/블로그 프로필/동일 게시글 중복 필터링.
8. 이전 스냅샷이 VERIFIED이고 현재 UNKNOWN이면 순위 하락으로 처리하지 않는다.
9. 이전 VERIFIED 4위에서 현재 VERIFIED 10위권 밖으로 바뀌었을 때만 이탈 표시.
10. 동시 GitHub push, 실패 작업, 재시도에서도 히스토리가 유실되거나 중복 확정되지 않는다.
11. `BLOCKED` 후 자동 검색 요청 중단, 캡차 우회 없음.
12. 45분 이상 오래된 결과는 STALE과 수집시각 표기.
13. 390px 모바일 및 PC에서 요약, 상세, 추천, 결과 링크 확인.
14. 공개 GitHub Pages/Artifacts에 쿠키·계정·세션 토큰 및 민감 검색 HTML 노출 없음.
15. 기존 `npm test`, Python tests, 브라우저 UI 스모크 테스트 및 GitHub Actions의 **전체 CI 성공**.
16. 실제 검색 결과로 샘플 **최소 4개 키워드×1개 검색어**를 수동 시각 검증하고 블로그 영역 순위 일치 여부 기록. 12개 전부 자동 VERIFIED가 구조적으로 불가능하면 이를 숨기지 않고 정확히 보고.
17. 실측 불가능한 상황에서도 관리 페이지는 정상 로드되며 `미확인`과 재시도/증거 제출 경로가 보임.
18. 운영자는 검색 결과를 매번 직접 붙여넣지 않아도, 성공한 관측의 최신 결과와 다음 배정을 읽을 수 있음.

## 12. Codex 최종 보고 포맷
1. 수행 완료/부분완료/미완료 표
2. 최근 실측 12개 검색어의 `VERIFIED/CANDIDATE/PARTIAL/BLOCKED` 수와 시각
3. 실제 사용자 블로그 7개에 대한 확정 순위(검증된 것만), 나머지 '확인 불가'
4. 추천 발행자/키워드/제목 및 근거(확정 자료가 없으면 배정 보류)
5. GitHub 브랜치/PR/커밋 링크, CI 빌드와 호스팅 URL
6. 비용 및 운영자 수동 작업 유무
7. 실패 원인과 다음 기술 조치(불확실하면 단정하지 말 것)

## 13. Codex에 주는 최상위 작업 지시
**You are the implementation owner for this repository task.** Read this spec and current code, work through P0–P5 without stopping after scaffolding, keep the original SERP Lens working, verify every claim with tests and real output, and only declare completion after meeting the acceptance tests. Do not ask the user to paste SERP URLs repeatedly. If verification is not technically possible, provide a working bounded fallback and explicitly state the exact limitation. Respect policies and existing GitHub permissions. Do not make deceptive current-rank claims.
