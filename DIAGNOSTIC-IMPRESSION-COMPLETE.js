// DIAGNOSTIC-IMPRESSION-COMPLETE.js
// Script de diagnostic complet pour tester le système d'impression Glowflixprojet
// Usage: node DIAGNOSTIC-IMPRESSION-COMPLETE.js

import fs from 'fs';
import path from 'path';
import os from 'os';

console.log('🔍 ==========================================');
console.log('🔍 DIAGNOSTIC COMPLET DU SYSTÈME D\'IMPRESSION');
console.log('🔍 ==========================================\n');

// ============================================
// 1. Détection de l'environnement
// ============================================
console.log('📋 1. ENVIRONNEMENT');
console.log('   ✓ Platform:', process.platform);
console.log('   ✓ Node version:', process.version);
console.log('   ✓ NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('   ✓ Username:', os.userInfo().username);
console.log('   ✓ CWD:', process.cwd());
console.log('');

// ============================================
// 2. Variables d'environnement critiques
// ============================================
console.log('📋 2. VARIABLES D\'ENVIRONNEMENT');
console.log('   ✓ APPDATA:', process.env.APPDATA || '❌ NON DÉFINI');
console.log('   ✓ GLOWFLIX_ROOT_DIR:', process.env.GLOWFLIX_ROOT_DIR || '(non défini, utilise valeur par défaut)');
console.log('   ✓ LAGRACE_DATA_DIR:', process.env.LAGRACE_DATA_DIR || '(non défini)');
console.log('   ✓ GLOWFLIX_PRINT_DIR:', process.env.GLOWFLIX_PRINT_DIR || '(non défini, utilise valeur par défaut)');
console.log('');

// ============================================
// 3. Logique de détection du Data Root
// ============================================
console.log('📋 3. DÉTECTION DU DATA ROOT');

function getDataRoot() {
  if (process.env.LAGRACE_DATA_DIR) return path.resolve(process.env.LAGRACE_DATA_DIR);
  if (process.env.GLOWFLIX_ROOT_DIR) return path.resolve(process.env.GLOWFLIX_ROOT_DIR);

  if (process.platform === "win32") {
    const appDataRoaming = process.env.APPDATA;
    if (appDataRoaming) {
      const isPackaged = process.env.NODE_ENV === 'production' || 
                         process.defaultApp === false ||
                         (process.mainModule && process.mainModule.filename.indexOf('app.asar') !== -1);
      
      if (isPackaged || process.env.NODE_ENV === 'production') {
        return path.join(appDataRoaming, "Glowflixprojet");
      }
      
      const devPath = "C:\\Glowflixprojet";
      if (fs.existsSync(devPath)) {
        return devPath;
      }
      
      return path.join(appDataRoaming, "Glowflixprojet");
    }
    return "C:\\Glowflixprojet";
  }
  
  return path.join(os.homedir(), "Glowflixprojet");
}

const dataRoot = getDataRoot();
console.log('   ✓ Data Root détecté:', dataRoot);

function getPrintDir() {
  if (process.env.GLOWFLIX_PRINT_DIR) return path.resolve(process.env.GLOWFLIX_PRINT_DIR);
  return path.join(dataRoot, "printer");
}

const printDir = getPrintDir();
console.log('   ✓ Print Dir:', printDir);
console.log('');

// ============================================
// 4. Vérification de l'existence des dossiers
// ============================================
console.log('📋 4. VÉRIFICATION DES DOSSIERS');

const requiredDirs = [
  printDir,
  path.join(printDir, 'ok'),
  path.join(printDir, 'err'),
  path.join(printDir, 'tmp'),
  path.join(printDir, 'templates'),
  path.join(printDir, 'assets'),
];

let allDirsExist = true;
for (const dir of requiredDirs) {
  const exists = fs.existsSync(dir);
  const status = exists ? '✅' : '❌';
  console.log(`   ${status} ${path.relative(printDir, dir) || 'ROOT'}: ${dir}`);
  if (!exists) allDirsExist = false;
}
console.log('');

if (!allDirsExist) {
  console.log('⚠️  ATTENTION: Des dossiers manquent! Création automatique...\n');
  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`   ✅ Créé: ${dir}`);
      } catch (error) {
        console.log(`   ❌ ERREUR création: ${dir}`);
        console.log(`      → ${error.message}`);
      }
    }
  }
  console.log('');
}

// ============================================
// 5. Permissions d'écriture
// ============================================
console.log('📋 5. TEST DES PERMISSIONS D\'ÉCRITURE');

try {
  const testFile = path.join(printDir, `test-write-${Date.now()}.tmp`);
  fs.writeFileSync(testFile, 'Test de permissions', 'utf-8');
  
  if (fs.existsSync(testFile)) {
    const content = fs.readFileSync(testFile, 'utf-8');
    if (content === 'Test de permissions') {
      console.log('   ✅ Écriture: OK');
      console.log('   ✅ Lecture: OK');
      fs.unlinkSync(testFile);
      console.log('   ✅ Suppression: OK');
    } else {
      console.log('   ❌ Lecture: Contenu incorrect');
    }
  } else {
    console.log('   ❌ Écriture: Fichier non créé');
  }
} catch (error) {
  console.log('   ❌ ERREUR de permissions:');
  console.log(`      → ${error.message}`);
  console.log(`      → Code: ${error.code}`);
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    console.log('      → SOLUTION: Exécuter en tant qu\'administrateur ou vérifier les permissions');
  }
}
console.log('');

