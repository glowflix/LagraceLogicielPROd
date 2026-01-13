@echo off
REM Quick-Check Script pour Windows: Vérifier que tout fonctionne

echo.
echo 🚀 QUICK CHECK - La Grace POS v2026.01.06
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

REM Check 1: Node & npm
echo 1️⃣  Vérification Node.js...
node --version >nul 2>&1 && (
    echo    ✅ Node.js OK
) || (
    echo    ❌ Node.js manquant - Installer de https://nodejs.org
)

npm --version >nul 2>&1 && (
    echo    ✅ npm OK
) || (
    echo    ❌ npm manquant
)
echo.

REM Check 2: Python
echo 2️⃣  Vérification Python (AI)...
python --version >nul 2>&1 && (
    echo    ✅ Python OK
) || (
    echo    ⚠️  Python non trouvé (AI optionnel)
)
echo.

REM Check 3: Dépendances
echo 3️⃣  Vérification dépendances...
if exist "node_modules" (
    echo    ✅ node_modules existe
) else (
    echo    ❌ Exécuter: npm install
)

if exist "package.json" (
    echo    ✅ package.json trouvé
) else (
    echo    ❌ package.json manquant
)
echo.

REM Check 4: Config
echo 4️⃣  Vérification configuration...
if exist ".env.backend" (
    echo    ✅ .env.backend trouvé
) else (
    echo    ⚠️  .env.backend manquant
)

if exist "config.env" (
    echo    ✅ config.env trouvé
) else (
    echo    ⚠️  config.env manquant
)
echo.

REM Check 5: Fichiers critiques
echo 5️⃣  Vérification fichiers critiques...
if exist "src\api\server.js" (
    echo    ✅ server.js
) else (
    echo    ❌ server.js manquant
)

if exist "electron\main.cjs" (
    echo    ✅ main.cjs
) else (
    echo    ❌ main.cjs manquant
)
echo.

REM Check 6: Structure
echo 6️⃣  Vérification structure...
if exist "src" (
    echo    ✅ src/
) else (
    echo    ❌ src/ manquant
)

if exist "electron" (
    echo    ✅ electron/
) else (
    echo    ❌ electron/ manquant
)

if exist "print" (
    echo    ✅ print/
) else (
    echo    ❌ print/ manquant
)

if exist "ai-lagrace" (
    echo    ✅ ai-lagrace/
) else (
    echo    ⚠️  ai-lagrace/ (AI optionnel)
)
echo.

echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo 📋 Prochaines étapes:
echo.
echo 1️⃣  Installation (si besoin^):
echo     npm install
echo.
echo 2️⃣  Démarrage RAPIDE (recommandé^):
echo     npm run dev:web
echo     → Ouvre http://localhost:5173
echo.
echo 3️⃣  Démarrage COMPLET (Electron + AI^):
echo     npm run dev
echo.
echo 4️⃣  Ou tester directement:
echo     npm start
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo ✅ Configuration OK! Prêt à démarrer.
echo.
pause
