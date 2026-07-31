#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Select-String -Path $logPath -Pattern 'AGENT-END|completed|max iterations|batch_spawn|spawn'
foreach ($line in $lines) {
  try {
    $o = $line.Line | ConvertFrom-Json
    $agent = $o.data.agent
    $iter = $o.data.iterations
    $success = $o.data.success
    $finish = $o.data.finishReason
    $toolCalls = $o.data.toolCallsExecuted
    $elapsed = $o.data.elapsed
    Write-Host ("{0} | {1} | {2} | iter={3} success={4} finish={5} tools={6} elapsed={7}" -f $o.timestamp, $agent, $o.message, $iter, $success, $finish, $toolCalls, $elapsed)
  } catch {
    Write-Host "PARSE_FAIL: $($line.Line.Substring(0, [Math]::Min(150, $line.Line.Length)))"
  }
}