// ============================================
// 6. Fichiers en attente dans le dossier printer
// ============================================
console.log('📋 6. FICHIERS EN ATTENTE');

try {
  const files = fs.readdirSync(printDir);
  const jobFiles = files.filter(f => f.endsWith('.json') || f.endsWith('.pdf'));
  
  if (jobFiles.length === 0) {
    console.log('   ✓ Aucun job en attente (normal)');
  } else {
    console.log(`   ⚠️  ${jobFiles.length} job(s) en attente:`);
    jobFiles.forEach(file => {
      const fullPath = path.join(printDir, file);
      const stats = fs.statSync(fullPath);
      const age = Math.round((Date.now() - stats.mtimeMs) / 1000);
      console.log(`      - ${file} (${stats.size} bytes, ${age}s)`);
    });
  }
} catch (error) {
  console.log('   ❌ ERREUR lecture dossier:');
  console.log(`      → ${error.message}`);
}
console.log('');

// ============================================
// 7. Création d'un job de test
// ============================================
console.log('📋 7. CRÉATION D\'UN JOB DE TEST');

const testJobPayload = {
  template: 'receipt-80',
  copies: 1,
  data: {
    factureNum: `TEST-${Date.now()}`,
    numero: `TEST-${Date.now()}`,
    client: 'Client Test Diagnostic',
    taux: 2800,
    dateISO: new Date().toISOString(),
    lignes: [
      {
        code: 'TEST001',
        nom: 'Produit Test',
        unite: 'piece',
        mark: '',
        qty: 1,
        qteLabel: '1',
        puFC: 1000,
        totalFC: 1000,
        puUSD: 0.36,
        totalUSD: 0.36,
      }
    ],
    totalFC: 1000,
    totalUSD: 0.36,
    printCurrency: 'FC',
    entreprise: {
      nom: "ALIMENTATION LA GRACE",
      rccm: "CD/KIS/RCCM 22-A-00172",
      impot: "A220883T",
      tel: "+243 896 885 373 / +243 819 082 637",
      adresse: "Avenue Lac Tanganyika, Makiso, Kisangani, R.D.Congo"
    },
    meta: {
      vendeur: 'Diagnostic Script',
      payment_mode: 'cash',
      autoDette: false,
      currency: 'FC',
      ventesUsd: false,
    }
  }
};

try {
  const testJobFile = path.join(printDir, `job-DIAGNOSTIC-${Date.now()}.json`);
  fs.writeFileSync(testJobFile, JSON.stringify(testJobPayload, null, 2), 'utf-8');
  
  if (fs.existsSync(testJobFile)) {
    const stats = fs.statSync(testJobFile);
    console.log('   ✅ Job de test créé avec succès!');
    console.log(`      - Nom: ${path.basename(testJobFile)}`);
    console.log(`      - Taille: ${stats.size} bytes`);
    console.log(`      - Chemin: ${testJobFile}`);
    console.log('');
    console.log('   ℹ️  Ce job devrait être détecté par le watcher dans quelques secondes');
    console.log('   ℹ️  Vérifiez les logs du serveur pour voir s\'il est traité');
  } else {
    console.log('   ❌ ERREUR: Job non créé après writeFileSync');
  }
} catch (error) {
  console.log('   ❌ ERREUR création job de test:');
  console.log(`      → ${error.message}`);
  console.log(`      → Code: ${error.code}`);
}
console.log('');

// ============================================
// 8. Résumé et recommandations
// ============================================
console.log('📋 8. RÉSUMÉ ET RECOMMANDATIONS');
console.log('');

if (allDirsExist) {
  console.log('   ✅ Tous les dossiers existent');
} else {
  console.log('   ⚠️  Des dossiers manquaient (créés automatiquement)');
}

console.log('');
console.log('📋 CHECKLIST DE VÉRIFICATION:');
console.log('   [ ] Le serveur backend est démarré (npm run dev ou .exe)');
console.log('   [ ] Le module d\'impression est initialisé (vérifier logs au démarrage)');
console.log('   [ ] Le watcher chokidar est actif (vérifier logs)');
console.log('   [ ] Une imprimante par défaut est configurée sur Windows');
console.log('   [ ] Aucune erreur de permissions (EACCES/EPERM)');
console.log('');

console.log('📋 PROCHAINES ÉTAPES:');
console.log('   1. Vérifier les logs du serveur pour voir si le job test est détecté');
console.log('   2. Vérifier si le job est déplacé vers ok/ ou err/');
console.log('   3. Si le job reste dans ROOT, vérifier que le watcher surveille bien ce dossier');
console.log('   4. Si le job va dans err/, lire le fichier .error.json pour les détails');
console.log('');

console.log('🔍 ==========================================');
console.log('🔍 FIN DU DIAGNOSTIC');
console.log('🔍 ==========================================');

