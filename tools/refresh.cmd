@echo off
rem Incremental GitLab refresh for Git Journey. Unchanged repos come from the cache.
rem Register once (as the user who owns .env), every hour on weekdays 8-20:
rem   schtasks /Create /TN "Git Journey refresh" /SC HOURLY /MO 1 /ST 08:00 /DU 12:00 /TR "\"%~f0\""
rem Remove:  schtasks /Delete /TN "Git Journey refresh" /F
cd /d "%~dp0.."
python fetch_gitlab.py >> refresh.log 2>&1
