import { syncRepo } from '../../db/repositories/sync.repo.js';
import { sheetsClient } from './sheets.client.js';
import { productsRepo } from '../../db/repositories/products.repo.js';
import { salesRepo } from '../../db/repositories/sales.repo.js';
import { debtsRepo } from '../../db/repositories/debts.repo.js';
import { ratesRepo } from '../../db/repositories/rates.repo.js';
import { syncLogger } from '../../core/logger.js';

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS) || 10000; // 10 secondes par défaut

let syncInterval = null;
let isSyncing = false;
let isOnline = true; // État de connexion Internet

/**
 * Worker de synchronisation qui tourne en arrière-plan
 */
export class SyncWorker {
  /**
   * Démarre le worker avec import initial intelligent
   */
  async start() {
    if (syncInterval) {
      return; // Déjà démarré
    }

    syncLogger.info(`🚀 Démarrage du worker de synchronisation (intervalle: ${SYNC_INTERVAL_MS}ms)`);
    syncLogger.info(`📡 URL Google Apps Script: ${process.env.GOOGLE_SHEETS_WEBAPP_URL ? '✅ Configurée' : '❌ Non configurée'}`);

    // Vérifier si la base est vide (pas de produits)
    const isDatabaseEmpty = !productsRepo.hasProducts();
    
    if (isDatabaseEmpty) {
      syncLogger.info('📥 Base de données vide, import initial depuis Google Sheets...');
      // Import initial complet (utilise date très ancienne)
      await this.pullUpdates(true); // true = import initial
    } else {
      syncLogger.info('📊 Base de données contient des données, synchronisation incrémentale');
      // Première sync normale
      await this.sync();
    }

    // Détection automatique de connexion
    this.setupConnectionDetection();

    // Puis toutes les X secondes
    syncLogger.info(`⏰ Synchronisation automatique configurée: toutes les ${SYNC_INTERVAL_MS / 1000} secondes`);
    syncInterval = setInterval(() => {
      syncLogger.debug(`🔄 Déclenchement synchronisation automatique (intervalle ${SYNC_INTERVAL_MS / 1000}s)`);
      this.sync();
    }, SYNC_INTERVAL_MS);
  }

  /**
   * Configure la détection automatique de connexion Internet
   */
  setupConnectionDetection() {
    // Côté serveur Node.js, vérifier périodiquement la connexion
    setInterval(() => {
      this.checkConnection();
    }, 15000); // Vérifier toutes les 15 secondes
  }

