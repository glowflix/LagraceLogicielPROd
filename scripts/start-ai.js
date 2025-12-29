/**
 * Script pour démarrer AI LaGrace en arrière-plan
 * Appelé par Electron au démarrage de l'application
 */

import { spawn } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Chemin vers le dossier AI
const aiDir = path.join(projectRoot, 'ai-lagrace');
const mainPy = path.join(aiDir, 'main.py');

let aiProcess = null;

/**
 * Vérifie si Python est disponible
 */
async function checkPython() {
  return new Promise((resolve) => {
    const check = spawn('python', ['--version'], { shell: true });
    check.on('close', (code) => {
      resolve(code === 0);
    });
    check.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Démarre AI LaGrace
 */
export async function startAI() {
  // Vérifier si le fichier main.py existe
  if (!existsSync(mainPy)) {
    console.log('⚠️  AI LaGrace non installée (main.py non trouvé)');
    return null;
  }

  // Vérifier Python
  const hasPython = await checkPython();
  if (!hasPython) {
    console.log('⚠️  Python non disponible, AI LaGrace désactivée');
    return null;
  }

  console.log('🤖 Démarrage de AI LaGrace...');

  // Démarrer le processus Python
  aiProcess = spawn('python', ['main.py'], {
    cwd: aiDir,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true, // Cache la fenêtre console sur Windows
  });

  // Capturer la sortie
  aiProcess.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        console.log(`🤖 AI: ${line}`);
      }
    });
  });

  aiProcess.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        console.error(`🤖 AI Error: ${line}`);
      }
    });
  });

  aiProcess.on('close', (code) => {
    console.log(`🤖 AI LaGrace arrêtée (code: ${code})`);
    aiProcess = null;
  });

  aiProcess.on('error', (err) => {
    console.error('🤖 Erreur AI:', err);
    aiProcess = null;
  });

  return aiProcess;
}

/**
 * Arrête AI LaGrace
 */
export function stopAI() {
  if (aiProcess) {
    console.log('🤖 Arrêt de AI LaGrace...');
    
    // Sur Windows, utiliser taskkill pour tuer le processus et ses enfants
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', aiProcess.pid, '/f', '/t'], { shell: true });
    } else {
      aiProcess.kill('SIGTERM');
    }
    
    aiProcess = null;
  }
}

/**
 * Vérifie si l'AI est en cours d'exécution
 */
export function isAIRunning() {
  return aiProcess !== null && !aiProcess.killed;
}

// Si exécuté directement
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Démarrage de AI LaGrace en mode standalone...');
  startAI().then((proc) => {
    if (proc) {
      console.log('AI LaGrace démarrée avec PID:', proc.pid);
      
      // Gérer l'arrêt propre
      process.on('SIGINT', () => {
        stopAI();
        process.exit(0);
      });
    }
  });
}

