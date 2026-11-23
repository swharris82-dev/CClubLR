# Clubhouse IQ plant gateway installer for Windows 10/11.
# Run install.cmd (it asks for administrator rights and runs this).
# Safe to run again: it upgrades the program and keeps your config.json.

$ErrorActionPreference = 'Stop'
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dir = 'C:\ClubhouseIQ\Gateway'
$Task = 'Clubhouse IQ Gateway'

function Say($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Ask($q, $def) {
    $a = Read-Host "$q$(if ($def) { " [$def]" })"
    if ([string]::IsNullOrWhiteSpace($a)) { return $def } else { return $a.Trim() }
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Please run install.cmd (it asks for administrator rights).' -ForegroundColor Red; exit 1 }

Write-Host 'Clubhouse IQ plant gateway setup' -ForegroundColor Green
Write-Host 'Reads the central plant from the BAS (read only) and sends it to Clubhouse IQ.'

# ---- stop an older copy while we update files
if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue }

# ---- files
Say 'Copying files'
if (Test-Path $Dir) {
    # Repair permissions left by version 1.0 of this installer, which locked the files themselves.
    takeown /F $Dir /R /D Y 2>&1 | Out-Null
    icacls $Dir /reset /T /C /Q 2>&1 | Out-Null
}
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
foreach ($f in 'ciq_gateway.py', 'config.example.json', 'requirements.txt', 'uninstall.cmd', 'uninstall.ps1', 'Gateway tools.cmd', 'README.md') {
    if (Test-Path (Join-Path $Src $f)) { Copy-Item (Join-Path $Src $f) $Dir -Force }
}

# ---- Python
Say 'Checking Python'
function Find-Python {
    foreach ($c in @('py -3.12', 'py -3.13', 'py -3.11', 'py -3')) {
        $parts = $c.Split(' ')
        try {
            $v = & $parts[0] $parts[1] -c "import sys;print(sys.executable) if sys.version_info>=(3,10) else None" 2>$null
            if ($LASTEXITCODE -eq 0 -and $v -and (Test-Path $v)) { return $v.Trim() }
        } catch { }
    }
    foreach ($p in @("$env:ProgramFiles\Python313\python.exe", "$env:ProgramFiles\Python312\python.exe", "$env:ProgramFiles\Python311\python.exe")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}
$py = Find-Python
if (-not $py) {
    Write-Host 'Python not found. Installing Python 3.12 for all users...'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        winget install --id Python.Python.3.12 -e --scope machine --silent --accept-package-agreements --accept-source-agreements | Out-Host
    } else {
        $exe = Join-Path $env:TEMP 'python-3.12.8-amd64.exe'
        Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe' -OutFile $exe -UseBasicParsing
        Start-Process $exe -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1 Include_test=0' -Wait
    }
    $py = Find-Python
    if (-not $py) { Write-Host 'Python install did not finish. Install Python 3.12 from python.org, then run install.cmd again.' -ForegroundColor Red; exit 1 }
}
Write-Host "Using $py"

Say 'Setting up the gateway program'
if (-not (Test-Path "$Dir\venv\Scripts\python.exe")) { & $py -m venv "$Dir\venv" }
$vpy = "$Dir\venv\Scripts\python.exe"
& $vpy -m pip install --quiet --upgrade pip | Out-Host
& $vpy -m pip install --quiet -r "$Dir\requirements.txt" | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host 'Could not install the BACnet library. Check this PC can reach the internet, then run install.cmd again.' -ForegroundColor Red; exit 1 }

# ---- settings
$cfgPath = "$Dir\config.json"
$port = 47808
if (Test-Path $cfgPath) {
    Say 'Keeping your existing config.json'
    $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
    if ($cfg.bacnet.address -match ':(\d+)$') { $port = [int]$Matches[1] }
} else {
    Say 'Settings'
    $cfg = Get-Content "$Dir\config.example.json" -Raw | ConvertFrom-Json
    Write-Host 'Paste the plant key. It is PLANT_INGEST_KEY in Render > clubhouse-iq > Environment.'
    $key = ''
    while ($key.Length -lt 24) { $key = Ask 'Plant key (24+ characters)' '' }
    $cfg.key = $key
    $cfg.server = Ask 'Clubhouse IQ address' $cfg.server

    # Is BACnet software (Compass) already using port 47808 on this PC?
    $busy = Get-NetUDPEndpoint -LocalPort 47808 -ErrorAction SilentlyContinue
    if ($busy) {
        $owner = ($busy | Select-Object -First 1).OwningProcess
        $pname = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
        Write-Host ''
        Write-Host "Port 47808 is already used by $pname on this PC (likely the BAS software)." -ForegroundColor Yellow
        Write-Host 'The gateway will use port 47809 instead. Fill in the device addresses in config.json (see README).' -ForegroundColor Yellow
        $port = 47809
    }

    Write-Host ''
    Write-Host 'Which network connection is on the BAS network? (The BCM is at 192.168.1.43.)'
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Sort-Object InterfaceAlias)
    for ($i = 0; $i -lt $ips.Count; $i++) { Write-Host ("  {0}. {1}/{2}  ({3})" -f ($i + 1), $ips[$i].IPAddress, $ips[$i].PrefixLength, $ips[$i].InterfaceAlias) }
    $pick = 0
    while ($pick -lt 1 -or $pick -gt $ips.Count) { $pick = [int](Ask 'Number' '1') }
    $ip = $ips[$pick - 1]
    $cfg.bacnet.address = "$($ip.IPAddress)/$($ip.PrefixLength)" + $(if ($port -ne 47808) { ":$port" } else { '' })

    $json = $cfg | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($cfgPath, $json, (New-Object Text.UTF8Encoding($false)))
    Write-Host "Saved $cfgPath"
}

# ---- lock the folder to administrators and SYSTEM (config.json holds the key).
# Set on the folder only; files and subfolders inherit it.
icacls $Dir /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' /Q | Out-Null
icacls $Dir /inheritance:r /Q | Out-Null

# ---- firewall: BACnet answers come back to this UDP port
Say 'Firewall'
Get-NetFirewallRule -DisplayName 'Clubhouse IQ Gateway (BACnet)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Clubhouse IQ Gateway (BACnet)' -Direction Inbound -Protocol UDP -LocalPort $port -Action Allow -Profile Any | Out-Null
Write-Host "Allowed BACnet replies on UDP $port"

# ---- keep the PC awake
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null

# ---- first test
Say 'Test: reading the plant once and sending it'
& $vpy "$Dir\ciq_gateway.py" test --send
Write-Host ''
Write-Host 'If points show "not answering", check the network connection, port, and device addresses (README), then use Gateway tools > Test.'

# ---- run at startup, restart if it stops
Say 'Starting the gateway (runs at startup, even when nobody is signed in)'
$action = New-ScheduledTaskAction -Execute "$Dir\venv\Scripts\pythonw.exe" -Argument "`"$Dir\ciq_gateway.py`" run" -WorkingDirectory $Dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $Task

# ---- shortcut to the tools menu
$lnk = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Clubhouse IQ Gateway.lnk'
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk); $s.TargetPath = "$Dir\Gateway tools.cmd"; $s.WorkingDirectory = $Dir; $s.Save()

Say 'Done'
Write-Host 'The gateway is running. Open the Plant page in Clubhouse IQ: it should say "Live from the BAS" within a minute.'
Write-Host 'Desktop shortcut "Clubhouse IQ Gateway" has Test, Find points, Log, Restart and Edit settings.'
