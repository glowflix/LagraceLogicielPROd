import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';
import crypto from 'crypto';

/**
 * Repository pour la gestion des dettes
 */
export class DebtsRepository {
  /**
   * Crée une dette depuis une vente
   */
  createFromSale(saleId, invoiceNumber) {
    const db = getDb();
    try {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
      if (!sale) {
        throw new Error('Vente non trouvée');
      }

      const debtUuid = generateUUID();
      const debtStmt = db.prepare(`
        INSERT INTO debts (
          uuid, sale_id, invoice_number, client_name, client_phone, 
          total_fc, paid_fc, remaining_fc, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const totalFC = sale.total_fc;
      const paidFC = sale.paid_fc || 0;
      const remainingFC = totalFC - paidFC;

      const result = debtStmt.run(
        debtUuid,
        saleId,
        invoiceNumber,
        sale.client_name || 'Client',
        sale.client_phone || null,
        totalFC,
        paidFC,
        remainingFC,
        remainingFC > 0 ? 'open' : 'closed'
      );

      return this.findById(result.lastInsertRowid);
    } catch (error) {
      logger.error('Erreur createFromSale debt:', error);
      throw error;
    }
  }

  /**
   * Trouve une dette par ID
   */
  findById(id) {
    const db = getDb();
    try {
      const debt = db.prepare('SELECT * FROM debts WHERE id = ?').get(id);
      if (!debt) return null;

      const payments = db
        .prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY paid_at DESC')
        .all(id);

      return { ...debt, payments };
    } catch (error) {
      logger.error('Erreur findById debt:', error);
      throw error;
    }
  }

  /**
   * Trouve une dette par numéro de facture
   */
  findByInvoice(invoiceNumber) {
    const db = getDb();
    try {
      const debt = db.prepare('SELECT * FROM debts WHERE invoice_number = ?').get(invoiceNumber);
      if (!debt) return null;

      const payments = db
        .prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY paid_at DESC')
        .all(debt.id);

      return { ...debt, payments };
    } catch (error) {
      logger.error('Erreur findByInvoice debt:', error);
      throw error;
    }
  }

  /**
   * Liste toutes les dettes
   */
  findAll(filters = {}) {
    const db = getDb();
    try {
      let query = 'SELECT * FROM debts WHERE 1=1';
      const params = [];

      if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
      }
      
      if (filters.invoice_number) {
        query += ' AND invoice_number = ?';
        params.push(filters.invoice_number);
      }

      query += ' ORDER BY created_at DESC';

      logger.debug(`🔍 [DebtsRepo] Exécution requête: ${query}`);
      logger.debug(`   📋 Paramètres: ${JSON.stringify(params)}`);

      const debts = db.prepare(query).all(...params);
      
      logger.info(`📊 [DebtsRepo] findAll: ${debts.length} dette(s) trouvée(s) dans la base`);
      
      if (debts.length > 0) {
        logger.info(`   🔍 Première dette: ID=${debts[0].id}, Client="${debts[0].client_name}", Total=${debts[0].total_fc} FC, Status=${debts[0].status}`);
        logger.debug(`   📋 Toutes les dettes: ${JSON.stringify(debts).substring(0, 500)}...`);
      } else {
        // Vérifier si la table existe et contient des données
        const countResult = db.prepare('SELECT COUNT(*) as count FROM debts').get();
        logger.warn(`   ⚠️  Table debts contient ${countResult.count} ligne(s) au total`);
        
        if (countResult.count > 0) {
          // Il y a des données mais le filtre les a exclues
          const allDebts = db.prepare('SELECT * FROM debts LIMIT 5').all();
          logger.warn(`   📋 Exemples de dettes (sans filtre): ${JSON.stringify(allDebts).substring(0, 300)}...`);
        }
      }
      
      return debts;
    } catch (error) {
      logger.error('❌ [DebtsRepo] Erreur findAll debts:', error);
      logger.error(`   Message: ${error.message}`);
      logger.error(`   Stack: ${error.stack?.substring(0, 500)}`);
      throw error;
    }
  }

  /**
   * Génère un UUID stable pour une dette basé sur des champs déterministes
   * Utilisé quand Sheets envoie uuid: null
   */
  generateStableDebtUuid(debtData) {
    const key = [
      debtData.invoice_number || '',
      debtData.client_name || '',
      String(debtData.product_description || ''),
      debtData.created_at || new Date().toISOString()
    ].join('|');
    
    // Générer un hash SHA-1 et prendre les 32 premiers caractères (format UUID-like)
    const hash = crypto.createHash('sha1').update(key).digest('hex');
    return hash.substring(0, 32);
  }

  /**
   * Crée ou met à jour une dette
   * IMPORTANT: Prend toujours la PLUS RÉCENTE si plusieurs doublons existent
   * SYNC: Crée automatiquement une opération sync_operations pour push vers Sheets
   * ✅ ANTI-DOUBLON: Détecte les doublons par invoice_number ET UUID
   */
  upsert(debtData) {
    const db = getDb();
    try {
      // Vérifier si la dette existe (par invoice_number OU uuid)
      let existing = null;
      
      // ✅ 1. Chercher d'abord par UUID si fourni (priorité)
      if (debtData.uuid && debtData.uuid.trim()) {
        existing = db.prepare('SELECT * FROM debts WHERE uuid = ?').get(debtData.uuid);
        if (existing) {
          logger.info(`   🔍 [UPSERT] Dette trouvée par UUID: id=${existing.id}, invoice=${existing.invoice_number}`);
        }
      }
      
      // ✅ 2. Si pas trouvé par UUID, chercher par invoice_number (CRITIQUE pour éviter doublons)
      if (!existing && debtData.invoice_number && debtData.invoice_number.trim()) {
        // Prendre la plus récente (order by updated_at DESC, id DESC)
        const candidates = db.prepare(`
          SELECT * FROM debts
          WHERE invoice_number = ?
          ORDER BY updated_at DESC, id DESC
        `).all(debtData.invoice_number);
        
        if (candidates.length > 0) {
          existing = candidates[0];
          logger.info(`   🔍 [UPSERT] Dette trouvée par invoice_number: id=${existing.id}, uuid=${existing.uuid || 'N/A'}`);
          
          // ⚠️ ALERTE: Si plusieurs dettes avec le même invoice_number, supprimer les doublons
          if (candidates.length > 1) {
            logger.warn(`   ⚠️ [UPSERT] ${candidates.length} dettes trouvées avec invoice_number="${debtData.invoice_number}" - Suppression des doublons...`);
            // Supprimer les doublons (garder seulement la plus récente)
            for (let i = 1; i < candidates.length; i++) {
              db.prepare('DELETE FROM debts WHERE id = ?').run(candidates[i].id);
              logger.info(`      🗑️  Doublon supprimé: id=${candidates[i].id}`);
            }
          }
        }
      }
      
      // ✅ 3. Gérer les UUID null : générer un UUID stable basé sur les données
      let debtUuid = existing?.uuid || debtData.uuid;
      if (!debtUuid || debtUuid.trim() === '') {
        debtUuid = this.generateStableDebtUuid(debtData);
        logger.info(`   🔑 [UUID] UUID stable généré pour dette ${debtData.invoice_number || 'N/A'}: ${debtUuid.substring(0, 8)}...`);
      }
      
      // ✅ 4. Vérifier aussi si cet UUID existe déjà (même si pas trouvé par invoice)
      if (!existing && debtUuid && debtUuid.trim()) {
        const existingByUuid = db.prepare('SELECT * FROM debts WHERE uuid = ?').get(debtUuid);
        if (existingByUuid) {
          existing = existingByUuid;
          logger.info(`   🔄 [UUID] Dette existante trouvée par UUID généré: id=${existing.id}`);
        }
      }
      
      if (existing) {
        // Mettre à jour (préserver les valeurs existantes si nouvelles valeurs vides/null)
        logger.info(`💾 [SQL] UPDATE debts WHERE id=${existing.id}, invoice=${debtData.invoice_number || 'N/A'}`);
        logger.info(`   📋 Données: client="${debtData.client_name || existing.client_name}", total=${debtData.total_fc !== undefined ? debtData.total_fc : existing.total_fc} FC, reste=${debtData.remaining_fc !== undefined ? debtData.remaining_fc : existing.remaining_fc} FC`);
        
        // ✅ Préserver product_description si nouvelle valeur est vide/null
        const finalProductDesc = (debtData.product_description && debtData.product_description.trim()) 
          ? debtData.product_description 
          : (existing.product_description || null);
        
        const updateResult = db.prepare(`
          UPDATE debts SET
            uuid = COALESCE(?, uuid),
            client_name = COALESCE(NULLIF(?, ''), client_name),
            product_description = COALESCE(?, product_description),
            total_fc = COALESCE(?, total_fc),
            paid_fc = COALESCE(?, paid_fc),
            remaining_fc = COALESCE(?, remaining_fc),
            total_usd = COALESCE(?, total_usd),
            debt_fc_in_usd = COALESCE(?, debt_fc_in_usd),
            note = COALESCE(?, note),
            status = COALESCE(?, status),
            created_at = COALESCE(?, created_at),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          debtUuid,
          debtData.client_name || existing.client_name || '',
          finalProductDesc,
          debtData.total_fc !== undefined ? debtData.total_fc : null,
          debtData.paid_fc !== undefined ? debtData.paid_fc : null,
          debtData.remaining_fc !== undefined ? debtData.remaining_fc : null,
          debtData.total_usd !== undefined ? debtData.total_usd : null,
          debtData.debt_fc_in_usd || null,
          debtData.note || null,
          debtData.status || existing.status || 'open',
          debtData.created_at || existing.created_at,
          existing.id
        );
        
        logger.info(`   ✅ [SQL] UPDATE réussie: ${updateResult.changes} ligne(s) modifiée(s)`);
        const updated = this.findById(existing.id);
        logger.info(`   📊 [SQL] Dette mise à jour: id=${updated.id}, invoice=${updated.invoice_number}, status=${updated.status}, product_desc="${updated.product_description || 'N/A'}"`);
        
        // 📤 Créer opération DEBT pour le PUSH vers Sheets
        this.createSyncOperation(updated, 'upsert');
        
        return updated;
      } else {
        // Créer
        logger.info(`💾 [SQL] INSERT INTO debts (nouvelle dette)`);
        logger.info(`   📋 Données: invoice="${debtData.invoice_number || 'N/A'}", client="${debtData.client_name || ''}", total=${debtData.total_fc || 0} FC, reste=${debtData.remaining_fc !== undefined ? debtData.remaining_fc : (debtData.total_fc || 0) - (debtData.paid_fc || 0)} FC`);
        
        const result = db.prepare(`
          INSERT INTO debts (
            uuid, invoice_number, client_name, client_phone, product_description,
            total_fc, paid_fc, remaining_fc, total_usd, debt_fc_in_usd,
            note, status, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          debtUuid,
          debtData.invoice_number || null,
          debtData.client_name || '',
          debtData.client_phone || null,
          debtData.product_description || null,
          debtData.total_fc || 0,
          debtData.paid_fc || 0,
          debtData.remaining_fc !== undefined ? debtData.remaining_fc : (debtData.total_fc || 0) - (debtData.paid_fc || 0),
          debtData.total_usd || 0,
          debtData.debt_fc_in_usd || null,
          debtData.note || null,
          debtData.status || 'open',
          debtData.created_at || new Date().toISOString()
        );
        
        logger.info(`   ✅ [SQL] INSERT réussie: id=${result.lastInsertRowid}, invoice=${debtData.invoice_number || 'N/A'}`);
        const created = this.findById(result.lastInsertRowid);
        logger.info(`   📊 [SQL] Dette créée et disponible: id=${created.id}, invoice=${created.invoice_number}, status=${created.status}`);
        
        // 📤 Créer opération DEBT pour le PUSH vers Sheets
        this.createSyncOperation(created, 'upsert');
        
        return created;
      }
    } catch (error) {
      logger.error('Erreur upsert debt:', error);
      throw error;
    }
  }

  /**
   * Crée une opération sync_operations pour la dette
   * Cette opération sera pushée vers Google Sheets via sync.worker
   * ✅ ANTI-DOUBLON: Vérifie qu'aucune opération pending n'existe déjà pour cette dette
   */
  createSyncOperation(debt, opType = 'upsert') {
    const db = getDb();
    try {
      // ✅ ANTI-DOUBLON: Vérifier si une opération pending existe déjà pour cette dette
      const existingPending = db.prepare(`
        SELECT id FROM sync_operations 
        WHERE entity_uuid = ? AND op_type = 'DEBT' AND status = 'pending'
        LIMIT 1
      `).get(debt.uuid);
      
      if (existingPending) {
        logger.debug(`   ⏭️ [SYNC] Opération DEBT déjà pending pour uuid=${debt.uuid?.substring(0, 8)}...`);
        return; // Ne pas créer de doublon
      }
      
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
        INSERT INTO sync_operations (
          op_id, op_type, entity_uuid, entity_code, payload_json, status
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        op_id,
        'DEBT',
        debt.uuid,
        debt.invoice_number,
        JSON.stringify(payload),
        'pending'
      );
      
      logger.debug(`   📤 [SYNC] Opération DEBT créée: op_id=${op_id.substring(0, 8)}..., invoice=${debt.invoice_number}`);
    } catch (error) {
      // Ne pas bloquer si la création de sync_op échoue
      logger.warn(`   ⚠️ [SYNC] Erreur création sync_operations: ${error.message}`);
    }
  }

  /**
   * Ajoute un paiement à une dette
   * ✅ FIX: Vérifier si la dette existe avant de la modifier
   */
  addPayment(debtId, paymentData) {
    const db = getDb();
    const transaction = db.transaction(() => {
      try {
        // ✅ FIX: Vérifier d'abord si la dette existe
        const debt = this.findById(debtId);
        
        if (!debt) {
          // ✅ Essayer de trouver par invoice_number si fourni
          if (paymentData.invoice_number) {
            const debtByInvoice = this.findByInvoice(paymentData.invoice_number);
            if (debtByInvoice) {
              logger.info(`💳 [addPayment] Dette trouvée par invoice_number: ${paymentData.invoice_number}`);
              return this.addPayment(debtByInvoice.id, paymentData);
            }
          }
          
          throw new Error(`Dette non trouvée avec ID: ${debtId}. La dette n'existe peut-être pas encore localement (synchronisation en cours).`);
        }
        
        logger.info(`💳 [addPayment] Dette trouvée: ID=${debt.id}, invoice=${debt.invoice_number}, paid_fc=${debt.paid_fc}, total_fc=${debt.total_fc}`);
        
        // Ajouter le paiement
        const paymentStmt = db.prepare(`
          INSERT INTO debt_payments (debt_id, amount_fc, payment_mode, paid_by)
          VALUES (?, ?, ?, ?)
        `);

        paymentStmt.run(
          debtId,
          paymentData.amount_fc,
          paymentData.payment_mode || 'cash',
          paymentData.paid_by || null
        );

        // Mettre à jour la dette
        const newPaidFC = (debt.paid_fc || 0) + paymentData.amount_fc;
        const newRemainingFC = Math.max(0, debt.total_fc - newPaidFC);
        const newStatus = newRemainingFC <= 0 ? 'closed' : newPaidFC > 0 ? 'partial' : 'open';

        db.prepare(`
          UPDATE debts
          SET paid_fc = ?, remaining_fc = ?, status = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(newPaidFC, newRemainingFC, newStatus, debtId);

        logger.info(`   ✅ [addPayment] Paiement enregistré: +${paymentData.amount_fc} FC, nouveau solde: paid=${newPaidFC}, reste=${newRemainingFC}, status=${newStatus}`);

        return this.findById(debtId);
      } catch (error) {
        logger.error('❌ [addPayment] Erreur:', error);
        throw error;
      }
    });

    return transaction();
  }

  /**
   * Nettoie les doublons dans la table debts
   * Garde la dette la plus récente pour chaque invoice_number
   * @returns {number} Nombre de doublons supprimés
   */
  cleanupDuplicates() {
    const db = getDb();
    try {
      logger.info('🧹 [CLEANUP] Début nettoyage des doublons de dettes...');
      
      // Trouver tous les invoice_number qui ont plusieurs dettes
      const duplicates = db.prepare(`
        SELECT invoice_number, COUNT(*) as count
        FROM debts
        WHERE invoice_number IS NOT NULL AND invoice_number != ''
        GROUP BY invoice_number
        HAVING COUNT(*) > 1
      `).all();
      
      logger.info(`   🔍 [CLEANUP] ${duplicates.length} facture(s) avec doublons trouvée(s)`);
      
      let totalDeleted = 0;
      
      for (const dup of duplicates) {
        // Récupérer toutes les dettes pour cette facture
        const debts = db.prepare(`
          SELECT * FROM debts
          WHERE invoice_number = ?
          ORDER BY updated_at DESC, id DESC
        `).all(dup.invoice_number);
        
        // Garder la première (la plus récente), supprimer les autres
        const toKeep = debts[0];
        const toDelete = debts.slice(1);
        
        logger.info(`   📋 [CLEANUP] Facture "${dup.invoice_number}": ${debts.length} dette(s), garde id=${toKeep.id}, supprime ${toDelete.length}`);
        
        for (const debt of toDelete) {
          db.prepare('DELETE FROM debts WHERE id = ?').run(debt.id);
          totalDeleted++;
          logger.info(`      🗑️  Doublon supprimé: id=${debt.id}, uuid=${debt.uuid || 'N/A'}`);
        }
      }
      
      logger.info(`✅ [CLEANUP] Nettoyage terminé: ${totalDeleted} doublon(s) supprimé(s)`);
      return totalDeleted;
    } catch (error) {
      logger.error('❌ [CLEANUP] Erreur nettoyage doublons:', error);
      throw error;
    }
  }
}

export const debtsRepo = new DebtsRepository();

