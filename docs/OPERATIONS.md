# 4인 블로그 관제 운영 안내

## 매일 보는 화면

운영 URL: `https://prepaid1215.github.io/naver-serp-inspector/keyword-ops.html`

1. `최신 VERIFIED 검색어`와 `45분 경과`를 먼저 확인한다.
2. 발행 제안이 있으면 근거 상태가 모두 `VERIFIED`인지 확인한다.
3. 작성자별 제목은 `규칙 기반 초안`이다. 사실·가격·서비스 조건을 추가하기 전에 운영자가 확인한다.
4. 화면의 발행 상태 버튼은 공유 백엔드가 없으므로 읽기 전용이다. 자동 네이버 발행은 하지 않는다.

## 자동 수집

GitHub Actions `Mobile blog SERP monitor`가 KST 08:30, 10:30, 13:30 예약으로 실행된다. GitHub 예약은 지연될 수 있다. 수동 재실행은 Actions 화면의 `Run workflow`를 사용한다.

수집기는 다음 정책을 지킨다.

- 390×844 Android Chrome 에뮬레이션을 사용한다.
- 검색 사이에 6초 간격을 둔다.
- 접근 제한 또는 CAPTCHA가 보이면 전체 실행의 후속 검색 요청을 중단한다.
- 통합검색의 블로그 게시글 후보와 블로그 영역 후보를 별도로 기록한다.
- 캡처 업로드는 저장소 변수 `UPLOAD_SERP_EVIDENCE=true`를 명시한 경우에만 3일 보존 아티팩트로 올린다. 기본값은 업로드하지 않음이다.
- 원본 HTML은 Actions 아티팩트나 Pages에 올리지 않는다.

## 수동 시각 검증 폴백

자동 관측이 `CANDIDATE`, `PARTIAL`, `UNKNOWN`이면 미노출 또는 순위 하락으로 확정하지 않는다.

1. 관제판 아래 `수동 시각 검증 자료 만들기`에서 검색어, 실제 모바일 검색 URL, 블로그 영역 게시글 10개, 전체 화면 캡처, 검수자와 시각을 입력한다.
2. 내려받은 JSON과 캡처가 같은 화면인지 다시 확인한다.
3. 저장소 체크아웃에서 다음 명령을 실행한다.

```powershell
python -m automation.cli manual-verify --evidence C:\path\to\naver-blog-evidence.json
python -m automation.cli validate --input web\ops-data\latest.json
python -m unittest discover -s automation -p "test_*.py" -v
```

4. 변경된 `latest.json`과 `history.json`을 리뷰한 뒤 PR로 반영한다. JSON 파일은 공개 블로그 URL과 검수자 식별값을 포함하므로 공개 가능한 값만 사용한다. 캡처 원본은 커밋하지 않는다.

## 장애 대응

| 상태 | 의미 | 조치 |
|---|---|---|
| `BLOCKED` | 접근 제한 감지 | 요청을 늘리지 말고 다음 예약까지 대기. 필요하면 사용자 브라우저에서 1회 수동 검증 |
| `ERROR` | 브라우저·네트워크·코드 오류 | Actions 로그 확인 후 1회 수동 재실행. 반복되면 Playwright/Naver 마크업 진단 |
| `PARTIAL` | 게시글 10개 미만 | 실제 영역이 10개 미만인지 캡처로 확인. 빈 순위를 추정해 채우지 않음 |
| `UNKNOWN` | 영역 부재 또는 불명확 | 후보 순서로 대체하지 않고 수동 검증 또는 다음 수집 대기 |
| `STALE` | 45분 경과 | 현재 순위로 사용하지 않고 수동 재실행 |

## ChatGPT 예약 보고

기존 `네이버 4인 발행 키워드 배정` 작업을 재사용한다. 새 작업을 만들지 않는다. 보고 작업은 `latest.json`의 `captured_at_kst`, 검색어별 `INTEGRATED_FEED_BLOG_CARDS_TOP10`의 `status`, `recommendation.status`를 먼저 확인해야 한다.

- `VERIFIED`가 아닌 관측을 확정 순위로 표현하지 않는다.
- `recommendation.status=PENDING`이면 담당자를 임의 배정하지 않는다.
- `RULE_BASED_DRAFT` 제목은 GPT가 수정할 수 있지만, 검증 자료에 없는 가격·혜택·개통 보장은 추가하지 않는다.
- 보고 시각은 08:55, 10:55, 13:55 KST이고 발행 자체는 운영자가 결정한다.

OpenAI API 키는 필요하지 않다. 서버 측 GPT 호출은 구현하지 않았으며 클라이언트 코드에 키를 넣지 않는다.



## 2026-11-12 운영 정책 변경: 4인 개별 발행

기존 2인 팀 매칭 조건은 폐지했다. 매 수집마다 `recommendation.assignments`의 `people`, `titles`, `owner_reasons`를 사용하여 **건호·영은·하루·수진 각 1건**의 발행 주제를 추천한다. 3개 변형 검색어가 모두 최신 `VERIFIED`인 키워드만 사용한다. 미노출 우선, 8~10번째 노출 보강, 일부 변형 검색어 미노출, 4~7번째 노출 보강, 상위권의 다른 검색 의도 확장 순서다. 자료가 부족한 담당자만 배정 보류한다. 기존 예약 작업은 같은 일정으로 4인 보고를 출력한다.
