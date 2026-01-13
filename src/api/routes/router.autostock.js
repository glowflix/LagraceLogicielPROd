/**
 * router.autostock.js
 * 
 * ROUTE AUTO-STOCK (Carton -> Piece/Millier)
 * Compatible avec le schéma SQL:
 * - products(id, uuid, code, name)
 * - product_units(uuid, product_id, unit_level, stock_initial, stock_current, auto_stock_factor, ...)
 * - stock_moves(...)
 * - sync_operations(...)
 *
 * Règle:
 * - On ne fait RIEN si auto_stock_factor <= 0
 * - On ne fait RIEN si carton.stock_current <= 0
 * - On "ouvre" 1 carton si target.stock_current <= 0 (PIECE/MILLIER) :
 *      carton -= 1
 *      target += factor
 *   Et on modifie TOUJOURS stock_initial ET stock_current en même temps.
 */

import express from "express";
import crypto from "crypto";

const router = express.Router();

function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (crypto.randomBytes(1)[0] % 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowISO() {
  return new Date().toISOString();
}

function toUpper(s) {
  return String(s ?? "").toUpperCase().trim();
}

function isIntString(s) {
  return typeof s === "string" && /^[0-9]+$/.test(s.trim());
}

function toNum(v, fallback = 0) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function normFactor(v) {
  const n = toNum(v, 0);
  return n > 0 ? n : 0;
}

/**
 * DB wrapper: support sqlite3 callbacks OR better-sqlite3 sync.
 * On suppose que req.app.locals.db est déjà initialisé.
 */
function makeDb(db) {
  if (!db) throw new Error("DB manquante: req.app.locals.db est requis.");

  const isBetter = typeof db.prepare === "function";

  if (isBetter) {
    return {
      async exec(sql) {
        // better-sqlite3: exec existe souvent
        if (typeof db.exec === "function") return db.exec(sql);
        // fallback run
        return db.prepare(sql).run();
      },
      async get(sql, params = []) {
        return db.prepare(sql).get(params);
      },
      async all(sql, params = []) {
        return db.prepare(sql).all(params);
      },
      async run(sql, params = []) {
        return db.prepare(sql).run(params);
      },
      async tx(fn) {
        const trx = db.transaction(() => fn());
        return trx();
      },
    };
  }

  // sqlite3 (callbacks)
  return {
    exec(sql) {
      return new Promise((resolve, reject) => {
        db.exec(sql, (err) => (err ? reject(err) : resolve()));
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
      });
    },
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes ?? 0, lastID: this.lastID });
        });
      });
    },
    async tx(fn) {
      await this.run("BEGIN IMMEDIATE");
      try {
        const out = await fn();
        await this.run("COMMIT");
        return out;
      } catch (e) {
        await this.run("ROLLBACK");
        throw e;
      }
    },
  };
}

async function forcePragmas(dbx) {
  // Sécurité runtime (tu as déjà WAL/foreign_keys dans ton bootstrap,
  // mais ici on garantit au moins foreign_keys)
  await dbx.exec("PRAGMA foreign_keys = ON;");
}

/**
 * Trouver produit par:
 * - id (numérique)
 * - code (exact)
 * - uuid (exact)
 * - name (exact, fallback)
 */
async function getProductByKey(dbx, key) {
  const k = String(key ?? "").trim();
  if (!k) return null;

  if (isIntString(k)) {
    const p = await dbx.get(`SELECT * FROM products WHERE id = ? LIMIT 1`, [Number(k)]);
    if (p) return p;
  }

  let p = await dbx.get(`SELECT * FROM products WHERE code = ? LIMIT 1`, [k]);
  if (p) return p;

  p = await dbx.get(`SELECT * FROM products WHERE uuid = ? LIMIT 1`, [k]);
  if (p) return p;

  p = await dbx.get(`SELECT * FROM products WHERE name = ? LIMIT 1`, [k]);
  if (p) return p;

  return null;
}

async function getUnits(dbx, productId) {
  return dbx.all(`SELECT * FROM product_units WHERE product_id = ?`, [productId]);
}

/**
 * Update PRO: toujours stock_initial ET stock_current ensemble
 * + last_update + synced_at NULL (pour resync)
 */