  /**
   * Vérifie si une connexion Internet est disponible
   */
  async checkConnection() {
    const webAppUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    if (!webAppUrl) {
      return; // Pas d'URL configurée
    }

    try {
      const axios = (await import('axios')).default;
      
      // Essayer de pinger Google Sheets avec un timeout court
      const response = await axios.get(webAppUrl, {
        params: { entity: 'test' },
        timeout: 3000, // 3 secondes de timeout
        validateStatus: (status) => status < 500, // Accepter même les erreurs 4xx (signe de connexion)
      });
      
      // Si on arrive ici, la connexion est disponible
      if (!isOnline) {
        syncLogger.info('🌐 Connexion Internet détectée, reprise de la synchronisation');
        isOnline = true;
        // Relancer une sync immédiate
        this.sync();
      }
    } catch (error) {
      // Pas de connexion ou timeout
      if (isOnline && (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout'))) {
        syncLogger.debug('⚠️ Connexion Internet perdue, synchronisation en attente');
        isOnline = false;
      }
    }
  }

  /**
   * Arrête le worker
   */
  stop() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
      syncLogger.info('Worker de synchronisation arrêté');
    }
  }

  /**
   * Effectue une synchronisation complète
   */
  async sync() {
    if (isSyncing) {
      return; // Déjà en cours
    }

    isSyncing = true;

    try {
      // Push: envoyer les opérations en attente
      await this.pushPending();

      // Pull: récupérer les données depuis Sheets
      await this.pullUpdates();
    } catch (error) {
      syncLogger.error('Erreur lors de la synchronisation:', error);
    } finally {
      isSyncing = false;
    }
  }

  /**
   * Push les opérations en attente vers Google Sheets
   */
  async pushPending() {
    // Ne pas push si pas de connexion
    if (!isOnline) {
      return;
    }

    try {
      const pending = syncRepo.getPending(50); // Max 50 par batch

      if (pending.length === 0) {
        return;
      }

      syncLogger.info(`📤 Push de ${pending.length} opérations...`);

      for (const op of pending) {
        try {
          const result = await sheetsClient.push(
            op.entity,
            op.entity_id,
            op.op,
            JSON.parse(op.payload_json || JSON.stringify(op.payload))
          );

          if (result.success) {
            syncRepo.markAsSent(op.id);
          } else {
            syncRepo.markAsError(op.id, new Error(result.error));
            // Si erreur réseau, marquer comme hors ligne
            if (result.error && (result.error.includes('network') || result.error.includes('ECONNREFUSED'))) {
              isOnline = false;
            }
          }
        } catch (error) {
          syncRepo.markAsError(op.id, error);
          // Si erreur réseau, marquer comme hors ligne
          if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            isOnline = false;
          }
        }
      }
    } catch (error) {
      syncLogger.error('Erreur pushPending:', error);
    }
  }

  /**
   * Pull les mises à jour depuis Google Sheets
   * @param {boolean} isInitialImport - Si true, import complet (ignore les dates)
   */
  async pullUpdates(isInitialImport = false) {
    // Vérifier la connexion Internet
    if (!isOnline && !isInitialImport) {
      syncLogger.debug('Hors ligne, pull ignoré');
      return;
    }

    syncLogger.info(`🔄 Début pull depuis Google Sheets${isInitialImport ? ' (IMPORT INITIAL)' : ' (synchronisation incrémentale)'}`);

    try {
      const entities = ['products', 'sales', 'debts', 'rates', 'users'];
      let totalItems = 0;

      for (const entity of entities) {
        try {
          // Pour l'import initial, utiliser une date très ancienne (1970)
          const lastSync = isInitialImport ? new Date(0) : syncRepo.getLastPullDate(entity);
          syncLogger.info(`   📋 Traitement: ${entity}${lastSync ? ` (dernière sync: ${lastSync})` : ' (première sync)'}`);
          
          // Pull depuis Sheets
          const result = await sheetsClient.pull(entity, lastSync);
          
          // Appliquer les mises à jour localement
          if (result.success && result.data && result.data.length > 0) {
            syncLogger.info(`   ⚙️  Application de ${result.data.length} item(s) pour ${entity}...`);
            await this.applyUpdates(entity, result.data);
            syncRepo.setLastPullDate(entity, new Date().toISOString());
            totalItems += result.data.length;
            syncLogger.info(`   ✅ ${entity}: ${result.data.length} item(s) appliqué(s)${isInitialImport ? ' (import initial)' : ''}`);
          } else if (result.success && (!result.data || result.data.length === 0)) {
            syncLogger.info(`   ℹ️  ${entity}: Aucune donnée à importer${isInitialImport ? ' (import initial)' : ''}`);
          } else {
            syncLogger.warn(`   ⚠️  ${entity}: Échec du pull`);
          }
        } catch (error) {
          syncLogger.error(`   ❌ Erreur pull ${entity}:`, error.message || error);
          // En cas d'erreur, marquer comme hors ligne si c'est une erreur réseau
          if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.message.includes('network')) {
            this.isOnline = false;
            syncLogger.warn(`   🔌 Marqué comme hors ligne`);
          }
        }
      }
      
      syncLogger.info(`✅ Pull terminé: ${totalItems} item(s) au total${isInitialImport ? ' (import initial)' : ''}`);
    } catch (error) {
      syncLogger.error('❌ Erreur pullUpdates:', error);
    }
  }

  /**
   * Applique les mises à jour récupérées depuis Sheets
   */
  async applyUpdates(entity, data) {
    try {
      syncLogger.info(`⚙️  Application des mises à jour pour ${entity} (${data.length} item(s))...`);
      
      switch (entity) {
        case 'products':
        case 'product_units':
          await this.applyProductUpdates(data);
          break;
        case 'sales':
          await this.applySalesUpdates(data);
          break;
        case 'debts':
          await this.applyDebtsUpdates(data);
          break;
        case 'rates':
          await this.applyRatesUpdates(data);
          break;
        case 'users':
          await this.applyUsersUpdates(data);
          break;
        default:
          syncLogger.warn(`⚠️  Type d'entité non géré pour pull: ${entity}`);
      }
      
      syncLogger.info(`✅ Application des mises à jour pour ${entity} terminée`);
    } catch (error) {
      syncLogger.error(`❌ Erreur applyUpdates ${entity}:`, error.message || error);
      throw error;
    }
  }

  /**
   * Applique les mises à jour de produits
   */
  async applyProductUpdates(data) {
    if (!data || data.length === 0) {
      syncLogger.warn('⚠️  Aucune donnée produit à appliquer');
      return;
    }

    syncLogger.info(`📦 Application de ${data.length} produit(s)/unité(s) dans la base locale...`);

    // Grouper les produits par code
    const productsByCode = {};
    
    for (const item of data) {
      const code = item.code;
      if (!code) continue;
      
      // Si l'item a une propriété 'units', c'est un produit avec ses unités (format de getProductsSince pour 'products')
      if (item.units && Array.isArray(item.units)) {
        // Format: { code, name, uuid, units: [...] }
        if (!productsByCode[code]) {
          productsByCode[code] = {
            code: code,
            name: item.name || '',
            uuid: item.uuid,
            units: []
          };
        }
        
        // Ajouter toutes les unités du produit
        for (const unit of item.units) {
          productsByCode[code].units.push({
            uuid: unit.uuid,
            unit_level: unit.unit_level,
            unit_mark: unit.unit_mark || '',
            stock_initial: unit.stock_initial || unit.stock_current || 0,
            stock_current: unit.stock_current || unit.stock_initial || 0,
            purchase_price_usd: unit.purchase_price_usd || 0,
            sale_price_fc: unit.sale_price_fc || 0,
            sale_price_usd: unit.sale_price_usd || 0,
            auto_stock_factor: unit.auto_stock_factor || 1,
            qty_step: unit.qty_step || 1,
            last_update: unit.last_update || new Date().toISOString()
          });
        }
      } else if (item.unit_level) {
        // Format: unité individuelle (format de getProductsSince pour 'product_units')
        if (!productsByCode[code]) {
          productsByCode[code] = {
            code: code,
            name: item.name || '',
            uuid: item.uuid,
            units: []
          };
        }
        
        productsByCode[code].units.push({
          uuid: item.uuid,
          unit_level: item.unit_level,
          unit_mark: item.unit_mark || '',
          stock_initial: item.stock_initial || item.stock_current || 0,
          stock_current: item.stock_current || item.stock_initial || 0,
          purchase_price_usd: item.purchase_price_usd || 0,
          sale_price_fc: item.sale_price_fc || 0,
          sale_price_usd: item.sale_price_usd || 0,
          auto_stock_factor: item.auto_stock_factor || 1,
          qty_step: item.qty_step || 1,
          last_update: item.last_update || new Date().toISOString()
        });
      }
    }
    
    // Insérer ou mettre à jour chaque produit
    let successCount = 0;
    let errorCount = 0;
    
    for (const code in productsByCode) {
      try {
        const product = productsByCode[code];
        syncLogger.info(`   💾 Upsert produit "${code}" (${product.name || 'sans nom'}) avec ${product.units.length} unité(s)`);
        productsRepo.upsert({
          ...product,
          is_active: 1,
          _origin: 'SHEETS'
        });
        successCount++;
      } catch (error) {
        errorCount++;
        syncLogger.error(`   ❌ Erreur upsert produit ${code}:`, error.message || error);
      }
    }
    
    syncLogger.info(`✅ Produits traités: ${successCount} réussi(s), ${errorCount} erreur(s) sur ${Object.keys(productsByCode).length} produit(s)`);
  }

  /**
   * Applique les mises à jour de ventes
   */
  async applySalesUpdates(data) {
    syncLogger.info(`💰 Application de ${data.length} vente(s)/item(s) de vente...`);
    
    // Grouper par facture
    const salesByInvoice = {};
    
    for (const item of data) {
      const invoiceNumber = item.invoice_number;
      if (!invoiceNumber) continue;
      
      if (!salesByInvoice[invoiceNumber]) {
        salesByInvoice[invoiceNumber] = {
          invoice_number: invoiceNumber,
          sold_at: item.sold_at,
          client_name: item.client_name || '',
          seller_name: item.seller_name || '',
          items: []
        };
      }
      
      // Trouver le product_id depuis le code
      const product = productsRepo.findByCode(item.product_code);
      
      salesByInvoice[invoiceNumber].items.push({
        product_id: product?.id || null,
        product_code: item.product_code || '',
        product_name: item.product_name || product?.name || '',
        unit_level: item.unit_level || 'PIECE',
        unit_mark: item.unit_mark || '',
        qty: item.qty || 0,
        qty_label: item.qty_label || (item.qty ? item.qty.toString() : '0'),
        unit_price_fc: item.unit_price_fc || 0,
        subtotal_fc: item.subtotal_fc || (item.qty * item.unit_price_fc),
        unit_price_usd: item.unit_price_usd || 0,
        subtotal_usd: item.subtotal_usd || (item.qty * item.unit_price_usd)
      });
    }
    
    // Vérifier si la vente existe déjà (pour éviter les doublons)
    // Si elle existe et vient de Sheets, on ne l'écrase pas si elle est locale
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const invoiceNumber in salesByInvoice) {
      try {
        const saleData = salesByInvoice[invoiceNumber];
        // Calculer les totaux
        let totalFC = 0;
        let totalUSD = 0;
        for (const item of saleData.items) {
          totalFC += item.subtotal_fc;
          totalUSD += item.subtotal_usd;
        }
        
        // Vérifier si la vente existe
        const existing = salesRepo.findByInvoice(invoiceNumber);
        if (!existing || existing.origin === 'SHEETS') {
          // Créer la vente (sans décrémenter le stock car elle vient de Sheets)
          // TODO: Gérer le stock différemment pour les ventes Sheets
          syncLogger.info(`   💰 Création vente ${invoiceNumber} avec ${saleData.items.length} item(s) (Total: ${totalFC} FC)`);
          salesRepo.create({
            ...saleData,
            total_fc: totalFC,
            total_usd: totalUSD,
            payment_mode: 'cash',
            status: 'paid',
            origin: 'SHEETS',
            rate_fc_per_usd: 2800 // Par défaut, sera calculé si nécessaire
          });
          successCount++;
        } else {
          skippedCount++;
          syncLogger.debug(`   ⏭️  Vente ${invoiceNumber} déjà existante (locale), ignorée`);
        }
      } catch (error) {
        errorCount++;
        syncLogger.error(`   ❌ Erreur upsert vente ${invoiceNumber}:`, error.message || error);
      }
    }
    
    syncLogger.info(`✅ Ventes traitées: ${successCount} créée(s), ${skippedCount} ignorée(s), ${errorCount} erreur(s)`);
  }

  /**
   * Applique les mises à jour de dettes
   */
  async applyDebtsUpdates(data) {
    syncLogger.info(`💳 Application de ${data.length} dette(s)...`);
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const item of data) {
      try {
        if (!item.invoice_number) {
          syncLogger.warn(`   ⚠️  Dette sans numéro de facture ignorée`);
          skippedCount++;
          continue;
        }
        
        // Créer ou mettre à jour la dette
        syncLogger.info(`   💳 Upsert dette ${item.invoice_number} (Client: ${item.client_name || 'N/A'}, Total: ${item.total_fc || 0} FC)`);
        debtsRepo.upsert({
          uuid: item.uuid,
          invoice_number: item.invoice_number,
          client_name: item.client_name || '',
          client_phone: item.client_phone || null,
          product_description: item.product_description || null,
          total_fc: item.total_fc || 0,
          paid_fc: item.paid_fc || 0,
          remaining_fc: item.remaining_fc !== undefined ? item.remaining_fc : (item.total_fc || 0) - (item.paid_fc || 0),
          total_usd: item.total_usd || 0,
          debt_fc_in_usd: item.debt_fc_in_usd || null,
          note: item.note || null,
          status: item.status || 'open',
          created_at: item.created_at || new Date().toISOString()
        });
        successCount++;
      } catch (error) {
        errorCount++;
        syncLogger.error(`   ❌ Erreur upsert dette ${item.invoice_number || 'N/A'}:`, error.message || error);
      }
    }
    
    syncLogger.info(`✅ Dettes traitées: ${successCount} synchronisée(s), ${skippedCount} ignorée(s), ${errorCount} erreur(s)`);
  }

  /**
   * Applique les mises à jour de taux
   */
  async applyRatesUpdates(data) {
    syncLogger.info(`💱 Application de ${data.length} taux de change...`);
    
    // Prendre le taux le plus récent
    if (data.length > 0) {
      const latestRate = data[data.length - 1]; // Déjà trié par date
      try {
        syncLogger.info(`   💱 Mise à jour taux de change: ${latestRate.rate_fc_per_usd} FC/USD`);
        ratesRepo.updateCurrent(latestRate.rate_fc_per_usd, null);
        syncLogger.info(`✅ Taux de change mis à jour avec succès`);
      } catch (error) {
        syncLogger.error(`   ❌ Erreur mise à jour taux:`, error.message || error);
      }
    } else {
      syncLogger.info(`   ℹ️  Aucun taux de change à appliquer`);
    }
  }

  /**
   * Applique les mises à jour d'utilisateurs
   */
  async applyUsersUpdates(data) {
    syncLogger.info(`👥 Application de ${data.length} utilisateur(s)...`);
    
    // Note: usersRepo.upsert n'existe peut-être pas encore
    // Pour l'instant, on log juste
    for (const user of data) {
      syncLogger.info(`   👥 Utilisateur: ${user.name || user.nom || 'Inconnu'} (${user.numero || 'N/A'})`);
    }
    
    syncLogger.info(`✅ ${data.length} utilisateur(s) logué(s) (fonctionnalité à implémenter)`);
  }

  /**
   * Force une synchronisation immédiate
   */
  async syncNow() {
    await this.sync();
  }
}

export const syncWorker = new SyncWorker();

