@echo off
rem Install daily 10:00 scheduled task for Nu Jiu Encyclopedia auto-update
set PY=C:\Users\Aigooz\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
if not exist "%PY%" set PY=python
schtasks /Create /TN "NuJiuEncyclopediaAutoUpdate" /TR "\"%PY%\" \"%~dp0tools\update.py\" run" /SC DAILY /ST 10:00 /F
if %errorlevel%==0 (
  echo Scheduled task created: daily 10:00.
) else (
  echo Failed. Right-click this file and choose "Run as administrator".
)
pause
