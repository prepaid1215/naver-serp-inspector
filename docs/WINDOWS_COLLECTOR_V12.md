# Windows 자동 SERP 수집기 v1.2 개발·보안 메모

## 범위

- Windows 전용. GitHub Pages는 HTML/ZIP 로컬 분석 기능만 유지합니다.
- UI의 명시적 **SERP 수집 시작** 이후 Microsoft Edge(Playwright channel=msedge)를 실행합니다.
- PC 브라우저 및 모바일 에뮬레이션(실제 모바일 기기 아님)으로 네이버 검색 결과 페이지에만 접속합니다. 검색 결과의 외부 URL은 따라가지 않습니다.
- 검색어 10개/회, 각 검색 요청 사이 최소 6초. 요청 수 제한 준수 여부와 서비스 접근 가능 여부는 별개입니다.
- CAPTCHA/접근 제한 탐지 시 나머지 요청 중지. 우회, 프록시 회전, 브라우저 지문 변경, 자동 재시도 없음.
- HTML·전체 PNG를 KST 시각으로 지정한 이름에 로컬 보관하고 ZIP 생성. API가 반환하는 HTML은 현재 실행에서 생성한 목록으로 제한.
- WebView에 반환된 HTML은 공통 엔진 DOMParser로 분석; `web/`에는 검색 네트워크 기능이 없습니다.

## 테스트 상태

- `python -m unittest discover -s tests -p test_collector.py -v`: 가상 브라우저를 이용한 저장, 모바일 에뮬레이션 설정, CAPTCHA 중단, API 임의파일 차단 검증.
- `python tests/browser_desktop_bridge.py`: 가상 WebView API 응답으로 수집→HTML 자동 불러오기→분석 검증.
- 실제 네이버 자동 접속과 Windows EXE GUI 실행은 Windows 설치 환경에서 별도 검증이 필요합니다. GitHub CI의 EXE 빌드만으로 실행 성공을 단정하지 않습니다.

## 공개 전 점검

1. GitHub Actions Windows 빌드 성공 및 EXE 아티팩트 생성 확인.
2. 실제 Windows 10/11 + Edge에서 v1.2 EXE 실행·중지 동작 확인.
3. 네이버의 관련 이용 조건 확인. 제한 화면이 나타나면 즉시 수집 중단하고 공식 검색 도구 또는 수동 저장 방식으로 전환.
4. 수집된 HTML/PNG는 저작권·개인정보가 포함될 수 있으므로 공개 GitHub 저장소에 커밋하지 않기.
5. 수집 당시 PC·모바일 결과와 실제 스크린샷으로 블록 경계 검수. SERP Lens의 추정값은 공식 노출 순위·색인 판정이 아닙니다.
