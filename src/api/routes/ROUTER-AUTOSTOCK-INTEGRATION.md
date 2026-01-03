/**
 * INTÉGRATION ROUTER.AUTOSTOCK
 * 
 * Ajoute ceci à ton server.js (ou main.js, index.js)
 */

// ============= EXEMPLE: server.js =============

import express from 'express';
import sqlite3 from 'sqlite3';  // ou better-sqlite3
import autoStockRouter from './routes/router.autostock.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialiser la DB
const db = new sqlite3.Database('./db/data.db', (err) => {
  if (err) {
    console.error('Erreur connexion DB:', err);
    process.exit(1);
  }
  console.log('✅ DB SQLite3 connectée');
  
  // Force PRAGMA au démarrage
  db.run('PRAGMA foreign_keys = ON;');
});

// Middleware
app.use(express.json());

// Passer la DB à Express pour que les routes y accèdent
app.locals.db = db;

// Routes
app.use('/api/products', productRouter);      // ton router produits
app.use('/api/sales', salesRouter);           // ton router ventes
app.use('/api/autostock', autoStockRouter);   // ✅ LE NOUVEAU ROUTER

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Erreur:', err);
  res.status(err.status || 500).json({ 
    ok: false, 
    error: err.message || 'Erreur serveur' 
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur sur http://localhost:${PORT}`);
});

// ============= ENDPOINTS DISPONIBLES =============

/**
 * POST /api/autostock/apply/:productKey
 * Applique l'autostock sur un produit (par id/code/uuid/name)
 * 
 * Paramètres:
 * - productKey (path): id|code|uuid|name du produit
 * - unit_level (body/query, optionnel): "PIECE" ou "MILLIER" (défaut: tous)
 * - device_id (body/header, optionnel): ID du device source
 * 
 * Exemple:
 * curl -X POST http://localhost:3000/api/autostock/apply/PROD-001 \
 *   -H "Content-Type: application/json" \
 *   -d '{ "unit_level": "PIECE", "device_id": "ipad-1" }'
 * 
 * Réponse:
 * {
 *   "ok": true,
 *   "product": { "id": 1, "uuid": "...", "code": "PROD-001", "name": "Riz" },
 *   "actions": [
 *     {
 *       "opened_carton": true,
 *       "factor": 50,
 *       "carton": { "uuid": "...", "before": {...}, "after": {...} },
 *       "target": { "unit_level": "PIECE", "uuid": "...", "before": {...}, "after": {...} }
 *     }
 *   ],
 *   "sync_op_id": "..."
 * }
 */

/**
 * POST /api/autostock/apply
 * Applique l'autostock (body payload)
 * 
 * Body:
 * {
 *   "productKey": "PROD-001" ou 1 ou "uuid-...",
 *   "unit_level": "PIECE" (optionnel),
 *   "device_id": "ipad-1" (optionnel)
 * }
 * 
 * Exemple:
 * curl -X POST http://localhost:3000/api/autostock/apply \
 *   -H "Content-Type: application/json" \
 *   -d '{ "productKey": "PROD-001", "unit_level": "PIECE" }'
 */

// ============= LOGIQUE PRO =============

/*
CONDITIONS D'EXECUTION:

1. Produit doit exister (par id/code/uuid/name)
2. Produit doit avoir une unité CARTON
3. auto_stock_factor (sur PIECE/MILLIER) > 0
4. CARTON.stock_current > 0
5. PIECE/MILLIER.stock_current <= 0 (vide/zéro/négatif)

ACTION:
- CARTON: stock_initial -= 1, stock_current -= 1
- PIECE/MILLIER: stock_initial += factor, stock_current += factor
- Chaque unité: last_update = NOW(), synced_at = NULL (pour resync)
- Log 2 stock_moves (carton -, cible +) avec reason="adjustment"
- Crée 1 sync_operation (idempotente) avec status="pending" pour Sheets

EXEMPLE CONCRET:
- CARTON.stock_current = 10
- PIECE.stock_current = 0
- PIECE.auto_stock_factor = 50

Après autostock:
- CARTON.stock_current = 9
- PIECE.stock_current = 50

Et si PIECE.stock_current = -3:
- PIECE.stock_current = -3 + 50 = 47 (rattrapage auto)
*/

// ============= REQUÊTE HTTP EXEMPLES =============

// 1) Autostock par code produit
POST /api/autostock/apply/RIZ-001
Content-Type: application/json

{
  "unit_level": "PIECE",
  "device_id": "ipad-gerant-1"
}

// 2) Autostock par ID numérique
POST /api/autostock/apply/5
Content-Type: application/json

{}

// 3) Autostock par UUID
POST /api/autostock/apply/uuid-abc123...
Content-Type: application/json

{
  "unit_level": "MILLIER"
}

// 4) Autostock via payload body
POST /api/autostock/apply
Content-Type: application/json

{
  "productKey": "RIZ-001",
  "unit_level": "PIECE",
  "device_id": "ipad-gerant-1"
}

// ============= RÉPONSES =============

// Succès avec 1 action (autostock exécuté)
{
  "ok": true,
  "product": {
    "id": 1,
    "uuid": "prod-uuid-1",
    "code": "RIZ-001",
    "name": "Riz premium"
  },
  "actions": [
    {
      "opened_carton": true,
      "factor": 50,
      "carton": {
        "uuid": "unit-carton-uuid",
        "before": { "stock_initial": 10, "stock_current": 10 },
        "after": { "stock_initial": 9, "stock_current": 9 }
      },
      "target": {
        "unit_level": "PIECE",
        "uuid": "unit-piece-uuid",
        "before": { "stock_initial": 0, "stock_current": 0 },
        "after": { "stock_initial": 50, "stock_current": 50 }
      }
    }
  ],
  "sync_op_id": "op-uuid-123"
}

// Succès sans action (CARTON stock_current = 0)
{
  "ok": true,
  "product": { "id": 1, "uuid": "...", "code": "RIZ-001", "name": "Riz premium" },
  "reason": "CARTON stock_current <= 0 (aucune action)",
  "actions": []
}

// Succès sans action (PIECE stock_current > 0, pas besoin)
{
  "ok": true,
  "product": { "id": 1, "uuid": "...", "code": "RIZ-001", "name": "Riz premium" },
  "reason": "Aucune unité cible (PIECE/MILLIER) trouvée",
  "actions": []
}

// Erreur: Produit introuvable
{
  "ok": false,
  "error": "Produit introuvable: \"UNKNOWN-001\" (id/code/uuid/name)"
}

// Erreur: Pas de CARTON
{
  "ok": false,
  "error": "Produit \"RIZ-001\" sans unité CARTON"
}

// ============= INTÉGRATION FRONTEND (VUE / REACT) =============

// Bouton dans la UI des produits
<button onClick={() => triggerAutoStock('RIZ-001', 'PIECE')}>
  🔄 Ouvrir Carton (Auto-Stock)
</button>

// Fonction frontend
async function triggerAutoStock(productKey, unitLevel) {
  try {
    const res = await fetch('/api/autostock/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productKey,
        unit_level: unitLevel,
        device_id: navigator.userAgent  // Ou un vrai device_id
      })
    });

    const data = await res.json();
    
    if (data.ok) {
      if (data.actions.length > 0) {
        console.log('✅ AutoStock effectué:', data.actions);
        // Rafraîchir les stocks
        loadProducts();
      } else {
        console.log('⚠️ Aucune action:', data.reason);
      }
    } else {
      console.error('❌ Erreur:', data.error);
    }
  } catch (e) {
    console.error('❌ Erreur requête:', e);
  }
}
