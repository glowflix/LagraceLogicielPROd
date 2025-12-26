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
    
    // Mode offline: accepter le token offline
    if (token === 'offline-token') {
      req.user = { username: 'offline', is_admin: true };
      return next();
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = usersRepo.findById(decoded.userId);
      
      if (!user || !user.is_active) {
        return res.status(401).json({ success: false, error: 'Utilisateur invalide' });
      }

      req.user = user;
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

