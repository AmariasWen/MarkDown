@echo off
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" server.js --open
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Runtime missing. Please restore the runtime folder.
    pause
    exit /b 1
  )
  node server.js --open
)
pause
