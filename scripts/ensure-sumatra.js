/**
 * scripts/ensure-sumatra.js
 * Télécharge SumatraPDF portable si non présent
 * Exécuté automatiquement avant le build
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SUMATRA_URL = 'https://files2.sumatrapdfreader.org/software/sumatrapdf/rel/3.5.2/SumatraPDF-3.5.2-64.zip';
const VENDOR_DIR = path.join(ROOT, 'vendor', 'sumatra');
const SUMATRA_EXE = path.join(VENDOR_DIR, 'SumatraPDF.exe');
const ZIP_FILE = path.join(VENDOR_DIR, 'SumatraPDF.zip');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  📦 VÉRIFICATION SUMATRAPDF PORTABLE                       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Vérifier si déjà présent
if (existsSync(SUMATRA_EXE)) {
  console.log(`✅ SumatraPDF déjà présent: ${SUMATRA_EXE}`);
  process.exit(0);
}

console.log('⬇️  Téléchargement de SumatraPDF portable...');

// Créer le dossier vendor/sumatra
mkdirSync(VENDOR_DIR, { recursive: true });

// Télécharger le fichier
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    
    const request = https.get(url, (response) => {
      // Gérer les redirections
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        unlinkSync(dest);
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      const total = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const percent = Math.round((downloaded / total) * 100);
        process.stdout.write(`\r   Progression: ${percent}% (${(downloaded/1024/1024).toFixed(1)}MB)`);
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log('\n');
        resolve();
      });
    });
    
    request.on('error', (err) => {
      file.close();
      unlinkSync(dest);
      reject(err);
    });
  });
}

// Extraire le ZIP avec PowerShell (Windows)
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main() {
  try {
    // Télécharger
    await download(SUMATRA_URL, ZIP_FILE);
    console.log('✅ Téléchargement terminé');
    
    // Extraire
    console.log('📂 Extraction...');
    await extractZip(ZIP_FILE, VENDOR_DIR);
    console.log('✅ Extraction terminée');
    
    // Renommer l'exe si nécessaire
    const extractedExe = path.join(VENDOR_DIR, 'SumatraPDF-3.5.2-64.exe');
    if (existsSync(extractedExe) && !existsSync(SUMATRA_EXE)) {
      fs.renameSync(extractedExe, SUMATRA_EXE);
    }
    
    // Nettoyer le ZIP
    if (existsSync(ZIP_FILE)) {
      unlinkSync(ZIP_FILE);
    }
    
    console.log(`\n✅ SumatraPDF installé: ${SUMATRA_EXE}`);
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ SUMATRAPDF PRÊT POUR LE PACKAGING                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
  } catch (err) {
    console.error('\n❌ Erreur:', err.message);
    console.log('\n⚠️  Vous pouvez télécharger manuellement SumatraPDF:');
    console.log(`   URL: ${SUMATRA_URL}`);
    console.log(`   Destination: ${SUMATRA_EXE}`);
    process.exit(1);
  }
}

main();
