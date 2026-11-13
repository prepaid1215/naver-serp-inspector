# Vercel 관제판에서 네이버 새 검색 실행

Vercel 사이트: https://59man-serp-v1-download.vercel.app/
GitHub workflow: https://github.com/prepaid1215/naver-serp-inspector/actions/workflows/mobile-blog-monitor.yml

## 준비

1. GitHub의 Fine-grained personal access token 페이지(https://github.com/settings/personal-access-tokens/new)를 엽니다.
2. Resource owner는 **prepaid1215**, repository access는 **Only select repositories** → **naver-serp-inspector** 하나만 선택합니다.
3. Repository permissions에서 **Actions → Read and write**를 지정합니다. 가능하면 짧은 만료 기간을 설정합니다.
4. 토큰은 **GitHub와 Vercel 설정 화면 밖으로 복사해서 공유하지 않습니다.** 대화/Issue/커밋에 붙여넣지 않습니다.
5. Vercel → haru's projects → 59man-serp-v1-download → Settings → Environment Variables에 다음을 **Production** 대상으로 저장합니다.
   - `SERP_GITHUB_TOKEN`: GitHub에서 만든 Fine-grained PAT (Sensitive/Encrypted)
   - `SERP_RUN_SECRET`: 직접 생성한 서로 다른 랜덤 문자 24자 이상의 **관리자 실행 코드** (Sensitive/Encrypted)
6. 환경변수는 이미 배포된 함수에 소급 적용되지 않으므로 **프로젝트를 Production으로 다시 배포**합니다.
7. 관제판의 "네이버 새 검색 실행"에서 관리자 코드를 입력하고 실행합니다. 성공하면 "요청 접수"이며 수집 완료는 아닙니다.
8. GitHub 실행 기록 링크에서 수집 상태를 확인합니다. 최신 결과 확인 버튼은 수집 실행과 관계없이 이미 저장된 JSON을 다시 읽습니다.

## 보안
- 토큰/관리자 코드는 HTML이나 클라이언트 JS에 두지 않습니다.
- 운영자 입력 코드는 브라우저 저장소나 URL에 남기지 않고, 제출 후 바로 입력란을 비웁니다.
- Vercel 함수는 정확히 `prepaid1215/naver-serp-inspector`의 `mobile-blog-monitor.yml`을 `main`에서만 실행합니다.
- 공개 GitHub Pages 사이트에서는 관리자 버튼 대신 Vercel 관제판으로 연결합니다.
- 요청은 동일 출처 JSON POST + 24자 이상 비밀 코드 검증 후 처리합니다.
- 기존 작업이 진행 중이면 중복 요청을 거부합니다. 여러 서버 인스턴스가 동시에 요청할 경우 중복 가능성이 완전히 0은 아닙니다.
- 서버에서 GITHUB_ACTIONS_TOKEN 대신 정확한 `SERP_GITHUB_TOKEN`을 사용하며, 토큰은 어떤 응답에도 포함하지 않습니다.
- GitHub Action 자체의 concurrency 그룹으로 겹치는 수집을 직렬화합니다.

## 제한
- GitHub의 예약 실행은 지연·누락될 수 있습니다.
- 수집 결과의 신선도는 관제판에서 45분 기준으로 판단합니다.
- Vercel 환경변수가 없다면 버튼을 비활성화합니다. 설치가 끝났다고 실제 GitHub 실행이 되는 것은 아닙니다.
