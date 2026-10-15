# SERP Lens — 오프라인 네이버 검색결과 분석기

**Windows 앱 + 웹사이트가 하나의 JavaScript 분석 엔진을 사용합니다.** 네이버 검색을 자동 실행하거나 우회하지 않습니다. 사용자가 직접 저장한 HTML, PNG, ZIP을 자신의 기기에서 분석해 블록별 등장 URL, 카페/블로그/웹사이트 구분, 타깃 도메인의 발견 여부를 확인합니다.

> **비공식 오픈소스 프로그램**입니다. 네이버와 무관하며 결과의 정확도, 실시간 순위, 색인을 보장하지 않습니다. HTML만으로 실제 화면 블록 순서가 재현되지 않을 수 있어 PNG 캡처와 반드시 비교해야 합니다.

## 기능

- 다중 HTML 파일, `.zip` 압축파일, PNG 스크린샷 불러오기
- 이전 진단기의 파일명(`001_pc_선불폰_개통.html`, `002_mobile_...html`) 지원
- 새 파일명(`20261015-1430_pc_선불폰 개통.html`) 지원
- 네이버 검색 결과 HTML에서 블록 후보 추출: WEB, BLOG, CAFE, KIN, NEWS, VIDEO, CLIP, AD, UNCLASSIFIED
- 타깃 도메인 여러 개 입력, 도메인 발견 횟수 집계
- 블록 번호와 블록 내부 문서 순위를 분리 표시, 블록별 CSV 내보내기 (**실제 섹션명은 미표시·추정으로 구분**)
- 10개 결과 유형별 요약, CSV 및 JSON 저장
- 파일별 SHA-256 저장, 캡처 확인 표시
- 웹/Windows 공용 `web/engine.js` 분석 엔진
- **100% 클라이언트 처리**: HTML·PNG·ZIP 파일을 외부 서버로 전송하지 않음

## 웹사이트 버전 사용

1. GitHub 저장소의 **Settings → Pages → Build and deployment → Source = GitHub Actions** 선택.
2. `.github/workflows/pages.yml` 작업을 실행해 `web/` 정적 파일을 Pages에 게시합니다.
3. 사이트 `https://<GitHub 사용자명>.github.io/<저장소명>/`에 접속합니다.
4. 직접 저장한 검색결과 HTML 또는 ZIP을 선택합니다. 대상 도메인을 입력하고 **오프라인 분석 시작**을 누릅니다.
5. PNG 파일도 선택했다면 해당 화면을 대조하고, CSV를 내려받습니다.

Windows에서 소스 파일을 즉시 사용하려면 Python 3 설치 후 저장소 최상위 `RUN_WINDOWS_BROWSER.bat`를 더블클릭하세요. 설치형 UI 없이 기본 브라우저에서 로컬 앱이 열립니다. 실행 중인 명령창에서 `Ctrl+C`로 종료합니다.

또는 `web/` 폴더를 localhost 정적 서버에서 열 수 있습니다:

```bash
python -m http.server 8000 --directory web
# http://127.0.0.1:8000
```

**주의:** `file://`에서 ES 모듈을 직접 열면 일부 브라우저가 차단합니다. 반드시 정적 서버 또는 GitHub Pages로 열어 주세요.

## Windows 앱 사용

1. GitHub Actions의 **Build Windows desktop app**에서 `workflow_dispatch`로 빌드를 실행합니다.
2. 완료된 실행 기록에서 `SERP-Lens-Windows` 아티팩트를 받습니다.
3. 압축을 풀고 `SERP-Lens.exe`를 실행합니다.
4. Windows WebView2 런타임이 설치되어 있어야 합니다(Windows 11 및 최신 Edge 환경에서 대체로 기본 제공).

