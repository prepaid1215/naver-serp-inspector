# P0–P5 수용 검증 기록 — 2026-11-12

기준 문서: `docs/CODEX_MASTER_SPEC.md` 11절. 이 문서는 실측·테스트 결과를 과장 없이 기록한다.

## 단계별 상태

| 단계 | 상태 | 근거 |
|---|---|---|
| P0 저장소·오류 감사 | 완료 | 최신 main의 Actions 실패 단계 확인. `tests/browser_extension.py`가 CSP에서 금지한 문자열 `wait_for_function`을 사용한 것이 재현 원인. locator assertion으로 수정 |
| P1 수집 검증 강화 | 완료(검증 순위 0건) | 두 표면 분리, 보수적 검증 게이트, 실제 모바일 12개 수집과 캡처 완료. 명시적 블로그 영역은 12개 모두 확인되지 않아 `UNKNOWN` 유지 |
| P2 배정 엔진 | 완료 | 7개 ID·4인 매칭, 3변형 독립 판정, VERIFIED 이탈, 2인×2팀, 중복 방지, 제목 초안 테스트 |
| P3 관제 UX | 완료(읽기 전용) | v2 실데이터 연결, 390px 무가로스크롤 브라우저 테스트, 상세 근거·후보·이력·수동 증거 JSON. 공유 백엔드가 없어 발행 상태 저장은 명시적으로 비활성화 |
| P4 예약·GPT 연결 | 부분 완료 | Actions 스케줄·재시도·이력 병합 구현. 기존 ChatGPT 예약 작업을 조회하고 중복 생성하지 않음. 갱신용 지속 프롬프트는 문서화했으나 기존 작업 설정은 안전하게 읽어오지 못해 자동 변경하지 않음 |
| P5 통합 검증·배포 | 로컬 완료 / 원격 대기 | 전체 로컬 테스트 통과. PR·원격 CI·Pages 재배포는 브랜치 푸시 후 기록 갱신 필요 |

## 실제 모바일 관측

- run id: `20261112T123945+0900-mobile`
- 수집 완료: `2026-11-12T12:42:28+09:00`
- 기기: Playwright Chromium, Android Chrome 사용자 에이전트, 390×844, KST
- 접근 제한/기술 오류: 0
- 블로그 영역 표면: `UNKNOWN` 12, `VERIFIED` 0, `CANDIDATE` 0, `PARTIAL` 0, `BLOCKED` 0, `ERROR` 0
- 통합검색 블로그 글 후보 표면: `CANDIDATE` 12(각 10개)
- 자동 배정: `PENDING`, 0팀

대표 키워드의 기본 검색어 4개(`KT바로유심`, `LG모두의 원칩`, `태블릿소유자회원번호`, `다이소 유심`) 전체 화면 캡처를 직접 대조했다. 각 화면에는 네이버 블로그 게시글 카드가 통합검색 흐름에 나타났지만, 게시글 10개의 시작·끝을 정의할 명시적 `블로그` 영역 제목과 경계를 확인하지 못했다. 그러므로 통합검색 블로그 글 후보 순서와 사용자가 요구한 블로그 영역 순위가 같다고 승인하지 않았다.

캡처 원본은 로컬 `monitor-evidence/2026-11-12_123945/`에만 있고 `.gitignore`로 공개 커밋에서 제외한다. 공개 JSON에는 캡처 SHA-256과 구조화된 요약만 포함한다.

## 7개 운영 블로그의 확정 순위

`INTEGRATED_BLOG_SECTION_TOP10`의 VERIFIED 검색어가 0개이므로, `carrotmobile_`, `lifeon5g_`, `esim99_`, `esim99`, `esim87_`, `ntelecom59`, `jjuny1253`의 확정 순위는 모두 **확인 불가**다. 후보 글 순서에서 발견된 위치를 확정 순위로 보고하지 않는다.

## 수용 테스트 18개

| # | 결과 | 검증 |
|---:|---|---|
| 1 | 통과 | 7개 ID의 4인 매칭 단위 테스트 |
| 2 | 통과 | 프로필·유사 호스트 제외, PostView 게시글 허용 |
| 3 | 통과 | 영은 3위·하루 7위 합성 VERIFIED → 건호+수진, 서로 다른 의도·제목 |
| 4 | 통과 | 키워드 A/B에서 두 팀, 4인 중복 없음 |
| 5 | 통과 | 변형 하나 UNKNOWN이면 owner state 전부 UNKNOWN, 배정 없음 |
| 6 | 통과 | 통합검색 글 10개는 CANDIDATE, 블로그 영역은 UNKNOWN |
| 7 | 통과 | 광고·카페·프로필·동일 게시글 중복 제외 |
| 8 | 통과 | 이전 VERIFIED + 현재 UNKNOWN은 이탈 없음 |
| 9 | 통과 | 이전 VERIFIED 4위 + 현재 VERIFIED 미노출만 이탈 |
| 10 | 통과 | run id 기준 동시 이력 합집합·재시도 중복 제거 |
| 11 | 통과 | BLOCKED 표면 결과 비움, 수집 루프는 후속 요청 중단 분기 사용 |
| 12 | 통과 | 45분 초과 STALE, 45분 이하는 원 상태 유지 |
| 13 | 통과 | 390×844 관제판 `scrollWidth == clientWidth`, 핵심 정보·링크 확인 |
| 14 | 통과 | 원본 HTML·쿠키·세션 미저장, 캡처 기본 업로드 꺼짐, 비밀 패턴 검색 결과 없음 |
| 15 | 로컬 통과 | `npm test`, Python 17개, 브라우저 스모크 5개. 원격 CI는 PR 후 확인 |
| 16 | 통과(VERIFIED 0) | 실제 대표 검색어 4개 시각 대조. 별도 블로그 영역 불확실 사실을 기록 |
| 17 | 통과 | UNKNOWN 실데이터에서도 관제판 로드, 보류·수동 증거 경로 표시 |
| 18 | 통과(배정 보류) | 최신 자동 관측 12개와 후보를 매번 붙여넣지 않고 읽음. 검증 근거 부족 시 배정은 보류 |

## 로컬 실행 결과

```text
npm test: PASS
python -m unittest discover -s automation -p "test_*.py" -v: 13 PASS
python -m unittest discover -s tests -p "test_collector.py" -v: 4 PASS
browser_in_memory.py: PASS
browser_desktop_bridge.py: PASS
browser_extension.py: PASS
browser_fds_2026.py: PASS
browser_keyword_ops.py: PASS (390/390px)
automation.cli validate: VALID, section UNKNOWN 12
```

## 남은 운영 조건

1. 기존 ChatGPT 예약 작업의 지침을 `docs/CHATGPT_AUTOMATION_PROMPT.md` 내용으로 갱신한다. 새 작업은 만들지 않는다.
2. 실제 블로그 영역이 명시되는 화면 또는 사용자가 정의한 대체 정책이 확보되기 전에는 자동 배정을 운영 확정으로 사용하지 않는다.
3. 팀 공유 발행 완료 이력이 필요하면 인증 가능한 저장 백엔드를 별도 승인 후 추가한다. 현재 Pages는 의도적으로 읽기 전용이며 추가 비용은 없다.

