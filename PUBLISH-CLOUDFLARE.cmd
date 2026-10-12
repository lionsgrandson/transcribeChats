@echo off
setlocal
cd /d "%~dp0"
title TranscribeChats - Publish transcription-only edition
if not exist ".env.local" (
  echo [ERROR] Missing .env.local - copy .env.example and fill in the public configuration.
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 22 or newer must be installed.
  exit /b 1
)
node --env-file=.env.local scripts\deploy-transcription-only.mjs
exit /b %ERRORLEVEL%
