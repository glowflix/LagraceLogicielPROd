#!/usr/bin/env node

// Patcher electron-builder pour désactiver la signature Windows
const path = require('path');
const fs = require('fs');

const builderPath = path.join(__dirname, 'node_modules/app-builder-lib/out/winPackager.js');

if (fs.existsSync(builderPath)) {
  let content = fs.readFileSync(builderPath, 'utf8');
  
  // Patch la fonction signApp
  content = content.replace(
    /signApp\(.*?\{/s,
    'signApp() { console.log("[SKIP] Windows code signing disabled"); return Promise.resolve(); } signApp_original() {'
  );
  
  fs.writeFileSync(builderPath, content);
  console.log('electron-builder patched to skip Windows code signing');
}

// Lancer electron-builder
require('electron-builder').build().catch(e => {
  console.error('Build failed:', e);
  process.exit(1);
});
