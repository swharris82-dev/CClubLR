# Removes the Clubhouse IQ plant gateway: startup task, firewall rule, shortcut.
# Asks before deleting C:\ClubhouseIQ\Gateway (your config.json and log are there).
$Task = 'Clubhouse IQ Gateway'
$Dir = 'C:\ClubhouseIQ\Gateway'
if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $Task -Confirm:$false
    Write-Host 'Startup task removed.'
}
Get-NetFirewallRule -DisplayName 'Clubhouse IQ Gateway (BACnet)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Firewall rule removed.'
Remove-Item (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Clubhouse IQ Gateway.lnk') -ErrorAction SilentlyContinue
$a = Read-Host "Delete $Dir too (settings and log)? y/N"
if ($a -match '^[yY]') { Set-Location C:\; Remove-Item $Dir -Recurse -Force; Write-Host 'Folder deleted.' }
Write-Host 'The gateway is removed. Python stays installed.'
