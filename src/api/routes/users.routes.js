import express from 'express';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { outboxRepo } from '../../db/repositories/outbox.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { authenticate, optionalAuth } from '../middlewares/auth.js';
// Note: requireAdmin non utilisé car la création est accessible avec license
// import { requireAdmin, requirePermission } from '../middlewares/permissions.js';
import { logger } from '../../core/logger.js';

const router = express.Router();

/**
 * GET /api/users/debug
 * Endpoint de debug pour voir tous les utilisateurs (sans filtres)
 */
router.get('/debug', (req, res) => {
  try {
    const users = usersRepo.findAll();
    const debugInfo = users.map(u => ({
      id: u.id,
      username: u.username,
      phone: u.phone || 'N/A',
      is_active: u.is_active,
      is_admin: u.is_admin,
      has_password: !!u.password_hash
    }));
    
    res.json({
      total: users.length,
      users: debugInfo,
      message: users.length === 0 ? 'Aucun utilisateur dans la base. Vérifiez la synchronisation depuis Google Sheets.' : 'Utilisateurs trouvés'
    });
  } catch (error) {
    logger.error('Erreur debug users:', error);
    res.status(500).json({ error: error.message });
  }
});

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
 * GET /api/users/me
 * Récupère l'utilisateur actuellement connecté
 */
