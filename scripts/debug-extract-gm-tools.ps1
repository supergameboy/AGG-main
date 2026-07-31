#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 修复脚本中的 ErrorRecord 处理问题，重写 load_skill 提取
Write-Host "=== load_skill calls (with params) ==="
$lines | Where-Object { $_ -match 'load_skill' -and $_ -match '"tag":"TOOL-CALL"' -or ($_ -match 'load_skill' -and $_ -match 'Tool call:') } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $agent = $o.data.agent
    if (-not $agent) { return }
    $params = $o.data.params
    $ts = $o.timestamp
    $paramsStr = if ($params) { ($params | ConvertTo-Json -Compress) } else { 'null' }
    Write-Host ("{0} | agent={1} | params={2}" -f $ts, $agent, $paramsStr)
  } catch {}
}

Write-Host ""
Write-Host "=== gamemaster LLM iterations count ==="
$llmIters = $lines | Where-Object { $_ -match '"tag":"LLM-INPUT"' -and $_ -match '"agent":"gamemaster"' }
Write-Host "gamemaster LLM iterations: $($llmIters.Count)"

Write-Host ""
Write-Host "=== AGENT-END summary (all agents) ==="
$lines | Where-Object { $_ -match 'AGENT-END|completed,|reached max iterations' } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $iter = $o.data.iterations
    $tools = $o.data.toolCallsExecuted
    $finish = $o.data.finishReason
    $elapsed = $o.data.elapsed
    $agent = $o.data.agent
    Write-Host ("{0} | agent={1} | iter={2} tools={3} finish={4} elapsed={5}s" -f $o.timestamp, $agent, $iter, $tools, $finish, $elapsed)
  } catch {}
}

Write-Host ""
Write-Host "=== AGENT-START (initial timing) ==="
$lines | Where-Object { $_ -match 'AGENT-START' } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $agent = $o.data.agent
    Write-Host ("{0} | agent={1} START" -f $o.timestamp, $agent)
  } catch {}
}

Write-Host ""
Write-Host "=== Skill layer / rules injected ==="
$lines | Where-Object { $_ -match 'Context injected for' } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $agent = $o.data.agent
    $msg = $o.message
    Write-Host ("{0} | agent={1} | {2}" -f $o.timestamp, $agent, $msg)
  } catch {}
}

Write-Host ""
Write-Host "=== init_stats / initialize_time / get_template_data ==="
$lines | Where-Object { $_ -match 'init_stats|initialize_time|get_template_data' } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $agent = $o.data.agent
    $method = $o.data.method
    $ts = $o.timestamp
    $msg = $o.message
    if ($msg.Length -gt 60) { $msg = $msg.Substring(0, 60) }
    Write-Host ("{0} | agent={1} | method={2} | {3}" -f $ts, $agent, $method, $msg)
  } catch {}
}
