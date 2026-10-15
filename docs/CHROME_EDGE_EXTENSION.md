# SERP Lens v1.3 — Chrome / Edge 확장 프로그램

## 무엇을 하나요?

사용자가 **직접 네이버 통합검색 결과 페이지를 열고** 확장 프로그램을 클릭하면,
현재 탭의 DOM HTML과 **현재 보이는 화면에 한정된** PNG 1장을 브라우저 내부 IndexedDB에 저장합니다.
그다음 내장된 SERP Lens 웹 분석기에서 같은 JavaScript 엔진으로 자동 분석합니다.
네이버 검색 자동 반복, 페이지 이동, 스크롤 자동화, CAPTCHA 우회는 포함하지 않습니다.

## 설치 (Chrome)

1. GitHub Actions → **Package Chrome and Edge extension** → 성공한 작업의
   `SERP-Lens-Chrome-Edge-Extension` 아티팩트를 내려받아 압축을 해제합니다.
   또는 저장소를 ZIP으로 받은 뒤 `extension/`과 `web/`을 포함하여 직접 구성합니다.
2. 압축을 해제한 뒤 **`manifest.json`이 보이는 폴더**를 확인합니다.
3. 주소창에 `chrome://extensions` 입력 → 오른쪽 위 **개발자 모드** ON.
4. **압축해제된 확장 프로그램을 로드** → 위 폴더를 선택합니다.
5. 확장 프로그램을 툴바에 고정합니다.

## 설치 (Microsoft Edge)

`edge://extensions` → 개발자 모드 ON → **압축 해제된 확장 로드**에서 같은 폴더를 선택합니다.

## 사용

1. Chrome 또는 Edge에서 **직접** `선불폰 개통`을 네이버 검색합니다.
2. `https://search.naver.com/search.naver?...` 또는
   `https://m.search.naver.com/search.naver?...` 탭이 열린 상태에서 SERP Lens 아이콘을 누릅니다.
3. **현재 화면 수집하고 분석하기**를 클릭합니다.
4. 새 탭에서 SERP Lens가 자동으로 HTML·PNG를 불러오고 블록별 추정 순위를 계산합니다.
5. 비교할 사이트를 **대상 도메인**에 입력하고 **오프라인 분석 시작**을 다시 누르면
   해당 도메인의 등장 여부가 표시됩니다.
6. `원본 HTML ↓` 및 `화면 PNG ↓`로 저장하거나, CSV/JSON으로 결과를 내보냅니다.

## 중요한 제한

- PNG는 **보이는 화면(viewport)만** 캡처합니다. 전체 페이지 PNG라고 오해하면 안 됩니다.
- HTML은 클릭한 순간 DOM으로 만들어진 내용을 저장하므로, 화면 아래 미로딩 결과는 빠질 수 있습니다.
- 블록 순서·유형은 HTML 기반 **추정**입니다. 실제 화면과 대조하고 검증 여부를 표시하세요.
- PC에서 모바일 검색 페이지를 열면 URL 호스트 기준으로 `mo` 분류합니다. 실제 스마트폰과 검색결과가 다를 수 있습니다.
- 원본은 브라우저 확장 프로그램 IndexedDB에 저장되며 **다음 수집 때 덮어써집니다.**
  파일로 보관하려면 다음 수집 전에 다운로드하세요. 확장 프로그램을 삭제하면 기록도 사라집니다.
- 저장 화면이 개인 계정으로 로그인된 상태라면 개인정보가 포함될 수 있습니다.
  GitHub에 HTML·PNG를 올리지 마세요.
- 권한은 `activeTab` 및 `scripting`뿐이고, 모든 사이트에 대한 상시 접근 권한을 요청하지 않습니다.
- 네이버 접근 제한·CAPTCHA를 우회하지 않습니다. 네이버 서비스 이용 조건을 준수해야 합니다.

## 배포

압축 해제 개발자 설치용 베타입니다. Chrome Web Store / Edge Add-ons 심사·등록은 하지 않았습니다.
Windows EXE 및 GitHub Pages 버전은 그대로 유지합니다.
