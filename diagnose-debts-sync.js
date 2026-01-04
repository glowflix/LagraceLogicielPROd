#!/usr/bin/env node

/**
 * 🔍 Script de diagnostic - Vérification de la synchronisation des dettes
 * Vérifie que :
 * 1. Les dettes existent dans Google Sheets
 * 2. Les dettes sont bien synchronisées dans la base de données SQL
 * 3. Les colonnes correspondent correctement
 */

const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'app.db');

console.log('📊 ============================================');
console.log('🔍 DIAGNOSTIC - SYNCHRONISATION DES DETTES');
console.log('📊 ============================================\n');

// Vérifier si la base de données existe
if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Base de données non trouvée: ${DB_PATH}`);
  console.error('📍 Emplacements recherchés:');
  const possiblePaths = [
    path.join(__dirname, 'app.db'),
    path.join(__dirname, 'database.db'),
    path.join(__dirname, 'la-grace-sync.sqlite3'),
    path.join(__dirname, '../..', 'app.db'),
  ];
  possiblePaths.forEach(p => console.error(`   - ${p}`));
  process.exit(1);
}

console.log(`✅ Base de données trouvée: ${DB_PATH}\n`);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error(`❌ Erreur connexion DB: ${err.message}`);
    process.exit(1);
  }

  console.log('🔗 Connecté à la base de données\n');

  // Vérifier si la table debts existe
  db.all(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='debts'
  `, (err, tables) => {
    if (err) {
      console.error(`❌ Erreur requête: ${err.message}`);
      db.close();
      process.exit(1);
    }

    if (tables.length === 0) {
      console.error('❌ Table "debts" non trouvée dans la base de données');
      console.log('\n📝 Tables disponibles:');
      db.all(`SELECT name FROM sqlite_master WHERE type='table'`, (err, tables) => {
        if (tables) {
          tables.forEach(t => console.log(`   - ${t.name}`));
        }
        db.close();
        process.exit(1);
      });
      return;
    }

    console.log('✅ Table "debts" existe\n');

    // Récupérer le schéma de la table debts
    console.log('📋 Schéma de la table debts:');
    db.all(`PRAGMA table_info(debts)`, (err, columns) => {
      if (err) {
        console.error(`❌ Erreur: ${err.message}`);
        db.close();
        process.exit(1);
      }

      columns.forEach(col => {
        console.log(`   - ${col.name} (${col.type})${col.notnull ? ' NOT NULL' : ''}`);
      });

      // Récupérer le nombre de dettes
      console.log('\n📊 Statistiques des dettes:');
      db.all(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
          SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial_count,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
          SUM(remaining_fc) as total_remaining,
          SUM(total_fc) as total_amount
        FROM debts
      `, (err, result) => {
        if (err) {
          console.error(`❌ Erreur: ${err.message}`);
          db.close();
          process.exit(1);
        }

        const stats = result[0] || {};
        console.log(`   ✅ Total dettes: ${stats.total || 0}`);
        console.log(`   🔴 Ouvertes: ${stats.open_count || 0}`);
        console.log(`   🟡 Partielles: ${stats.partial_count || 0}`);
        console.log(`   🟢 Fermées: ${stats.closed_count || 0}`);
        console.log(`   💰 Montant total: ${(stats.total_amount || 0).toLocaleString('fr-FR')} FC`);
        console.log(`   💳 Restant à payer: ${(stats.total_remaining || 0).toLocaleString('fr-FR')} FC`);

        // Afficher les 5 premières dettes
        console.log('\n📋 Dernières dettes synchronisées:');
        db.all(`
          SELECT * FROM debts 
          ORDER BY created_at DESC LIMIT 5
        `, (err, debts) => {
          if (err) {
            console.error(`❌ Erreur: ${err.message}`);
            db.close();
            process.exit(1);
          }

          if (debts && debts.length > 0) {
            debts.forEach((debt, i) => {
              console.log(`\n   ${i + 1}. ${debt.client_name || 'N/A'}`);
              console.log(`      Facture: ${debt.invoice_number || 'N/A'}`);
              console.log(`      Total: ${debt.total_fc.toLocaleString('fr-FR')} FC`);
              console.log(`      Payé: ${debt.paid_fc.toLocaleString('fr-FR')} FC`);
              console.log(`      Restant: ${debt.remaining_fc.toLocaleString('fr-FR')} FC`);
              console.log(`      Statut: ${debt.status || 'N/A'}`);
              console.log(`      Crée: ${debt.created_at || 'N/A'}`);
              console.log(`      Mis à jour: ${debt.updated_at || 'N/A'}`);
            });
          } else {
            console.warn('   ⚠️  Aucune dette trouvée dans la base de données');
            console.log('\n   💡 Actions possibles:');
            console.log('      1. Vérifier que Google Sheets contient des données dans la feuille "Dettes"');
            console.log('      2. Assurez-vous que la synchronisation est en cours (vérifier les logs)');
            console.log('      3. Vérifier que les colonnes Google Sheets correspondent:');
            console.log('         - Client (client_name)');
            console.log('         - Facture # (invoice_number)');
            console.log('         - Montant Total (total_fc)');
            console.log('         - Montant Payé (paid_fc)');
            console.log('         - Statut (status: open/partial/closed)');
          }

          // Vérifier les erreurs de synchronisation
          console.log('\n🔄 Vérification des logs de synchronisation:');
          const logsDir = path.join(__dirname, 'logs');
          if (fs.existsSync(logsDir)) {
            const files = fs.readdirSync(logsDir)
              .filter(f => f.includes('sync') || f.includes('debt'))
              .slice(-3);
            
            if (files.length > 0) {
              console.log(`   ✅ Fichiers de logs trouvés:`);
              files.forEach(f => {
                const filePath = path.join(logsDir, f);
                const stats = fs.statSync(filePath);
                const size = (stats.size / 1024).toFixed(2);
                console.log(`      - ${f} (${size} KB)`);
              });
              console.log('\n   💡 Consultez ces fichiers pour voir les détails de synchronisation');
            } else {
              console.log('   ⚠️  Pas de logs de synchronisation trouvés');
            }
          }

          console.log('\n📊 ============================================');
          console.log('✅ Diagnostic terminé');
          console.log('📊 ============================================\n');

          db.close();
          process.exit(0);
        });
      });
    });
  });
});
