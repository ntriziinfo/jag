@echo off
setlocal EnableExtensions

set "REPO_DIR=%~dp0"
for %%I in ("%REPO_DIR%..") do set "WORK_DIR=%%~fI"
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

echo Syncing current workspace files...
if exist "%WORK_DIR%\gorai.html" copy /Y "%WORK_DIR%\gorai.html" "%REPO_DIR%gorai.html" >nul
if exist "%WORK_DIR%\AGENTS.md" copy /Y "%WORK_DIR%\AGENTS.md" "%REPO_DIR%AGENTS.md" >nul
if exist "%WORK_DIR%\.gitignore" copy /Y "%WORK_DIR%\.gitignore" "%REPO_DIR%.gitignore" >nul

if exist "%WORK_DIR%\Documents" (
  if not exist "%REPO_DIR%Documents" mkdir "%REPO_DIR%Documents"
  robocopy "%WORK_DIR%\Documents" "%REPO_DIR%Documents" /E /NFL /NDL /NJH /NJS /NP >nul
  if errorlevel 8 (
    echo Failed to sync Documents.
    pause
    exit /b 1
  )
)

if exist "%WORK_DIR%\assets" (
  if not exist "%REPO_DIR%assets" mkdir "%REPO_DIR%assets"
  robocopy "%WORK_DIR%\assets" "%REPO_DIR%assets" /E /NFL /NDL /NJH /NJS /NP >nul
  if errorlevel 8 (
    echo Failed to sync assets.
    pause
    exit /b 1
  )
)

echo Staging files...
"%GIT_EXE%" add -- gorai.html Documents assets AGENTS.md .gitignore push-to-github.cmd
if errorlevel 1 (
  echo Failed to stage files.
  pause
  exit /b 1
)

"%GIT_EXE%" diff --cached --quiet
if not errorlevel 1 (
  echo No changes to commit.
  "%GIT_EXE%" status --short
  pause
  exit /b 0
)

echo Creating commit...
"%GIT_EXE%" commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo Failed to create commit.
  pause
  exit /b 1
)

echo Pushing to GitHub...
"%GIT_EXE%" push origin main
if errorlevel 1 (
  echo Failed to push. Check GitHub login or network connection.
  pause
  exit /b 1
)

echo Done.
"%GIT_EXE%" status --short
pause
