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
}

export const usersRepo = new UsersRepository();

