@echo off
setlocal EnableExtensions
REM ============================================================
REM  Clubhouse IQ BAS control installer
REM  Put this file and ciq_bas_control.py in C:\ClubhouseIQ\update
REM  and double-click it. Click Yes when Windows asks.
REM  It installs the control program next to the plant gateway,
REM  reads every control point once (writes nothing), and starts the
REM  background task "Clubhouse IQ BAS Control". Writes only happen
REM  after remote control is turned on in the app. The plant gateway
REM  and the BAS scanner are not touched.
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
set "TASK=Clubhouse IQ BAS Control"
if not exist "%RES%" mkdir "%RES%"
set "OUT=%RES%\bas_control_install.txt"

echo Clubhouse IQ BAS control install %date% %time% > "%OUT%"
echo.
echo  Installing the Clubhouse IQ BAS control program...
echo.

if not exist "%SRC%ciq_bas_control.py" (
  echo  ciq_bas_control.py is missing from %SRC%
  echo ciq_bas_control.py missing >> "%OUT%"
  goto :end
)
if not exist "%PY%" (
  echo  The plant gateway's Python was not found at %PY%
  echo  Install the plant gateway first.
  echo gateway venv missing >> "%OUT%"
  goto :end
)

REM stop an older control program before replacing it
schtasks /End /TN "%TASK%" >nul 2>&1
timeout /t 2 /nobreak >nul

if exist "%GW%\ciq_bas_control.py" copy /y "%GW%\ciq_bas_control.py" "%GW%\ciq_bas_control.prev.py" >nul
copy /y "%SRC%ciq_bas_control.py" "%GW%\ciq_bas_control.py" >nul
if exist "%SRC%bas_control.json" if not exist "%GW%\bas_control.json" copy /y "%SRC%bas_control.json" "%GW%\bas_control.json" >nul
echo copied files >> "%OUT%"

echo  Reading each control point once. Nothing is written.
echo.
pushd "%GW%"
"%PY%" -I ciq_bas_control.py test --port 47814 > "%RES%\bas_control_test.txt" 2>&1
set "RC=%errorlevel%"
popd
type "%RES%\bas_control_test.txt"
echo test exit %RC% >> "%OUT%"

schtasks /Create /F /TN "%TASK%" /SC ONSTART /DELAY 0003:00 /RU SYSTEM /RL HIGHEST ^
  /TR "\"%PYW%\" \"%GW%\ciq_bas_control.py\" run" >> "%OUT%" 2>&1
schtasks /Run /TN "%TASK%" >> "%OUT%" 2>&1
echo task created and started >> "%OUT%"

echo.
echo  Done. The control program now checks the app every 10 seconds.
echo  To stop all writes, set "allow_writes": false in %GW%\bas_control.json
echo  and restart the task (or turn remote control off in the app).
echo  Results: %RES%\bas_control_test.txt
echo  Log:     %GW%\bas_control.log

:end
echo.
pause
