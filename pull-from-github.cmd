@echo off
setlocal EnableExtensions

set "REPO_DIR=%~dp0"
set "GIT_EXE=C:\Program Files\Git\cmd\git.exe"

if not exist "%GIT_EXE%" (
  where git >nul 2>nul
  if errorlevel 1 (
    echo Git was not found. Please install Git for Windows first.
    pause
    exit /b 1
  )
  set "GIT_EXE=git"
)

if not exist "%REPO_DIR%.git" (
  echo This script must be placed in the Git repository folder.
  echo Expected .git at: %REPO_DIR%.git
  pause
  exit /b 1
)

cd /d "%REPO_DIR%" || (
  echo Failed to open repository folder.
  pause
  exit /b 1
)

if exist ".git\index.lock" (
  echo Git is locked. Close other Git tools and try again.
  echo Lock file: %REPO_DIR%.git\index.lock
  pause
  exit /b 1
)

"%GIT_EXE%" config --global --add safe.directory "%CD%" >nul 2>nul

"%GIT_EXE%" diff --quiet
if errorlevel 1 (
  echo Local tracked files have uncommitted changes.
  echo Commit or discard them before pulling from GitHub.
  "%GIT_EXE%" status --short
  pause
  exit /b 1
)

"%GIT_EXE%" diff --cached --quiet
if errorlevel 1 (
  echo Local staged files have uncommitted changes.
  echo Commit or unstage them before pulling from GitHub.
  "%GIT_EXE%" status --short
  pause
  exit /b 1
)

echo Pulling latest GitHub main...
"%GIT_EXE%" fetch origin main
if errorlevel 1 (
  echo Failed to fetch from GitHub. Check network or GitHub login.
  pause
  exit /b 1
)

"%GIT_EXE%" pull --ff-only origin main
if errorlevel 1 (
  echo Failed to fast-forward pull. Another terminal may have unpublished local commits.
  echo If this happens, ask Codex to inspect the Git state.
  pause
  exit /b 1
)

echo Done. Refresh the browser after this.
"%GIT_EXE%" log -1 --oneline
"%GIT_EXE%" status --short --branch
pause
