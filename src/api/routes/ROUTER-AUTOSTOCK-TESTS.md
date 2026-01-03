/**
 * TEST ROUTER.AUTOSTOCK
 * Scénarios de test pour valider le système d'auto-stock
 * 
 * À exécuter avec: npm test -- autostock.test.js
 * Ou manuellement via curl / Postman
 */

// ============= SCENARIO 1: AUTOSTOCK NOMINAL =============
/*
Situation:
- CARTON.stock_current = 10
- PIECE.stock_current = 0
- PIECE.auto_stock_factor = 50

Attente:
- CARTON.stock_current -> 9
- PIECE.stock_current -> 50
- 2 stock_moves créés
- 1 sync_operation en pending
*/

// TEST 1A: Via /apply/:productKey
curl -X POST http://localhost:3000/api/autostock/apply/RIZ-001 \
  -H "Content-Type: application/json" \
  -d '{ "unit_level": "PIECE", "device_id": "test-device" }' \
  | jq .

// Assertions:
// - response.ok === true
// - response.actions.length === 1
// - response.actions[0].carton.after.stock_current === 9
// - response.actions[0].target.after.stock_current === 50
// - response.sync_op_id !== null

// ============= SCENARIO 2: CARTON VIDE =============
/*
Situation:
- CARTON.stock_current = 0
- PIECE.stock_current = 0
- PIECE.auto_stock_factor = 50

Attente:
- Aucune action
- reason = "CARTON stock_current <= 0 (aucune action)"
- actions = []
*/

// TEST 2A: Vider le CARTON
curl -X POST http://localhost:3000/api/autostock/apply/RIZ-001 \
  -H "Content-Type: application/json" \
  -d '{ "unit_level": "PIECE" }' | jq .

// Assertions:
// - response.ok === true
// - response.actions.length === 0
// - response.reason.includes("CARTON stock_current <= 0")

// ============= SCENARIO 3: PIECE DÉJÀ FOURNI =============
/*
Situation:
- CARTON.stock_current = 10
- PIECE.stock_current = 30 (> 0)
- PIECE.auto_stock_factor = 50

Attente:
- Aucune action (pas besoin d'ouvrir carton si PIECE > 0)
- actions = []
*/

// TEST 3A: PIECE avec stock
curl -X POST http://localhost:3000/api/autostock/apply/RIZ-001 \
  -H "Content-Type: application/json" \
  -d '{ "unit_level": "PIECE" }' | jq .

// Assertions:
// - response.ok === true
// - response.actions.length === 0

// ============= SCENARIO 4: AUTO_STOCK_FACTOR = 0 =============
/*
Situation:
- CARTON.stock_current = 10
- PIECE.stock_current = 0
- PIECE.auto_stock_factor = 0 (ou vide)

Attente:
- Aucune action (impossible de convertir si factor = 0)
- actions = []
*/

// TEST 4A: Factor vide
curl -X POST http://localhost:3000/api/autostock/apply/RIZ-001 \
  -H "Content-Type: application/json" \
  -d '{ "unit_level": "PIECE" }' | jq .

// Assertions:
// - response.ok === true
// - response.actions.length === 0

// ============= SCENARIO 5: STOCK NÉGATIF (RATTRAPAGE) =============
/*
Situation:
- CARTON.stock_current = 10
- PIECE.stock_current = -3 (vente en excès)
- PIECE.auto_stock_factor = 50

Attente:
- PIECE.stock_current -> -3 + 50 = 47 (rattrapage)
- CARTON.stock_current -> 9
*/

// TEST 5A: Stock négatif
curl -X POST http://localhost:3000/api/autostock/apply/RIZ-001 \
  -H "Content-Type: application/json" \
  -d '{ "unit_level": "PIECE" }' | jq .

// Assertions:
// - response.ok === true
// - response.actions.length === 1
// - response.actions[0].target.after.stock_current === 47

// ============= SCENARIO 6: MULTIPLE ACTIONS (PIECE + MILLIER) =============
/*
Situation:
- CARTON.stock_current = 10
- PIECE.stock_current = 0, factor = 50
- MILLIER.stock_current = 0, factor = 20

Attente:
- 2 actions
- CARTON -> 8 (ouvert 2 fois)
- PIECE -> 50
- MILLIER -> 20
*/

// TEST 6A: Sans unit_level (défaut: tous)
curl -X POST http://localhost:3000/api/autostock/apply/RIZ-001 \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

// Assertions:
// - response.ok === true
// - response.actions.length === 2
// - carton final = 8
// - PIECE = 50
// - MILLIER = 20

// ============= SCENARIO 7: PRODUIT INTROUVABLE =============

// TEST 7A: Code inexistant
curl -X POST http://localhost:3000/api/autostock/apply/UNKNOWN-001 \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

// Assertions:
// - response.ok === false
// - response.error.includes("Produit introuvable")
// - HTTP 404

// ============= SCENARIO 8: SANS UNITÉ CARTON =============

// TEST 8A: Produit sans CARTON
curl -X POST http://localhost:3000/api/autostock/apply/PROD-NO-CARTON \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

// Assertions:
// - response.ok === false
// - response.error.includes("sans unité CARTON")
// - HTTP 400

// ============= SCENARIO 9: PARAMÈTRE PRODUCTKEY MANQUANT =============

// TEST 9A: Via /apply sans productKey
curl -X POST http://localhost:3000/api/autostock/apply \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

// Assertions:
// - response.ok === false
// - response.error.includes("productKey requis")
// - HTTP 400

// ============= VERIFICATION DB =============

// Après un test réussi, vérifier les données:

-- Vérifier les stocks
SELECT id, uuid, unit_level, stock_initial, stock_current, auto_stock_factor
FROM product_units
WHERE product_id = (SELECT id FROM products WHERE code = 'RIZ-001')
ORDER BY unit_level;

-- Vérifier les stock_moves
SELECT move_id, product_code, unit_level, delta, reason, stock_before, stock_after, created_at
FROM stock_moves
WHERE product_code = 'RIZ-001'
ORDER BY created_at DESC;

-- Vérifier les sync_operations
SELECT op_id, op_type, entity_code, status, payload_json, created_at
FROM sync_operations
WHERE entity_code = 'RIZ-001'
ORDER BY created_at DESC;

-- Vérifier que les triggers ont bien mis à jour last_update
SELECT uuid, unit_level, stock_current, last_update, synced_at
FROM product_units
WHERE product_id = (SELECT id FROM products WHERE code = 'RIZ-001');

// ============= CHECKLIST FINAL =============

/*
✓ Router chargé dans server.js
✓ DB initialisée avec schema.sql
✓ PRAGMA foreign_keys = ON au startup ET dans le route
✓ Endpoints /api/autostock/apply/:productKey et /api/autostock/apply fonctionnent
✓ Les paramètres productKey, unit_level, device_id sont bien parsés
✓ Les stocks (stock_initial ET stock_current) sont modifiés ensemble
✓ Les stock_moves sont créés avec les bonnes valeurs (delta, reason, before/after)
✓ Les sync_operations sont créées avec status='pending'
✓ Les unités ont last_update = NOW() et synced_at = NULL après l'action
✓ Les conditions de sécurité sont respectées (factor > 0, carton > 0, cible <= 0)
✓ Les erreurs sont bien gérées (produit intro, carton absent, etc.)
✓ Les cas "pas d'action" sont bien loggés (raison explicitée)
✓ Les UUIDs sont générés correctement (pour move_id, op_id)
✓ Idempotence: 2x la même requête ne double pas les actions (op_id unique)
*/
