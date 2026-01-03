#!/usr/bin/env node
/**
 * Script pour s'assurer que src/ et print/ ont un package.json
 * avec "type": "module" pour que Node.js les traite comme ESM
 * 
 * Cela évite les erreurs "Cannot use import statement outside a module"
 * en production (EXE) où les fichiers sont extraits et doivent être reconnus comme ESM
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function ensureTypeModule(dir) {
  const pkgPath = path.join(projectRoot, dir, 'package.json');
  const content = JSON.stringify({ type: 'module' }, null, 2);

  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, content, 'utf8');
    console.log(`✅ Créé ${dir}/package.json (type: module)`);
    return;
  }

  try {
    const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (json.type !== 'module') {
      json.type = 'module';
      fs.writeFileSync(pkgPath, JSON.stringify(json, null, 2), 'utf8');
      console.log(`✅ Mis à jour ${dir}/package.json (type: module)`);
    } else {
      console.log(`ℹ️  OK ${dir}/package.json (type: module)`);
    }
  } catch {
    fs.writeFileSync(pkgPath, content, 'utf8');
    console.log(`✅ Réparé ${dir}/package.json (type: module)`);
  }
}

// ✅ Garantir que src/ et print/ sont des modules ESM
ensureTypeModule('src');
ensureTypeModule('print');

console.log('✅ ESM markers vérifiés');
