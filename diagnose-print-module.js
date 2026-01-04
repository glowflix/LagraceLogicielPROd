#!/usr/bin/env node
/**
 * Diagnostic Print Module - Vérifier les chemins et dépendances
 * Usage: node diagnose-print-module.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('════════════════════════════════════════════════════════');
console.log('  DIAGNOSTIC PRINT MODULE - LA GRACE POS');
console.log('════════════════════════════════════════════════════════\n');

// 1️⃣ Vérifier les chemins de base
console.log('📍 CHEMINS DE BASE:');
console.log(`   __dirname: ${__dirname}`);
console.log(`   process.cwd(): ${process.cwd()}`);
console.log(`   process.resourcesPath: ${process.resourcesPath || 'N/A'}`);
console.log('');

// 2️⃣ Vérifier le dossier print
const printDirDev = path.join(__dirname, 'print');
const printDirProd = process.resourcesPath 
  ? path.join(process.resourcesPath, 'print')
  : printDirDev;

console.log('🖨️  DOSSIER PRINT:');
console.log(`   Dev: ${printDirDev}`);
console.log(`        Existe: ${fs.existsSync(printDirDev) ? '✅' : '❌'}`);
console.log(`   Prod: ${printDirProd}`);
console.log(`        Existe: ${fs.existsSync(printDirProd) ? '✅' : '❌'}`);
console.log('');

// 3️⃣ Vérifier print/module.js
const moduleFileDev = path.join(printDirDev, 'module.js');
const moduleFileProd = path.join(printDirProd, 'module.js');

console.log('📄 FICHIER MODULE:');
console.log(`   Dev: ${moduleFileDev}`);
console.log(`        Existe: ${fs.existsSync(moduleFileDev) ? '✅' : '❌'}`);
console.log(`   Prod: ${moduleFileProd}`);
console.log(`        Existe: ${fs.existsSync(moduleFileProd) ? '✅' : '❌'}`);
console.log('');

// 4️⃣ Vérifier les dossiers templates et assets
const templatesDev = path.join(printDirDev, 'templates');
const assetsDev = path.join(printDirDev, 'assets');
const templatesProd = path.join(printDirProd, 'templates');
const assetsProd = path.join(printDirProd, 'assets');

console.log('📁 DOSSIERS TEMPLATES & ASSETS:');
console.log(`   Dev Templates: ${templatesDev} → ${fs.existsSync(templatesDev) ? '✅' : '❌'}`);
console.log(`   Dev Assets: ${assetsDev} → ${fs.existsSync(assetsDev) ? '✅' : '❌'}`);
console.log(`   Prod Templates: ${templatesProd} → ${fs.existsSync(templatesProd) ? '✅' : '❌'}`);
console.log(`   Prod Assets: ${assetsProd} → ${fs.existsSync(assetsProd) ? '✅' : '❌'}`);
console.log('');

// 5️⃣ Vérifier les dépendances npm du print module
console.log('📦 DÉPENDANCES REQUISES:');
const deps = [
  'fs',        // builtin
  'path',      // builtin
  'chokidar',  // npm
  'dayjs',     // npm
  'express',   // npm
  'pdf-to-printer',  // npm
  'Handlebars',      // npm (package.json: handlebars)
];

for (const dep of deps) {
  const isBuiltin = ['fs', 'path', 'child_process', 'url'].includes(dep);
  
  if (isBuiltin) {
    console.log(`   ✅ ${dep} (builtin)`);
  } else {
    // Vérifier dans node_modules
    const nodeModulesPath = path.join(__dirname, 'node_modules', dep);
    const exists = fs.existsSync(nodeModulesPath);
    console.log(`   ${exists ? '✅' : '❌'} ${dep}`);
    if (!exists) {
      console.log(`        Chemin attendu: ${nodeModulesPath}`);
    }
  }
}
console.log('');

// 6️⃣ Vérifier node_modules global
const nodeModulesPath = path.join(__dirname, 'node_modules');
console.log('📦 NODE_MODULES:');
console.log(`   Chemin: ${nodeModulesPath}`);
console.log(`   Existe: ${fs.existsSync(nodeModulesPath) ? '✅' : '❌'}`);

if (fs.existsSync(nodeModulesPath)) {
  const modules = fs.readdirSync(nodeModulesPath)
    .filter(m => !m.startsWith('.'))
    .slice(0, 20);
  console.log(`   Premiers modules: ${modules.join(', ')}`);
  if (fs.readdirSync(nodeModulesPath).length > 20) {
    console.log(`   ... et ${fs.readdirSync(nodeModulesPath).length - 20} autres`);
  }
}
console.log('');

// 7️⃣ Vérifier electron-builder.json
const builderConfigPath = path.join(__dirname, 'electron-builder.json');
console.log('⚙️  CONFIGURATION ELECTRON-BUILDER:');
console.log(`   Chemin: ${builderConfigPath}`);
console.log(`   Existe: ${fs.existsSync(builderConfigPath) ? '✅' : '❌'}`);

if (fs.existsSync(builderConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(builderConfigPath, 'utf-8'));
    console.log(`   files: ${config.files?.length || 0} entrées`);
    console.log(`   extraResources: ${config.extraResources?.length || 0} entrées`);
    
    // Chercher print dans files et extraResources
    const hasPrintInFiles = config.files?.some(f => f.includes('print'));
    const hasPrintInExtra = config.extraResources?.some(r => r.from?.includes('print'));
    
    console.log(`   ✅ print dans files: ${hasPrintInFiles ? 'OUI' : 'NON'}`);
    console.log(`   ✅ print dans extraResources: ${hasPrintInExtra ? 'OUI' : 'NON'}`);
    
    // Vérifier node_modules
    const hasNodeModulesInFiles = config.files?.some(f => f.includes('node_modules'));
    const hasNodeModulesInExtra = config.extraResources?.some(r => r.from?.includes('node_modules'));
    
    console.log(`   ⚠️  node_modules dans files: ${hasNodeModulesInFiles ? 'OUI' : 'NON'}`);
    console.log(`   ⚠️  node_modules dans extraResources: ${hasNodeModulesInExtra ? 'OUI' : 'NON'}`);
    
    if (!hasNodeModulesInFiles && !hasNodeModulesInExtra) {
      console.log('');
      console.log('   ⚠️  ALERTE: node_modules n\'est pas inclus dans le build!');
      console.log('   ⚠️  Cela causera une erreur: Cannot find module "pdf-to-printer", etc.');
      console.log('   💡  Solution: Ajouter "node_modules/**/*" à la section "files"');
    }
  } catch (e) {
    console.log(`   ❌ Erreur lecture: ${e.message}`);
  }
}
console.log('');

