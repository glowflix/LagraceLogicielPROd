#!/usr/bin/env node
/**
 * Script pour attendre que les serveurs soient prêts puis lancer Electron
 */
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const BACKEND_URL = 'http://localhost:3030/api/health';
const VITE_URL = 'http://localhost:5173';
const MAX_ATTEMPTS = 60; // 30 secondes max (500ms * 60)
const DELAY_MS = 250; // Réduit de 500ms à 250ms pour réponse plus rapide
const PATIENCE_MODE = true; // Continue d'attendre même après le timeout initial

/**
 * ✅ IMPORTANT (Fix ESM en production)
 * Assure que src/package.json existe avec { "type": "module" }
 * Ainsi, quand Electron Builder copie src -> resources/src, Node verra "type":"module"
 * et acceptera les imports ESM dans resources/src/api/server.js.
 */
function ensureSrcEsmModuleMarker() {
  try {
    const srcPkgPath = resolve(projectRoot, 'src', 'package.json');
    if (!fs.existsSync(srcPkgPath)) {
      fs.writeFileSync(srcPkgPath, JSON.stringify({ type: 'module' }, null, 2), 'utf8');
      console.log(`✅ Créé: ${srcPkgPath} (type: module)`);
    } else {
      // Optionnel: vérifier que "type":"module" est bien présent
      const raw = fs.readFileSync(srcPkgPath, 'utf8');
      let json = {};
      try { json = JSON.parse(raw); } catch {}
      if (json.type !== 'module') {
        json.type = 'module';
        fs.writeFileSync(srcPkgPath, JSON.stringify(json, null, 2), 'utf8');
        console.log(`✅ Mis à jour: ${srcPkgPath} (type: module)`);
      } else {
        console.log(`ℹ️ OK: src/package.json (type: module)`);
      }
    }
  } catch (e) {
    console.warn('⚠️ Impossible de garantir src/package.json (type: module):', e.message);
    console.warn('💡 Crée manuellement src/package.json avec: { "type": "module" }');
  }
}

function checkServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 300 }, (res) => {
      // Accepter 200, 304, et les redirections 301/302 (Vite peut rediriger)
      const ok = res.statusCode >= 200 && res.statusCode < 400;
      resolve(ok);
    });
    
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServers() {
  console.log('⏳ Attente des serveurs...');
  console.log(`   Backend: ${BACKEND_URL}`);
  console.log(`   Vite: ${VITE_URL}`);
  
  // Vérifier immédiatement d'abord (en parallèle)
  let [backendReady, viteReady] = await Promise.all([
    checkServer(BACKEND_URL),
    checkServer(VITE_URL)
  ]);
  
  if (backendReady && viteReady) {
    console.log('✅ Tous les serveurs sont déjà prêts !');
    return true;
  }
  
  let attempt = 0;
  let timeoutWarningShown = false;
  const startTime = Date.now();
  
  // Boucle d'attente (infinie en mode patience si le backend prend du temps)
  while (true) {
    attempt++;
    
    // Vérifier les deux serveurs en parallèle pour plus de rapidité
    [backendReady, viteReady] = await Promise.all([
      checkServer(BACKEND_URL),
      checkServer(VITE_URL)
    ]);
    
    if (backendReady && viteReady) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Tous les serveurs sont prêts après ${elapsed}s !`);
      return true;
    }
    
    // Afficher le statut toutes les 1 secondes (toutes les 4 tentatives avec 250ms delay)
    if (attempt % 4 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const backendStatus = backendReady ? '✅' : '⏳';
      const viteStatus = viteReady ? '✅' : '⏳';
      console.log(`   [${elapsed}s] Backend: ${backendStatus} | Vite: ${viteStatus}`);
    }
    
    // Vérifier si on a atteint le timeout initial
    if (attempt >= MAX_ATTEMPTS) {
      if (PATIENCE_MODE) {
        // Mode patience: continuer d'attendre si au moins un serveur progresse
        if (!timeoutWarningShown) {
          console.log('⚠️  Timeout initial dépassé, mais le mode patience est activé...');
          console.log('   💡 Le backend peut prendre du temps à charger les modules (impression, etc.)');
          console.log('   ⏳ Attente prolongée...');
          timeoutWarningShown = true;
        }
        // Continuer d'attendre, mais avec des intervalles plus longs
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      } else {
        console.error('❌ Timeout: Les serveurs ne sont pas prêts après 90 secondes');
        return false;
      }
    }
    
    // Délai réduit pour les premières tentatives
    const delay = attempt < 10 ? 200 : DELAY_MS; // Plus rapide au début
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

async function launchElectron() {
  console.log('🚀 Lancement d\'Electron...');
  
  // Utiliser npx pour lancer Electron (plus fiable)
  const isWindows = process.platform === 'win32';
  const npxCmd = isWindows ? 'npx.cmd' : 'npx';
  
  console.log(`   Commande: ${npxCmd} electron .`);
  console.log(`   Répertoire: ${projectRoot}`);
  
  const electronProcess = spawn(npxCmd, ['electron', '.'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SKIP_BACKEND_WAIT: 'true', // Signal: Ne pas démarrer le backend (il tourne déjà depuis npm run dev:backend)
    },
    stdio: 'inherit', // Hériter de stdin/stdout/stderr pour voir les logs
    shell: isWindows,
  });
  
  electronProcess.on('error', (error) => {
    console.error('❌ Erreur lors du lancement d\'Electron:', error);
    console.error('💡 Vérifiez que Electron est installé: npm install electron --save-dev');
    console.error('💡 Ou essayez: npx electron .');
    process.exit(1);
  });
  
  electronProcess.on('exit', (code) => {
    console.log(`\n📴 Electron fermé avec le code ${code}`);
    process.exit(code || 0);
  });
  
  // Gérer Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n🛑 Arrêt d\'Electron...');
    electronProcess.kill('SIGTERM');
  });
  
  process.on('SIGTERM', () => {
    electronProcess.kill('SIGTERM');
  });
}

// Main
console.log('📦 Script de lancement Electron démarré');
console.log(`   Répertoire projet: ${projectRoot}`);

// ✅ CORRECTION: Assurer que src/package.json existe avant le build
ensureSrcEsmModuleMarker();

waitForServers().then((ready) => {
  if (ready) {
    // Lancer Electron immédiatement sans délai
    launchElectron();
  } else {
    console.error('❌ Impossible de lancer Electron, les serveurs ne sont pas prêts');
    process.exit(1);
  }
}).catch((error) => {
  console.error('❌ Erreur lors de l\'attente des serveurs:', error);
  process.exit(1);
});

