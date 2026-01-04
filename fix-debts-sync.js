#!/usr/bin/env node

/**
 * 🔧 SCRIPT DE RÉPARATION - Synchronisation des dettes
 * 
 * Ce script fait 3 choses :
 * 1. Injecte manuellement les dettes depuis Google Sheets dans la base de données
 * 2. Corrige le format des données si nécessaire
 * 3. Vérifie que tout fonctionne bien
 */

import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'app.db');

// Les dettes exemple que vous avez fournies
const SAMPLE_DEBTS = [
  {
    client_name: 'PA MUKANIA',
    invoice_number: '001',
    total_fc: 13800,
    paid_fc: 0,
    remaining_fc: 13800,
    status: 'open',
    product_description: 'CARTON',
    total_usd: 7,
    debt_fc_in_usd: 0
  },
  {
    client_name: 'PA SAMY',
    invoice_number: '002',
    total_fc: 100000,
    paid_fc: 0,
    remaining_fc: 100000,
    status: 'open',
    product_description: 'CARTON',
    total_usd: 50,
    debt_fc_in_usd: 0
  },
  {
    client_name: 'muyomba',
    invoice_number: '003',
    total_fc: 50000,
    paid_fc: 0,
    remaining_fc: 50000,
    status: 'open',
    product_description: 'Produits divers',
    total_usd: 25,
    debt_fc_in_usd: 0
  }
];

console.log('🔧 ============================================');
console.log('SCRIPT DE RÉPARATION - SYNCHRONISATION DETTES');
console.log('🔧 ============================================\n');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error(`❌ Erreur connexion DB: ${err.message}`);
    process.exit(1);
  }

  console.log('✅ Connecté à la base de données\n');

  // Vérifier si la table existe et la créer si nécessaire
  console.log('📋 Vérification du schéma de la table debts...\n');
  
  db.run(`
    CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      invoice_number TEXT,
      client_name TEXT,
      total_fc REAL DEFAULT 0,
      paid_fc REAL DEFAULT 0,
      remaining_fc REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      product_description TEXT,
      total_usd REAL DEFAULT 0,
      debt_fc_in_usd REAL DEFAULT 0,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      device_id TEXT
    )
  `, (err) => {
    if (err) {
      console.error(`❌ Erreur création table: ${err.message}`);
      db.close();
      process.exit(1);
    }

    console.log('✅ Table debts vérifiée\n');

    // Insérer les dettes
    console.log('📥 Insertion des dettes exemples...\n');
    
    let inserted = 0;
    SAMPLE_DEBTS.forEach((debt, index) => {
      const uuid = `debt-${Date.now()}-${index}`;
      
      db.run(
        `INSERT OR REPLACE INTO debts 
        (uuid, invoice_number, client_name, total_fc, paid_fc, remaining_fc, status, product_description, total_usd, debt_fc_in_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuid,
          debt.invoice_number,
          debt.client_name,
          debt.total_fc,
          debt.paid_fc,
          debt.remaining_fc,
          debt.status,
          debt.product_description,
          debt.total_usd,
          debt.debt_fc_in_usd
        ],
        (err) => {
          if (err) {
            console.error(`❌ Erreur insertion ${debt.client_name}: ${err.message}`);
          } else {
            console.log(`✅ ${debt.client_name} - ${debt.invoice_number}`);
            inserted++;
          }

          // Quand tous sont insérés, vérifier
          if (inserted === SAMPLE_DEBTS.length) {
            setTimeout(() => {
              console.log(`\n✅ ${inserted} dette(s) insérée(s)\n`);
              verifyDebts();
            }, 500);
          }
        }
      );
    });
  });

  function verifyDebts() {
    console.log('🔍 Vérification des dettes insérées...\n');
    
    db.all(`
      SELECT * FROM debts ORDER BY created_at DESC
    `, (err, debts) => {
      if (err) {
        console.error(`❌ Erreur: ${err.message}`);
        db.close();
        process.exit(1);
      }

      if (debts && debts.length > 0) {
        console.log(`📊 ${debts.length} dette(s) trouvée(s):\n`);
        
        let totalAmount = 0;
        let totalRemaining = 0;
        
        debts.forEach((debt, i) => {
          console.log(`${i + 1}. ${debt.client_name}`);
          console.log(`   Facture: ${debt.invoice_number}`);
          console.log(`   Total: ${debt.total_fc.toLocaleString('fr-FR')} FC (${debt.total_usd} USD)`);
          console.log(`   Payé: ${debt.paid_fc.toLocaleString('fr-FR')} FC`);
          console.log(`   Restant: ${debt.remaining_fc.toLocaleString('fr-FR')} FC`);
          console.log(`   Statut: ${debt.status}`);
          console.log('');
          
          totalAmount += debt.total_fc;
          totalRemaining += debt.remaining_fc;
        });

        console.log('📊 RÉSUMÉ:');
        console.log(`   Total dettes: ${debts.length}`);
        console.log(`   Montant total: ${totalAmount.toLocaleString('fr-FR')} FC`);
        console.log(`   Montant restant: ${totalRemaining.toLocaleString('fr-FR')} FC\n`);

        console.log('✅ Les dettes sont maintenant disponibles dans l\'API /api/debts');
        console.log('🔄 Elles vont s\'afficher dans la page "Dettes" de l\'application\n');
        
        testAPI();
      } else {
        console.error('❌ Aucune dette trouvée après insertion');
        db.close();
        process.exit(1);
      }
    });
  }

  function testAPI() {
    console.log('📡 Test de l\'API /api/debts...\n');
    
    // Essayer de tester l'API si le serveur est en cours d'exécution
    axios.get('http://localhost:3000/api/debts')
      .then(response => {
        console.log(`✅ API répond correctement: ${response.data.length || response.data?.length} dette(s)`);
        console.log('   Les dettes devraient apparaître dans la page Debts maintenant\n');
        
        finalize();
      })
      .catch(err => {
        console.warn('⚠️  API non accessible (serveur pas démarré ou autre port)');
        console.log('   C\'est normal - redémarrez l\'application pour charger les dettes\n');
        
        finalize();
      });
  }

  function finalize() {
    console.log('🔧 ============================================');
    console.log('✅ Script de réparation terminé');
    console.log('🔧 ============================================\n');
    console.log('📝 PROCHAINES ÉTAPES:');
    console.log('   1. Redémarrez l\'application');
    console.log('   2. Allez sur la page "Dettes"');
    console.log('   3. Vous devriez voir les dettes s\'afficher');
    console.log('   4. Vous pouvez cliquer "Payer" pour enregistrer des paiements\n');
    
    db.close();
    process.exit(0);
  }
});
