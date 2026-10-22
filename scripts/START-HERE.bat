@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ============================================================
echo   Kone 1.4.38 - Clean Machine Evidence Collector
echo ============================================================
echo.
echo  This only READS this PC's basic facts and checks the
echo  installer fingerprint. It changes NOTHING on this PC.
echo  It does not need admin rights. About 10 seconds.
echo.
echo  Running...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0clean-machine-collect.ps1" -InstallerPath "%~dp0Kone-Intellect-Setup-1.4.38.exe" -IncludeLogs
set "RC=%ERRORLEVEL%"

echo.
echo ------------------------------------------------------------
if "%RC%"=="0" echo   RESULT: OK - fingerprint matches. Continue.
if "%RC%"=="2" echo   RESULT: FINGERPRINT MISMATCH - STOP and report.
if "%RC%"=="9" echo   RESULT: COLLECTOR ERROR - send this screen to the dev.
if not "%RC%"=="0" if not "%RC%"=="2" if not "%RC%"=="9" echo   RESULT: unexpected (exit code %RC%)
echo ------------------------------------------------------------
echo.
echo   A folder named kone-evidence-1.4.38-... was just created
echo   in this same directory. Send that whole folder back.
echo.
pause
