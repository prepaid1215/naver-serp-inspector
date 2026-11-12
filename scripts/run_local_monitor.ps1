<#
Windows local headed monitor: opens a visible browser, searches the 12 queries on
Naver mobile, cross-checks extraction against the screen and a full-page screenshot,
and prints the publisher report. Screenshots stay in monitor-evidence\ (git-ignored).

  .\scripts\run_local_monitor.ps1            # collect + validate + report, nothing is pushed
  .\scripts\run_local_monitor.ps1 -Publish   # also commit/push ONLY web/ops-data/*.json to the current branch
#>
param(
    [switch]$Publish
)
$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
Set-Location (Split-Path -Parent $PSScriptRoot)

if ($Publish) {
    # Publishing JSON to a feature branch would not update the live site.
    $branch = (git branch --show-current).Trim()
    if ($branch -ne "main") {
        throw "공개 관제판에 반영하려면 먼저 main 브랜치로 전환하세요: git switch main"
    }
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw "main 최신화에 실패했습니다. 로컬 작업 상태를 확인하세요." }
}

python -m automation.cli collect --local
python -m automation.cli validate --input web/ops-data/latest.json
python -m automation.cli report

if ($Publish) {
    # Commits only the two data files to the CURRENT branch; screenshots are git-ignored.
    git add web/ops-data/latest.json web/ops-data/history.json
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        git commit -m "data: local headed mobile blog observation"
        git pull --rebase origin main
        git push origin main
    }
}
