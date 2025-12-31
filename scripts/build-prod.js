#!/usr/bin/env node

/**
 * Script de build professionnel pour Glowflix POS
 * - Vérifie que SQLite/better-sqlite3 est présent
 * - Bundle tout dans l'EXE (backend, UI, base données)
 * - Crée un installeur NSIS avec branding Glowflix
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

console.log('\n🔧 GLOWFLIX POS - Build Professionnel v1.0\n');

// Patch electron-builder winCodeSign issue
console.log('🔨 Patching electron-builder winCodeSign...');
const winPackagerPath = path.join(projectRoot, 'node_modules', 'app-builder-lib', 'out', 'winPackager.js');
if (fs.existsSync(winPackagerPath)) {
  let content = fs.readFileSync(winPackagerPath, 'utf8');
  if (!content.includes('return false; // PATCHED')) {
    const patchPoint = 'async signApp(zipFile, isNsis) {';
    if (content.includes(patchPoint)) {
      content = content.replace(
        patchPoint + '\n    const signOptions = this.signOptions;',
        patchPoint + '\n    return false; // PATCHED: Skip code signing\n    const signOptions = this.signOptions;'
      );
      fs.writeFileSync(winPackagerPath, content, 'utf8');
      console.log('✅ Patch appliqué\n');
    }
  }
}

// 1. Vérifications prérequis
console.log('✅ Vérification des prérequis...');

const checks = {
  'better-sqlite3': path.join(projectRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  'Vite dist': path.join(projectRoot, 'dist'),
  'Electron main': path.join(projectRoot, 'electron', 'main.cjs'),
  'Backend API': path.join(projectRoot, 'src', 'api', 'server.js'),
  'Icon': path.join(projectRoot, 'asset', 'image', 'icon', 'photo.ico')
};

let missingDeps = [];

for (const [name, filePath] of Object.entries(checks)) {
  if (!fs.existsSync(filePath)) {
    console.log(`   ❌ ${name} MANQUANT: ${filePath}`);
    missingDeps.push(name);
  } else {
    console.log(`   ✅ ${name}`);
  }
}

if (missingDeps.length > 0) {
  console.error(`\n❌ ERREUR: Éléments manquants pour le build:`);
  console.error(missingDeps.join(', '));
  
  if (missingDeps.includes('Vite dist')) {
    console.log('\n📝 Exécuter: npm run build:ui');
  }
  if (missingDeps.includes('better-sqlite3')) {
    console.log('\n📝 Exécuter: cd node_modules/better-sqlite3 && node-gyp rebuild');
  }
  process.exit(1);
}

console.log('\n✅ Tous les prérequis sont présents!\n');

// 2. Builder l'UI (Vite)
console.log('🎨 Construction UI avec Vite...');
try {
  execSync('npm run build:ui', { cwd: projectRoot, stdio: 'inherit' });
  console.log('✅ UI construite avec succès\n');
} catch (error) {
  console.error('❌ Erreur lors du build UI');
  process.exit(1);
}

// 3. Package avec electron-builder
console.log('📦 Création installeur avec electron-builder...');
try {
  // Configuration sans signing
  const buildEnv = { 
    ...process.env, 
    GYP_MSVS_VERSION: '2022',
    SKIP_SIGNING: 'true',
    CSC_LINK: '',
    CSC_KEY_PASSWORD: '',
    WIN_CSC_LINK: '',
    WIN_CSC_KEY_PASSWORD: ''
  };
  
  execSync('npx electron-builder --win --publish never -c.win.sign=null', { 
    cwd: projectRoot,
    stdio: 'inherit',
    env: buildEnv
  });
  console.log('✅ Installeur créé avec succès\n');
} catch (error) {
  console.error('❌ Erreur lors de la création de l\'installeur');
  process.exit(1);
}

// 4. Vérifier le fichier EXE généré
console.log('🔍 Vérification du fichier d\'installation...');
const distDir = path.join(projectRoot, 'dist-electron');
const installerFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.exe'));

if (installerFiles.length === 0) {
  console.error('❌ Aucun fichier EXE généré');
  process.exit(1);
}

const installerPath = path.join(distDir, installerFiles[0]);
const installerSize = (fs.statSync(installerPath).size / 1024 / 1024).toFixed(2);

console.log(`✅ Installeur généré: ${installerFiles[0]} (${installerSize} MB)\n`);

// 5. Résumé
console.log('═════════════════════════════════════════════════');
console.log('✨ BUILD GLOWFLIX POS RÉUSSI!');
console.log('═════════════════════════════════════════════════\n');
console.log(`📦 Fichier d'installation: ${installerPath}`);
console.log(`💾 Taille: ${installerSize} MB`);
console.log(`📍 Contient: Backend, UI, SQLite, Electron`);
console.log(`🏢 Société: Glowflix`);
console.log(`🌐 Site: www.glowflix.com`);
console.log(`⚙️  Permissions: Admin (requises)`);
console.log('\n💡 Le logiciel est prêt pour distribution professionnelle!\n');

console.log('Prochaines étapes:');
console.log('  1. Distribuer l\'installeur');
console.log('  2. Les utilisateurs l\'exécutent en tant qu\'administrateur');
console.log('  3. Installation hors ligne complète (aucune dépendance externe)');
console.log('\n');
