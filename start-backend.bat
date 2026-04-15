@echo off
title ECEC Backend Server
echo =======================================
echo  ECEC Work Placement Portal - Backend
echo =======================================
echo.

cd /d "%~dp0backend"

echo Checking Python...
python --version
if errorlevel 1 (
    echo ERROR: Python not found. Please install Python from python.org
    pause
    exit /b 1
)

echo.
echo Installing dependencies (first time only)...
pip install -r requirements.txt --quiet

echo.
echo Starting backend server...
echo API will be available at: http://localhost:8000
echo API docs at: http://localhost:8000/docs
echo.
echo Press Ctrl+C to stop
echo.

set DATABASE_URL=postgresql://postgres:ecec_secret@localhost:5432/ecec_placement
set SECRET_KEY=xK9mP2qL7vN4jR8wY1cT6bA3fD5hS0eU
set SENDGRID_API_KEY=
set FROM_EMAIL=noreply@academies.edu.au
set FROM_NAME=Academies Australasia
set FRONTEND_URL=http://localhost:5173
set USE_SMTP=false
set ACCESS_TOKEN_EXPIRE_MINUTES=480
set ALGORITHM=HS256

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

pause
