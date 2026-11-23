@echo off
rem Clubhouse IQ gateway tools. Needs administrator rights (the settings file is locked to admins).
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d C:\ClubhouseIQ\Gateway
set PY=C:\ClubhouseIQ\Gateway\venv\Scripts\python.exe
:menu
cls
echo  Clubhouse IQ plant gateway
echo  ---------------------------
echo   1  Test: read every point once (sends nothing)
echo   2  Test and send one reading to Clubhouse IQ
echo   3  Find BACnet devices on the network
echo   4  Find points in a device (to fill in config.json)
echo   5  Show the last 40 log lines
echo   6  Edit settings (config.json), then restart
echo   7  Restart the gateway
echo   8  Stop the gateway
echo   0  Exit
echo.
set /p c=Choose: 
if "%c%"=="1" ( schtasks /End /TN "Clubhouse IQ Gateway" >nul 2>&1 & "%PY%" ciq_gateway.py test & schtasks /Run /TN "Clubhouse IQ Gateway" >nul & pause & goto menu )
if "%c%"=="2" ( schtasks /End /TN "Clubhouse IQ Gateway" >nul 2>&1 & "%PY%" ciq_gateway.py test --send & schtasks /Run /TN "Clubhouse IQ Gateway" >nul & pause & goto menu )
if "%c%"=="3" ( schtasks /End /TN "Clubhouse IQ Gateway" >nul 2>&1 & "%PY%" ciq_gateway.py discover & schtasks /Run /TN "Clubhouse IQ Gateway" >nul & pause & goto menu )
if "%c%"=="4" ( set /p d=Device number, like 120: & set /p w=Words to match, like chw,cond,walk ^(blank for all^): & goto find )
if "%c%"=="5" ( powershell -NoProfile -Command "Get-Content gateway.log -Tail 40" & pause & goto menu )
if "%c%"=="6" ( notepad config.json & schtasks /End /TN "Clubhouse IQ Gateway" >nul 2>&1 & schtasks /Run /TN "Clubhouse IQ Gateway" >nul & echo Restarted. & pause & goto menu )
if "%c%"=="7" ( schtasks /End /TN "Clubhouse IQ Gateway" >nul 2>&1 & schtasks /Run /TN "Clubhouse IQ Gateway" >nul & echo Restarted. & pause & goto menu )
if "%c%"=="8" ( schtasks /End /TN "Clubhouse IQ Gateway" & pause & goto menu )
if "%c%"=="0" exit /b
goto menu
:find
schtasks /End /TN "Clubhouse IQ Gateway" >nul 2>&1
"%PY%" ciq_gateway.py discover %d% --find "%w%"
schtasks /Run /TN "Clubhouse IQ Gateway" >nul
pause
goto menu
