/**
 * ROUTER.AUTOSTOCK - GUIDE COMPLET
 * 
 * ⚠️ IMPORTANT: Ce système gère le stock et la synchronisation
 * Respecte STRICTEMENT les règles décrites ci-dessous
 */

// ============= ARCHITECTURE =============

/**
 * FLUX COMPLET:
 * 
 * 1. FRONTEND: Utilisateur clique "Ouvrir Carton" (PIECE/MILLIER)
 *    ↓
 * 2. API: POST /api/autostock/apply { productKey, unit_level }
 *    ↓
 * 3. BACKEND: applyAutoStock()
 *    - Valide conditions (CARTON > 0, cible <= 0, factor > 0)
 *    - MàJ stock_initial ET stock_current ensemble
 *    - Crée stock_moves (2 lignes: carton -, cible +)
 *    - Crée sync_operation (idempotente)
 *    ↓
 * 4. RESPONSE: { ok: true, actions: [...], sync_op_id }
 *    ↓
 * 5. SYNC: Sheets reçoit sync_operation, applique les mouvements
 *    ↓
 * 6. CONFIRMATION: sync_operations.status = 'acked'
 */

// ============= RÈGLES STRICTES =============

/**
 * RÈGLE 1: STOCK INITIAL === STOCK CURRENT
 * 
 * Ces deux colonnes DOIVENT TOUJOURS avoir la même valeur.
 * Elles représentent le même stock, juste dupliquées pour:
 * - stock_initial: Source de vérité (correspond à colonne C dans Sheets)
 * - stock_current: Pour les requêtes SQL sans lock
 * 
 * ⚠️ JAMAIS modifier l'une sans l'autre.
 * Le trigger SQL t'impose déjà, mais au code côté app aussi.
 */

// ✅ BON:
UPDATE product_units
SET stock_initial = stock_initial + delta,
    stock_current = stock_current + delta
WHERE uuid = ?;

// ❌ MAUVAIS:
UPDATE product_units
SET stock_current = stock_current + delta
WHERE uuid = ?;

/**
 * RÈGLE 2: TOUJOURS utiliser product_units.uuid (jamais unit_mark)
 * 
 * unit_mark est MODIFIABLE par l'utilisateur.
 * C'est dangereux de l'utiliser comme clé.
 * 
 * Exemple:
 * - Utilisateur renomme "SAC" en "SACS"
 * - Tous les mouvements de stock avec unit_mark='SAC' deviennent orphelins
 * - Les triggers ne retrouvent plus l'unité pour mettre à jour le stock
 */

// ✅ BON:
UPDATE product_units
SET stock_initial = ...
WHERE uuid = ?

// ❌ MAUVAIS:
UPDATE product_units
SET stock_initial = ...
WHERE unit_mark = 'SAC'  // Danger: unit_mark peut changer!

/**
 * RÈGLE 3: Modifier last_update ET synced_at = NULL
 * 
 * Après chaque changement de stock:
 * - last_update = datetime('now') : Trace quand ça a changé
 * - synced_at = NULL : Force une resync vers Sheets
 * 
 * C'est critique pour que Sheets sache qu'il y a une nouvelle valeur.
 */

// ✅ BON:
UPDATE product_units
SET stock_initial = ...,
    stock_current = ...,
    last_update = datetime('now'),
    synced_at = NULL
WHERE uuid = ?

// ❌ MAUVAIS:
UPDATE product_units
SET stock_initial = ...,
    stock_current = ...
WHERE uuid = ?  // synced_at ne change pas -> Sheets ne verra pas la modif

/**
 * RÈGLE 4: IDEMPOTENCE via sync_operations.op_id
 * 
 * Chaque opération doit avoir un UUID unique (op_id).
 * Si le même op_id est envoyé 2x, Sheets l'ignore (UNIQUE constraint).
 * Ça évite les doublons si le réseau rebadie.
 */

// ✅ BON:
INSERT INTO sync_operations (op_id, op_type, ...) 
VALUES (crypto.randomUUID(), 'STOCK_MOVE', ...)

// ❌ MAUVAIS:
INSERT INTO sync_operations (op_id, op_type, ...) 
VALUES (NULL, 'STOCK_MOVE', ...)  // op_id NULL -> pas d'idempotence

/**
 * RÈGLE 5: TRANSACTIONS (BEGIN / COMMIT / ROLLBACK)
 * 
 * L'autostock modifie 4 tables (product_units, stock_moves, sync_operations, ...).
 * C'est OBLIGATOIRE de le faire dans une transaction.
 * Si une partie échoue, tout revient en arrière.
 */

