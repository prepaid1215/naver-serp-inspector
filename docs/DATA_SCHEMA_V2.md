# 네이버 블로그 관제 데이터 스키마 v2

공개 관제 데이터는 `web/ops-data/latest.json`과 `history.json`에 저장한다. 원본 HTML, 쿠키, 브라우저 세션과 전체 캡처는 이 경로에 저장하지 않는다.

## 순위 표면

| `surface` | 의미 | 자동 배정 사용 |
|---|---|---|
| `INTEGRATED_BLOG_SECTION_TOP10` | 모바일 통합검색에서 명시적으로 확인한 블로그 영역의 게시글 1~10위 | 최신 `VERIFIED`만 사용 |
| `INTEGRATED_BLOG_ARTICLES_TOP10` | 모바일 통합검색 전체에서 발견한 네이버 블로그 게시글 화면 순서 후보 | 사용하지 않음 |
| `BLOG_TAB_TOP10` | 별도 블로그 탭 | 기본 정책에서 사용하지 않음 |

한 검색어의 표면은 `queries.<검색어>.surfaces.<surface>`에 독립적으로 저장한다. 한 표면의 순위를 다른 표면이나 변형 검색어에 전파하지 않는다.

## 상태

- `VERIFIED`: 게시글 URL 10개, 영역명, 전체 화면 캡처 SHA-256, 검수자, 시각 검수 방법이 모두 있는 블로그 영역 관측.
- `CANDIDATE`: 게시글 10개를 자동 추출했지만 영역 또는 화면 순서를 독립 검수하지 않음.
- `PARTIAL`: 유효한 게시글이 10개 미만.
- `BLOCKED`: 접근 제한 또는 CAPTCHA. 이후 요청을 중단한다.
- `ERROR`: 기술 오류.
- `UNKNOWN`: 블로그 영역 부재 또는 구조 불명확.
- `STALE`: 저장 상태를 바꾸지 않는 화면 표시 상태. 관측 후 45분이 지났을 때 계산한다.
- `NOT_FOUND`: 최신 `VERIFIED` 10개 안에 7개 운영 블로그가 없을 때만 파생 판정에 사용할 수 있다.

## VERIFIED 게이트

`automation.models.validate_observation()`은 다음 조건을 모두 강제한다.

1. 표면이 `INTEGRATED_BLOG_SECTION_TOP10`이다.
2. 서로 다른 실제 네이버 블로그 게시글 10개가 1~10위로 순차 저장되어 있다.
3. `verification_method`가 `human_visual_review` 또는 승인된 골든 샘플이다.
4. `section_name`, `screenshot_sha256`, `reviewed_by`가 있다.

자동 수집기는 이 게이트를 통과시키지 않는다. 자동으로 찾은 완전한 영역도 우선 `CANDIDATE`이며, 운영자가 캡처와 화면 순서를 검수한 후에만 `automation.cli manual-verify`로 승격한다.

## latest.json 핵심 구조

```json
{
  "schema": "naver-blog-ops-v2",
  "run_id": "20261112T103012+0900-mobile",
  "captured_at_kst": "2026-11-12T10:31:12+09:00",
  "freshness_minutes": 45,
  "queries": {
    "KT바로유심": {
      "query": "KT바로유심",
      "surfaces": {
        "INTEGRATED_BLOG_SECTION_TOP10": {
          "surface": "INTEGRATED_BLOG_SECTION_TOP10",
          "status": "CANDIDATE",
          "observed_at": "2026-11-12T10:31:12+09:00",
          "evidence": {
            "source_url": "https://m.search.naver.com/search.naver?...",
            "viewport": "390x844",
            "screenshot_sha256": "...",
            "verification_method": "automated_section_candidate"
          },
          "results": []
        }
      }
    }
  },
  "groups": {},
  "recommendation": {}
}
```

## 이력 무결성

`history.json`은 `naver-blog-ops-history-v2` 객체와 `entries` 배열을 사용한다. 각 항목은 `run_id`로 중복 제거한다. Actions가 원격 변경 후 재시도할 때 `automation.cli merge-history`가 원격 이력과 방금 관측한 이력을 합치므로, 다른 실행의 항목을 덮어쓰지 않는다.

