import express from 'express';
import jwt from 'jsonwebtoken';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { logger } from '../../core/logger.js';
import { getSocketIO } from '../socket.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * POST /api/auth/login
 * Connexion utilisateur
 */
router.post('/login', async (req, res) => {
  try {
    // Accepter soit 'username' soit 'numero' (pour compatibilité)
    const identifier = req.body.username || req.body.numero || req.body.phone;
    const password = req.body.password;

    logger.info(`🔐 [AUTH] Tentative de connexion: identifier=${identifier ? identifier.substring(0, 3) + '***' : 'VIDE'}, hasPassword=${!!password}`);

    if (!identifier || !password) {
      logger.warn(`⚠️ [AUTH] Connexion échouée: identifiant ou mot de passe manquant`);
      return res.status(400).json({
        success: false,
        error: 'Numéro (ou nom d\'utilisateur) et mot de passe requis',
      });
    }

    // Debug: Lister tous les utilisateurs disponibles (seulement en dev)
    if (process.env.NODE_ENV === 'development') {
      const allUsers = usersRepo.findAll();
      logger.debug(`📋 [AUTH] Utilisateurs disponibles dans la base: ${allUsers.length} utilisateur(s)`);
      allUsers.forEach(u => {
        logger.debug(`   - ${u.username} (phone: ${u.phone || 'N/A'}, active: ${u.is_active})`);
      });
    }

    const user = await usersRepo.verifyPassword(identifier, password);
    
    logger.info(`🔍 [AUTH] Résultat vérification: ${user ? 'Utilisateur trouvé (ID: ' + user.id + ', username: ' + user.username + ')' : 'Aucun utilisateur trouvé'}`);

    if (!user) {
      // Vérifier si l'utilisateur existe mais avec un mauvais mot de passe
      const userExists = usersRepo.findByUsernameOrPhone(identifier);
      
      let errorMessage = 'Numéro ou mot de passe invalide';
      let debugInfo = {};
      
      if (userExists) {
        errorMessage = 'Mot de passe incorrect';
        // En mode développement, donner des infos supplémentaires
        if (process.env.NODE_ENV === 'development') {
          debugInfo = {
            hint: 'L\'utilisateur existe mais le mot de passe est incorrect',
            note: 'Les utilisateurs synchronisés depuis Google Sheets utilisent le mot de passe par défaut "changeme123"',
            endpoint: '/api/users/debug',
            message: 'Utilisez GET /api/users/debug pour voir tous les utilisateurs disponibles'
          };
        }
      } else {
        // En mode développement, donner plus d'infos pour déboguer
        if (process.env.NODE_ENV === 'development') {
          debugInfo = {
            hint: 'L\'utilisateur n\'existe pas dans la base de données',
            endpoint: '/api/users/debug',
            message: 'Utilisez GET /api/users/debug pour voir tous les utilisateurs disponibles. Vérifiez que la synchronisation depuis Google Sheets a été effectuée.'
          };
        }
      }
      
      return res.status(401).json({
        success: false,
        error: errorMessage,
        ...debugInfo
      });
    }

    // Vérifier que le compte est toujours valide (double vérification)
    if (!user.is_active || user.is_active === 0) {
      logger.warn(`⚠️ [AUTH] Tentative de connexion avec compte inactif: ${identifier}`);
      return res.status(401).json({
        success: false,
        error: 'Ce compte a été désactivé. Contactez un administrateur pour réactiver votre compte.',
      });
    }

    // Générer le token JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Audit log
    auditRepo.log(user.id, 'login', { username: user.username });

    // Émettre l'événement de connexion pour AI LaGrace
    const io = getSocketIO();
    if (io) {
      io.emit('user:login', {
        username: user.username,
        name: user.username,
        is_admin: user.is_admin,
        timestamp: new Date().toISOString()
      });
      logger.info(`🤖 [AI] Événement user:login émis pour ${user.username}`);
    }

    // Retourner toutes les informations utilisateur nécessaires
    res.json({
      success: true,
      user: {
        id: user.id,
        uuid: user.uuid,
        username: user.username,
        phone: user.phone,
        is_admin: user.is_admin,
        is_active: user.is_active,
        is_vendeur: user.is_vendeur,
        is_gerant_stock: user.is_gerant_stock,
        can_manage_products: user.can_manage_products,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      token,
    });
  } catch (error) {
    logger.error('Erreur login:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la connexion',
    });
  }
});

export default router;

