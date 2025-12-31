#!/usr/bin/env node

/**
 * Build sans signing - contournement du problème winCodeSign
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// Désactiver le signing dans electron-builder
process.env.SKIP_SIGNING = 'true';
process.env.CSC_LINK = '';
process.env.CSC_KEY_PASSWORD = '';
process.env.WIN_CSC_LINK = '';
process.env.WIN_CSC_KEY_PASSWORD = '';

// Modifier la config au runtime
const packageJsonPath = path.join(projectRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Assurer que le signing est désactivé
packageJson.build.win.sign = null;
packageJson.build.win.certificateFile = null;
packageJson.build.win.signingHashAlgorithms = [];

// Écrire temporairement
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log('Lancement electron-builder sans signing...');

// Appeler electron-builder avec un patch
const result = spawnSync('npx', ['electron-builder', '--win', '--publish', 'never', '-c.win.sign=null'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true
});

// Restaurer
process.exit(result.status || 0);
