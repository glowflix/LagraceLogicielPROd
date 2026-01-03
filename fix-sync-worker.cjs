const fs = require('fs');
const path = require('path');

const filePath = 'src/services/sync/sync.worker.js';
let content = fs.readFileSync(filePath, 'utf8');

// The replacement text for the entire pushProductPatches function
const newFunction = `  /**
   * Push les patches produits vers Sheets
   * FAN-OUT LOGIC: Crée un patch pour chaque unité du produit
   * CRITIQUE: S'assurer que le champ 'name' et 'unit_level' sont TOUJOURS inclus
   * IMPACT: Garantit que la mise à jour du nom affecte TOUTES les feuilles (Carton, Millier, Piece)
   */
  async pushProductPatches(patches) {
    if (!patches || patches.length === 0) return;
    
    const ackedOpIds = [];
    
    // Préparer les opérations pour batchPush avec FAN-OUT pour chaque unité
    const ops = patches.flatMap((op, idx) => {
      let payloadData = {};
      if (op.payload_json) {
        if (typeof op.payload_json === 'string') {
          try {
            payloadData = JSON.parse(op.payload_json);
          } catch (e) {
            syncLogger.warn(\`      [PRODUCT \${idx}] Impossible to parse payload_json for \${op.entity_code}: \${e.message}\`);
            payloadData = {};
          }
        } else {
          payloadData = op.payload_json;
        }
      }

      const finalName = payloadData.name !== undefined && payloadData.name !== null
        ? String(payloadData.name)
        : '';

      let uuid = payloadData.uuid || op.entity_uuid || '';
      let units = [];
      try {
        const fullProduct = productsRepo.findByCode(op.entity_code);
        if (fullProduct) {
          uuid = fullProduct.uuid || uuid;
          if (fullProduct.units && fullProduct.units.length > 0) {
            units = fullProduct.units.map((u) => ({
              unit_level: u.unit_level || 'CARTON',
              unit_mark: u.unit_mark || ''
            }));
          }
        }
      } catch (e) {
        syncLogger.debug(\`      [PRODUCT \${idx}] Unable to load full product, using fallback units\`);
      }

      if (units.length === 0) {
        units = [{
          unit_level: payloadData.unit_level || 'CARTON',
          unit_mark: payloadData.unit_mark || ''
        }];
      }

      const perUnitOps = units.map((unit, unitIdx) => {
        const operationPayload = {
          code: op.entity_code,
          name: finalName,
          is_active: payloadData.is_active !== undefined ? payloadData.is_active : 1,
          unit_level: unit.unit_level,
          unit_mark: unit.unit_mark,
          uuid: uuid
        };

        if (idx < 3 && unitIdx < 3) {
          syncLogger.info(\`      [PRODUCT \${idx}] Code='\${op.entity_code}', Name='\${finalName}', unit_level='\${unit.unit_level}', unit_mark='\${unit.unit_mark}'\`);
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

    if (ops.length > 3) {
      syncLogger.info(\`         ... et \${ops.length - 3} autre(s) produit(s)\`);
    }
    
    try {
      syncLogger.info(\`      📤 Push \${patches.length} patch(es) produit vers Sheets via batchPush\`);
      
      // Utiliser pushBatch qui supporte le mode batch via Code.gs
      const result = await sheetsClient.pushBatch(ops);
      
      if (result.success) {
        // Marquer les opérations appliquées comme confirmées
        for (const applied of (result.applied || [])) {
          if (applied.op_id) {
            ackedOpIds.push(applied.op_id);
          }
        }
        
        // Marquer les conflits comme erreurs
        for (const conflict of (result.conflicts || [])) {
          if (conflict.op_id) {
            outboxRepo.markAsError(conflict.op_id, conflict.reason || 'Conflit');
            syncLogger.warn(\`      ⚠️ Conflit produit (op_id: \${conflict.op_id}): \${conflict.reason}\`);
          }
        }
        
        syncLogger.info(\`      ✅ \${ackedOpIds.length}/\${patches.length} patch(es) produit confirmé(s) dans Sheets\`);
      } else {
        for (const op of patches) {
          outboxRepo.markAsError(op.op_id, result.error || 'Erreur push');
        }
        syncLogger.warn(\`      ⚠️ Erreur patches produits: \${result.error}\`);
      }
    } catch (error) {
      for (const op of patches) {
        outboxRepo.markAsError(op.op_id, error.message);
      }
      syncLogger.error(\`      ❌ Erreur push produits: \${error.message}\`);
    }
    
    if (ackedOpIds.length > 0) {
      outboxRepo.markAsAcked(ackedOpIds);
    }
  }`;

// Find the start of the function
const startMatch = content.match(/\n  async pushProductPatches\(patches\)\s*\{/);
if (!startMatch) {
  console.error('ERROR: Could not find pushProductPatches function');
  process.exit(1);
}

const startIndex = content.indexOf(startMatch[0]) + 1; // +1 to keep the newline
let braceCount = 0;
let endIndex = startIndex + startMatch[0].length - 1;

// Count braces to find the end
for (let i = endIndex; i < content.length; i++) {
  if (content[i] === '{') braceCount++;
  if (content[i] === '}') {
    braceCount--;
    if (braceCount === 0) {
      endIndex = i;
      break;
    }
  }
}

console.log('Found pushProductPatches function');
console.log('Start index:', startIndex);
console.log('End index:', endIndex);
console.log('Old function length:', endIndex - startIndex, 'characters');

// Replace the function
const newContent = content.substring(0, startIndex) + newFunction + content.substring(endIndex);

// Write back
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('✅ pushProductPatches function fixed with fan-out logic!');
