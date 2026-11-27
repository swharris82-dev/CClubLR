@echo off
setlocal EnableExtensions
REM ============================================================
REM  Clubhouse IQ BAS scanner installer
REM  Put this file and ciq_bas_scan.py in C:\ClubhouseIQ\update
REM  and double-click it. Click Yes when Windows asks.
REM  It installs the scanner next to the plant gateway, runs one
REM  test scan, sends it to the app, and starts the background
REM  task "Clubhouse IQ BAS Scan". The plant gateway is not touched.
REM ============================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "SRC=%~dp0"
set "GW=C:\ClubhouseIQ\Gateway"
set "RES=%SRC%results"
set "PY=%GW%\venv\Scripts\python.exe"
set "PYW=%GW%\venv\Scripts\pythonw.exe"
set "TASK=Clubhouse IQ BAS Scan"
if not exist "%RES%" mkdir "%RES%"
set "OUT=%RES%\bas_scan_install.txt"

echo Clubhouse IQ BAS scanner install %date% %time% > "%OUT%"
echo.
echo  Installing the Clubhouse IQ BAS scanner...
echo.

if not exist "%SRC%ciq_bas_scan.py" (
  echo  ciq_bas_scan.py is missing from %SRC%
  echo ciq_bas_scan.py missing >> "%OUT%"
  goto :end
)
if not exist "%PY%" (
  echo  The plant gateway's Python was not found at %PY%
  echo  Install the plant gateway first.
  echo gateway venv missing >> "%OUT%"
  goto :end
)

REM stop an older scanner before replacing it
schtasks /End /TN "%TASK%" >nul 2>&1
timeout /t 2 /nobreak >nul

if exist "%GW%\ciq_bas_scan.py" copy /y "%GW%\ciq_bas_scan.py" "%GW%\ciq_bas_scan.prev.py" >nul
copy /y "%SRC%ciq_bas_scan.py" "%GW%\ciq_bas_scan.py" >nul
if exist "%GW%\bas_scan.json" copy /y "%GW%\bas_scan.json" "%GW%\bas_scan.prev.json" >nul
if exist "%SRC%bas_scan.json" copy /y "%SRC%bas_scan.json" "%GW%\bas_scan.json" >nul
REM forget the old discovery so new settings take effect now
if exist "%GW%\bas_scan_cache.json" del /q "%GW%\bas_scan_cache.json"
echo copied files >> "%OUT%"

echo  Finding BAS controllers and reading their points.
echo  This first scan can take 5 to 15 minutes. Leave this window open.
echo.
pushd "%GW%"
"%PY%" -I ciq_bas_scan.py test --send > "%RES%\bas_scan_test.txt" 2>&1
set "RC=%errorlevel%"
popd
type "%RES%\bas_scan_test.txt"
echo test exit %RC% >> "%OUT%"

schtasks /Create /F /TN "%TASK%" /SC ONSTART /DELAY 0002:00 /RU SYSTEM /RL HIGHEST ^
  /TR "\"%PYW%\" \"%GW%\ciq_bas_scan.py\" run" >> "%OUT%" 2>&1
schtasks /Run /TN "%TASK%" >> "%OUT%" 2>&1
echo task created and started >> "%OUT%"

echo.
echo  Done. The scanner now runs in the background every 5 minutes.
echo  Results: %RES%\bas_scan_test.txt
echo  Log:     %GW%\bas_scan.log

:end
echo.
pause
