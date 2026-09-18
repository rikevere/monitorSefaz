<#
  Inicia o Monitor SEFAZ em segundo plano, usado pela Tarefa Agendada do Windows
  (gatilho "At startup", executando mesmo sem login de usuário).
#>

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = 'C:\Program Files\nodejs\node.exe' }

Set-Location $projectRoot

& $nodeExe (Join-Path $projectRoot 'server\index.js') *>> (Join-Path $logDir 'monitor-sefaz.log')
