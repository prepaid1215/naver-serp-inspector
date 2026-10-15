# 별도 공개 GitHub 저장소 개설 절차

사용할 GitHub 계정: `prepaid1215`

1. GitHub에서 **New repository** 클릭.
2. Repository name: **`naver-serp-inspector`**.
3. Visibility: **Public**.
4. **Add a README file** 체크 후 Create repository. (기존 원격 `main`을 만들기 위해 필요)
5. 생성된 주소 **`https://github.com/prepaid1215/naver-serp-inspector`** 를 이 대화에 알려주면 ChatGPT가 연결된 GitHub 쓰기 기능으로 이 ZIP의 텍스트 프로젝트 파일을 올릴 수 있습니다. 비공개 원본 HTML/PNG는 올리지 않습니다.
6. 저장소가 완성되면 Settings → Pages → Source: **GitHub Actions** 설정.
7. Actions → **Publish GitHub Pages** → Run workflow.
8. Actions → **Build Windows desktop app** → Run workflow. 성공한 실행의 아티팩트에서 EXE 다운로드.

**이 저장소를 새로 만드는 단계는 ChatGPT의 현재 GitHub 연결 기능에 포함되지 않아 계정 소유자가 먼저 한 번 해야 합니다.**

원하는 경우 Git CLI로 직접 올리기:

```powershell
# 압축을 푼 프로젝트 폴더에서
# 이 폴더가 다른 Git 저장소 안에 들어가지 않도록 주의
 git init -b main
 git add .
 git commit -m "Initial SERP Lens app"
 git remote add origin https://github.com/prepaid1215/naver-serp-inspector.git
 git push -u origin main
```

Git CLI로 직접 배포하는 경우 GitHub에서 README 없이 빈 저장소를 만들면 됩니다. ChatGPT 연결 기능으로 업로드하는 경우에는 README를 만들어야 합니다.
