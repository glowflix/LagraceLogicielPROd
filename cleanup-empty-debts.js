// Script pour nettoyer les dettes vides
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA, 'ai-lagrace', 'glowflixprojet.db');
console.log('📂 DB Path:', dbPath);

const db = new Database(dbPath);

// Supprimer les dettes vides (sans client ou sans montant)
const emptyDebts = db.prepare(`
  SELECT id, client_name, total_fc, total_usd FROM debts 
  WHERE (client_name IS NULL OR client_name = '' OR TRIM(client_name) = '')
     OR (COALESCE(total_fc, 0) <= 0 AND COALESCE(total_usd, 0) <= 0)
`).all();

console.log('\n🔍 Dettes vides trouvées:', emptyDebts.length);
emptyDebts.forEach(d => console.log('  -', d));

// Supprimer ces dettes
const deleteResult = db.prepare(`
  DELETE FROM debts 
  WHERE (client_name IS NULL OR client_name = '' OR TRIM(client_name) = '')
     OR (COALESCE(total_fc, 0) <= 0 AND COALESCE(total_usd, 0) <= 0)
`).run();
console.log('\n🗑️ Dettes vides supprimées:', deleteResult.changes);

// Supprimer les opérations DEBT vides en pending
const emptyOps = db.prepare(`
  SELECT id, entity_code, payload_json FROM sync_operations 
  WHERE op_type = 'DEBT' AND status = 'pending'
`).all();

let deletedOps = 0;
for (const op of emptyOps) {
  try {
    const payload = JSON.parse(op.payload_json);
    const client = (payload.Client || payload.client_name || '').trim();
    const total = parseFloat(payload.total_usd || payload['prix a payer'] || 0);
    if (!client || total <= 0) {
      db.prepare('DELETE FROM sync_operations WHERE id = ?').run(op.id);
      deletedOps++;
      console.log('  🗑️ Op supprimée:', op.entity_code);
    }
  } catch (e) {
    console.error('  ❌ Erreur parsing op:', op.id);
  }
}
console.log('\n🗑️ Opérations DEBT vides supprimées:', deletedOps);

db.close();
console.log('\n✅ Nettoyage terminé');
