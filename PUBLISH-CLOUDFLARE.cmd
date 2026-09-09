@echo off
setlocal
cd /d "%~dp0"
title Publish TranscribeChats to Cloudflare Pages

set "PROJECT=%~1"
if "%PROJECT%"=="" set "PROJECT=transcribe-chats"

echo ============================================================
echo          TRANSCRIBECHATS - CLOUDFLARE PUBLISH
echo ============================================================
echo Project: %PROJECT%
echo.
echo NOTE: The browser UI can be published to Cloudflare Pages.
echo Whisper and Ollama remain local on your PC because they require
echo your local GPU/RAM. Use START-LEARNING.cmd for the full AI stack.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not on PATH.
  pause
  exit /b 1
)

echo [1/5] Installing exact dependencies...
call npm ci
if errorlevel 1 goto :fail

echo [2/5] Running lint, tests and production build checks...
call npm run check
if errorlevel 1 goto :fail

echo [3/5] Building production frontend...
call npm run build
if errorlevel 1 goto :fail

echo [4/5] Checking Cloudflare login...
call npx wrangler@latest whoami >nul 2>&1
if errorlevel 1 (
  echo [AUTH] Cloudflare login is required. Opening Wrangler login...
  call npx wrangler@latest login
  if errorlevel 1 goto :fail
)

echo [5/5] Publishing dist to Cloudflare Pages...
call npx wrangler@latest pages project create "%PROJECT%" --production-branch main >nul 2>&1
call npx wrangler@latest pages deploy dist --project-name "%PROJECT%" --branch main
if errorlevel 1 goto :fail

echo.
echo [OK] Cloudflare Pages publish finished.
echo [INFO] For full transcription/study/audit AI, keep START-LEARNING.cmd running locally.
pause
exit /b 0

:fail
echo.
echo [ERROR] Publish failed. Nothing after the failed step was deployed.
pause
exit /b 1
