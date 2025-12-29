import jwt from 'jsonwebtoken';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { logger } from '../../core/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Middleware d'authentification
 */
export function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Token manquant' });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Mode offline: accepter le token offline basique
    if (token === 'offline-token') {
      req.user = { username: 'offline', is_admin: true };
      return next();
    }

    // Token local (généré côté client)
    if (token.startsWith('local.')) {
      try {
        // Décoder le token local (base64)
        const payloadBase64 = token.substring(6);
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8'));
        
        // Vérifier l'expiration
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
          return res.status(401).json({ success: false, error: 'Token expiré' });
        }

        // Si un user_id est présent, essayer de charger l'utilisateur
        if (payload.user_id) {
          const user = usersRepo.findById(payload.user_id);
          if (user && user.is_active) {
            req.user = user;
            return next();
          }
        }

        // Sinon, créer un utilisateur basique basé sur le rôle et les flags
        const roleFlags = payload.role_flags || {};
        req.user = {
          username: payload.user_id ? `user_${payload.user_id}` : 'offline',
          is_admin: payload.role === 'ADMIN' || roleFlags.admin === true,
          is_vendeur: roleFlags.vendeur === true || payload.role === 'VENDEUR_SEULEMENT' || payload.role === 'VENDEUR_PRODUITS' || payload.role === 'VENDEUR_STOCK',
          is_gerant_stock: roleFlags.gerentStock === true || payload.role === 'GERANT_STOCK' || payload.role === 'VENDEUR_STOCK',
          can_manage_products: roleFlags.produitsVendeur === true || payload.role === 'VENDEUR_PRODUITS' || payload.role === 'VENDEUR_STOCK' || payload.role === 'PRODUITS_SEULEMENT' || payload.role === 'GERANT_STOCK' || payload.role === 'ADMIN',
        };
        req.userRole = payload.role || 'LICENSE_ONLY';
        req.roleFlags = roleFlags;
        return next();
      } catch (error) {
        logger.error('Erreur décodage token local:', error);
        return res.status(401).json({ success: false, error: 'Token local invalide' });
      }
    }

    // Token JWT serveur (authentification normale)
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = usersRepo.findById(decoded.userId);
      
      if (!user || !user.is_active) {
        return res.status(401).json({ success: false, error: 'Utilisateur invalide' });
      }

      req.user = user;
      // Déterminer le rôle depuis l'utilisateur pour les vérifications de permissions
      if (user.is_admin === 1 || user.is_admin === true) {
        req.userRole = 'ADMIN';
      } else if (user.is_vendeur === 1 && user.is_gerant_stock === 1) {
        req.userRole = 'VENDEUR_STOCK';
      } else if (user.is_vendeur === 1 && user.can_manage_products === 1) {
        req.userRole = 'VENDEUR_PRODUITS';
      } else if (user.is_vendeur === 1) {
        req.userRole = 'VENDEUR_SEULEMENT';
      } else if (user.is_gerant_stock === 1) {
        req.userRole = 'GERANT_STOCK';
      } else if (user.can_manage_products === 1) {
        req.userRole = 'PRODUITS_SEULEMENT';
      } else {
        req.userRole = 'LICENSE_ONLY';
      }
      next();
    } catch (error) {
      logger.error('Erreur vérification token:', error);
      return res.status(401).json({ success: false, error: 'Token invalide' });
    }
  } catch (error) {
    logger.error('Erreur authentification:', error);
    return res.status(500).json({ success: false, error: 'Erreur authentification' });
  }
}

/**
 * Middleware optionnel (ne bloque pas si pas de token)
 */
export function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    // Log pour débogage
    if (req.path && req.path.includes('/sync/now')) {
      logger.info(`🔓 [OPTIONAL AUTH] Requête ${req.method} ${req.path}`);
      logger.info(`   📋 Authorization header: ${authHeader ? 'Présent' : 'Absent'}`);
      if (authHeader) {
        logger.info(`   📋 Token: ${authHeader.substring(0, 20)}...`);
      }
    }
    
    // Si pas de header, continuer sans authentification
    if (!authHeader || !authHeader.trim()) {
      if (req.path && req.path.includes('/sync/now')) {
        logger.info(`   ✅ [OPTIONAL AUTH] Pas de token, continuation sans authentification`);
      }
      return next();
    }
    
    const token = authHeader.replace('Bearer ', '').trim();
    
    // Si token vide, continuer sans authentification
    if (!token || token === 'null' || token === 'undefined') {
      return next();
    }
    
    if (token === 'offline-token') {
      req.user = { username: 'offline', is_admin: true };
      return next();
    }

    // Token local
    if (token.startsWith('local.')) {
      try {
        const payloadBase64 = token.substring(6);
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8'));
        const now = Math.floor(Date.now() / 1000);
        
        if (payload.exp && payload.exp >= now) {
          if (payload.user_id) {
            const user = usersRepo.findById(payload.user_id);
            if (user && user.is_active) {
              req.user = user;
            } else {
              req.user = {
                username: `user_${payload.user_id}`,
                is_admin: payload.role === 'ADMIN',
              };
            }
          } else {
            req.user = {
              username: 'offline',
              is_admin: payload.role === 'ADMIN',
            };
          }
        }
      } catch (error) {
        // Ignorer l'erreur en mode optionnel
        logger.debug('Erreur décodage token local en optionalAuth:', error.message);
      }
      return next();
    }

    // Token JWT serveur
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = usersRepo.findById(decoded.userId);
      if (user && user.is_active) {
        req.user = user;
      }
    } catch (error) {
      // Ignorer l'erreur en mode optionnel - continuer sans authentification
      logger.debug('Token invalide en mode optionalAuth, continuation sans authentification');
    }
    
    next();
  } catch (error) {
    // En cas d'erreur, continuer quand même
    logger.debug('Erreur dans optionalAuth, continuation:', error.message);
    next();
  }
}