// ✅ BON: (le router le fait déjà via dbx.tx())
await dbx.tx(async () => {
  await updateUnitStocks(...);
  await insertStockMove(...);
  await insertSyncOperation(...);
});

// ❌ MAUVAIS:
await updateUnitStocks(...);
await insertStockMove(...);  // Si cette ligne échoue, stock déjà modifié!
await insertSyncOperation(...);

/**
 * RÈGLE 6: VALIDATION des conditions AVANT l'action
 * 
 * Avant de toucher au stock, vérifier:
 * 1. Produit existe
 * 2. CARTON existe
 * 3. auto_stock_factor > 0
 * 4. CARTON.stock_current > 0
 * 5. CIBLE.stock_current <= 0
 */

// ✅ BON: (le router le fait déjà)
if (!product) throw Error("Produit intro");
if (!carton) throw Error("Pas de CARTON");
if (normFactor(factor) === 0) continue;  // Skip si factor=0
if (cartonStock <= 0) return { reason: "CARTON vide", actions: [] };
if (targetStock > 0) continue;  // Skip si cible déjà fournie

// ❌ MAUVAIS:
// Vérifier pendant l'update (trop tard, stock déjà modifié)
UPDATE product_units SET stock_initial = ... WHERE uuid = ?;
IF error THEN ...

// ============= INTÉGRATION COMPLÈTE =============

// server.js:
import autoStockRouter from './routes/router.autostock.js';
app.use('/api/autostock', autoStockRouter);

// Assurez-vous que req.app.locals.db est assigné:
const db = new sqlite3.Database('./db/data.db');
app.locals.db = db;

// ============= APPELS DEPUIS LE FRONTEND =============

// React / Vue component:

// 1. Bouton dans la UI produit
<button onClick={() => handleAutoStock('RIZ-001', 'PIECE')}>
  🔄 Ouvrir Carton (PIECE)
</button>

// 2. Handler frontend
async function handleAutoStock(productKey, unitLevel) {
  try {
    const response = await fetch('/api/autostock/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productKey,
        unit_level: unitLevel,
        device_id: getDeviceId()  // iPad, Android, etc.
      })
    });

    const result = await response.json();

    if (result.ok) {
      if (result.actions.length > 0) {
        // Succès: afficher les changements
        showNotification(`✅ ${result.actions.length} action(s) appliquée(s)`);
        
        // Mettre à jour l'affichage local
        result.actions.forEach(action => {
          console.log(`Carton: ${action.carton.before.stock_current} -> ${action.carton.after.stock_current}`);
          console.log(`${action.target.unit_level}: ${action.target.before.stock_current} -> ${action.target.after.stock_current}`);
        });

        // Rafraîchir les stocks
        await loadProducts();
        
        // Tracker la sync_operation
        console.log(`Sync operation: ${result.sync_op_id}`);
      } else {
        // Pas d'action (CARTON vide? PIECE déjà fourni?)
        showNotification(`⚠️ ${result.reason}`);
      }
    } else {
      // Erreur
      showNotification(`❌ Erreur: ${result.error}`);
    }
  } catch (error) {
    console.error('Erreur autostock:', error);
    showNotification('❌ Erreur réseau');
  }
}

// ============= SCÉNARIOS EDGE CASE =============

/**
 * SCENARIO A: CARTON.stock_current = 1, PIECE = 0, MILLIER = 0
 * 
 * Que se passe-t-il si on appelle autostock SANS unit_level?
 * (défaut: essayer PIECE et MILLIER)
 * 
 * Réponse:
 * - PIECE: ouvre 1 carton -> CARTON = 0, PIECE = 50
 * - MILLIER: carton = 0, ne peut pas ouvrir
 * - Résultat: 1 seule action (PIECE), pas 2
 * 
 * Code: le for loop s'arrête si cartonLeft <= 0
 */

/**
 * SCENARIO B: Même autostock appelé 2x rapidement
 * 
 * Appel 1: POST /api/autostock/apply/RIZ-001
 * Appel 2: POST /api/autostock/apply/RIZ-001 (avant que Sheets réponde)
 * 
 * Que se passe-t-il?
 * 
 * Réponse:
 * - Chaque appel crée sa propre op_id (UUID différent)
 * - Les 2 opérations sont envoyées à Sheets
 * - Sheets applique les 2 (pas de doublon car op_id différent)
 * - Stocks se mettent à jour correctement (2 cartons ouverts)
 * 
 * ⚠️ MAIS: Si c'est vraiment un doublon (erreur réseau), le frontend doit:
 * - Checker response.sync_op_id
 * - Si même op_id, c'est un doublon
 * - Ne pas relancer
 */

