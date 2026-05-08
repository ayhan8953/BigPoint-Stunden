@echo off
echo.
echo  ========================================
echo   BigPoint Stunden - Zeiterfassung
echo  ========================================
echo.
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo  FEHLER: Node.js ist nicht installiert!
  echo  Bitte von https://nodejs.org herunterladen.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Installiere Abhaengigkeiten...
  npm install
  echo.
)

echo  App startet auf http://localhost:3000
echo.
start "" http://localhost:3000
node server.js
pause
