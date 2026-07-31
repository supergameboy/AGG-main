#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

Write-Host "=== Last 30 lines ==="
$lines | Select-Object -Last 30 | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $msg = $o.message
    if ($msg.Length -gt 80) { $msg = $msg.Substring(0, 80) }
    $agent = $o.data.agent
    $iter = $o.data.iterations
    $finish = $o.data.finishReason
    $tools = $o.data.toolCallsExecuted
    Write-Host ("{0} | {1} | {2} | agent={3} iter={4} finish={5} tools={6}" -f $o.timestamp, $o.source, $msg, $agent, $iter, $finish, $tools)
  } catch {
    Write-Host "PARSE_FAIL"
  }
}

Write-Host ""
Write-Host "=== AGENT-END summary ==="
$lines | Where-Object { $_ -match 'AGENT-END|reached max iterations|completed, ' } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $iter = $o.data.iterations
    $tools = $o.data.toolCallsExecuted
    $finish = $o.data.finishReason
    $elapsed = $o.data.elapsed
    $success = $o.data.success
    Write-Host ("{0} | {1} | {2} | iter={3} tools={4} finish={5} elapsed={6}s success={7}" -f $o.timestamp, $o.data.agent, $o.message, $iter, $tools, $finish, $elapsed, $success)
  } catch {
    Write-Host "PARSE_FAIL: $($_.Substring(0, [Math]::Min(150, $_.Length)))"
  }
}

Write-Host ""
Write-Host "=== Audit events ==="
$lines | Where-Object { $_ -match 'audit' } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $taskRound = $o.data.taskConformanceAuditRound
    $auditRound = $o.data.auditRound
    $staged = $o.data.stagedWriteCount
    Write-Host ("{0} | {1} | {2} | taskRound={3} auditRound={4} staged={5}" -f $o.timestamp, $o.data.agent, $o.message, $taskRound, $auditRound, $staged)
  } catch {
    Write-Host "PARSE_FAIL: $($_.Substring(0, [Math]::Min(150, $_.Length)))"
  }
}
