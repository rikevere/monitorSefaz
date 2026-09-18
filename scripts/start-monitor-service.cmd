@echo off
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" "server\index.js" >> "logs\monitor-sefaz.log" 2>&1
