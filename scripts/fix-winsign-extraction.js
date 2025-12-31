#!/usr/bin/env node
// Force extraction without symlinks on Windows
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cacheDir = path.join(
  process.env.APPDATA || process.env.HOME,
  'electron-builder/Cache/winCodeSign'
);

if (!fs.existsSync(cacheDir)) {
  process.exit(0);
}

// Find all 7z files
const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.7z'));

for (const file of files) {
  const filePath = path.join(cacheDir, file);
  const extractDir = filePath.replace('.7z', '');
  
  if (!fs.existsSync(extractDir)) {
    try {
      // Use 7zip with option to skip on error
      const cmd = `"${path.join(__dirname, '../node_modules/7zip-bin/win/x64/7za.exe')}" x -aoa -bse0 -bso0 "${filePath}" -o"${extractDir}"`;
      execSync(cmd, { stdio: 'pipe' });
    } catch (e) {
      // Ignore extraction errors
      console.log(`Extraction error for ${file}, continuing...`);
    }
  }
}

process.exit(0);