// 8️⃣ RÉSUMÉ ET RECOMMANDATIONS
console.log('════════════════════════════════════════════════════════');
console.log('  RÉSUMÉ & RECOMMANDATIONS');
console.log('════════════════════════════════════════════════════════\n');

const allChecksPassed = 
  fs.existsSync(moduleFileDev) &&
  fs.existsSync(templatesDev) &&
  fs.existsSync(assetsDev) &&
  fs.existsSync(nodeModulesPath);

if (allChecksPassed) {
  console.log('✅ TOUS LES CHEMINS SEMBLENT CORRECTS EN DÉVELOPPEMENT');
  console.log('');
  console.log('En mode EXE BUILD, assurez-vous que:');
  console.log('  1. ✅ print/ est inclus dans extraResources (electron-builder.json)');
  console.log('  2. ✅ node_modules/ est inclus dans files (electron-builder.json)');
  console.log('  3. ✅ Après rebuild, le dossier dist-electron/ contient les ressources');
} else {
  console.log('❌ CERTAINS CHEMINS MANQUENT:');
  console.log('');
  if (!fs.existsSync(moduleFileDev)) {
    console.log('   ❌ print/module.js manquant');
  }
  if (!fs.existsSync(templatesDev)) {
    console.log('   ❌ print/templates/ manquant');
  }
  if (!fs.existsSync(assetsDev)) {
    console.log('   ❌ print/assets/ manquant');
  }
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('   ❌ node_modules/ manquant');
    console.log('      Solution: Exécuter "npm install"');
  }
}

console.log('');
console.log('════════════════════════════════════════════════════════\n');
