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
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      
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
        // Ignorer l'erreur en mode optionnel
      }
    }
    
    next();
  } catch (error) {
    next();
  }
}