async function updateUnitStocks(dbx, unitUuid, delta) {
  const t = nowISO();

  // Lire avant
  const before = await dbx.get(
    `SELECT uuid, stock_initial, stock_current FROM product_units WHERE uuid = ? LIMIT 1`,
    [unitUuid]
  );
  if (!before) {
    const err = new Error(`Unité introuvable (uuid): ${unitUuid}`);
    err.status = 400;
    throw err;
  }

  const bi = toNum(before.stock_initial, 0);
  const bc = toNum(before.stock_current, 0);

  const afterI = bi + delta;
  const afterC = bc + delta;

  await dbx.run(
    `UPDATE product_units
     SET stock_initial = stock_initial + ?,
         stock_current = stock_current + ?,
         updated_at = datetime('now'),
         last_update = datetime('now'),
         synced_at = NULL
     WHERE uuid = ?`,
    [delta, delta, unitUuid]
  );

  return {
    before: { stock_initial: bi, stock_current: bc },
    after: { stock_initial: afterI, stock_current: afterC },
  };
}

async function insertStockMove(dbx, move) {
  // move: { product_uuid, product_code, unit_level, unit_mark, delta, reason, reference_id, stock_before, stock_after, device_id }
  const move_id = uuidv4();

  await dbx.run(
    `INSERT INTO stock_moves (
      move_id, product_uuid, product_code, unit_level, unit_mark,
      delta, reason, reference_id, stock_before, stock_after, device_id,
      synced, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
    [
      move_id,
      move.product_uuid,
      move.product_code,
      move.unit_level,
      move.unit_mark ?? "",
      move.delta,
      move.reason,
      move.reference_id ?? null,
      move.stock_before ?? null,
      move.stock_after ?? null,
      move.device_id ?? null,
      0,
    ]
  );

  return move_id;
}

async function insertSyncOperation(dbx, op) {
  // op: { op_type, entity_uuid, entity_code, payload, device_id }
  const op_id = uuidv4();
  await dbx.run(
    `INSERT INTO sync_operations (
      op_id, op_type, entity_uuid, entity_code, payload_json, device_id,
      status, tries, created_at, updated_at
    ) VALUES (?,?,?,?,?,?, 'pending', 0, datetime('now'), datetime('now'))`,
    [
      op_id,
      op.op_type,
      op.entity_uuid,
      op.entity_code ?? null,
      JSON.stringify(op.payload ?? {}),
      op.device_id ?? null,
    ]
  );
  return op_id;
}

/**
 * Applique l'autostock:
 * - targetLevels: ["PIECE"] ou ["MILLIER"] ou ["PIECE","MILLIER"]
 * - condition: "empty" (<=0) par défaut
 */
async function applyAutoStock(dbx, productKey, opts = {}) {
  const product = await getProductByKey(dbx, productKey);
  if (!product) {
    const err = new Error(`Produit introuvable: "${productKey}" (id/code/uuid/name)`);
    err.status = 404;
    throw err;
  }

  const units = await getUnits(dbx, product.id);

  const carton = units.find((u) => toUpper(u.unit_level) === "CARTON");
  if (!carton) {
    const err = new Error(`Produit "${product.code}" sans unité CARTON`);
    err.status = 400;
    throw err;
  }

  const cartonStock = toNum(carton.stock_current, 0);
  if (cartonStock <= 0) {
    return {
      ok: true,
      product: { id: product.id, uuid: product.uuid, code: product.code, name: product.name },
      reason: "CARTON stock_current <= 0 (aucune action)",
      actions: [],
    };
  }

  const device_id = opts.device_id ?? null;

  // Target Levels
  const requested = (opts.unit_level ? [opts.unit_level] : ["PIECE", "MILLIER"])
    .map(toUpper)
    .filter((x) => x === "PIECE" || x === "MILLIER");

  const targets = requested
    .map((lvl) => units.find((u) => toUpper(u.unit_level) === lvl))
    .filter(Boolean);

  if (targets.length === 0) {
    return {
      ok: true,
      product: { id: product.id, uuid: product.uuid, code: product.code, name: product.name },
      reason: "Aucune unité cible (PIECE/MILLIER) trouvée",
      actions: [],
    };
  }

  let cartonLeft = cartonStock;
  const actions = [];
  const moveIds = [];

  // Condition: empty (<=0)
  for (const target of targets) {
    const factor = normFactor(target.auto_stock_factor);
    if (!factor) continue;

    const targetStock = toNum(target.stock_current, 0);

    // Si cible > 0 => rien
    if (targetStock > 0) continue;

    // Si plus de carton => stop
    if (cartonLeft <= 0) break;

    // 1) CARTON -1
    const cartonUuid = carton.uuid;
    const cartonDelta = -1;

    // 2) TARGET +factor (replenish)
    const targetUuid = target.uuid;
    const targetDelta = factor;

    // MàJ stocks (stock_initial & stock_current ensemble)
    const cartonUpd = await updateUnitStocks(dbx, cartonUuid, cartonDelta);
    const targetUpd = await updateUnitStocks(dbx, targetUuid, targetDelta);

    cartonLeft = cartonUpd.after.stock_current;

    // Log stock_moves (2 mouvements)
    const ref = `AUTO_STOCK:${product.code}`;

    const cartonMoveId = await insertStockMove(dbx, {
      product_uuid: product.uuid,
      product_code: product.code,
      unit_level: "CARTON",
      unit_mark: carton.unit_mark ?? "",
      delta: cartonDelta,
      reason: "adjustment",
      reference_id: ref,
      stock_before: cartonUpd.before.stock_current,
      stock_after: cartonUpd.after.stock_current,
      device_id,
    });

    const targetMoveId = await insertStockMove(dbx, {
      product_uuid: product.uuid,
      product_code: product.code,
      unit_level: toUpper(target.unit_level),
      unit_mark: target.unit_mark ?? "",
      delta: targetDelta,
      reason: "adjustment",
      reference_id: ref,
      stock_before: targetUpd.before.stock_current,
      stock_after: targetUpd.after.stock_current,
      device_id,
    });

    moveIds.push(cartonMoveId, targetMoveId);

    actions.push({
      opened_carton: true,
      factor,
      carton: {
        uuid: cartonUuid,
        before: cartonUpd.before,
        after: cartonUpd.after,
      },
      target: {
        unit_level: toUpper(target.unit_level),
        uuid: targetUuid,
        before: targetUpd.before,
        after: targetUpd.after,
      },
    });
  }

  // Si aucune action, on ne crée pas d'op sync
  let sync_op_id = null;
  if (actions.length > 0) {
    // 1 seule opération idempotente qui contient les 2 moves (carton+target) par action
    sync_op_id = await insertSyncOperation(dbx, {
      op_type: "STOCK_MOVE",
      entity_uuid: product.uuid,
      entity_code: product.code,
      device_id,
      payload: {
        kind: "AUTO_STOCK",
        product: { uuid: product.uuid, code: product.code, name: product.name },
        move_ids: moveIds,
        actions,
        at: nowISO(),
      },
    });
  }

  return {
    ok: true,
    product: { id: product.id, uuid: product.uuid, code: product.code, name: product.name },
    actions,
    sync_op_id,
  };
}

/**
 * POST /api/autostock/apply/:productKey
 * Body optionnel:
 * { unit_level?: "PIECE"|"MILLIER", device_id?: string }
 *
 * Exemple:
 * POST /api/autostock/apply/PROD-001
 * { "unit_level": "PIECE", "device_id": "device-123" }
 */
router.post("/apply/:productKey", async (req, res) => {
  const db = req.app?.locals?.db;
  const dbx = makeDb(db);

  const productKey = req.params.productKey;
  const unit_level = req.body?.unit_level ?? req.query?.unit_level;
  const device_id = req.body?.device_id ?? req.headers["x-device-id"] ?? null;

  try {
    const result = await dbx.tx(async () => {
      await forcePragmas(dbx);
      return applyAutoStock(dbx, productKey, { unit_level, device_id });
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || "Erreur AutoStock" });
  }
});

/**
 * POST /api/autostock/apply
 * Body:
 * { productKey: string|number, unit_level?: "PIECE"|"MILLIER", device_id?: string }
 *
 * Exemple:
 * POST /api/autostock/apply
 * { "productKey": "PROD-001", "unit_level": "PIECE" }
 */
router.post("/apply", async (req, res) => {
  const db = req.app?.locals?.db;
  const dbx = makeDb(db);

  const productKey = req.body?.productKey;
  const unit_level = req.body?.unit_level ?? req.query?.unit_level;
  const device_id = req.body?.device_id ?? req.headers["x-device-id"] ?? null;

  if (!productKey) return res.status(400).json({ ok: false, error: "productKey requis (id/code/uuid/name)" });

  try {
    const result = await dbx.tx(async () => {
      await forcePragmas(dbx);
      return applyAutoStock(dbx, productKey, { unit_level, device_id });
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || "Erreur AutoStock" });
  }
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTO-STOCK PRÉVENTIF POUR VENTES (SalesPOS)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Calcule et applique l'auto-stock AVANT qu'il soit trop tard, basé sur la
 * quantité demandée par l'utilisateur dans l'écran de vente.
 * 
 * Exemple:
 * - Stock MILLIER: 15, auto_stock_factor: 50
 * - Quantité demandée: 45
 * - Stock insuffisant (15 < 45)
 * - Besoin: ceil((45 - 15) / 50) = 1 carton
 * - Après conversion: MILLIER = 15 + 50 = 65, CARTON = n - 1
 * - Vente peut continuer: 65 >= 45
 */

/**
 * Prévisualisation Auto-Stock (read-only, pas de modification DB)
 * 
 * POST /api/autostock/preview
 * Body: { productKey, unit_level, qty_requested }
 * 
 * Retourne:
 * - needsConversion: boolean
 * - cartonsNeeded: number
 * - cartonsAvailable: number
 * - canFulfill: boolean (si conversion possible)
 * - stockAfterConversion: number
 * - message: string (pour UI)
 */
router.post("/preview", async (req, res) => {
  const db = req.app?.locals?.db;
  const dbx = makeDb(db);

  const { productKey, unit_level, qty_requested } = req.body || {};

  if (!productKey) {
    return res.status(400).json({ ok: false, error: "productKey requis" });
  }
  if (!unit_level) {
    return res.status(400).json({ ok: false, error: "unit_level requis (PIECE ou MILLIER)" });
  }
  if (typeof qty_requested !== 'number' || qty_requested <= 0) {
    return res.status(400).json({ ok: false, error: "qty_requested requis (nombre > 0)" });
  }

  try {
    const product = await getProductByKey(dbx, productKey);
    if (!product) {
      return res.status(404).json({ ok: false, error: `Produit introuvable: ${productKey}` });
    }

    const units = await getUnits(dbx, product.id);
    const carton = units.find((u) => toUpper(u.unit_level) === "CARTON");
    const target = units.find((u) => toUpper(u.unit_level) === toUpper(unit_level));

    if (!carton) {
      return res.json({
        ok: true,
        needsConversion: false,
        canFulfill: false,
        message: "Pas d'unité CARTON trouvée pour ce produit",
        stockCurrent: target?.stock_current || 0,
      });
    }

    if (!target) {
      return res.status(404).json({ ok: false, error: `Unité ${unit_level} introuvable pour ce produit` });
    }

    const cartonStock = toNum(carton.stock_current, 0);
    const targetStock = toNum(target.stock_current, 0);
    const factor = normFactor(target.auto_stock_factor);

    // Stock suffisant sans conversion
    if (targetStock >= qty_requested) {
      return res.json({
        ok: true,
        needsConversion: false,
        canFulfill: true,
        cartonsNeeded: 0,
        cartonsAvailable: cartonStock,
        stockCurrent: targetStock,
        stockAfterConversion: targetStock,
        factor: factor,
        message: `Stock suffisant (${targetStock} disponibles)`,
      });
    }

    // Pas de facteur de conversion
    if (factor <= 0) {
      return res.json({
        ok: true,
        needsConversion: false,
        canFulfill: targetStock >= qty_requested,
        cartonsNeeded: 0,
        cartonsAvailable: cartonStock,
        stockCurrent: targetStock,
        stockAfterConversion: targetStock,
        factor: 0,
        message: `Auto-stock désactivé (factor=0). Stock: ${targetStock}`,
      });
    }

    // Calculer combien de cartons sont nécessaires
    const shortage = qty_requested - targetStock;
    const cartonsNeeded = Math.ceil(shortage / factor);

    // Vérifier si assez de cartons
    if (cartonsNeeded > cartonStock) {
      const maxPossibleStock = targetStock + (cartonStock * factor);
      
      // ✅ Message spécifique si cartons = 0
      let message;
      if (cartonStock <= 0) {
        message = `Stock épuisé: ${targetStock} ${toUpper(unit_level)} disponibles, aucun carton à convertir`;
      } else {
        message = `Stock insuffisant: max ${maxPossibleStock} (${cartonStock} carton${cartonStock > 1 ? 's' : ''} dispo)`;
      }
      
      return res.json({
        ok: true,
        needsConversion: true,
        canFulfill: false,
        cartonsNeeded: cartonsNeeded,
        cartonsAvailable: cartonStock,
        stockCurrent: targetStock,
        stockAfterConversion: maxPossibleStock,
        factor: factor,
        shortage: qty_requested - maxPossibleStock,
        noCartonsLeft: cartonStock <= 0,
        message: message,
      });
    }

    // Conversion possible!
    const stockAfterConversion = targetStock + (cartonsNeeded * factor);
    const remainingStock = stockAfterConversion - qty_requested;

    return res.json({
      ok: true,
      needsConversion: true,
      canFulfill: true,
      cartonsNeeded: cartonsNeeded,
      cartonsAvailable: cartonStock,
      cartonStockAfter: cartonStock - cartonsNeeded,
      stockCurrent: targetStock,
      stockAfterConversion: stockAfterConversion,
      remainingAfterSale: remainingStock,
      factor: factor,
      message: `Auto-Stock: ${cartonsNeeded} carton(s) → +${cartonsNeeded * factor} ${toUpper(unit_level)}`,
    });

  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || "Erreur preview AutoStock" });
  }
});

/**
 * Appliquer Auto-Stock PRÉVENTIF pour une quantité demandée
 * 
 * POST /api/autostock/apply-for-sale
 * Body: { productKey, unit_level, qty_requested, device_id? }
 * 
 * Cette route:
 * 1. Calcule combien de cartons sont nécessaires
 * 2. Convertit UNIQUEMENT le nombre de cartons nécessaires
 * 3. Retourne le nouveau stock pour que la vente puisse continuer
 */
router.post("/apply-for-sale", async (req, res) => {
  const db = req.app?.locals?.db;
  const dbx = makeDb(db);

  const { productKey, unit_level, qty_requested, device_id } = req.body || {};

  if (!productKey) {
    return res.status(400).json({ ok: false, error: "productKey requis" });
  }
  if (!unit_level) {
    return res.status(400).json({ ok: false, error: "unit_level requis (PIECE ou MILLIER)" });
  }
  if (typeof qty_requested !== 'number' || qty_requested <= 0) {
    return res.status(400).json({ ok: false, error: "qty_requested requis (nombre > 0)" });
  }

  try {
    const result = await dbx.tx(async () => {
      await forcePragmas(dbx);

      const product = await getProductByKey(dbx, productKey);
      if (!product) {
        const err = new Error(`Produit introuvable: ${productKey}`);
        err.status = 404;
        throw err;
      }

      const units = await getUnits(dbx, product.id);
      const carton = units.find((u) => toUpper(u.unit_level) === "CARTON");
      const target = units.find((u) => toUpper(u.unit_level) === toUpper(unit_level));

      if (!carton) {
        const err = new Error(`Pas d'unité CARTON pour ${product.code}`);
        err.status = 400;
        throw err;
      }

      if (!target) {
        const err = new Error(`Unité ${unit_level} introuvable pour ${product.code}`);
        err.status = 404;
        throw err;
      }

      const cartonStock = toNum(carton.stock_current, 0);
      const targetStock = toNum(target.stock_current, 0);
      const factor = normFactor(target.auto_stock_factor);

      // Stock déjà suffisant
      if (targetStock >= qty_requested) {
        return {
          ok: true,
          applied: false,
          reason: "Stock déjà suffisant",
          product: { code: product.code, name: product.name },
          stockCurrent: targetStock,
          stockFinal: targetStock,
        };
      }

      // Pas de facteur
      if (factor <= 0) {
        const err = new Error(`Auto-stock désactivé pour ${unit_level} (factor=0)`);
        err.status = 400;
        throw err;
      }

      // Calculer cartons nécessaires
      const shortage = qty_requested - targetStock;
      const cartonsNeeded = Math.ceil(shortage / factor);

      // Vérifier disponibilité cartons
      if (cartonsNeeded > cartonStock) {
        const err = new Error(`Cartons insuffisants: ${cartonStock} disponibles, ${cartonsNeeded} requis`);
        err.status = 400;
        throw err;
      }

      // ✅ APPLIQUER LA CONVERSION
      const actions = [];
      const moveIds = [];
      const ref = `AUTO_STOCK_SALE:${product.code}`;

      // Décrémenter CARTON
      const cartonDelta = -cartonsNeeded;
      const cartonUpd = await updateUnitStocks(dbx, carton.uuid, cartonDelta);

      // Incrémenter TARGET
      const targetDelta = cartonsNeeded * factor;
      const targetUpd = await updateUnitStocks(dbx, target.uuid, targetDelta);

      // Log stock_moves
      const cartonMoveId = await insertStockMove(dbx, {
        product_uuid: product.uuid,
        product_code: product.code,
        unit_level: "CARTON",
        unit_mark: carton.unit_mark ?? "",
        delta: cartonDelta,
        reason: "adjustment",
        reference_id: ref,
        stock_before: cartonUpd.before.stock_current,
        stock_after: cartonUpd.after.stock_current,
        device_id: device_id ?? "SALES_POS",
      });

      const targetMoveId = await insertStockMove(dbx, {
        product_uuid: product.uuid,
        product_code: product.code,
        unit_level: toUpper(target.unit_level),
        unit_mark: target.unit_mark ?? "",
        delta: targetDelta,
        reason: "adjustment",
        reference_id: ref,
        stock_before: targetUpd.before.stock_current,
        stock_after: targetUpd.after.stock_current,
        device_id: device_id ?? "SALES_POS",
      });

      moveIds.push(cartonMoveId, targetMoveId);

      // Sync operations
      const sync_op_id = await insertSyncOperation(dbx, {
        op_type: "STOCK_MOVE",
        entity_uuid: product.uuid,
        entity_code: product.code,
        device_id: device_id ?? "SALES_POS",
        payload: {
          kind: "AUTO_STOCK_SALE",
          product: { uuid: product.uuid, code: product.code, name: product.name },
          move_ids: moveIds,
          cartonsConverted: cartonsNeeded,
          unitsAdded: targetDelta,
          unit_level: toUpper(unit_level),
          at: nowISO(),
        },
      });

      return {
        ok: true,
        applied: true,
        product: { code: product.code, name: product.name, uuid: product.uuid },
        cartonsConverted: cartonsNeeded,
        factor: factor,
        unitsAdded: targetDelta,
        cartonBefore: cartonUpd.before.stock_current,
        cartonAfter: cartonUpd.after.stock_current,
        targetBefore: targetUpd.before.stock_current,
        targetAfter: targetUpd.after.stock_current,
        stockFinal: targetUpd.after.stock_current,
        remainingAfterSale: targetUpd.after.stock_current - qty_requested,
        sync_op_id,
        message: `✅ ${cartonsNeeded} carton(s) converti(s) → +${targetDelta} ${toUpper(unit_level)}`,
      };
    });

    res.json(result);

  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || "Erreur AutoStock Sale" });
  }
});

