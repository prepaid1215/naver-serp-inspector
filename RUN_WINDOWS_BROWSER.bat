@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 desktop\browser_fallback.py
) else (
    python desktop\browser_fallback.py
)
if errorlevel 1 pause
