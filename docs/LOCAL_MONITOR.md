# Windows 로컬 실제 브라우저 검증

GitHub Actions의 헤드리스 수집과 별개로, 이 컴퓨터에서 **보이는 브라우저 창**(`headless=False`, 모바일 390×844 에뮬레이션)으로 12개 검색어를 검색하고 화면과 추출 결과를 대조한다.

```powershell
.\scripts\run_local_monitor.ps1              # 수집 + 검증 + 발행자 보고. 아무것도 푸시하지 않음
.\scripts\run_local_monitor.ps1 -Publish     # web/ops-data/*.json만 커밋·푸시
python -m automation.cli collect --local     # 수집만
python -m automation.cli report              # 누가 어떤 키워드로 어떤 제목을 발행할지와 이유
```

## 검증 항목 (모두 통과해야 VERIFIED)

| 항목 | 내용 |
|---|---|
| `screen_hit_test` | 카드 제목 링크 위치를 화면에 스크롤해 가장 위에 보이는 요소가 그 게시글 링크인지(가려지거나 숨겨진 카드 제외) |
| `screen_order` | 화면에서 스크롤 위치가 추출 순번대로 증가하는지 |
| `title_matches_screen` | 화면에 보이는 제목이 추출한 제목과 같은지 |
| `screenshot_size_matches` | 저장한 전체 캡처 높이가 촬영 전후 페이지 높이와 일치하는지 |
| `screenshot_crops_nonblank` | 상위 10개 카드 위치를 캡처에서 잘라 비어 있지 않은지(Pillow 필요) |
| `stable_rerun` | 캡처 후 다시 추출해도 상위 10개 URL·순서가 같은지 |
| 기본 4항목 | 카드 순서·겹침 없음·광고/AI 브리핑 제외·게시글 중복 없음 |

하나라도 실패하면 해당 검색어는 `CANDIDATE`가 되고, 변형 3개가 모두 VERIFIED가 아닌 키워드는 미노출 확정과 발행자 배정이 보류된다. 캡처는 `monitor-evidence/`에만 저장되고 `.gitignore`로 공개 저장소에서 제외된다.

## 한계

- PC의 모바일 에뮬레이션이 실제 스마트폰 화면과 같다는 보장은 없다. 이 컴퓨터의 접속 환경 기준이다.
- 화면 대조는 레이아웃·가림·제목·캡처 크기를 확인하며, 글자 인식(OCR)으로 캡처 속 글을 읽지는 않는다.
- 네이버 접근 제한이 감지되면 이후 요청을 중단한다(우회 없음).

## 자동 실행 (선택, 직접 등록)

컴퓨터가 켜져 있고 로그인된 상태여야 보이는 창이 열린다. 작업 스케줄러 등록은 사용자가 직접 한다. 예시:

```powershell
schtasks /Create /TN "SERP blog monitor 0830" /SC DAILY /ST 08:30 /TR "powershell -NoProfile -File \"<프로젝트 경로>\scripts\run_local_monitor.ps1\" -Publish"
```

10:30, 13:30도 같은 방식으로 추가한다. 클라우드 수집(`mobile-blog-monitor.yml`)도 같은 `latest.json`을 쓰므로 둘을 동시에 켜면 마지막 실행이 덮어쓴다. 로컬 수집을 주로 쓴다면 클라우드 스케줄을 끄는 것을 권한다.

## 운영 사이트로 데이터 보내기
`-Publish`는 반드시 `main` 브랜치에서 실행한다. 다른 브랜치에 데이터를 푸시해도 GitHub Pages 관제판이 갱신되지 않기 때문이다.

```powershell
git switch main
git pull --ff-only origin main
.\scripts\run_local_monitor.ps1 -Publish
```

GitHub Pages 반영까지 배포 지연이 생길 수 있다. 원본 PNG는 공개 GitHub에 올라가지 않는다.


## 기본 24개 및 연관검색어 승인

- 8개 묶음에 각 3변형, 총 24개를 기본 조사합니다.
- 네이버 모바일 검색 화면의 실제 연관검색어 영역을 식별하면 수집 결과의 related_candidates에 후보를 기록합니다. 화면에서 발견하지 못한 경우에는 빈 목록을 기록합니다.
- 관제판 최상단의 입력칸에서 검색어와 묶음을 선택하고 '추가 승인 요청'을 누르면 GitHub Issue 작성 화면이 열립니다. Submit new issue 버튼까지 눌러야 접수됩니다.
- 저장소 운영자가 Issue에 serp-approved 라벨을 붙여 승인하면 .github/workflows/approve-keyword.yml 워크플로가 config/approved-keywords.json에 해당 검색어를 등록합니다.
- 다음 PC/클라우드 조사부터 승인 검색어를 해당 묶음에 추가합니다. 모든 변형 검색어가 최신 검증을 통과해야 미노출을 확정합니다.
- 추가 검색어는 최대 24개(총 48개)까지이며, 실측 네이버 연관검색어는 등록 전까지 자동 수집하지 않습니다.
- '네이버 검색' 버튼은 즉시 네이버 모바일 검색창을 열지만 자동 추적 목록을 변경하지는 않습니다.
