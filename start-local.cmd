@echo off
rem Git Journey из локальных клонов: repos\ → данные → браузер. Фото кладите в photos\.
cd /d "%~dp0"
python fetch_local.py %*
if errorlevel 1 pause
