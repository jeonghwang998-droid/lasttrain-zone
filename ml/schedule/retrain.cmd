@echo off
rem 매주 실제 데이터로 다시 학습. 이전 모델과 baseline 보다 나을 때만 활성화
rem 작업 스케줄러가 실행한다 (등록: ml\schedule\register.ps1). 기록은 ml\logs\retrain.log 에 이어서 쌓인다
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist ml\logs mkdir ml\logs
set PYTHONIOENCODING=utf-8
set PYTHONUNBUFFERED=1
echo ===== %date% %time% ===== >> ml\logs\retrain.log
backend\.venv\Scripts\python.exe ml\train.py --source db --auto >> ml\logs\retrain.log 2>&1
