#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Select-String -Path $logPath -Pattern 'Injecting task conformance|Injecting continuity|Task conformance audit approved|Continuity audit approved|AGENT-START|AGENT-END'
foreach ($line in $lines) {
  try {
    $o = $line.Line | ConvertFrom-Json
    $agent = $o.data.agent
    $msg = $o.message
    $taskRound = $o.data.taskConformanceAuditRound
    $auditRound = $o.data.auditRound
    $staged = $o.data.stagedWriteCount
    $iter = $o.data.iteration
    Write-Host ("{0} | {1} | iter={2} | {3} | taskRound={4} auditRound={5} staged={6}" -f $o.timestamp, $agent, $iter, $msg, $taskRound, $auditRound, $staged)
  } catch {
    Write-Host "PARSE_FAIL: $($line.Line.Substring(0, [Math]::Min(200, $line.Line.Length)))"
  }
}
