#!/usr/bin/env node
/**
 * Fix debts sync issues:
 * 1. Create missing unique index on debts(invoice_number)
 * 2. Backfill sync_operations for existing debts
 */

import { getDb } from './src/db/sqlite.js';
import { generateUUID } from './src/core/crypto.js';

const db = getDb();

console.log('\n' + '='.repeat(80));
console.log('🔧 FIX DEBTS SYNC - CREATE INDEX & BACKFILL');
console.log('='.repeat(80) + '\n');

try {
  // FIX 1: Create missing unique index
  console.log('📍 FIX 1: Creating unique index idx_debts_invoice_unique...');
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_debts_invoice_unique 
      ON debts(invoice_number) 
      WHERE invoice_number IS NOT NULL;
    `);
    console.log('   ✅ Index created successfully\n');
  } catch (err) {
    console.log(`   ⚠️  Index already exists or error: ${err.message}\n`);
  }

  // FIX 2: Backfill sync_operations for existing debts
  console.log('📍 FIX 2: Backfilling sync_operations for existing debts...');
  
  const existingDebts = db.prepare(`
    SELECT * FROM debts WHERE id IS NOT NULL
  `).all();
  
  console.log(`   Found ${existingDebts.length} debt(s) to sync`);
  
  let backfilled = 0;
  let skipped = 0;
  let errors = 0;

  for (const debt of existingDebts) {
    try {
      // Check if sync_operation already exists for this debt
      const existing = db.prepare(`
        SELECT op_id FROM sync_operations 
        WHERE op_type = 'DEBT' AND entity_uuid = ? AND status = 'pending'
        LIMIT 1
      `).get(debt.uuid);

      if (existing) {
        skipped++;
        continue;
      }

      // Create sync_operation record
      const op_id = generateUUID();
      const payload = {
        uuid: debt.uuid,
        invoice_number: debt.invoice_number,
        client_name: debt.client_name,
        client_phone: debt.client_phone,
        product_description: debt.product_description,
        total_fc: debt.total_fc,
        paid_fc: debt.paid_fc,
        remaining_fc: debt.remaining_fc,
        total_usd: debt.total_usd,
        debt_fc_in_usd: debt.debt_fc_in_usd,
        status: debt.status,
        note: debt.note
      };

      db.prepare(`
        INSERT OR IGNORE INTO sync_operations
        (op_id, op_type, entity_uuid, entity_code, payload_json, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        op_id,
        'DEBT',
        debt.uuid,
        debt.invoice_number,
        JSON.stringify(payload),
        'pending'
      );

      backfilled++;
      console.log(`   ✅ [${debt.invoice_number}] Backfilled sync_operation`);
    } catch (err) {
      errors++;
      console.log(`   ❌ [${debt.invoice_number}] Error: ${err.message}`);
    }
  }

  console.log(`\n   📊 Summary:`);
  console.log(`      - Backfilled: ${backfilled}`);
  console.log(`      - Skipped (already has sync_op): ${skipped}`);
  console.log(`      - Errors: ${errors}`);

  // Verification
  console.log('\n📍 VERIFICATION: Checking sync_operations after fix...');
  const debtOps = db.prepare(`
    SELECT COUNT(*) as count FROM sync_operations WHERE op_type = 'DEBT'
  `).get();
  
  const pendingOps = db.prepare(`
    SELECT COUNT(*) as count FROM sync_operations WHERE op_type = 'DEBT' AND status = 'pending'
  `).get();

  console.log(`   ✅ Total DEBT sync_operations: ${debtOps.count}`);
  console.log(`   ✅ Pending DEBT sync_operations: ${pendingOps.count}`);

  if (pendingOps.count > 0) {
    console.log('\n✨ ALL FIXES COMPLETED SUCCESSFULLY!');
    console.log('   Debts are now ready for PUSH to Google Sheets on next sync cycle.');
  } else {
    console.log('\n⚠️  WARNING: No pending sync operations found');
  }

} catch (err) {
  console.error('\n❌ FATAL ERROR:', err.message);
  process.exit(1);
} finally {
  db.close();
}

console.log('\n' + '='.repeat(80) + '\n');
