@echo off
chcp 65001 >nul
cd /d "%~dp0"
python tools\gen_charts.py
python tools\build_xlsx.py
python tools\build_site_data.py
python tools\enrich_xlsx_insights.py
node tools\generate_quiz.js
python tools\build_docx.py
pause