/**
 * SCENARIO C: Device offline, autostock appliqué, puis sync en arrière plan
 * 
 * 1. Device offline: POST /api/autostock/apply -> marque pending
 * 2. Device back online: sync_operations.status = 'pending' -> envoie Sheets
 * 3. Sheets acked: status = 'acked'
 * 
 * Aucun problème d'idempotence car op_id unique.
 * Sheets verra la même op_id et l'ignorera si déjà traitée.
 */

/**
 * SCENARIO D: Utilisateur modifie auto_stock_factor après autostock
 * 
 * Avant: PIECE.auto_stock_factor = 50
 * AutoStock: CARTON -= 1, PIECE += 50
 * Après: Utilisateur change PIECE.auto_stock_factor = 100
 * 
 * Impact: Aucun. L'autostock a été appliqué, c'est fait.
 * Le prochain autostock utilisera factor = 100.
 */

// ============= MONITORING / LOGS =============

/**
 * Pour debugger, vérifiez:
 * 
 * 1. Les stock_moves sont bien créées
 * SELECT COUNT(*) FROM stock_moves WHERE product_code = 'RIZ-001';
 * 
 * 2. Les sync_operations sont en pending
 * SELECT status FROM sync_operations WHERE entity_code = 'RIZ-001';
 * 
 * 3. Les stocks ont bien changé
 * SELECT stock_initial, stock_current FROM product_units 
 *   WHERE product_id = (SELECT id FROM products WHERE code = 'RIZ-001');
 * 
 * 4. Les timestamps sont à jour
 * SELECT last_update, synced_at FROM product_units 
 *   WHERE product_id = ...;
 */

// ============= PERFORMANCE =============

/**
 * L'autostock est généralement rapide (< 100ms) car:
 * - Peu de queries (4-5 au total)
 * - Pas de full table scan
 * - Indexes sur product_id, uuid, code
 * - Transaction courte
 * 
 * Mais si le device a 10k produits avec auto_stock, ça peut être slow.
 * Solution: Ajouter un cache au frontend
 * (mettre en cache le résultat de /api/products)
 */

// ============= SÉCURITÉ =============

/**
 * THREATS + MITIGATIONS:
 * 
 * 1. SQL Injection
 *    ✓ Utilise parameterized queries (? placeholders)
 *    ✓ Pas de string concatenation
 * 
 * 2. Race conditions
 *    ✓ Transactions (BEGIN/COMMIT)
 *    ✓ Indices sur uuid/id/code
 * 
 * 3. Doublon d'opérations
 *    ✓ op_id UNIQUE dans sync_operations
 *    ✓ Idempotence garantie
 * 
 * 4. Corruption stock
 *    ✓ Toujours modifier stock_initial ET stock_current ensemble
 *    ✓ Déclaratif (pas d'If/Then dangereux)
 * 
 * 5. Suppression accidentelle
 *    ✓ Aucune opération DELETE
 *    ✓ Seulement INSERT/UPDATE
 *    ✓ Tout est tracé dans stock_moves
 */

// ============= ROLLBACK MANUAL (si besoin) =============

/*
Si un autostock s'est mal passé (données corrompues, etc.):

1. Identifier l'op_id problématique:
   SELECT op_id FROM sync_operations 
   WHERE entity_code = 'RIZ-001' AND created_at = '...';

2. Lire son payload:
   SELECT payload_json FROM sync_operations 
   WHERE op_id = '...';

3. Inverser les stock_moves:
   UPDATE product_units
   SET stock_initial = stock_initial - delta,
       stock_current = stock_current - delta,
       last_update = datetime('now'),
       synced_at = NULL
   WHERE uuid IN (
     SELECT product_uuid FROM stock_moves 
     WHERE reference_id = 'AUTO_STOCK:RIZ-001'
   );

4. Marquer sync_operation comme acked pour éviter resync:
   UPDATE sync_operations 
   SET status = 'acked'
   WHERE op_id = '...';

⚠️ Fais un backup avant, et teste en dev d'abord!
*/

// ============= DÉPLOIEMENT =============

/**
 * Checklist before going LIVE:
 * 
 * ✓ Schema.sql chargé avec stock_moves + sync_operations
 * ✓ PRAGMA foreign_keys = ON au startup
 * ✓ router.autostock.js importé dans server.js
 * ✓ app.locals.db assigné
 * ✓ Tests manuels: tous les scenarios passent
 * ✓ Logs et monitoring configurés
 * ✓ Backup DB avant premier déploiement
 * ✓ Documenter les procédures de rollback
 * ✓ Tester offline -> online sync
 */
