@echo off
title ECEC Portal Launcher
echo =======================================
echo   ECEC Work Placement Portal v2.0
echo   Academies Australasia
echo =======================================
echo.
echo This will open TWO windows:
echo   1. Backend server  (API)
echo   2. Frontend server (Web portal)
echo.
echo After both start, open your browser to:
echo   http://localhost:5173
echo.
echo Login: b.dotel@academies.edu.au
echo Pass:  aca0022z
echo.
pause

echo Starting Backend...
start "ECEC Backend" cmd /k "cd /d "%~dp0" && start-backend.bat"

echo Waiting 5 seconds for backend to start...
timeout /t 5 /nobreak > nul

echo Starting Frontend...
start "ECEC Frontend" cmd /k "cd /d "%~dp0" && start-frontend.bat"

echo.
echo Both servers are starting in separate windows.
echo.
echo Wait about 30 seconds then open:
echo   http://localhost:5173
echo.
echo To stop: close both server windows.
echo.
pause