/**
 * AUTO-VÉRIFICATION (toutes les 2 secondes)
 * 
 * Scanne tous les produits et déclenche automatiquement autostock si:
 * 1. CARTON.stock_current > 0
 * 2. Une unité cible (PIECE/MILLIER) a stock_current <= 0
 * 3. Cette unité a auto_stock_factor > 0
 */

let autoCheckInterval = null;
let autoCheckRunning = false;

function runAutoCheck(db) {
  if (autoCheckRunning) return; // Éviter les chevauchements
  autoCheckRunning = true;

  const checkStartTime = Date.now();
  
  // ✅ SÉCURITÉ: Limites raisonnables pour éviter les valeurs cassées
  const MAX_STOCK = 1000000;  // Stock max acceptable
  const MIN_STOCK = -10000;   // Stock min acceptable (permet petits négatifs temporaires)
  const MAX_FACTOR = 10000;   // Facteur max acceptable
  
  try {
    // ✅ SYNCHRONE: utiliser db directement (better-sqlite3)
    // Pas de makeDb(), pas de async/await
    
    if (!db || typeof db.prepare !== 'function') {
      console.error('❌ [AutoCheck] DB non disponible ou invalide');
      return;
    }

    // 1. Récupérer tous les produits avec leurs unités
    const products = db.prepare(`
      SELECT DISTINCT p.id, p.uuid, p.code, p.name
      FROM products p
      JOIN product_units pu ON p.id = pu.product_id
      WHERE p.is_active = 1
      ORDER BY p.code ASC
    `).all();

    // Mode silencieux pour accélérer le démarrage - n'affiche que les actions effectuées
    let actionCount = 0;
    let skippedCount = 0;

    for (const product of products) {
      try {
        // 2. Récupérer toutes les unités du produit (synchrone)
        const units = db.prepare(`
          SELECT * FROM product_units WHERE product_id = ?
        `).all(product.id);

        // 3. Vérifier conditions:
        // - CARTON existe et stock > 0
        const carton = units.find((u) => (u.unit_level || '').toUpperCase().trim() === "CARTON");
        
        if (!carton) {
          skippedCount++;
          continue;
        }

        const cartonStock = Number(carton.stock_current ?? 0);
        
        // ✅ SÉCURITÉ: Vérifier que le stock CARTON est valide
        if (!Number.isFinite(cartonStock) || cartonStock < 0.5 || cartonStock > MAX_STOCK) {
          skippedCount++;
          continue;
        }

        // 4. Chercher UNE unité cible vide avec auto_stock_factor > 0
        // Chercher MILLIER ou PIECE
        const targets = units.filter(
          (u) => {
            const level = (u.unit_level || '').toUpperCase().trim();
            const stock = Number(u.stock_current ?? 0);
            const factor = Number(u.auto_stock_factor ?? 0);
            
            // ✅ SÉCURITÉ: Ignorer les valeurs cassées
            if (!Number.isFinite(stock) || stock < MIN_STOCK || stock > MAX_STOCK) {
              return false;
            }
            if (!Number.isFinite(factor) || factor <= 0 || factor > MAX_FACTOR) {
              return false;
            }
            
            return (level === "PIECE" || level === "MILLIER") && stock <= 0 && factor > 0;
          }
        );

        if (targets.length === 0) {
          skippedCount++;
          continue;
        }

        // 5. Si une cible vide trouvée, déclencher autostock (synchrone)
        const target = targets[0]; // Prendre la première cible
        // ✅ FIX: Forcer le facteur à être POSITIF avec Math.abs()
        const targetFactor = Math.abs(Math.floor(Number(target.auto_stock_factor ?? 0)));
        const targetStock = Number(target.stock_current ?? 0);
        
        // ✅ SÉCURITÉ FINALE: Vérifier les bornes
        if (targetFactor <= 0 || targetFactor > MAX_FACTOR) {
          skippedCount++;
          continue;
        }
        
        // ✅ DEBUG: Afficher les valeurs avant la transaction
        console.log(`  🔍 [AutoStock] ${product.code}: Vérification...`);
        console.log(`      CARTON: stock=${cartonStock}, MILLIER: stock=${targetStock}, factor=${targetFactor}`);

        // ✅ TRANSACTION SYNCHRONE
        try {
          const tx = db.transaction(() => {
            // ✅ Recalculer le facteur positif à l'intérieur de la transaction
            const positiveFactorTx = Math.abs(targetFactor);
            
            // 1) Update CARTON -1
            const cartonRes = db.prepare(`
              UPDATE product_units
              SET stock_initial = stock_initial - 1,
                  stock_current = stock_current - 1,
                  last_update = datetime('now'),
                  synced_at = NULL,
                  updated_at = datetime('now')
              WHERE uuid = ?
            `).run(carton.uuid);

            if (cartonRes.changes === 0) {
              throw new Error(`Impossible de mettre à jour CARTON (uuid: ${carton.uuid})`);
            }

            // 2) Update TARGET +factor (TOUJOURS POSITIF!)
            const targetRes = db.prepare(`
              UPDATE product_units
              SET stock_initial = stock_initial + ?,
                  stock_current = stock_current + ?,
                  last_update = datetime('now'),
                  synced_at = NULL,
                  updated_at = datetime('now')
              WHERE uuid = ?
            `).run(positiveFactorTx, positiveFactorTx, target.uuid);

            if (targetRes.changes === 0) {
              throw new Error(`Impossible de mettre à jour ${target.unit_level} (uuid: ${target.uuid})`);
            }

            // 3) Créer stock_moves (2 mouvements)
            const now = new Date().toISOString();
            const moveIdCarton = crypto.randomUUID();
            const moveIdTarget = crypto.randomUUID();
            const ref = `AUTO_STOCK:${product.code}`;

            db.prepare(`
              INSERT INTO stock_moves (
                move_id, product_uuid, product_code, unit_level, unit_mark,
                delta, reason, reference_id, stock_before, stock_after,
                device_id, synced, created_at
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
            `).run(
              moveIdCarton,
              product.uuid,
              product.code,
              'CARTON',
              carton.unit_mark || '',
              -1,
              'adjustment',
              ref,
              cartonStock,
              cartonStock - 1,
              'AUTO_CHECK',
              0
            );

            db.prepare(`
              INSERT INTO stock_moves (
                move_id, product_uuid, product_code, unit_level, unit_mark,
                delta, reason, reference_id, stock_before, stock_after,
                device_id, synced, created_at
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
            `).run(
              moveIdTarget,
              product.uuid,
              product.code,
              target.unit_level,
              target.unit_mark || '',
              Math.abs(targetFactor), // ✅ Toujours positif!
              'adjustment',
              ref,
              targetStock,
              targetStock + Math.abs(targetFactor), // ✅ Toujours positif!
              'AUTO_CHECK',
              0
            );

            // 4) Créer sync_operations - UNE OPÉRATION PAR MOUVEMENT avec format compatible sync.worker
            const opIdCarton = crypto.randomUUID();
            const opIdTarget = crypto.randomUUID();
            
            // ✅ FIX: Calculer les nouvelles valeurs de stock avec GARANTIE positive pour target
            const newCartonStock = Math.round((cartonStock - 1) * 100) / 100;
            const newTargetStock = Math.round((targetStock + Math.abs(targetFactor)) * 100) / 100;
            
            // ✅ FIX: Payload compatible avec pushStockMoves() dans sync.worker.js
            // Format requis: product_code, unit_level, unit_mark, stock_absolute, delta
            const payloadCarton = {
              move_id: moveIdCarton,
              product_uuid: product.uuid,
              product_code: String(product.code).trim(),
              unit_level: 'CARTON',
              unit_mark: carton.unit_mark || '',
              stock_absolute: newCartonStock,
              delta: -1,
              reason: 'adjustment',
              reference_id: ref,
              stock_before: cartonStock,
              stock_after: newCartonStock
            };

            // ✅ FIX: S'assurer que delta est POSITIF pour MILLIER/PIECE
            const positiveDelta = Math.abs(targetFactor);
            
            const payloadTarget = {
              move_id: moveIdTarget,
              product_uuid: product.uuid,
              product_code: String(product.code).trim(),
              unit_level: target.unit_level,
              unit_mark: target.unit_mark || '',
              stock_absolute: newTargetStock,
              delta: positiveDelta, // ✅ Toujours positif!
              reason: 'adjustment',
              reference_id: ref,
              stock_before: targetStock,
              stock_after: newTargetStock
            };
            
            // ✅ DEBUG: Afficher les payloads
            console.log(`      📤 CARTON: ${cartonStock} → ${newCartonStock} (delta: -1)`);
            console.log(`      📤 ${target.unit_level}: ${targetStock} → ${newTargetStock} (delta: +${positiveDelta})`);

            db.prepare(`
              INSERT INTO sync_operations (
                op_id, op_type, entity_uuid, entity_code, payload_json,
                device_id, status, tries, created_at, updated_at
              ) VALUES (?,?,?,?,?,?, 'pending', 0, datetime('now'), datetime('now'))
            `).run(
              opIdCarton,
              'STOCK_MOVE',
              product.uuid,
              product.code,
              JSON.stringify(payloadCarton),
              'AUTO_CHECK'
            );

            db.prepare(`
              INSERT INTO sync_operations (
                op_id, op_type, entity_uuid, entity_code, payload_json,
                device_id, status, tries, created_at, updated_at
              ) VALUES (?,?,?,?,?,?, 'pending', 0, datetime('now'), datetime('now'))
            `).run(
              opIdTarget,
              'STOCK_MOVE',
              product.uuid,
              product.code,
              JSON.stringify(payloadTarget),
              'AUTO_CHECK'
            );

            return { opIdCarton, opIdTarget, moveIdCarton, moveIdTarget };
          });

          const result = tx();
          actionCount++;

          // Afficher uniquement les actions effectuées
          const displayFactor = Math.abs(targetFactor);
          console.log(`  ✅ [AutoStock] ${product.code}: CARTON ${cartonStock}→${cartonStock-1}, ${target.unit_level} ${targetStock}→${targetStock + displayFactor}`);

        } catch (txErr) {
          console.error(`  ❌ ${product.code}: Erreur transaction - ${txErr.message}`);
        }

      } catch (err) {
        console.error(`  ❌ ${product.code}: Erreur - ${err.message}`);
      }
    }

    const checkDuration = Date.now() - checkStartTime;
    // Résumé compact
    if (actionCount > 0) {
      console.log(`✨ [AutoCheck] ${actionCount} action(s), ${skippedCount} skip en ${checkDuration}ms`);
    }
    // Pas de log si rien n'a été fait (silencieux)

  } catch (err) {
    console.error("❌ [AutoCheck] Erreur globale:", err.message);
  } finally {
    autoCheckRunning = false;
  }
}

/**
 * Démarrer la vérification automatique
 * À appeler depuis server.js après que req.app.locals.db soit initialisé
 */
export function startAutoCheck(db) {
  if (autoCheckInterval) {
    console.log("⚠️  [AutoCheck] Déjà en cours d'exécution");
    return;
  }

  // ✅ PRO: Démarrage silencieux

  let checkCount = 0;

  autoCheckInterval = setInterval(() => {
    checkCount++;
    try {
      runAutoCheck(db);
    } catch (err) {
      console.error(`[AutoCheck #${checkCount}] Erreur:`, err.message);
    }
  }, 2000); // 2000 ms = 2 secondes
}

/**
 * Arrêter la vérification automatique
 * À appeler lors de l'arrêt du serveur
 */
export function stopAutoCheck() {
  if (autoCheckInterval) {
    clearInterval(autoCheckInterval);
    autoCheckInterval = null;
  }
}

export default router;
