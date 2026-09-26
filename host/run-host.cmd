@echo off
rem Launch in an independent Windows terminal, not a Claude background job.
:restart
node "%~dp0supervise.mjs" %*
set "host_exit=%errorlevel%"
if "%host_exit%"=="0" exit /b 0
if "%host_exit%"=="2" exit /b 2
if "%host_exit%"=="75" exit /b 75
if "%host_exit%"=="130" exit /b 130
if "%host_exit%"=="143" exit /b 143
echo Supervisor exited with code %host_exit%; retrying in 5 seconds.
timeout /t 5 /nobreak >nul
goto restart
