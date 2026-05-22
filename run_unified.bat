@echo off
SETLOCAL EnableDelayedExpansion
title Smart Meeting Companion - Unified Server Setup

echo =======================================================================
echo     Smart Meeting Companion - Unified Production Server Builder
echo =======================================================================
echo.

:: Get workspace directory
SET "WORK_DIR=%~dp0"
CD /D "%WORK_DIR%"

:: Phase 1: Build the frontend
echo [1/3] Building Frontend React app...
CD /D "%WORK_DIR%frontend"

if not exist node_modules (
    echo node_modules not found, running npm install...
    call npm install
) else (
    echo node_modules found, skipping npm install...
)

echo Compiling static assets...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend build failed!
    pause
    exit /b %ERRORLEVEL%
)
echo Frontend build complete!
echo.

:: Phase 2: Prepare Backend Virtual Environment
echo [2/3] Preparing Backend Python Virtual Environment...
CD /D "%WORK_DIR%backend"

if not exist venv (
    echo Virtual environment 'venv' not found. Creating python virtual environment...
    python -m venv venv
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to create Python virtual environment. Ensure Python is installed and in your PATH.
        pause
        exit /b %ERRORLEVEL%
    )
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing/Updating dependencies from requirements.txt...
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install backend dependencies!
    pause
    exit /b %ERRORLEVEL%
)
echo Backend setup complete!
echo.

:: Phase 3: Start FastAPI server
echo [3/3] Starting the Unified Server...
echo The React frontend is now integrated and served by FastAPI!
echo Open your browser and navigate to: http://localhost:8000
echo.

python main.py
pause
