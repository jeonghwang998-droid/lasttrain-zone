@echo off
rem 매일 밤 실제 열차 도착·출발 기록 수집 (21:00~01:30, 끝나면 저절로 닫힌다)
rem 작업 스케줄러가 실행한다 (등록: ml\schedule\register.ps1). 기록은 ml\logs\collect.log 에 이어서 쌓인다
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist ml\logs mkdir ml\logs
set PYTHONIOENCODING=utf-8
set PYTHONUNBUFFERED=1
echo ===== %date% %time% ===== >> ml\logs\collect.log
backend\.venv\Scripts\python.exe ml\collect.py >> ml\logs\collect.log 2>&1
