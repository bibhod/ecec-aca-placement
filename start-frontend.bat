@echo off
title ECEC Frontend Server
echo =======================================
echo  ECEC Work Placement Portal - Frontend
echo =======================================
echo.

cd /d "%~dp0frontend"

echo Checking Node.js...
node --version
if errorlevel 1 (
    echo ERROR: Node.js not found. Please install from nodejs.org
    pause
    exit /b 1
)

echo.
echo Installing dependencies (first time only, may take a few minutes)...
npm install

echo.
echo Starting frontend...
echo Portal will open at: http://localhost:5173
echo.
echo Press Ctrl+C to stop
echo.

npm run dev

pause
