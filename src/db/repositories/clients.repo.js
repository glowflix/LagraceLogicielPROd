import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import { generateUUID } from '../../core/crypto.js';

/**
 * Repository pour la gestion des clients
 * Les clients peuvent être des utilisateurs existants ou créés à la volée
 */
export class ClientsRepository {
  /**
   * Génère un code client unique
   * Format: CLI-YYYYMMDD-XXX (ex: CLI-20260105-001)
   */
  generateClientCode() {
    const db = getDb();
    const today = new Date().toISOString().substring(0, 10).replace(/-/g, '');
    
    // Trouver le dernier code du jour
    const lastCode = db.prepare(`
      SELECT client_code FROM clients 
      WHERE client_code LIKE ? 
      ORDER BY client_code DESC 
      LIMIT 1
    `).get(`CLI-${today}-%`);
    
    let sequence = 1;
    if (lastCode && lastCode.client_code) {
      const match = lastCode.client_code.match(/-(\d{3})$/);
      if (match) {
        sequence = parseInt(match[1], 10) + 1;
      }
    }
    
    return `CLI-${today}-${String(sequence).padStart(3, '0')}`;
  }
  
  /**
   * Crée un nouveau client
   * @param {Object} clientData - Données du client
   * @returns {Object} - Client créé
   */
  create(clientData) {
    const db = getDb();
    
    try {
      const clientUuid = clientData.uuid || generateUUID();
      const clientCode = clientData.client_code || this.generateClientCode();
      
      logger.info(`👤 [Clients] Création client:`);
      logger.info(`   Nom: ${clientData.name}`);
      logger.info(`   Téléphone: ${clientData.phone || '(non fourni)'}`);
      logger.info(`   Code: ${clientCode}`);
      
      const result = db.prepare(`
        INSERT INTO clients (
          uuid, client_code, name, phone, email, address, note,
          is_active, device_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        clientUuid,
        clientCode,
        clientData.name,
        clientData.phone || null,
        clientData.email || null,
        clientData.address || null,
        clientData.note || null,
        clientData.is_active !== undefined ? clientData.is_active : 1,
        clientData.device_id || null
      );
      
      logger.info(`   ✅ Client créé: ID ${result.lastInsertRowid}`);
      
      // Créer opération sync
      this.createSyncOperation(clientUuid, {
        uuid: clientUuid,
        client_code: clientCode,
        name: clientData.name,
        phone: clientData.phone || null,
        email: clientData.email || null,
        address: clientData.address || null,
        is_active: 1
      });
      
      return this.findById(result.lastInsertRowid);
    } catch (error) {
      logger.error('❌ [Clients] Erreur création:', error);
      throw error;
    }
  }
  
  /**
   * Trouve ou crée un client par nom
   * Si le nom existe déjà, retourne le client existant
   * Sinon, crée un nouveau client
   * @param {string} name - Nom du client
   * @param {Object} additionalData - Données supplémentaires pour la création
   * @returns {Object} - Client trouvé ou créé
   */
  findOrCreate(name, additionalData = {}) {
    const db = getDb();
    
    try {
      // Normaliser le nom (trim, lowercase pour comparaison)
      const normalizedName = name.trim();
      
      // Chercher un client existant (comparaison insensible à la casse)
      let existing = db.prepare(`
        SELECT * FROM clients 
        WHERE LOWER(TRIM(name)) = LOWER(?) AND is_active = 1
        LIMIT 1
      `).get(normalizedName);
      
      // Si pas trouvé dans clients, chercher dans users (compatibilité)
      if (!existing) {
        const user = db.prepare(`
          SELECT id, uuid, username as name, phone 
          FROM users 
          WHERE LOWER(TRIM(username)) = LOWER(?) AND is_active = 1
          LIMIT 1
        `).get(normalizedName);
        
        if (user) {
          // Créer un client à partir de l'utilisateur
          logger.info(`   🔄 [Clients] Utilisateur trouvé, création client depuis user ID ${user.id}`);
          return this.create({
            name: user.name,
            phone: user.phone,
            user_id: user.id,
            ...additionalData
          });
        }
      }
      
      if (existing) {
        logger.info(`   ✅ [Clients] Client existant trouvé: ${existing.name} (ID ${existing.id})`);
        return existing;
      }
      
      // Créer un nouveau client
      logger.info(`   🆕 [Clients] Nouveau client, création...`);
      return this.create({
        name: normalizedName,
        ...additionalData
      });
    } catch (error) {
      logger.error('❌ [Clients] Erreur findOrCreate:', error);
      throw error;
    }
  }
  
  /**
   * Trouve un client par ID
   */
  findById(id) {
    const db = getDb();
    try {
      return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    } catch (error) {
      logger.error('Erreur findById client:', error);
      throw error;
    }
  }
  
  /**
   * Trouve un client par UUID
   */
  findByUuid(uuid) {
    const db = getDb();
    try {
      return db.prepare('SELECT * FROM clients WHERE uuid = ?').get(uuid);
    } catch (error) {
      logger.error('Erreur findByUuid client:', error);
      throw error;
    }
  }
  
  /**
   * Trouve un client par code
   */
  findByCode(code) {
    const db = getDb();
    try {
      return db.prepare('SELECT * FROM clients WHERE client_code = ?').get(code);
    } catch (error) {
      logger.error('Erreur findByCode client:', error);
      throw error;
    }
  }
  
  /**
   * Recherche clients par nom (autocomplete)
   * @param {string} query - Terme de recherche
   * @param {number} limit - Nombre max de résultats
   * @returns {Array} - Clients correspondants
   */
  search(query, limit = 10) {
    const db = getDb();
    try {
      const searchTerm = `%${query.trim()}%`;
      
      // Chercher dans clients
      const clients = db.prepare(`
        SELECT id, uuid, client_code, name, phone, 'client' as source
        FROM clients 
        WHERE (name LIKE ? OR phone LIKE ? OR client_code LIKE ?) AND is_active = 1
        ORDER BY name ASC
        LIMIT ?
      `).all(searchTerm, searchTerm, searchTerm, limit);
      
      // Chercher aussi dans users (compatibilité)
      const remainingSlots = limit - clients.length;
      if (remainingSlots > 0) {
        const users = db.prepare(`
          SELECT id, uuid, username as name, phone, 'user' as source
          FROM users 
          WHERE (username LIKE ? OR phone LIKE ?) AND is_active = 1
          AND id NOT IN (SELECT user_id FROM clients WHERE user_id IS NOT NULL)
          ORDER BY username ASC
          LIMIT ?
        `).all(searchTerm, searchTerm, remainingSlots);
        
        clients.push(...users);
      }
      
      return clients;
    } catch (error) {
      logger.error('Erreur search clients:', error);
      return [];
    }
  }
  
  /**
   * Liste tous les clients actifs
   */
  findAll(filters = {}) {
    const db = getDb();
    try {
      let query = 'SELECT * FROM clients WHERE is_active = 1';
      const params = [];
      
      if (filters.has_debt) {
        query = `
          SELECT c.*, 
            (SELECT COUNT(*) FROM debts d WHERE d.client_uuid = c.uuid AND d.status != 'paid') as open_debts,
            (SELECT COALESCE(SUM(remaining_usd), 0) FROM debts d WHERE d.client_uuid = c.uuid AND d.status != 'paid') as total_debt_usd
          FROM clients c
          WHERE c.is_active = 1
          HAVING open_debts > 0
        `;
      }
      
      query += ' ORDER BY name ASC';
      
      return db.prepare(query).all(...params);
    } catch (error) {
      logger.error('Erreur findAll clients:', error);
      return [];
    }
  }
  
  /**
   * Met à jour un client
   */
  update(id, clientData) {
    const db = getDb();
    try {
      db.prepare(`
        UPDATE clients SET
          name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          address = COALESCE(?, address),
          note = COALESCE(?, note),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        clientData.name || null,
        clientData.phone || null,
        clientData.email || null,
        clientData.address || null,
        clientData.note || null,
        id
      );
      
      return this.findById(id);
    } catch (error) {
      logger.error('Erreur update client:', error);
      throw error;
    }
  }
  
