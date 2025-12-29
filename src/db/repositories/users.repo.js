import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import bcrypt from 'bcrypt';
import { generateUUID } from '../../core/crypto.js';

/**
 * Repository pour la gestion des utilisateurs
 */
export class UsersRepository {
  /**
   * Trouve un utilisateur par nom d'utilisateur
   */
  findByUsername(username) {
    const db = getDb();
    try {
      return db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
    } catch (error) {
      logger.error('Erreur findByUsername:', error);
      throw error;
    }
  }

  /**
   * Trouve un utilisateur par numéro de téléphone (colonne Numero dans Sheets)
   */
  findByPhone(phone) {
    const db = getDb();
    try {
      if (!phone || phone.trim() === '') return null;
      // Normaliser le numéro (supprimer espaces, garder seulement chiffres)
      const normalizedPhone = phone.trim().replace(/\s+/g, '');
      return db.prepare('SELECT * FROM users WHERE phone = ? AND is_active = 1').get(normalizedPhone);
    } catch (error) {
      logger.error('Erreur findByPhone:', error);
      throw error;
    }
  }

  /**
   * Trouve un utilisateur par username ou phone (pour login flexible)
   * IMPORTANT: Ne filtre PAS par is_active ici, car verifyPassword le fait après
   */
  findByUsernameOrPhone(identifier) {
    const db = getDb();
    try {
      if (!identifier || identifier.trim() === '') return null;
      const normalized = identifier.trim();
      
      // Essayer d'abord par username (sans filtre is_active pour voir tous les utilisateurs)
      let user = db.prepare('SELECT * FROM users WHERE username = ?').get(normalized);
      if (user) {
        logger.debug(`🔍 [findByUsernameOrPhone] Trouvé par username: ${user.username}`);
        return user;
      }
      
      // Sinon essayer par phone (normaliser en supprimant les espaces, tirets, etc.)
      const normalizedPhone = normalized.replace(/[\s\-\(\)]/g, '');
      
      // Essayer d'abord avec le numéro exact
      user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalizedPhone);
      if (user) {
        logger.debug(`🔍 [findByUsernameOrPhone] Trouvé par phone exact: ${user.phone}`);
        return user;
      }
      
      // Si pas trouvé, essayer avec tous les utilisateurs et comparer en normalisant
      // (pour gérer les cas où le numéro pourrait être stocké avec des espaces)
      const allUsers = db.prepare('SELECT * FROM users').all();
      for (const u of allUsers) {
        if (u.phone) {
          const userPhoneNormalized = String(u.phone).replace(/[\s\-\(\)]/g, '');
          if (userPhoneNormalized === normalizedPhone) {
            logger.debug(`🔍 [findByUsernameOrPhone] Trouvé par phone normalisé: ${u.phone} (recherché: ${normalizedPhone})`);
            return u;
          }
        }
      }
      
      // Log pour debug : afficher tous les numéros disponibles
      logger.warn(`⚠️ [findByUsernameOrPhone] Aucun utilisateur trouvé pour: ${normalized.substring(0, 3)}***`);
      logger.debug(`📋 [findByUsernameOrPhone] Numéros disponibles dans la base: ${allUsers.map(u => u.phone || 'N/A').join(', ')}`);
      
      return null;
    } catch (error) {
      logger.error('❌ [findByUsernameOrPhone] Erreur:', error);
      throw error;
    }
  }

  /**
   * Trouve un utilisateur par UUID
   */
  findByUuid(uuid) {
    const db = getDb();
    try {
      if (!uuid || uuid.trim() === '') return null;
      const user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(uuid.trim());
      if (!user) return null;
      const { password_hash, ...userWithoutHash } = user;
      return userWithoutHash;
    } catch (error) {
      logger.error('Erreur findByUuid:', error);
      throw error;
    }
  }

  /**
   * Normalise un username pour comparaison
   */
  normalizeUsername(username) {
    return String(username || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /**
   * Trouve un utilisateur par username normalisé (pour matching sans uuid)
   */
  findByUsernameNormalized(username) {
    const db = getDb();
    try {
      const normalized = this.normalizeUsername(username);
      const allUsers = db.prepare('SELECT * FROM users').all();
      for (const user of allUsers) {
        if (this.normalizeUsername(user.username) === normalized) {
          const { password_hash, ...userWithoutHash } = user;
          return userWithoutHash;
        }
      }
      return null;
    } catch (error) {
      logger.error('Erreur findByUsernameNormalized:', error);
      throw error;
    }
  }

  /**
   * Met à jour l'UUID d'un utilisateur
   */
  setUuid(userId, uuid) {
    const db = getDb();
    try {
      db.prepare('UPDATE users SET uuid = ? WHERE id = ?').run(uuid, userId);
      logger.info(`💾 [UsersRepo] UUID mis à jour pour user ID=${userId}: ${uuid}`);
    } catch (error) {
      logger.error('Erreur setUuid:', error);
      throw error;
    }
  }

  /**
   * Vérifie le mot de passe
   * Accepte soit username soit phone (numéro) comme identifiant
   */
  async verifyPassword(identifier, password) {
    try {
      if (!identifier || !password) {
        logger.warn(`⚠️ [verifyPassword] Identifiant ou mot de passe manquant`);
        return null;
      }

      // Chercher par username ou phone
      const user = this.findByUsernameOrPhone(identifier);
      
      if (!user) {
        logger.warn(`⚠️ [verifyPassword] Aucun utilisateur trouvé pour: ${identifier.substring(0, 3)}***`);
        // Log tous les utilisateurs disponibles pour debug (seulement en dev)
        if (process.env.NODE_ENV === 'development') {
          const allUsers = this.findAll();
          logger.debug(`📋 [verifyPassword] Utilisateurs disponibles: ${allUsers.map(u => `${u.username} (phone: ${u.phone || 'N/A'})`).join(', ')}`);
        }
        return null;
      }

      logger.info(`✅ [verifyPassword] Utilisateur trouvé: ${user.username} (ID: ${user.id}, Phone: ${user.phone || 'N/A'})`);

      // Vérifier que l'utilisateur est actif
      if (!user.is_active || user.is_active === 0) {
        logger.warn(`⚠️ [verifyPassword] Tentative de connexion avec compte inactif: ${identifier}`);
        return null;
      }

      // CRITIQUE: Si l'utilisateur n'a pas de password_hash, créer un hash avec le mot de passe par défaut
      if (!user.password_hash || user.password_hash.trim() === '') {
        logger.warn(`⚠️ [verifyPassword] Utilisateur ${user.username} n'a pas de password_hash, création avec mot de passe par défaut`);
        const defaultPassword = 'changeme123';
        const defaultHash = await bcrypt.hash(defaultPassword, 10);
        
        // Mettre à jour le password_hash dans la base
        const db = getDb();
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(defaultHash, user.id);
        
        // Vérifier le mot de passe fourni avec le hash par défaut
        const isValid = await bcrypt.compare(password, defaultHash);
        if (!isValid) {
          logger.warn(`⚠️ [verifyPassword] Mot de passe incorrect pour: ${identifier} (mot de passe par défaut attendu: changeme123)`);
          return null;
        }
        
        logger.info(`✅ [verifyPassword] Mot de passe par défaut créé et validé pour: ${user.username}`);
      } else {
        // Vérifier le mot de passe normalement
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
          logger.warn(`⚠️ [verifyPassword] Mot de passe incorrect pour: ${identifier}`);
          return null;
        }
      }

      logger.info(`✅ [verifyPassword] Connexion réussie: ${user.username}`);

      // Retourner l'utilisateur sans le hash
      const { password_hash, ...userWithoutHash } = user;
      return userWithoutHash;
    } catch (error) {
      logger.error('❌ [verifyPassword] Erreur:', error);
      throw error;
    }
  }

  /**
   * Crée ou met à jour un device pour un utilisateur
   */
  upsertDevice(userId, deviceData) {
    const db = getDb();
    try {
      // Si device_brand ou profile_url sont fournis, créer/mettre à jour un device
      if (deviceData.device_brand || deviceData.profile_url || deviceData.expo_push_token) {
        // Chercher un device existant pour cet utilisateur avec les mêmes infos
        const existingDevice = db.prepare(`
          SELECT id FROM user_devices 
          WHERE user_id = ? AND device_brand = ? AND profile_url = ?
        `).get(
          userId,
          deviceData.device_brand || null,
          deviceData.profile_url || null
        );

        if (existingDevice) {
          // Mettre à jour le device existant
          db.prepare(`
            UPDATE user_devices 
            SET device_brand = ?, expo_push_token = ?, profile_url = ?
            WHERE id = ?
          `).run(
            deviceData.device_brand || null,
            deviceData.expo_push_token || null,
            deviceData.profile_url || null,
            existingDevice.id
          );
        } else {
          // Créer un nouveau device
          db.prepare(`
            INSERT INTO user_devices (user_id, device_brand, expo_push_token, profile_url)
            VALUES (?, ?, ?, ?)
          `).run(
            userId,
            deviceData.device_brand || null,
            deviceData.expo_push_token || null,
            deviceData.profile_url || null
          );
        }
      }
    } catch (error) {
      logger.error('Erreur upsertDevice:', error);
      // Ne pas faire échouer la création/modification de l'utilisateur si le device échoue
    }
  }

  /**
   * Crée un nouvel utilisateur
   * Gère automatiquement l'erreur UNIQUE constraint sur username en faisant un UPDATE si l'utilisateur existe déjà
   */
  async create(userData) {
    const db = getDb();
    try {
      const passwordHash = await bcrypt.hash(userData.password, 10);

      // Utiliser la date de création fournie ou la date actuelle
      const createdAt = userData.created_at || new Date().toISOString();
      
      // Générer un UUID si non fourni
      const userUuid = userData.uuid || generateUUID();

      const stmt = db.prepare(`
        INSERT INTO users (uuid, username, password_hash, phone, is_active, is_admin, is_vendeur, is_gerant_stock, can_manage_products, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        userUuid,
        userData.username,
        passwordHash,
        userData.phone || null,
        userData.is_active !== undefined ? userData.is_active : 1,
        userData.is_admin !== undefined ? userData.is_admin : 0,
        userData.is_vendeur !== undefined ? userData.is_vendeur : 1,
        userData.is_gerant_stock !== undefined ? userData.is_gerant_stock : 0,
        userData.can_manage_products !== undefined ? userData.can_manage_products : 0,
        createdAt
      );

      const userId = result.lastInsertRowid;

      // Créer un device si les informations sont fournies
      if (userData.device_brand || userData.profile_url) {
        this.upsertDevice(userId, {
          device_brand: userData.device_brand,
          profile_url: userData.profile_url,
          expo_push_token: userData.expo_push_token,
        });
      }

      return this.findById(userId);
    } catch (error) {
      // Gérer l'erreur UNIQUE constraint sur username : faire un UPDATE au lieu d'échouer
      const isUsernameUnique = error?.code === 'SQLITE_CONSTRAINT_UNIQUE' 
        && String(error.message || '').includes('users.username');
      
      if (isUsernameUnique) {
        logger.info(`💡 [UsersRepo] UNIQUE constraint sur username, tentative UPDATE pour: ${userData.username}`);
        const existing = this.findByUsername(userData.username);
        if (existing) {
          // Mettre à jour l'utilisateur existant avec les nouvelles données
          const updateData = {
            uuid: userData.uuid || existing.uuid, // Préserver UUID si fourni
            phone: userData.phone !== undefined ? userData.phone : existing.phone,
            is_active: userData.is_active !== undefined ? userData.is_active : existing.is_active,
            is_admin: userData.is_admin !== undefined ? userData.is_admin : existing.is_admin,
            is_vendeur: userData.is_vendeur !== undefined ? userData.is_vendeur : (existing.is_vendeur !== undefined ? existing.is_vendeur : 1),
            is_gerant_stock: userData.is_gerant_stock !== undefined ? userData.is_gerant_stock : (existing.is_gerant_stock || 0),
            can_manage_products: userData.can_manage_products !== undefined ? userData.can_manage_products : (existing.can_manage_products || 0),
            device_brand: userData.device_brand || existing.device_brand || '',
            profile_url: userData.profile_url || existing.profile_url || '',
            expo_push_token: userData.expo_push_token || existing.expo_push_token || '',
          };
          
          // Mettre à jour UUID si fourni et différent
          if (userData.uuid && userData.uuid !== existing.uuid) {
            this.setUuid(existing.id, userData.uuid);
          }
          
          await this.update(existing.id, updateData);
          
          // Mettre à jour le device si nécessaire
          if (userData.device_brand || userData.profile_url) {
            this.upsertDevice(existing.id, {
              device_brand: userData.device_brand,
              profile_url: userData.profile_url,
              expo_push_token: userData.expo_push_token,
            });
          }
          
          logger.info(`✅ [UsersRepo] Utilisateur mis à jour (fallback après UNIQUE constraint): ${userData.username}`);
          return this.findById(existing.id);
        }
      }
      
      // Re-throw les autres erreurs
      logger.error('Erreur create user:', {
        username: userData.username,
        message: String(error?.message || error || 'Erreur inconnue'),
        code: error?.code || 'UNKNOWN',
        stack: error?.stack || ''
      });
      throw error;
    }
  }

  /**
   * Crée ou met à jour un utilisateur par UUID (upsert)
   */
  async upsertByUuid(userData) {
    const db = getDb();
    try {
      if (!userData.uuid || userData.uuid.trim() === '') {
        throw new Error('UUID requis pour upsertByUuid');
      }

      const existing = this.findByUuid(userData.uuid);
      
      if (existing) {
        // Mise à jour
        return await this.update(existing.id, {
          username: userData.username,
          phone: userData.phone,
          is_active: userData.is_active,
          is_admin: userData.is_admin,
          device_brand: userData.device_brand,
          profile_url: userData.profile_url,
          expo_push_token: userData.expo_push_token,
        });
      } else {
        // Création avec UUID
        const defaultPassword = 'changeme123';
        return await this.create({
          uuid: userData.uuid,
          username: userData.username,
          password: defaultPassword,
          phone: userData.phone,
          is_active: userData.is_active,
          is_admin: userData.is_admin,
          created_at: userData.created_at,
          device_brand: userData.device_brand,
          profile_url: userData.profile_url,
          expo_push_token: userData.expo_push_token,
        });
      }
    } catch (error) {
      logger.error('Erreur upsertByUuid:', error);
      throw error;
    }
  }

  /**
   * Trouve un utilisateur par ID avec ses devices
   */
  findById(id) {
    const db = getDb();
    try {
      const user = db.prepare(`
        SELECT 
          u.id,
          u.uuid,
          u.username,
          u.phone,
          u.is_active,
          u.is_admin,
          u.is_vendeur,
          u.is_gerant_stock,
          u.can_manage_products,
          u.created_at,
          u.updated_at,
          GROUP_CONCAT(
            json_object(
              'id', ud.id,
              'device_brand', ud.device_brand,
              'expo_push_token', ud.expo_push_token,
              'profile_url', ud.profile_url,
              'created_at', ud.created_at
            )
          ) as devices
        FROM users u
        LEFT JOIN user_devices ud ON u.id = ud.user_id
        WHERE u.id = ?
        GROUP BY u.id
      `).get(id);
      
      if (!user) return null;
      
      const { password_hash, ...userWithoutHash } = user;
      return {
        ...userWithoutHash,
        devices: user.devices ? JSON.parse(`[${user.devices}]`) : [],
      };
    } catch (error) {
      logger.error('Erreur findById user:', error);
      throw error;
    }
  }

  /**
   * Liste tous les utilisateurs avec leurs devices
   */
  findAll() {
    const db = getDb();
    try {
      const users = db.prepare(`
        SELECT 
          u.id, 
          u.uuid,
          u.username, 
          u.phone, 
          u.is_active, 
          u.is_admin,
          u.is_vendeur,
          u.is_gerant_stock,
          u.can_manage_products,
          u.password_hash,
          u.created_at,
          u.updated_at,
          GROUP_CONCAT(
            json_object(
              'id', ud.id,
              'device_brand', ud.device_brand,
              'expo_push_token', ud.expo_push_token,
              'profile_url', ud.profile_url,
              'created_at', ud.created_at
            )
          ) as devices
        FROM users u
        LEFT JOIN user_devices ud ON u.id = ud.user_id
        GROUP BY u.id
        ORDER BY u.username
      `).all().map((row) => ({
        ...row,
        devices: row.devices ? JSON.parse(`[${row.devices}]`) : [],
      }));
      logger.info(`📊 [UsersRepo] findAll: ${users.length} utilisateur(s) trouvé(s) dans la base`);
      return users;
    } catch (error) {
      logger.error('Erreur findAll users:', error);
      throw error;
    }
  }

  /**
   * Met à jour un utilisateur
   */
  async update(id, userData) {
    const db = getDb();
    try {
      const existing = this.findById(id);
      if (!existing) {
        throw new Error('Utilisateur non trouvé');
      }

      // Si un nouveau mot de passe est fourni, le hasher
      let passwordHash = null;
      if (userData.password) {
        passwordHash = await bcrypt.hash(userData.password, 10);
      }

      // Construire la requête UPDATE dynamiquement
      const updates = [];
      const values = [];

      if (userData.username !== undefined) {
        // Vérifier si le username n'est pas déjà pris par un autre utilisateur
        const existingByUsername = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(userData.username, id);
        if (existingByUsername) {
          throw new Error('Ce nom d\'utilisateur est déjà utilisé');
        }
        updates.push('username = ?');
        values.push(userData.username);
      }

      if (passwordHash) {
        updates.push('password_hash = ?');
        values.push(passwordHash);
      }

      if (userData.phone !== undefined) {
        updates.push('phone = ?');
        values.push(userData.phone || null);
      }

      if (userData.is_admin !== undefined) {
        updates.push('is_admin = ?');
        values.push(userData.is_admin ? 1 : 0);
      }

      if (userData.is_active !== undefined) {
        updates.push('is_active = ?');
        values.push(userData.is_active ? 1 : 0);
      }

      if (userData.is_vendeur !== undefined) {
        updates.push('is_vendeur = ?');
        values.push(userData.is_vendeur ? 1 : 0);
      }

      if (userData.is_gerant_stock !== undefined) {
        updates.push('is_gerant_stock = ?');
        values.push(userData.is_gerant_stock ? 1 : 0);
      }

      if (userData.can_manage_products !== undefined) {
        updates.push('can_manage_products = ?');
        values.push(userData.can_manage_products ? 1 : 0);
      }

      if (updates.length === 0) {
        return existing; // Aucune mise à jour
      }

      updates.push('updated_at = datetime(\'now\')');
      values.push(id);

      const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      db.prepare(sql).run(...values);

      logger.info(`💾 [SQL] UPDATE users WHERE id=${id}`);
      logger.info(`   ✅ [SQL] Utilisateur mis à jour avec succès`);

      // Mettre à jour le device si les informations sont fournies
      if (userData.device_brand !== undefined || userData.profile_url !== undefined) {
        this.upsertDevice(id, {
          device_brand: userData.device_brand,
          profile_url: userData.profile_url,
          expo_push_token: userData.expo_push_token,
        });
      }

      return this.findById(id);
    } catch (error) {
      logger.error('Erreur update user:', error);
      throw error;
    }
  }
}

export const usersRepo = new UsersRepository();

