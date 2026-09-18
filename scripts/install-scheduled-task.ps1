<#
  Execute este script UMA VEZ em um PowerShell aberto como Administrador.
  Ele cria uma Tarefa Agendada que inicia o Monitor SEFAZ no boot do Windows,
  mesmo que nenhum usuário faça login (conta SYSTEM, LogonType ServiceAccount).

  A ação chama um arquivo .cmd dedicado (sem powershell.exe e sem aspas
  aninhadas na linha de Arguments), pois o algoritmo de remoção de aspas do
  cmd.exe quebra facilmente quando o Agendador de Tarefas passa uma única
  string de argumentos complexa, causando ERROR_INVALID_FUNCTION (0x80070001).
#>

$ErrorActionPreference = 'Stop'
$taskName = 'MonitorSefaz'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$startScript = Join-Path $projectRoot 'scripts\start-monitor-service.cmd'

$action = New-ScheduledTaskAction -Execute $startScript -WorkingDirectory $projectRoot

$trigger = New-ScheduledTaskTrigger -AtStartup

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Description 'Monitor SEFAZ - inicia no boot, sem necessidade de login.' | Out-Null

Write-Output "Tarefa '$taskName' registrada. Iniciando agora para validar..."
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 5
Get-ScheduledTaskInfo -TaskName $taskName | Format-List
