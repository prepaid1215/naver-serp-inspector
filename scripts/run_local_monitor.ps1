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

python -m automation.cli collect --local
python -m automation.cli validate --input web/ops-data/latest.json
python -m automation.cli report

if ($Publish) {
    # Commits only the two data files to the CURRENT branch; screenshots are git-ignored.
    git add web/ops-data/latest.json web/ops-data/history.json
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        git commit -m "data: local headed mobile blog observation"
        git pull --rebase origin (git branch --show-current)
        git push origin HEAD
    }
}
