/**
 * Script to properly fix pushProductPatches with fan-out logic and better logging
 * Run with: node fix-product-patches-v2.cjs
 */

const fs = require('fs');
const path = require('path');

const workerPath = path.join(__dirname, 'src/services/sync/sync.worker.js');

// Read current file
let content = fs.readFileSync(workerPath, 'utf8');

console.log('📖 Reading sync.worker.js...');
console.log(`Current file length: ${content.length} bytes`);

// Find and replace the pushProductPatches function
// Look for the function definition
const functionRegex = /async pushProductPatches\(patches\) \{[\s\S]*?(?=\n  \/\*\*|  async (?:push|ack|fetch)|^  \})/m;
const match = content.match(functionRegex);

if (!match) {
  console.error('❌ Could not find pushProductPatches function');
  process.exit(1);
}

console.log(`✅ Found pushProductPatches function (${match[0].length} chars)`);

// New improved implementation with detailed logging
const newFunction = `async pushProductPatches(patches) {
    if (!patches || patches.length === 0) return;
    
    const ackedOpIds = [];
    
    // Preparer les operations pour batchPush avec fan-out logic
    const ops = patches.flatMap((op, idx) => {
      // Log raw payload_json
      syncLogger.info(\`[PRODUCT-PATCH \${idx}] entity_code='\${op.entity_code}', payload_json type=\${typeof op.payload_json}\`);
      
      let payloadData = {};
      if (op.payload_json) {
        if (typeof op.payload_json === 'string') {
          try {
            payloadData = JSON.parse(op.payload_json);
            syncLogger.info(\`  ✅ Parsed JSON: name='\${payloadData.name}', is_active=\${payloadData.is_active}\`);
          } catch (e) {
            syncLogger.warn(\`  ❌ Parse error: \${e.message} (first 100 chars: '\${op.payload_json.substring(0, 100)}')\`);
            payloadData = {};
          }
        } else {
          payloadData = op.payload_json;
          syncLogger.info(\`  ✅ Already object: name='\${payloadData.name}'\`);
        }
      } else {
        syncLogger.warn(\`  ⚠️ payload_json is null/undefined!\`);
      }

      // Extract name from payload (with fallback)
      const finalName = payloadData.name !== undefined && payloadData.name !== null
        ? String(payloadData.name).trim()
        : '';
      
      syncLogger.info(\`  Name value: finalName='\${finalName}' (source: \${payloadData.name === undefined ? 'undefined' : 'defined'})\`);

      let uuid = payloadData.uuid || op.entity_uuid || '';
      let units = [];
      
      // CRITICAL: Load full product to get all units
      try {
        const fullProduct = productsRepo.findByCode(op.entity_code);
        if (fullProduct) {
          uuid = fullProduct.uuid || uuid;
          if (fullProduct.units && fullProduct.units.length > 0) {
            units = fullProduct.units.map((u) => ({
              unit_level: u.unit_level || 'CARTON',
              unit_mark: u.unit_mark || ''
            }));
            syncLogger.info(\`  📦 Loaded \${units.length} unit(s) from DB: \${units.map(u => u.unit_level).join(', ')}\`);
          }
        } else {
          syncLogger.warn(\`  ⚠️ Product not found in DB: \${op.entity_code}\`);
        }
      } catch (e) {
        syncLogger.error(\`  ❌ Error loading product: \${e.message}\`);
      }

      // Fallback: use unit from payload or default to CARTON
      if (units.length === 0) {
        units = [{
          unit_level: payloadData.unit_level || 'CARTON',
          unit_mark: payloadData.unit_mark || ''
        }];
        syncLogger.info(\`  ℹ️ Using fallback unit: \${units[0].unit_level}\`);
      }

      // FAN-OUT: Create one operation per unit level
      const perUnitOps = units.map((unit, unitIdx) => {
        const operationPayload = {
          ...payloadData,
          code: op.entity_code,
          name: finalName,
          is_active: payloadData.is_active !== undefined ? payloadData.is_active : 1,
          unit_level: unit.unit_level,
          unit_mark: unit.unit_mark,
          uuid: uuid
        };

        if (idx < 2) {
          syncLogger.info(\`    [UNIT \${unitIdx}] \${unit.unit_level}/\${unit.unit_mark}: name='\${finalName}'\`);
        }

        return {
          op_id: op.op_id,
          entity: 'products',
          op: 'upsert',
          payload: operationPayload
        };
      });

      return perUnitOps;
    });

    if (ops.length === 0) {
      syncLogger.warn('No product patches to push');
      return;
    }

    // Batch and push
    const batchSize = 50;
    for (let i = 0; i < ops.length; i += batchSize) {
      const batch = ops.slice(i, i + batchSize);
      const body = {
        action: 'batchPush',
        ops: batch
      };

      syncLogger.info(\`   Pushing batch: ops \${i}-\${Math.min(i + batchSize, ops.length)} of \${ops.length}\`);

      try {
        const response = await httpClient.post(sheetsUrl, body);
        const result = response.data || {};

        if (result.success) {
          const pushOps = batch.map((op) => op.op_id);
          ackedOpIds.push(...pushOps);
          syncLogger.info(\`   ✅ Batch acked: \${result.acked_count || 0}/\${batch.length}\`);
        } else {
          syncLogger.error(\`   ❌ Batch failed: \${result.error || 'unknown error'}\`);
        }
      } catch (err) {
        syncLogger.error(\`   ❌ Batch error: \${err.message}\`);
      }
    }

    // Mark acked operations as done
    if (ackedOpIds.length > 0) {
      try {
        outboxRepo.markAsAcked(ackedOpIds);
        syncLogger.info(\`   ✅ Marked \${ackedOpIds.length} operations as acked\`);
      } catch (error) {
        syncLogger.error(\`   ❌ Error marking as acked: \${error.message}\`);
      }
    }
  }`;

// Replace the function
content = content.replace(functionRegex, newFunction);

// Write back
fs.writeFileSync(workerPath, content, 'utf8');
console.log(`\n✅ Successfully updated pushProductPatches function!`);
console.log(`   File written: ${workerPath}`);
console.log(`   New implementation includes:`);
console.log(`   - Detailed logging of payload parsing`);
console.log(`   - Fan-out logic (one op per unit)`);
console.log(`   - Better error handling`);
console.log(`   - Batch processing with feedback`);
