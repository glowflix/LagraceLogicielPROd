#!/usr/bin/env node

/**
 * scripts/test-architecture.js
 * Vérifie que l'architecture pro est correctement configurée
 * 
 * Usage: node scripts/test-architecture.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

console.log('🧪 Test Architecture Glowflixprojet\n');

// Tests
const tests = [
  {
    name: 'src/main/paths.js existe',
    check: () => fs.existsSync(path.join(rootDir, 'src/main/paths.js')),
  },
  {
    name: 'src/main/db.js existe',
    check: () => fs.existsSync(path.join(rootDir, 'src/main/db.js')),
  },
  {
    name: 'src/main/printJobQueue.js existe',
    check: () => fs.existsSync(path.join(rootDir, 'src/main/printJobQueue.js')),
  },
  {
    name: 'src/main/logger.js existe',
    check: () => fs.existsSync(path.join(rootDir, 'src/main/logger.js')),
  },
  {
    name: 'src/main/templateManager.js existe',
    check: () => fs.existsSync(path.join(rootDir, 'src/main/templateManager.js')),
  },
  {
    name: 'src/main/init.js existe',
    check: () => fs.existsSync(path.join(rootDir, 'src/main/init.js')),
  },
  {
    name: 'electron/init-bridge.cjs existe',
    check: () => fs.existsSync(path.join(rootDir, 'electron/init-bridge.cjs')),
  },
  {
    name: 'electron/ipc-handlers.cjs existe',
    check: () => fs.existsSync(path.join(rootDir, 'electron/ipc-handlers.cjs')),
  },
  {
    name: 'package.json existe',
    check: () => fs.existsSync(path.join(rootDir, 'package.json')),
  },
  {
    name: 'package.json type: "module"',
    check: () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
      return pkg.type === 'module';
    },
  },
  {
    name: 'better-sqlite3 dans dependencies',
    check: () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
      return !!pkg.dependencies['better-sqlite3'];
    },
  },
  {
    name: 'electron dans devDependencies',
    check: () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
      return !!pkg.devDependencies?.electron;
    },
  },
  {
    name: 'print/ existe (templates embarqués)',
    check: () => fs.existsSync(path.join(rootDir, 'print')),
  },
];

let passed = 0;
let failed = 0;

tests.forEach((test) => {
  try {
    const result = test.check();
    if (result) {
      console.log(`✅ ${test.name}`);
      passed++;
    } else {
      console.log(`❌ ${test.name}`);
      failed++;
    }
  } catch (err) {
    console.log(`❌ ${test.name}: ${err.message}`);
    failed++;
  }
});

console.log(`\n📊 Résultats: ${passed}/${tests.length} ✅`);

if (failed > 0) {
  console.log(`\n⚠️  ${failed} test(s) échoué(s)\n`);
  process.exit(1);
} else {
  console.log(`\n✨ Tous les tests passés!\n`);
  console.log('Prochaines étapes:');
  console.log('1. npm install (si jamais)');
  console.log('2. npm run dev (tester en dev)');
  console.log('3. npm run build:exe (créer l\'installeur)');
  process.exit(0);
}
