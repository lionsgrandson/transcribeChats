@echo off
setlocal
cd /d "%~dp0"
title TranscribeChats - Study + Conversation Audit

echo ============================================================
echo       TRANSCRIBECHATS - STUDY + CONVERSATION AUDIT
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not on PATH.
  pause
  exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker Desktop is required for the local Whisper worker.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [SETUP] Installing app dependencies...
  call npm ci
  if errorlevel 1 goto :fail
)

echo [START] Starting Docker, Whisper, Ollama and the web app...
echo [INFO] Study Library:       http://localhost:4173/study
echo [INFO] Conversation Audit:  http://localhost:4173/social-audit
echo.
call npm start
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo [ERROR] Startup failed. Read the error above.
pause
exit /b 1