  /**
   * Récupère les statistiques d'un client
   */
  getStats(clientId) {
    const db = getDb();
    try {
      const client = this.findById(clientId);
      if (!client) return null;
      
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total_debts,
          COALESCE(SUM(total_usd), 0) as total_amount_usd,
          COALESCE(SUM(paid_usd), 0) as total_paid_usd,
          COALESCE(SUM(remaining_usd), 0) as total_remaining_usd,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_debts,
          SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial_debts,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_debts
        FROM debts
        WHERE client_uuid = ?
      `).get(client.uuid);
      
      return {
        client,
        ...stats
      };
    } catch (error) {
      logger.error('Erreur getStats client:', error);
      return null;
    }
  }
  
  /**
   * Crée une opération sync pour le client
   */
  createSyncOperation(uuid, payload) {
    const db = getDb();
    try {
      const opId = generateUUID();
      
      db.prepare(`
        INSERT OR IGNORE INTO sync_operations (
          op_id, op_type, entity_uuid, entity_code, payload_json, status
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        opId,
        'CLIENT',
        uuid,
        payload.client_code,
        JSON.stringify(payload),
        'pending'
      );
      
      logger.debug(`   📤 [SYNC] Opération CLIENT créée: op_id=${opId.substring(0, 8)}...`);
    } catch (error) {
      logger.warn(`   ⚠️ [SYNC] Erreur création sync client: ${error.message}`);
    }
  }
}

export const clientsRepo = new ClientsRepository();
