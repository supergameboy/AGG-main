#Requires -Version 7.0
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 找所有 quest / time 相关日志
Write-Host "=== quest agent records ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -notmatch '"agent":"quest"' -and $lines[$i] -notmatch 'quest_service') { continue }
  $l = $lines[$i]
  if ($l.Length -gt 350) { $l = $l.Substring(0, 350) + '...' }
  Write-Host "  line $i $l"
}

Write-Host ""
Write-Host "=== time agent records ==="
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -notmatch '"agent":"time"' -and $lines[$i] -