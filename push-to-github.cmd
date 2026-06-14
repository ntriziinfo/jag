@echo off
setlocal EnableExtensions

set "REPO_DIR=%~dp0"
set "GIT_EXE=C:\Program Files\Git\cmd\git.exe"
set "COMMIT_MSG=%~1"

if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Update White Devil"

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

echo Staging GitHub source files only...
"%GIT_EXE%" add -A -- .gitignore AGENTS.md README.txt admin.html gorai.html index.html server.js whitedevil.html Documents assets push-to-github.cmd pull-from-github.cmd sync-dropbox-from-git.cmd sync-dropbox-from-git.ps1
if errorlevel 1 (
  echo Failed to stage files.
  pause
  exit /b 1
)

"%GIT_EXE%" diff --cached --quiet
if errorlevel 1 (
  echo Creating commit...
  "%GIT_EXE%" commit -m "%COMMIT_MSG%"
  if errorlevel 1 (
    echo Failed to create commit.
    pause
    exit /b 1
  )
) else (
  echo No new local changes to commit.
)

echo Fetching latest GitHub main...
"%GIT_EXE%" fetch origin main
if errorlevel 1 (
  echo Failed to fetch from GitHub. Check network or GitHub login.
  pause
  exit /b 1
)

"%GIT_EXE%" merge-base --is-ancestor origin/main HEAD
if errorlevel 1 (
  echo GitHub has newer commits. Rebasing local commits on latest GitHub main...
  "%GIT_EXE%" pull --rebase origin main
  if errorlevel 1 (
    echo Rebase failed. Resolve the conflict, then run this script again.
    echo If you are unsure, ask Codex to inspect the Git state.
    pause
    exit /b 1
  )
)

echo Pushing to GitHub...
"%GIT_EXE%" push origin main
if errorlevel 1 (
  echo Failed to push. Check GitHub login or network connection.
  pause
  exit /b 1
)

echo Done.
"%GIT_EXE%" log -1 --oneline
"%GIT_EXE%" status --short --branch
pause
