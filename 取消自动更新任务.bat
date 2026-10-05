@echo off
rem Remove the Nu Jiu Encyclopedia scheduled task
schtasks /Delete /TN "NuJiuEncyclopediaAutoUpdate" /F
echo Scheduled task removed.
pause
