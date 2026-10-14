@echo off
setlocal
cd /d "%~dp0"
title TranscribeChats - Publish unified application
if not exist ".env.production.local" (
  echo [ERROR] Missing .env.production.local - copy .env.example and fill in public hosted configuration.
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 22 or newer must be installed.
  exit /b 1
)
node --env-file=.env.production.local scripts\publish.mjs
exit /b %ERRORLEVEL%
