#!/usr/bin/env node

/**
 * Workaround pour electron-builder qui refuse de compiler sans winCodeSign
 * Utilise electron-builder mais skip la signature Windows
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('=== Build Electron Alternative (Skip Windows Signing) ===\n');

// Définir des variables d'environnement
const env = {
  ...process.env,
  // Désactiver tous les certificats de signature
  WIN_CSC_KEY_PASSWORD: '',
  WIN_CSC_LINK: '',
  CSC_LINK: '',
  CSC_KEY_PASSWORD: '',
  // Forcer à ignorer les perms
  ELECTRON_BUILDER_CACHE: path.join(__dirname, '.eb-cache')
};

try {
  // Lancer electron-builder sans signing
  console.log('Launching electron-builder...\n');
  
  execSync('npx electron-builder --win --publish=never --config.win.certificateFile="" --config.nsis.artifactName="${productName}-${version}-${arch}.${ext}"', {
    cwd: __dirname,
    env: env,
    stdio: 'inherit'
  });
  
  console.log('\n✅ Build succeeded!');
  console.log('Check dist-electron/ for the installer');
  
} catch (error) {
  console.error('\n❌ Build failed');
  console.error('Error:', error.message);
  
  // Alternative: try with old electron-builder version
  console.log('\nTrying fallback approach...');
  
  try {
    // Créer un stub pour winCodeSign
    const cacheDir = path.join(env.ELECTRON_BUILDER_CACHE, 'winCodeSign');
    const stubDir = path.join(cacheDir, 'stub');
    
    if (!fs.existsSync(stubDir)) {
      fs.mkdirSync(stubDir, { recursive: true });
      fs.writeFileSync(path.join(stubDir, 'signtool.exe'), '');
    }
    
    console.log('Retrying with stub signtool...');
    execSync('npx electron-builder --win --publish=never', {
      cwd: __dirname,
      stdio: 'inherit'
    });
    
  } catch (e) {
    console.error('Fallback also failed. Please check electron-builder issues.');
    process.exit(1);
  }
}