router.get('/me', authenticate, (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, error: 'Utilisateur non authentifié' });
    }
    
    const user = usersRepo.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }
    
    res.json(user);
  } catch (error) {
    logger.error('❌ Erreur GET /api/users/me:', error);
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
 * ✅ Accessible avec authentification (license ou compte)
 * Les utilisateurs connectés peuvent créer des comptes clients
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { username, password, phone, is_admin, is_active, is_vendeur, is_gerant_stock, can_manage_products, device_brand, profile_url, expo_push_token } = req.body;

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

    // ✅ Sécurité: ADMIN/OWNER ou MODE LICENSE peut créer un compte admin
    const currentUser = req.user ? usersRepo.findById(req.user.id) : null;
    const isCurrentAdmin = currentUser && (currentUser.is_admin === 1 || currentUser.is_admin === true);
    const isCurrentOwner = currentUser && (currentUser.is_owner === 1 || currentUser.is_owner === true);
    
    // ✅ MODE LICENSE: Connexion avec license SANS compte utilisateur = ACCÈS COMPLET
    // Détection: req.user est null OU pas d'ID OU userRole = LICENSE_ONLY
    const isLicenseMode = !req.user || !req.user.id || req.userRole === 'LICENSE_ONLY';
    
    logger.debug(`🔐 [POST /api/users] Création utilisateur: currentUser=${!!currentUser}, isCurrentAdmin=${isCurrentAdmin}, isCurrentOwner=${isCurrentOwner}, isLicenseMode=${isLicenseMode}, userRole=${req.userRole}`);
    
    // Si is_admin demandé mais utilisateur non-admin/owner/license, refuser
    if (is_admin && !isCurrentAdmin && !isCurrentOwner && !isLicenseMode) {
      return res.status(403).json({
        success: false,
        error: 'Seuls les administrateurs ou le mode license peuvent créer un compte administrateur',
      });
    }

    const user = await usersRepo.create({
      username,
      password,
      phone,
      is_admin: (is_admin && (isCurrentAdmin || isCurrentOwner || isLicenseMode)) ? 1 : 0,
      is_active: is_active !== undefined ? is_active : 1,
      is_vendeur: is_vendeur !== undefined ? (is_vendeur ? 1 : 0) : 1,
      is_gerant_stock: is_gerant_stock ? 1 : 0,
      can_manage_products: can_manage_products ? 1 : 0,
      device_brand,
      profile_url,
      expo_push_token,
    });

    // ✅ PRO: Ajouter à l'outbox pour synchronisation avec Google Sheets (feuille "Compter Utilisateur")
    outboxRepo.enqueueUser({
      uuid: user.uuid,
      username: user.username,
      phone: user.phone || '',
      is_admin: user.is_admin,
      is_active: user.is_active,
      is_vendeur: user.is_vendeur !== undefined ? user.is_vendeur : 1,
      is_gerant_stock: user.is_gerant_stock || 0,
      can_manage_products: user.can_manage_products || 0,
      created_at: user.created_at,
      updated_at: user.updated_at,
      device_brand: user.devices?.[0]?.device_brand || device_brand || '',
      profile_url: user.devices?.[0]?.profile_url || profile_url || '',
      expo_push_token: user.devices?.map(d => d.expo_push_token).filter(Boolean).join('|') || expo_push_token || '',
    }, 'create');

    // Audit log
    const auditUserId = req.user?.id || 0; // 0 si connexion par license
    auditRepo.log(auditUserId, 'user_create', {
      user_id: user.id,
      username: user.username,
      created_by: currentUser?.username || 'license',
    });

    logger.info(`✅ POST /api/users: Utilisateur créé - ID=${user.id}, Username="${user.username}" par ${currentUser?.username || 'license'}`);

    res.json({ success: true, user });
  } catch (error) {
    logger.error('❌ Erreur POST /api/users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/users/:id
 * Met à jour un utilisateur
 * ✅ Accessible avec authentification (license ou compte)
 * - Chacun peut modifier son propre compte
 * - ADMIN/OWNER peuvent modifier tous les comptes
 * - Avec license: peut modifier n'importe quel compte client
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const currentUserId = req.user?.id;
    
    // ✅ SÉCURITÉ: Vérifier les permissions de modification par lookup DB directe
    const currentUser = (req.user && currentUserId) ? usersRepo.findById(currentUserId) : null;
    const isOwner = currentUser && (currentUser.is_owner === 1 || currentUser.is_owner === true);
    const isAdmin = currentUser && (currentUser.is_admin === 1 || currentUser.is_admin === true);
    
    // ✅ MODE LICENSE: Connexion avec license SANS compte utilisateur = ACCÈS COMPLET
    // Détection: req.user est null OU pas d'ID OU userRole = LICENSE_ONLY
    const isLicenseMode = !req.user || !currentUserId || req.userRole === 'LICENSE_ONLY';
    
    logger.debug(`🔐 [PUT /api/users/${userId}] Permissions: currentUser=${!!currentUser}, currentUserId=${currentUserId}, isOwner=${isOwner}, isAdmin=${isAdmin}, isLicenseMode=${isLicenseMode}, userRole=${req.userRole}`);
    
    // Règle: Peut modifier si:
    // - C'est son propre compte (toujours autorisé) OU
    // - C'est OWNER ou ADMIN (pour modifier les autres) OU
    // - Connexion avec license (peut gérer TOUS les comptes clients)
    if (userId !== currentUserId && !isAdmin && !isOwner && !isLicenseMode) {
      return res.status(403).json({ 
        success: false, 
        error: 'Vous n\'avez pas les permissions pour modifier ce compte' 
      });
    }

    const { username, password, phone, is_admin, is_active, is_vendeur, is_gerant_stock, can_manage_products, device_brand, profile_url, expo_push_token } = req.body;

    const existing = usersRepo.findById(userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé',
      });
    }

    // ✅ SÉCURITÉ: OWNER ou MODE LICENSE peut changer is_admin
    // En mode license = droits équivalents à OWNER pour gérer les comptes
    if ('is_admin' in req.body && !isOwner && !isLicenseMode) {
      return res.status(403).json({ 
        success: false, 
        error: 'Seul le créateur ou le mode license peut modifier le statut administrateur' 
      });
    }

    // ✅ SÉCURITÉ: Personne ne peut définir is_owner via API (protection contre escalade de privilèges)
    if ('is_owner' in req.body) {
      return res.status(403).json({ 
        success: false, 
        error: 'Impossible de modifier le statut propriétaire' 
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

    // ✅ PRO: Ajouter à l'outbox pour synchronisation avec Google Sheets (feuille "Compter Utilisateur")
    outboxRepo.enqueueUser({
      uuid: user.uuid,
      username: user.username,
      phone: user.phone || '',
      is_admin: user.is_admin,
      is_active: user.is_active,
      is_vendeur: user.is_vendeur !== undefined ? user.is_vendeur : 1,
      is_gerant_stock: user.is_gerant_stock || 0,
      can_manage_products: user.can_manage_products || 0,
      created_at: user.created_at || existing.created_at,
      updated_at: user.updated_at,
      device_brand: user.devices?.[0]?.device_brand || device_brand || '',
      profile_url: user.devices?.[0]?.profile_url || profile_url || '',
      expo_push_token: user.devices?.map(d => d.expo_push_token).filter(Boolean).join('|') || expo_push_token || '',
    }, 'update');

    // Audit log
    const auditUserId = currentUserId || 0; // 0 si connexion par license
    auditRepo.log(auditUserId, 'user_update', {
      user_id: user.id,
      username: user.username,
      updated_by: currentUser?.username || 'license',
    });

    logger.info(`✅ PUT /api/users/${userId}: Utilisateur mis à jour par ${currentUser?.username || 'license'}`);

    res.json({ success: true, user });
  } catch (error) {
    logger.error('❌ Erreur PUT /api/users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

