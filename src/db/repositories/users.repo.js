import { getDb } from '../sqlite.js';
import { logger } from '../../core/logger.js';
import bcrypt from 'bcrypt';

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
   * Vérifie le mot de passe
   */
  async verifyPassword(username, password) {
    try {
      const user = this.findByUsername(username);
      if (!user) {
        return null;
      }

      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return null;
      }

      // Retourner l'utilisateur sans le hash
      const { password_hash, ...userWithoutHash } = user;
      return userWithoutHash;
    } catch (error) {
      logger.error('Erreur verifyPassword:', error);
      throw error;
    }
  }

  /**
   * Crée un nouvel utilisateur
   */
  async create(userData) {
    const db = getDb();
    try {
      const passwordHash = await bcrypt.hash(userData.password, 10);

      const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, phone, is_active, is_admin)
        VALUES (?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        userData.username,
        passwordHash,
        userData.phone || null,
        userData.is_active !== undefined ? userData.is_active : 1,
        userData.is_admin !== undefined ? userData.is_admin : 0
      );

      return this.findById(result.lastInsertRowid);
    } catch (error) {
      logger.error('Erreur create user:', error);
      throw error;
    }
  }

  /**
   * Trouve un utilisateur par ID
   */
  findById(id) {
    const db = getDb();
    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (user && user.password_hash) {
        const { password_hash, ...userWithoutHash } = user;
        return userWithoutHash;
      }
      return user;
    } catch (error) {
      logger.error('Erreur findById user:', error);
      throw error;
    }
  }

  /**
   * Liste tous les utilisateurs
   */
  findAll() {
    const db = getDb();
    try {
      const users = db.prepare('SELECT id, username, phone, is_active, is_admin, created_at FROM users ORDER BY username').all();
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

      if (updates.length === 0) {
        return existing; // Aucune mise à jour
      }

      updates.push('updated_at = datetime(\'now\')');
      values.push(id);

      const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      db.prepare(sql).run(...values);

      logger.info(`💾 [SQL] UPDATE users WHERE id=${id}`);
      logger.info(`   ✅ [SQL] Utilisateur mis à jour avec succès`);

      return this.findById(id);
    } catch (error) {
      logger.error('Erreur update user:', error);
      throw error;
    }
  }
}

export const usersRepo = new UsersRepository();

