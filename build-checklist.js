#!/usr/bin/env node

/**
 * ✅ BUILD CHECKLIST - Vérifier la structure avant electron-builder
 * 
 * Lance-le avant npm run build:exe pour s'assurer que tout est prêt
 * Usage: node build-checklist.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

console.log('\n🔍 BUILD CHECKLIST - LA GRACE POS\n');

let errors = 0;
let warnings = 0;

function check(condition, message, isWarning = false) {
  if (!condition) {
    if (isWarning) {
      console.warn(`⚠️  ${message}`);
      warnings++;
    } else {
      console.error(`❌ ${message}`);
      errors++;
    }
    return false;
  }
  console.log(`✅ ${message}`);
  return true;
}

// === VÉRIFICATIONS ===

console.log('📦 Fichiers critiques:');
check(fs.existsSync(path.join(ROOT, 'package.json')), 'package.json');
check(fs.existsSync(path.join(ROOT, 'electron-builder.json')), 'electron-builder.json');
check(fs.existsSync(path.join(ROOT, 'electron/main.cjs')), 'electron/main.cjs');
check(fs.existsSync(path.join(ROOT, 'src/api/server.js')), 'src/api/server.js');
check(fs.existsSync(path.join(ROOT, 'src/api/server-entry.cjs')), 'src/api/server-entry.cjs');
check(fs.existsSync(path.join(ROOT, 'src/package.json')), 'src/package.json');

console.log('\n📁 Build artifacts (à générer):');
check(fs.existsSync(path.join(ROOT, 'dist/ui')), 'dist/ui/ (résultat Vite build)', true);
check(fs.existsSync(path.join(ROOT, 'dist/ui/index.html')), 'dist/ui/index.html', true);
check(fs.existsSync(path.join(ROOT, 'dist/ui/assets')), 'dist/ui/assets/ avec index-*.js/css', true);

if (!fs.existsSync(path.join(ROOT, 'dist/ui'))) {
  console.log('\n💡 SOLUTION: Lancer d\'abord npm run build');
}

console.log('\n📦 electron-builder.json:');
const builderConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));

// Vérifier la config
check(!builderConfig.asarUnpack?.includes('src/**'), 'asarUnpack: src/** SUPPRIMÉ (évite app.asar.unpacked)');
check(!builderConfig.files?.includes('dist/ui/**/*'), 'files: dist/ui/**/* SUPPRIMÉ (utilise extraResources)');
check(!builderConfig.files?.includes('print/**/*'), 'files: print/**/* SUPPRIMÉ (utilise extraResources)');

const hasDist = builderConfig.extraResources?.some(r => r.from === 'dist/ui');
const hasPrint = builderConfig.extraResources?.some(r => r.from === 'print');
const hasConfig = builderConfig.extraResources?.some(r => r.from === 'config.env');

check(hasDist, 'extraResources: dist/ui → ui', !hasDist);
check(hasPrint, 'extraResources: print → print', !hasPrint);
check(hasConfig, 'extraResources: config.env → config.env', !hasConfig);

console.log('\n🗂️  Structure attendue après build:');
console.log(`
Gracepos.exe
resources/
  ui/                    ← Servie au navigateur
    index.html
    assets/
      index-xxxxx.js
      index-xxxxx.css
  print/                 ← Templates d'impression
    module.js
    templates/
    assets/
  config.env             ← Variables d'environnement
  ai/                    ← AI LaGrace
    main.py
    ...
app.asar/
  electron/              ← Code Electron
  src/                   ← Code backend (serveur)
  package.json
`);

console.log('\n🚀 Commandes build:');
console.log(`
  npm run build          # Vite build (crée dist/ui)
  npm run build:exe      # electron-builder (crée l'EXE)
`);

// Résumé
console.log('\n' + '='.repeat(60));
if (errors === 0 && warnings === 0) {
  console.log('✅ Tous les checks sont passés! Prêt pour build.');
} else if (errors === 0) {
  console.log(`⚠️  ${warnings} warning(s) - Build possible mais vérifier.`);
} else {
  console.log(`❌ ${errors} erreur(s) critique(s) - Fix avant de builder.`);
  console.log('💡 Voir les messages ❌ ci-dessus.');
}
console.log('='.repeat(60) + '\n');

process.exit(errors > 0 ? 1 : 0);
