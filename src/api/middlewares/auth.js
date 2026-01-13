import jwt from 'jsonwebtoken';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { logger } from '../../core/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Normaliser boolean depuis DB/payload (1, true, '1', 'true', 'oui', 'OUI')
 */
function normalizeBool(v) {
  return v === 1 || v === true || v === '1' || v === 'true' || v === 'oui' || v === 'OUI';
}

/**
 * Calculer le rôle d'un utilisateur depuis ses flags DB
 * OWNER > ADMIN > autres rôles
 */
function computeUserRoleFromUser(user) {
  if (!user) return 'LICENSE_ONLY';
  
  // OWNER si is_owner=1 (créateur/fondateur)
  if (normalizeBool(user.is_owner)) return 'OWNER';
  
  // ADMIN si is_admin=1
  if (normalizeBool(user.is_admin)) return 'ADMIN';
  
  // Autres rôles selon combinaison de flags
  const isVendeur = normalizeBool(user.is_vendeur);
  const isStock = normalizeBool(user.is_gerant_stock);
  const canProducts = normalizeBool(user.can_manage_products);

  if (isVendeur && isStock) return 'VENDEUR_STOCK';
  if (isVendeur && canProducts) return 'VENDEUR_PRODUITS';
  if (isVendeur) return 'VENDEUR_SEULEMENT';
  if (isStock) return 'GERANT_STOCK';
  if (canProducts) return 'PRODUITS_SEULEMENT';
  return 'LICENSE_ONLY';
}

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
      req.user = { id: 0, username: 'offline', is_admin: true, is_active: 1 };
      req.userRole = 'ADMIN';
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
          if (user && normalizeBool(user.is_active)) {
            req.user = user;
            req.userRole = computeUserRoleFromUser(user); // ✅ IMPORTANT: toujours définir userRole
            req.roleFlags = payload.role_flags || {};
            return next();
          }
        }

        // Sinon, créer un utilisateur basique basé sur les flags (PAS sur payload.role pour sécurité)
        const roleFlags = payload.role_flags || {};
        
        // ✅ MODE LICENSE: Si pas de user_id dans le payload = connexion avec license seule
        // Dans ce cas, on ne crée PAS d'objet req.user pour permettre la détection du mode license
        if (!payload.user_id) {
          req.user = null; // ✅ CRITIQUE: null pour indiquer mode license pur
          req.userRole = 'LICENSE_ONLY';
          req.roleFlags = roleFlags;
          logger.debug('🔑 [Auth] Mode LICENSE détecté - Accès complet autorisé');
          return next();
        }
        
        // Si user_id présent mais pas dans DB, créer un user basique
        req.user = {
          id: Number(payload.user_id),
          username: `user_${payload.user_id}`,
          is_active: 1,
          // ⚠️ SÉCURITÉ: admin/owner ne viennent QUE de la DB, jamais du payload
          is_admin: false,
          is_vendeur: roleFlags.vendeur === true,
          is_gerant_stock: roleFlags.gerentStock === true,
          can_manage_products: roleFlags.produitsVendeur === true,
        };
        // Rôle déterminé par flags du payload (non-signé, donc contraint)
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
      
      if (!user || !normalizeBool(user.is_active)) {
        return res.status(401).json({ success: false, error: 'Utilisateur invalide' });
      }

      req.user = user;
      req.userRole = computeUserRoleFromUser(user); // ✅ Utiliser la fonction helper
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
            if (user && normalizeBool(user.is_active)) {
              req.user = user;
              req.userRole = computeUserRoleFromUser(user);
            } else {
              req.user = {
                id: Number(payload.user_id),
                username: `user_${payload.user_id}`,
                is_active: 1,
                is_admin: false, // Sécurité: pas d'admin depuis payload
              };
              req.userRole = payload.role || 'LICENSE_ONLY';
            }
          } else {
            req.user = {
              username: 'offline',
              is_active: 1,
              is_admin: false, // Sécurité: pas d'admin depuis payload
            };
            req.userRole = payload.role || 'LICENSE_ONLY';
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