개발 모드로 실행:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-desktop.txt
python desktop/launcher.py
```

Windows 실행파일은 `web/`을 포함한 `PyInstaller --onefile --windowed` 구성으로 Actions에서 만듭니다. **해당 빌드는 Windows CI에서 실제 실행 테스트를 추가하기 전까지 베타로 취급하세요.**

## 파일 준비 방법

네이버 검색 사이트에서 사용자가 직접 브라우저 검색을 완료하고 HTML 및 PNG 캡처를 저장합니다. 자동 검색 스크립트나 캡차 우회는 포함하지 않습니다.

샘플 파일명: `20261015-1430_pc_선불폰 개통.html`, `20261015-1430_pc_선불폰 개통.png`.

| 입력 | 결과 |
|---|---|
| HTML | 가능한 검색 카드 추출, 블록/문서 순서 **잠정 분석** |
| ZIP | 브라우저 지원 시 내부 HTML을 개별 분석 (압축 데이터 제한 적용) |
| PNG | 같은 이름의 HTML과 매칭되면 화면 대조용으로만 표시. ZIP 내부 PNG도 인식. OCR 없음 |
| 외부 링크 | 오직 사용자가 URL을 클릭했을 때 새 탭으로 열림 |

외부 다운로드되는 파일이나 개인 데이터가 포함된 검색 화면을 이 공개 저장소에 올리지 마세요. `serp_raw/`, `private-serp-evidence/` 등은 `.gitignore`로 제외했지만, 다른 이름의 파일도 업로드 전에 직접 확인해야 합니다.

## 정확도와 알려진 제한

- 네이버 마크업이 바뀌면 일부 카드 누락, 광고 오인식, 뉴스 분류 오류가 발생할 수 있습니다.
- HTML/스크린샷의 시각적 순서와 DOM 순서는 다를 수 있습니다. **블록별 CSV는 DOM 기반 추정이며, 네이버가 표시하지 않는 섹션명을 생성하지 않습니다.**
- 블로그·카페 프로필 링크와 실제 게시글 URL을 구분하나 완전하지 않습니다.
- `naver.me` 같은 단축 URL은 외부 요청으로 확인하지 않고 제외합니다.
- 일부 ZIP은 브라우저에서 `DecompressionStream('deflate-raw')` 지원이 없을 수 있습니다. 이 경우 압축을 풀어 HTML 파일을 선택하세요.
- 수집 당시의 HTML만 분석합니다. **현재 순위, 수집/색인 상태, 전환 성과는 판단할 수 없습니다.**
- 저작권과 개인정보를 고려해 공개 저장소에는 실제 검색결과 원본을 포함하지 않습니다. `tests/fixtures/`는 가공된 가상 샘플입니다.

## 개발·검증

```bash
npm test                 # JavaScript 구문 검사, ZIP 로더 오프라인 테스트
python tests/browser_in_memory.py   # Chromium/Playwright 설치된 환경에서 브라우저 기능 검증
```

`web/engine.js`만 브라우저 DOMParser API에 의존하며, 외부 npm/CDN 라이브러리를 사용하지 않습니다. Windows GUI 프레임워크는 Python `pywebview`이고, 실제 결과 분석은 공통 JavaScript 엔진이 수행합니다.

## 다음 개선 목표

- 10개 키워드 × PC/모바일 원본과 캡처의 실제 순위를 기준으로 분류 정확도 시험 및 회귀 테스트 확대
- 검색 카드 제목, 블록 유형과 화면 순서 비교용 수동 검수 UI 강화
- ZIP로부터 원본 파일명 및 캡처 매핑 기능 강화
- Windows 패키징 CI의 GUI 스모크 테스트

## 개인정보 · 보안 · 라이선스

- 검색 화면 데이터는 서버에 전송되지 않습니다. 사이트 호스팅업체는 일반 페이지 접속 기록을 남길 수 있습니다.
- CSP `connect-src 'none'` 설정으로 웹앱의 네트워크 호출을 제한합니다. 도구에 분석 추적 스크립트와 외부 폰트/CDN이 없습니다.
- 분석 전 파일 크기 및 ZIP 해제 크기를 제한합니다.
- MIT License. 네이버/제3자 상표와 콘텐츠의 권리는 각 권리자에게 있습니다.
