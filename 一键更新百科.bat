@echo off
chcp 65001 >nul
rem Nu Jiu Encyclopedia auto-updater (ASCII-only batch launcher)
cd /d "%~dp0"
set PY=C:\Users\Aigooz\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
if not exist "%PY%" set PY=python
echo ============================================
echo   Nu Jiu Encyclopedia Updater
echo   [1] Full auto update (needs Cookie in config.ini)
echo   [2] Ingest subtitles from inbox folder (SubBatch)
echo   [3] Show current status
echo ============================================
set /p choice=Select (1/2/3):
if "%choice%"=="1" "%PY%" tools\update.py run
if "%choice%"=="2" "%PY%" tools\update.py ingest
if "%choice%"=="3" "%PY%" tools\update.py status
echo.
echo [GitHub sync] Pushing changes...
git add -A 2>nul
git diff --cached --quiet 2>nul || (
    for /f "tokens=2 delims==" %%%%I in ('wmic os get localdatetime /value 2^^^>nul') do set dt=%%%%I
    git commit -m "Auto sync %%dt:~0,4%%-%%dt:~4,2%%-%%dt:~6,2%%" --quiet 2>nul
    git push origin master --quiet 2>nul
    if not errorlevel 1 (
        echo GitHub synced.
    ) else (
        echo GitHub push failed (offline?^).
    )
)
echo.
pause
