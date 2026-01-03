/**
 * CLEAN pushProductPatches FUNCTION - Ready to replace corrupted version
 * This is the complete, working implementation with fan-out logic
 * 
 * Location: src/services/sync/sync.worker.js (around line 304)
 * Replace the entire pushProductPatches method with this code
 */

async pushProductPatches(patches) {
  if (!patches || patches.length === 0) return;
  
  const ackedOpIds = [];
  
  // Préparer les opérations pour batchPush
  // IMPORTANT: Chaque patch de produit doit inclure:
  // - code (product_code)
  // - name (product_name)
  // - unit_level (CARTON, MILLIER, PIECE) - CRUCIAL pour router vers la bonne feuille
  // - uuid (product_uuid pour déduplication)
  // - is_active
  const ops = patches.flatMap(op => {
    // IMPORTANT: Utiliser payload_json, PAS payload! (c'est un string JSON en base)
    let payloadData = {};
    const payload = op.payload_json || op.payload;
    
    if (payload) {
      try {
        // Si c'est une string JSON, la parser
        if (typeof payload === 'string') {
          payloadData = JSON.parse(payload);
        } else {
          payloadData = payload;
        }
      } catch (e) {
        syncLogger.warn(`      ⚠️ Impossible de parser payload pour op ${op.op_id}: ${e.message}`);
        payloadData = {};
      }
    }
    
    // CRITIQUE: Récupérer le nom du produit
    const finalName = payloadData.name || op.name || '';
    const is_active = payloadData.is_active !== undefined ? payloadData.is_active : 1;
    let uuid = payloadData.uuid || op.entity_uuid || '';
    
    // Récupérer le produit complet pour avoir ses unités et unit_level
    // CRUCIAL: unit_level manquant causa le problème précédent
    const fullProduct = productsRepo.findByCode(op.entity_code);
    
    let unitLevel = payloadData.unit_level || 'CARTON'; // Default à CARTON
    
    // Si le produit existe, utiliser ses unités pour créer les patches correctement
    if (fullProduct && fullProduct.units && fullProduct.units.length > 0) {
      // FAN-OUT: Créer un patch pour chaque unité du produit
      // Cela garantit que le nom est mis à jour sur TOUTES les feuilles (Carton, Millier, Piece)
      return fullProduct.units.map((unit, idx) => {
        const operationPayload = {
          code: op.entity_code,
          name: finalName,
          is_active: is_active,
          unit_level: unit.unit_level, // CRUCIAL: Chaque patch spécifie son unit_level
          uuid: uuid,
          unit_mark: unit.unit_mark || ''
        };
        
        syncLogger.info(`         📦 [FAN-OUT ${idx + 1}] Code='${op.entity_code}', Name='${finalName}', UnitLevel='${unit.unit_level}'`);
        
        return {
          op_id: op.op_id + (idx > 0 ? `-${idx}` : ''), // Générer des op_id uniques pour chaque unit
          entity: 'products',
          op: 'upsert',
          payload: operationPayload
        };
      });
    } else {
      // Produit inexistant localement, envoyer avec unit_level par défaut
      const operationPayload = {
        code: op.entity_code,
        name: finalName,
        is_active: is_active,
        unit_level: unitLevel,
        uuid: uuid
      };
      
      syncLogger.warn(`      ⚠️ Produit '${op.entity_code}' inexistant localement, envoi avec unit_level='${unitLevel}' par défaut`);
      
      return [{
        op_id: op.op_id,
        entity: 'products',
        op: 'upsert',
        payload: operationPayload
      }];
    }
  });

  if (ops.length > 3) {
    syncLogger.info(`         ... et ${ops.length - 3} autre(s) produit(s)`);
  }
  
  try {
    syncLogger.info(`      📤 Push ${patches.length} patch(es) produit vers Sheets via batchPush`);
    
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
          syncLogger.warn(`      ⚠️ Conflit produit (op_id: ${conflict.op_id}): ${conflict.reason}`);
        }
      }
      
      syncLogger.info(`      ✅ ${ackedOpIds.length}/${patches.length} patch(es) produit confirmé(s) dans Sheets`);
    } else {
      for (const op of patches) {
        outboxRepo.markAsError(op.op_id, result.error || 'Erreur push');
      }
      syncLogger.warn(`      ⚠️ Erreur patches produits: ${result.error}`);
    }
  } catch (error) {
    for (const op of patches) {
      outboxRepo.markAsError(op.op_id, error.message);
    }
    syncLogger.error(`      ❌ Erreur push produits: ${error.message}`);
  }
  
  if (ackedOpIds.length > 0) {
    outboxRepo.markAsAcked(ackedOpIds);
  }
}
