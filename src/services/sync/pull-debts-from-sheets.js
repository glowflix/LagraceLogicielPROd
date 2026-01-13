import crypto from 'crypto';
import { getDb } from '../../db/sqlite.js';
import { logger } from '../../core/logger.js';
import { debtsRepo } from '../../db/repositories/debts.repo.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { sheetsClient } from './sheets.client.js';

function toNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;

  const s = String(v)
    .trim()
    .replace(/\s+/g, '')   // espaces
    .replace(',', '.');    // virgule -> point

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normStr(v) {
  return String(v ?? '').trim();
}

function getExchangeRateFcPerUsd() {
  const db = getDb();
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'exchange_rate_fc_per_usd'`).get();
    const rate = toNumber(row?.value);
    return rate > 0 ? rate : 2800; // fallback
  } catch (error) {
    logger.warn('Exchange rate not found, using default 2800');
    return 2800;
  }
}

function hashLineKey(line) {
  // clé stable pour enlever les doublons de Sheets
  const key = [
    line.client_name,
    line.invoice_number,
    line.product_id,
    line.date,
    String(line.total_raw),
    String(line.paid_raw),
    String(line.remaining_raw),
    line.description,
    line.currency,
  ].join('|');

  return crypto.createHash('sha1').update(key).digest('hex');
}

function computeStatus(remaining_fc, paid_fc, total_fc) {
  if (remaining_fc <= 0) return 'paid';
  if (paid_fc > 0 && remaining_fc < total_fc) return 'partial';
  return 'open';
}

/**
 * PULL dettes depuis Google Sheets vers SQLite
 * Gère:
 * - Conversion virgule -> point (nombres français)
 * - Conversion USD -> FC
 * - Déduplication des lignes doublées
 * - Agrégation par facture
 * - Upsert dans SQLite
 */
export async function pullDebtsFromSheets() {
  try {
    const rate = getExchangeRateFcPerUsd();
    logger.info(`📥 [PULL-DEBTS] Début - Rate=${rate} FC/USD`);

    // 1. Lire la feuille Dettes via sheetsClient.pull()
    // Utiliser une date très ancienne pour récupérer TOUTES les dettes (première sync)
    const sinceIso = new Date(0).toISOString();
    const result = await sheetsClient.pull('debts', sinceIso, {
      full: true,
      maxRetries: 3,
      timeout: 30000,
      limit: 500
    });
    
    if (!result.success || !result.data || result.data.length === 0) {
      logger.warn('⚠️ [PULL-DEBTS] Aucune ligne retournée de Sheets');
      return { read_rows: 0, unique_lines: 0, invoices: 0, upserted: 0 };
    }

    const rows = result.data;
    logger.info(`📥 [PULL-DEBTS] ${rows.length} ligne(s) lues de Sheets`);

    // 2. Normaliser et mapper les lignes - FILTRER LES ENTRÉES VIDES
    const mappedLines = rows
      .filter(r => r && Object.keys(r).length)
      .map(r => {
        const client_name = normStr(r.Client);
        const product_id = normStr(r.Produit);
        const invoice_number = normStr(r['numero de facture']);
        const date = normStr(r.date);

        const currency = normStr(r.Dollars).toUpperCase() === 'USD' ? 'USD' : 'FC';

        // Montants depuis Sheets (virgule -> point)
        const total_raw = toNumber(r['prix a payer'] ?? r.Argent);
        const paid_raw = toNumber(r['prix payer deja']);
        const remaining_raw = toNumber(r.reste);

        const description = normStr(
          r['objet\\Description'] ?? r['objet/Description'] ?? r['objet'] ?? ''
        );

        // Conversion: si USD -> FC via rate
        const total_fc = currency === 'USD' ? Math.round(total_raw * rate) : Math.round(total_raw);
        const paid_fc = currency === 'USD' ? Math.round(paid_raw * rate) : Math.round(paid_raw);
        const remaining_fc = currency === 'USD'
          ? Math.round((remaining_raw || (total_raw - paid_raw)) * rate)
          : Math.round(remaining_raw || (total_raw - paid_raw));

        const total_usd = currency === 'USD' ? total_raw : 0;

        return {
          client_name,
          product_id,
          invoice_number,
          date,
          currency,
          total_raw,
          paid_raw,
          remaining_raw,
          total_fc,
          paid_fc,
          remaining_fc,
          total_usd,
          description,
          _uuid: normStr(r._uuid),
          _updated_at: normStr(r._updated_at),
        };
      })
      // ✅ FILTRER LES ENTRÉES VIDES: client_name ET invoice_number ET total_fc > 0
      .filter(x => {
        const hasClient = x.client_name && x.client_name.trim().length > 0;
        const hasInvoice = x.invoice_number && x.invoice_number.trim().length > 0;
        const hasAmount = x.total_fc > 0 || x.total_usd > 0;
        return hasClient && hasInvoice && hasAmount;
      });

    logger.info(`📋 [PULL-DEBTS] ${mappedLines.length} ligne(s) mappée(s)`);

    // 3. Déduplication intelligente - PRIORITÉ: invoice_number + UUID
    // ✅ Stratégie: Utiliser invoice_number comme clé principale, UUID comme clé secondaire
    const uniq = new Map();
    const byInvoice = new Map(); // Pour gérer les doublons par facture
    
    for (const l of mappedLines) {
      // Clé principale: invoice_number (si disponible)
      const invoiceKey = l.invoice_number && l.invoice_number.trim() 
        ? `invoice:${l.invoice_number}` 
        : null;
      
      // Clé secondaire: UUID ou hash de la ligne
      const uuidKey = l._uuid && l._uuid.trim() 
        ? `uuid:${l._uuid}` 
        : `hash:${hashLineKey(l)}`;
      
      // ✅ PRIORITÉ 1: Si invoice_number existe, utiliser comme clé principale
      if (invoiceKey) {
        if (!byInvoice.has(invoiceKey)) {
          byInvoice.set(invoiceKey, l);
          uniq.set(uuidKey, l);
        } else {
          // Doublon par invoice_number - garder le plus récent (par _updated_at)
          const existing = byInvoice.get(invoiceKey);
          const existingDate = existing._updated_at || existing.date || '';
          const newDate = l._updated_at || l.date || '';
          
          if (newDate > existingDate) {
            // Remplacer par la version plus récente
            byInvoice.set(invoiceKey, l);
            uniq.set(uuidKey, l);
          }
          // Sinon, ignorer cette ligne (doublon plus ancien)
        }
      } else {
        // ✅ PRIORITÉ 2: Pas d'invoice_number, utiliser UUID/hash
        if (!uniq.has(uuidKey)) {
          uniq.set(uuidKey, l);
        }
      }
    }
    
    // Combiner les résultats (invoice_number prioritaire)
    const uniqueLines = [...new Set([
      ...byInvoice.values(),
      ...uniq.values()
    ])];

    logger.info(`🔄 [PULL-DEBTS] ${uniqueLines.length} ligne(s) unique(s) (doublons supprimés)`);

    // 4. Agrégation par facture (client + invoice = une dette)
    const byInvoiceAgg = new Map();
    for (const l of uniqueLines) {
      const invKey = `${l.client_name}__${l.invoice_number}`;
      
      if (!byInvoiceAgg.has(invKey)) {
        byInvoiceAgg.set(invKey, {
          invoice_number: l.invoice_number,
          client_name: l.client_name,
          product_description: '',
          total_fc: 0,
          paid_fc: 0,
          remaining_fc: 0,
          total_usd: 0,
          created_at: l.date || new Date().toISOString(),
          updated_at_src: l._updated_at || l.date || new Date().toISOString(),
        });
      }

      const agg = byInvoiceAgg.get(invKey);
      agg.total_fc += l.total_fc;
      agg.paid_fc += l.paid_fc;
      agg.remaining_fc += l.remaining_fc;
      agg.total_usd += l.total_usd;

      // Accumulate descriptions
      if (l.description) {
        const d = l.description.slice(0, 200);
        if (!agg.product_description.includes(d)) {
          agg.product_description = (agg.product_description ? agg.product_description + ' | ' : '') + d;
          agg.product_description = agg.product_description.slice(0, 500);
        }
      }

      if (l._updated_at && l._updated_at > agg.updated_at_src) {
        agg.updated_at_src = l._updated_at;
      }
    }

    // 4.5. Collecter les UUIDs de Sheets pour chaque facture (priorité au premier UUID non vide)
    const invoiceUuids = new Map();
    for (const l of uniqueLines) {
      const invKey = `${l.client_name}__${l.invoice_number}`;
      if (l._uuid && l._uuid.trim() && !invoiceUuids.has(invKey)) {
        invoiceUuids.set(invKey, l._uuid.trim());
      }
    }

    const invoices = [...byInvoiceAgg.values()].map(d => {
      const remaining_fc = d.remaining_fc || Math.max(0, d.total_fc - d.paid_fc);
      const status = computeStatus(remaining_fc, d.paid_fc, d.total_fc);

      const invKey = `${d.client_name}__${d.invoice_number}`;
      
      // ✅ PRIORITÉ: Utiliser l'UUID de Sheets s'il existe, sinon générer un UUID stable
      let uuid = invoiceUuids.get(invKey);
      if (!uuid || uuid.trim() === '') {
        // UUID stable par facture (même génération à chaque fois)
        uuid = crypto.createHash('sha1')
          .update(`${d.client_name}|${d.invoice_number}`)
          .digest('hex')
          .substring(0, 32);
      }

      return {
        uuid,
        invoice_number: d.invoice_number,
        client_name: d.client_name,
        product_description: d.product_description || null,
        total_fc: d.total_fc,
        paid_fc: d.paid_fc,
        remaining_fc,
        total_usd: d.total_usd,
        status,
        created_at: d.created_at,
      };
    });

    logger.info(`📊 [PULL-DEBTS] ${invoices.length} facture(s) agrégée(s)`);

    // 5. Upsert dans SQLite
    let upserted = 0;
    for (const debt of invoices) {
      try {
        debtsRepo.upsert(debt);
        upserted++;
      } catch (error) {
        logger.error(`❌ [PULL-DEBTS] Erreur upsert dette ${debt.invoice_number}:`, error);
      }
    }

    logger.info(`✅ [PULL-DEBTS] ${upserted}/${invoices.length} dettes upsertées dans SQLite`);

    // 6. ✅ PRO: Supprimer les dettes locales qui n'existent plus dans Sheets
    // Conditions:
    // - La dette existe en local mais n'est pas dans Sheets (avec données valides)
    // - La dette n'a pas d'opération pending dans l'outbox
    const deleted = cleanupDeletedDebts(invoices);
    
    if (deleted > 0) {
      logger.info(`🗑️ [PULL-DEBTS] ${deleted} dette(s) supprimée(s) (absentes de Sheets)`);
    }

    return {
      read_rows: rows.length,
      mapped_lines: mappedLines.length,
      unique_lines: uniqueLines.length,
      invoices: invoices.length,
      upserted,
      deleted,
    };
  } catch (error) {
    logger.error('❌ [PULL-DEBTS] Erreur:', error);
    throw error;
  }
}

/**
 * ✅ PRO: Supprime les dettes locales qui n'existent plus dans Sheets
 * Ne supprime PAS les dettes qui ont des opérations pending dans l'outbox
 * 
 * @param {Array} sheetsDebts - Dettes présentes dans Sheets (avec invoice_number)
 * @returns {number} - Nombre de dettes supprimées
 */
function cleanupDeletedDebts(sheetsDebts) {
  const db = getDb();
  let deleted = 0;
  
  try {
    // 1. Créer un Set des invoice_numbers présents dans Sheets
    const sheetsInvoiceNumbers = new Set(
      sheetsDebts
        .map(d => d.invoice_number)
        .filter(inv => inv && inv.trim().length > 0)
    );
    
    logger.debug(`🔍 [CLEANUP-DEBTS] ${sheetsInvoiceNumbers.size} factures dans Sheets`);
    
    // 2. Récupérer toutes les dettes locales
    const localDebts = db.prepare(`
      SELECT id, uuid, invoice_number, client_name, status 
      FROM debts 
      WHERE status != 'paid'
    `).all();
    
    logger.debug(`🔍 [CLEANUP-DEBTS] ${localDebts.length} dettes locales (non payées)`);
    
    // 3. Récupérer les dettes avec opérations pending dans l'outbox
    const pendingDebtOps = db.prepare(`
      SELECT DISTINCT entity_uuid, entity_code 
      FROM sync_outbox 
      WHERE entity_type IN ('DEBT', 'DEBT_PAYMENT', 'DEBT_PARTIAL') 
        AND status = 'pending'
    `).all();
    
    const pendingUuids = new Set(pendingDebtOps.map(op => op.entity_uuid).filter(Boolean));
    const pendingInvoices = new Set(pendingDebtOps.map(op => op.entity_code).filter(Boolean));
    
    logger.debug(`🔍 [CLEANUP-DEBTS] ${pendingUuids.size} UUIDs pending, ${pendingInvoices.size} factures pending`);
    
    // 4. Identifier les dettes à supprimer
    const toDelete = localDebts.filter(debt => {
      // Vérifier si la dette existe dans Sheets
      const existsInSheets = sheetsInvoiceNumbers.has(debt.invoice_number);
      
      // Vérifier si la dette a une opération pending
      const hasPendingOp = pendingUuids.has(debt.uuid) || pendingInvoices.has(debt.invoice_number);
      
      // Supprimer si: n'existe pas dans Sheets ET pas d'opération pending
      return !existsInSheets && !hasPendingOp;
    });
    
    logger.info(`🗑️ [CLEANUP-DEBTS] ${toDelete.length} dette(s) à supprimer`);
    
    // 5. Supprimer les dettes
    if (toDelete.length > 0) {
      const deleteStmt = db.prepare(`DELETE FROM debts WHERE id = ?`);
      const deletePaymentsStmt = db.prepare(`DELETE FROM debt_payments WHERE debt_id = ?`);
      
      const transaction = db.transaction(() => {
        for (const debt of toDelete) {
          try {
            // Supprimer les paiements associés d'abord
            deletePaymentsStmt.run(debt.id);
            // Supprimer la dette
            deleteStmt.run(debt.id);
            deleted++;
            logger.debug(`   🗑️ Supprimée: ${debt.invoice_number} (${debt.client_name})`);
          } catch (error) {
            logger.warn(`   ⚠️ Erreur suppression dette ${debt.invoice_number}: ${error.message}`);
          }
        }
      });
      
      transaction();
    }
    
    return deleted;
  } catch (error) {
    logger.error(`❌ [CLEANUP-DEBTS] Erreur: ${error.message}`);
    return 0;
  }
}
