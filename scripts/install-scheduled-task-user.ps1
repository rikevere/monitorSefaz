<#
  Alternativa ao install-scheduled-task.ps1 quando a conta SYSTEM é bloqueada
  por antivírus/EDR (ex.: Sophos retornando ERROR_INVALID_FUNCTION /
  0x80070001 ao criar processos disparados por SYSTEM a partir de uma pasta
  gravável fora de Program Files).

  Registra a mesma Tarefa Agendada (gatilho "At startup", inicia sem exigir
  login), porém executando sob a SUA própria conta de usuário em vez de
  SYSTEM. Isso costuma escapar da heurística específica de SYSTEM do EDR.

  Execute em um PowerShell aberto como Administrador. A senha é digitada
  diretamente no prompt do Windows (Get-Credential) e não passa pelo
  assistente de IA.
#>

$ErrorActionPreference = 'Stop'
$taskName = 'MonitorSefaz'
$projectRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $projectRoot 'scripts\start-monitor-service.cmd'
$logDir = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$credential = Get-Credential -Message 'Informe usuário e senha da conta que executará o Monitor SEFAZ no boot (ex.: INTRACISS\ricardo.ludwig)'

$action = New-ScheduledTaskAction -Execute $startScript -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -User $credential.UserName -Password $credential.GetNetworkCredential().Password `
  -RunLevel Limited -Settings $settings `
  -Description 'Monitor SEFAZ - inicia no boot, sem necessidade de login, sob conta de usuário (fallback ao bloqueio do EDR na conta SYSTEM).' | Out-Null

Write-Output "Tarefa '$taskName' registrada sob $($credential.UserName). Iniciando agora para validar..."
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 5
Get-ScheduledTaskInfo -TaskName $taskName | Format-List
