@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   怒九百科 - GitHub 同步
echo ========================================
cd /d "%~dp0"

echo.
echo [1/3] 检查变更...
git status --porcelain >nul 2>&1
if %errorlevel% neq 0 (
    echo 没有需要同步的变更。
    pause
    exit /b 0
)

echo.
echo [2/3] 提交变更...
git add -A
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set dt=%%I
set msg=Auto sync %dt:~0,4%-%dt:~4,2%-%dt:~6,2% %dt:~8,2%:%dt:~10,2%
git commit -m "%msg%" --quiet 2>nul
if %errorlevel% neq 0 (
    echo 没有新变更需要提交。
    pause
    exit /b 0
)

echo.
echo [3/3] 推送到 GitHub...
git push origin master 2>&1
if %errorlevel% equ 0 (
    echo.
    echo 同步完成！
) else (
    echo.
    echo 推送失败，请检查网络连接。
)
pause
