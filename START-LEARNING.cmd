@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title TranscribeChats - Local AI Launcher

set "MODE=%~1"
if "%MODE%"=="" set "MODE=start"

if /I "%MODE%"=="help" goto :help
if /I "%MODE%"=="/?" goto :help
if /I "%MODE%"=="hf" goto :open_hf

call :check_node || exit /b 1

if /I "%MODE%"=="setup" goto :setup
if /I "%MODE%"=="status" goto :status

call :check_docker || exit /b 1
call :ensure_node_modules || exit /b 1
call :ensure_env || exit /b 1

if /I "%MODE%"=="fallback" goto :start_fallback
if /I "%MODE%"=="rebuild" goto :start_rebuild
if /I not "%MODE%"=="start" if /I not "%MODE%"=="full" goto :unknown

call :offer_pyannote_setup
if errorlevel 2 exit /b 0
if errorlevel 1 exit /b 1

echo.
echo [START] Starting Docker, Whisper, Ollama, speaker separation and the web app...
echo [INFO] App:                 http://localhost:4173
echo [INFO] Study Library:       http://localhost:4173/study
echo [INFO] Conversation Audit:  http://localhost:4173/social-audit
echo.
call npm start
if errorlevel 1 goto :fail
exit /b 0

:start_rebuild
echo.
echo [REBUILD] Rebuilding the local AI worker without Docker cache, then starting everything...
echo [INFO] This is useful after changing Whisper or pyannote dependencies.
echo.
call npm run start:rebuild
if errorlevel 1 goto :fail
exit /b 0

:start_fallback
echo.
echo [START] Starting with acoustic speaker separation only.
echo [INFO] pyannote is disabled for this run; your saved token is not changed.
echo.
call npm run start:fallback
if errorlevel 1 goto :fail
exit /b 0

:setup
call :ensure_env || exit /b 1
if not exist "scripts\configure-pyannote.ps1" (
  echo [ERROR] scripts\configure-pyannote.ps1 is missing.
  pause
  exit /b 1
)
echo ============================================================
echo       PYANNOTE SPEAKER SEPARATION SETUP
echo ============================================================
echo.
echo 1. Accept access to the Community-1 model:
echo    https://huggingface.co/pyannote/speaker-diarization-community-1
echo 2. Create a READ token:
echo    https://huggingface.co/settings/tokens
echo 3. Paste the token below. It will be hidden while you type/paste.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\configure-pyannote.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Token setup was not completed.
  pause
  exit /b 1
)
echo.
echo [OK] pyannote configuration saved to .env.
echo [INFO] Run START-LEARNING.cmd normally. The launcher will verify model access and report the active speaker engine.
pause
exit /b 0

:status
call :ensure_env >nul 2>&1
if not exist node_modules (
  echo [INFO] node_modules is missing; status can still check the local AI services.
)
echo ============================================================
echo       TRANSCRIBECHATS LOCAL AI STATUS
echo ============================================================
echo.
node "scripts\start-all.mjs" --status
set "STATUS_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %STATUS_CODE%

:open_hf
start "" "https://huggingface.co/pyannote/speaker-diarization-community-1"
start "" "https://huggingface.co/settings/tokens"
echo [OK] Opened the pyannote model-access and Hugging Face token pages.
exit /b 0

:offer_pyannote_setup
call :token_is_configured
if not errorlevel 1 exit /b 0

echo.
echo [SPEAKERS] High-quality pyannote speaker separation is not configured yet.
echo [SPEAKERS] The app can still run with the built-in acoustic fallback.
echo.
choice /C YNO /N /M "Configure now? [Y]es  [N]o, use fallback  [O]pen Hugging Face pages: "
if errorlevel 3 (
  call :open_hf
  echo.
  echo Run START-LEARNING.cmd setup after accepting the model access and creating a read token.
  pause
  exit /b 2
)
if errorlevel 2 exit /b 0
call "%~f0" setup
if errorlevel 1 exit /b 1
exit /b 0

:token_is_configured
if not exist ".env" exit /b 1
findstr /R /C:"^[ ]*PYANNOTE_TOKEN[ ]*=[ ]*hf_[A-Za-z0-9]" ".env" >nul 2>&1
exit /b %ERRORLEVEL%

:ensure_env
if exist ".env" exit /b 0
if not exist ".env.example" (
  echo [ERROR] .env.example is missing, so the launcher cannot create .env.
  exit /b 1
)
copy /Y ".env.example" ".env" >nul
if errorlevel 1 (
  echo [ERROR] Could not create .env from .env.example.
  exit /b 1
)
echo [SETUP] Created .env from .env.example.
exit /b 0

:check_node
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not on PATH.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not installed or is not on PATH.
  pause
  exit /b 1
)
exit /b 0

:check_docker
where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker Desktop is required for the local Whisper/pyannote worker.
  pause
  exit /b 1
)
exit /b 0

:ensure_node_modules
if exist node_modules exit /b 0
echo [SETUP] Installing app dependencies...
call npm ci
if errorlevel 1 (
  echo [ERROR] npm ci failed.
  pause
  exit /b 1
)
exit /b 0

:unknown
echo [ERROR] Unknown launcher option: %MODE%
echo.
goto :help

:help
echo ============================================================
echo       TRANSCRIBECHATS START-LEARNING OPTIONS
echo ============================================================
echo.
echo   START-LEARNING.cmd
echo      Recommended one-click start. Offers pyannote setup once if needed.
echo.
echo   START-LEARNING.cmd setup
echo      Securely save or replace the Hugging Face read token in .env.
echo.
echo   START-LEARNING.cmd status
echo      Show Docker, Ollama, Whisper and speaker-separation status.
echo.
echo   START-LEARNING.cmd rebuild
echo      Clean-rebuild the local AI worker and start the full app.
echo.
echo   START-LEARNING.cmd fallback
echo      Start this run with acoustic speaker separation only.
echo.
echo   START-LEARNING.cmd hf
echo      Open the Community-1 model page and Hugging Face token page.
echo.
echo   START-LEARNING.cmd help
echo      Show this help.
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] Startup failed. Read the error above.
echo [TIP] Run START-LEARNING.cmd status for a quick local AI health check.
pause
exit /b 1
