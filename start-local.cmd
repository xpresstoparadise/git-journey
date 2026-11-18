@echo off
rem Life Way из локальных клонов: repos\ → данные → браузер. Фото кладите в photos\.
cd /d "%~dp0"
python fetch_local.py %*
if errorlevel 1 pause
