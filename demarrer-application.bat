@echo off
setlocal

cd /d "%~dp0"

echo ========================================
echo   EcoleDigitale - Demarrage local
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERREUR: Node.js n'est pas installe ou n'est pas dans le PATH.
  echo Installe Node.js puis relance ce fichier.
  pause
  exit /b 1
)

if not exist ".env" (
  echo Fichier .env introuvable. Creation depuis .env.example...
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo .env cree. Pense a verifier DATABASE_URL et les mots de passe.
    echo.
  ) else (
    echo ERREUR: .env.example introuvable.
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo Installation des dependances...
  call npx --yes pnpm@10.14.0 install
  if errorlevel 1 (
    echo ERREUR: installation des dependances echouee.
    pause
    exit /b 1
  )
  echo.
)

echo Lancement de l'API et du Web...
echo Web : http://localhost:3000
echo API : http://localhost:4000/api/v1/health
echo.

call npx --yes pnpm@10.14.0 dev

echo.
echo Application arretee.
pause
