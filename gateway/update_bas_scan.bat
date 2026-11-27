@echo off
REM Clubhouse IQ BAS scanner quick update.
REM Replaces ciq_bas_scan.py only. Keeps bas_scan.json and the saved point
REM names (bas_scan_cache.json), runs one values pass, restarts the task.
net session 1>NUL 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "SRC=%~dp0"
set "GW=C:\ClubhouseIQ\Gateway"
set "PY=%GW%\venv\Scripts\python.exe"
set "RES=%SRC%results"
set "TASK=Clubhouse IQ BAS Scan"
if not exist "%RES%" mkdir "%RES%"
set "OUT=%RES%\bas_scan_update.txt"
echo BAS scanner update %date% %time% > "%OUT%"

schtasks /End /TN "%TASK%" >> "%OUT%" 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*ciq_bas_scan.py*' } | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }" >> "%OUT%" 2>&1
timeout /t 2 /nobreak 1>NUL

copy /y "%GW%\ciq_bas_scan.py" "%GW%\ciq_bas_scan.prev.py" 1>NUL
copy /y "%SRC%ciq_bas_scan.py" "%GW%\ciq_bas_scan.py" >> "%OUT%" 2>&1

echo  Reading values from the BAS and sending them to Clubhouse IQ (a few minutes)...
pushd "%GW%"
"%PY%" -I ciq_bas_scan.py test --send > "%RES%\bas_scan_test.txt" 2>&1
echo test exit %errorlevel% >> "%OUT%"
popd

schtasks /Change /TN "%TASK%" /ENABLE >> "%OUT%" 2>&1
schtasks /Run /TN "%TASK%" >> "%OUT%" 2>&1
echo done >> "%OUT%"
type "%RES%\bas_scan_test.txt" | findstr /i "Devices found Sent Send failed"
echo.
echo Done. You can close this window.
