import express from 'express';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { syncRepo } from '../../db/repositories/sync.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
import { logger } from '../../core/logger.js';

const router = express.Router();

/**
 * GET /api/users
 * Liste tous les utilisateurs
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    logger.info(`📊 GET /api/users - Début récupération des utilisateurs`);
    
    const users = usersRepo.findAll();
    
    logger.info(`✅ GET /api/users: ${users.length} utilisateur(s) trouvé(s) dans la base`);
    
    if (users.length > 0) {
      logger.info(`   📋 Premier utilisateur: ID=${users[0].id}, Username="${users[0].username}", Admin=${users[0].is_admin}`);
    } else {
      logger.warn(`   ⚠️  Aucun utilisateur trouvé dans la base de données`);
      logger.warn(`   💡 Vérifier si les utilisateurs ont été synchronisés depuis Google Sheets`);
    }
    
    res.json(users);
  } catch (error) {
    logger.error('❌ Erreur GET /api/users:', error);
    logger.error(`   Message: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/users/:id
 * Récupère un utilisateur par ID
 */
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const user = usersRepo.findById(parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/users
 * Crée un nouvel utilisateur
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { username, password, phone, is_admin, is_active, device_brand, profile_url, expo_push_token } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Nom d\'utilisateur et mot de passe requis',
      });
    }

    // Vérifier si l'utilisateur existe déjà
    const existing = usersRepo.findByUsername(username);
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Ce nom d\'utilisateur existe déjà',
      });
    }

    const user = await usersRepo.create({
      username,
      password,
      phone,
      is_admin: is_admin ? 1 : 0,
      is_active: is_active !== undefined ? is_active : 1,
      is_vendeur: is_vendeur !== undefined ? (is_vendeur ? 1 : 0) : 1,
      is_gerant_stock: is_gerant_stock ? 1 : 0,
      can_manage_products: can_manage_products ? 1 : 0,
      device_brand,
      profile_url,
      expo_push_token,
    });

    // Ajouter à l'outbox pour synchronisation avec UUID - PRO et TOP
    syncRepo.addToOutbox('users', user.id.toString(), 'upsert', {
      uuid: user.uuid, // CRITIQUE: Inclure UUID pour sync bidirectionnelle
      username: user.username,
      phone: user.phone || '',
      is_admin: user.is_admin,
      is_active: user.is_active,
      is_vendeur: user.is_vendeur !== undefined ? user.is_vendeur : 1,
      is_gerant_stock: user.is_gerant_stock || 0,
      can_manage_products: user.can_manage_products || 0,
      created_at: user.created_at,
      updated_at: user.updated_at,
      device_brand: user.devices?.[0]?.device_brand || '',
      profile_url: user.devices?.[0]?.profile_url || '',
      expo_push_token: user.devices?.map(d => d.expo_push_token).filter(Boolean).join('|') || '',
    });

    // Audit log
    auditRepo.log(req.user.id, 'user_create', {
      user_id: user.id,
      username: user.username,
    });

    logger.info(`✅ POST /api/users: Utilisateur créé - ID=${user.id}, Username="${user.username}"`);

    res.json({ success: true, user });
  } catch (error) {
    logger.error('❌ Erreur POST /api/users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/users/:id
 * Met à jour un utilisateur
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { username, password, phone, is_admin, is_active, is_vendeur, is_gerant_stock, can_manage_products, device_brand, profile_url, expo_push_token } = req.body;

    const existing = usersRepo.findById(userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé',
      });
    }

    const user = await usersRepo.update(userId, {
      username,
      password,
      phone,
      is_admin,
      is_active,
      is_vendeur,
      is_gerant_stock,
      can_manage_products,
      device_brand,
      profile_url,
      expo_push_token,
    });

    // Ajouter à l'outbox pour synchronisation avec UUID - PRO et TOP
    syncRepo.addToOutbox('users', user.id.toString(), 'upsert', {
      uuid: user.uuid, // CRITIQUE: Inclure UUID pour sync bidirectionnelle
      username: user.username,
      phone: user.phone || '',
      is_admin: user.is_admin,
      is_active: user.is_active,
      is_vendeur: user.is_vendeur !== undefined ? user.is_vendeur : 1,
      is_gerant_stock: user.is_gerant_stock || 0,
      can_manage_products: user.can_manage_products || 0,
      updated_at: user.updated_at,
      device_brand: user.devices?.[0]?.device_brand || '',
      profile_url: user.devices?.[0]?.profile_url || '',
      expo_push_token: user.devices?.map(d => d.expo_push_token).filter(Boolean).join('|') || '',
    });

    // Audit log
    auditRepo.log(req.user.id, 'user_update', {
      user_id: user.id,
      username: user.username,
    });

    logger.info(`✅ PUT /api/users/${userId}: Utilisateur mis à jour`);

    res.json({ success: true, user });
  } catch (error) {
    logger.error('❌ Erreur PUT /api/users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

