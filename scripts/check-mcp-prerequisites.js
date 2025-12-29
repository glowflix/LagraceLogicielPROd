#!/usr/bin/env node

/**
 * Script de vérification des prérequis pour Chrome DevTools MCP
 * Vérifie que Node.js, npm et Chrome sont installés
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

console.log('🔍 Vérification des prérequis pour Chrome DevTools MCP...\n');

let allOk = true;

// Vérifier Node.js
console.log('1️⃣  Vérification de Node.js...');
try {
  const nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
  const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
  
  if (majorVersion >= 20) {
    console.log(`   ✅ Node.js ${nodeVersion} installé (requis: Node 20+)`);
  } else {
    console.log(`   ⚠️  Node.js ${nodeVersion} installé (recommandé: Node 20+)`);
    console.log('   💡 Mise à jour recommandée mais pas bloquante');
  }
} catch (error) {
  console.log('   ❌ Node.js non trouvé');
  console.log('   💡 Installez Node.js depuis https://nodejs.org/');
  allOk = false;
}

// Vérifier npm
console.log('\n2️⃣  Vérification de npm...');
try {
  const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim();
  console.log(`   ✅ npm ${npmVersion} installé`);
} catch (error) {
  console.log('   ❌ npm non trouvé');
  console.log('   💡 npm devrait être installé avec Node.js');
  allOk = false;
}

// Vérifier npx
console.log('\n3️⃣  Vérification de npx...');
try {
  const npxVersion = execSync('npx --version', { encoding: 'utf-8' }).trim();
  console.log(`   ✅ npx ${npxVersion} disponible`);
} catch (error) {
  console.log('   ❌ npx non trouvé');
  console.log('   💡 npx devrait être installé avec npm');
  allOk = false;
}

// Vérifier Chrome (Windows)
console.log('\n4️⃣  Vérification de Chrome...');
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
];

let chromeFound = false;
for (const path of chromePaths) {
  if (existsSync(path)) {
    console.log(`   ✅ Chrome trouvé: ${path}`);
    chromeFound = true;
    break;
  }
}

if (!chromeFound) {
  console.log('   ⚠️  Chrome non trouvé dans les emplacements standards');
  console.log('   💡 Chrome peut être installé ailleurs ou vous pouvez utiliser Chromium');
  console.log('   💡 Téléchargez Chrome depuis https://www.google.com/chrome/');
}

// Vérifier les fichiers de configuration
console.log('\n5️⃣  Vérification des fichiers de configuration...');
const configFiles = [
  '.cursor-mcp-config.json',
  '.cursor-mcp-config-with-browser-url.json',
  'SETUP-CHROME-DEVTOOLS-MCP.md',
];

for (const file of configFiles) {
  if (existsSync(file)) {
    console.log(`   ✅ ${file} trouvé`);
  } else {
    console.log(`   ❌ ${file} manquant`);
    allOk = false;
  }
}

// Résumé
console.log('\n' + '='.repeat(50));
if (allOk && chromeFound) {
  console.log('✅ Tous les prérequis sont satisfaits !');
  console.log('\n📝 Prochaines étapes :');
  console.log('   1. Ouvrez Cursor Settings (Ctrl+,)');
  console.log('   2. Allez dans MCP → New MCP Server');
  console.log('   3. Copiez la config depuis .cursor-mcp-config.json');
  console.log('   4. Redémarrez Cursor');
  console.log('\n📖 Documentation complète : SETUP-CHROME-DEVTOOLS-MCP.md');
} else {
  console.log('⚠️  Certains prérequis manquent');
  console.log('\n💡 Actions recommandées :');
  if (!allOk) {
    console.log('   - Installez Node.js 20+ depuis https://nodejs.org/');
  }
  if (!chromeFound) {
    console.log('   - Installez Chrome depuis https://www.google.com/chrome/');
  }
  console.log('\n📖 Consultez SETUP-CHROME-DEVTOOLS-MCP.md pour plus d\'informations');
}
console.log('='.repeat(50));

process.exit(allOk && chromeFound ? 0 : 1);

