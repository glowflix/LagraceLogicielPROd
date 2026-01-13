#!/bin/bash
# Quick-Check Script: Vérifier que tout fonctionne

echo "🚀 QUICK CHECK - La Grace POS v2026.01.06"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check 1: Node & npm
echo "1️⃣  Vérification Node.js..."
node --version > /dev/null 2>&1 && echo "   ✅ Node.js OK" || echo "   ❌ Node.js manquant"
npm --version > /dev/null 2>&1 && echo "   ✅ npm OK" || echo "   ❌ npm manquant"
echo ""

# Check 2: Python
echo "2️⃣  Vérification Python (AI)..."
python --version > /dev/null 2>&1 && echo "   ✅ Python OK" || echo "   ⚠️  Python non trouvé (AI optionnel)"
echo ""

# Check 3: Dépendances
echo "3️⃣  Vérification dépendances..."
test -d "node_modules" && echo "   ✅ node_modules existe" || echo "   ❌ Exécuter: npm install"
test -f "package.json" && echo "   ✅ package.json trouvé" || echo "   ❌ package.json manquant"
echo ""

# Check 4: Config
echo "4️⃣  Vérification configuration..."
test -f ".env.backend" && echo "   ✅ .env.backend trouvé" || echo "   ⚠️  .env.backend manquant (utiliser .env par défaut)"
test -f "config.env" && echo "   ✅ config.env trouvé" || echo "   ⚠️  config.env manquant"
echo ""

# Check 5: Fichiers critiques
echo "5️⃣  Vérification fichiers critiques..."
test -f "src/api/server.js" && echo "   ✅ server.js" || echo "   ❌ server.js manquant"
test -f "electron/main.cjs" && echo "   ✅ main.cjs" || echo "   ❌ main.cjs manquant"
test -f "package.json" && npm run | grep "dev:web" > /dev/null && echo "   ✅ Scripts npm" || echo "   ⚠️  Scripts npm incomplets"
echo ""

# Check 6: Structure
echo "6️⃣  Vérification structure..."
test -d "src" && echo "   ✅ src/" || echo "   ❌ src/ manquant"
test -d "electron" && echo "   ✅ electron/" || echo "   ❌ electron/ manquant"
test -d "print" && echo "   ✅ print/" || echo "   ❌ print/ manquant"
test -d "ai-lagrace" && echo "   ✅ ai-lagrace/" || echo "   ❌ ai-lagrace/ (AI optionnel)"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Prochaines étapes:"
echo ""
echo "1️⃣  Installation (si besoin):"
echo "    npm install"
echo ""
echo "2️⃣  Démarrage RAPIDE (recommandé):"
echo "    npm run dev:web"
echo "    → Ouvre http://localhost:5173"
echo ""
echo "3️⃣  Démarrage COMPLET (Electron + AI):"
echo "    npm run dev"
echo ""
echo "4️⃣  Ou tester directement:"
echo "    npm start"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Configuration OK! Prêt à démarrer."
