import { logger } from '../../core/logger.js';

/**
 * Mapping des routes vers les permissions requises
 */
const ROUTE_PERMISSIONS = {
  '/api/users': 'canManageUsers',
  '/api/products': 'canManageProducts',
  '/api/settings': 'canManageSettings',
  '/api/sync': 'canManageSync',
  '/api/license': 'canManageLicense',
};

/**
 * Mapping des méthodes HTTP vers les permissions
 */
const METHOD_PERMISSIONS = {
  'POST': {
    '/api/users': 'canCreateUsers',
    '/api/products': 'canManageProducts',
  },
  'PUT': {
    '/api/users': 'canManageUsers',
    '/api/products': 'canManageProducts',
  },
  'DELETE': {
    '/api/users': 'canBlockUsers',
    '/api/products': 'canManageProducts',
  },
};

/**
 * Définition des permissions par rôle (version backend)
 * Doit correspondre à src/ui/utils/permissions.js
 */
const ROLE_PERMISSIONS = {
  ADMIN: {
    canManageUsers: true,
    canCreateUsers: true,
    canBlockUsers: true,
    canManageProducts: true,
    canManageSettings: true,
    canManageSync: true,
    canManageLicense: true,
  },
  VENDEUR_SEULEMENT: {
    canManageUsers: false,
    canCreateUsers: false,
    canBlockUsers: false,
    canManageProducts: false,
    canManageSettings: false,
    canManageSync: false,
    canManageLicense: false,
  },
  VENDEUR_PRODUITS: {
    canManageUsers: false,
    canCreateUsers: false,
    canBlockUsers: false,
    canManageProducts: true,
    canManageSettings: false,
    canManageSync: false,
    canManageLicense: false,
  },
  VENDEUR_STOCK: {
    canManageUsers: false,
    canCreateUsers: false,
    canBlockUsers: false,
    canManageProducts: true,
    canManageSettings: false,
    canManageSync: false,
    canManageLicense: false,
  },
  GERANT_STOCK: {
    canManageUsers: false,
    canCreateUsers: false,
    canBlockUsers: false,
    canManageProducts: true,
    canManageSettings: false,
    canManageSync: false,
    canManageLicense: false,
  },
  PRODUITS_SEULEMENT: {
    canManageUsers: false,
    canCreateUsers: false,
    canBlockUsers: false,
    canManageProducts: true,
    canManageSettings: false,
    canManageSync: false,
    canManageLicense: false,
  },
  LICENSE_ONLY: {
    // Licence PRO = accès total comme ADMIN
    canManageUsers: true,
    canCreateUsers: true,
    canBlockUsers: true,
    canManageProducts: true,
    canManageSettings: true,
    canManageSync: true,
    canManageLicense: true,
  },
};

/**
 * Vérifie si un rôle a une permission spécifique
 */
function hasPermission(role, permission) {
  if (!role || !ROLE_PERMISSIONS[role]) {
    return false;
  }

  return ROLE_PERMISSIONS[role][permission] === true;
}

/**
 * Middleware pour vérifier les permissions backend
 * 
 * Usage:
 * router.get('/api/users', authenticate, requirePermission('canManageUsers'), (req, res) => { ... });
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    // Si pas d'utilisateur (ne devrait pas arriver si authenticate est appelé avant)
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentification requise' 
      });
    }

    const role = req.userRole || 'LICENSE_ONLY';

    // Admin ou Licence PRO a toujours accès
    if (role === 'ADMIN' || role === 'LICENSE_ONLY') {
      return next();
    }

    // Vérifier la permission spécifique
    if (!hasPermission(role, permission)) {
      logger.warn(`⚠️ [PERMISSIONS] Accès refusé: ${req.user.username} (${role}) tente d'accéder à ${req.path} (permission requise: ${permission})`);
      return res.status(403).json({ 
        success: false, 
        error: 'Vous n\'avez pas les permissions nécessaires pour effectuer cette action' 
      });
    }

    next();
  };
}

/**
 * Middleware pour vérifier que l'utilisateur est admin ou a une licence PRO
 * La licence PRO donne les mêmes droits qu'admin
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentification requise' 
    });
  }

  const role = req.userRole || 'LICENSE_ONLY';
  
  // Admin ou Licence PRO = accès total
  if (role !== 'ADMIN' && role !== 'LICENSE_ONLY') {
    logger.warn(`⚠️ [PERMISSIONS] Accès admin refusé: ${req.user.username} (${role}) tente d'accéder à ${req.path}`);
    return res.status(403).json({ 
      success: false, 
      error: 'Accès administrateur ou licence PRO requise' 
    });
  }

  next();
}

/**
 * Middleware pour vérifier les permissions automatiquement selon la route
 */
export function checkRoutePermissions(req, res, next) {
  // Si pas d'utilisateur, laisser authenticate gérer
  if (!req.user) {
    return next();
  }

  const role = req.userRole || 'LICENSE_ONLY';

  // Admin ou Licence PRO a toujours accès
  if (role === 'ADMIN' || role === 'LICENSE_ONLY') {
    return next();
  }

  // Vérifier les permissions selon la route
  const route = req.path;
  const method = req.method;

  // Vérifier les permissions spécifiques à la méthode
  if (METHOD_PERMISSIONS[method] && METHOD_PERMISSIONS[method][route]) {
    const requiredPermission = METHOD_PERMISSIONS[method][route];
    if (!hasPermission(role, requiredPermission)) {
      logger.warn(`⚠️ [PERMISSIONS] Accès refusé: ${req.user.username} (${role}) tente ${method} ${route} (permission requise: ${requiredPermission})`);
      return res.status(403).json({ 
        success: false, 
        error: 'Vous n\'avez pas les permissions nécessaires pour effectuer cette action' 
      });
    }
  }

  // Vérifier les permissions générales de la route
  if (ROUTE_PERMISSIONS[route]) {
    const requiredPermission = ROUTE_PERMISSIONS[route];
    if (!hasPermission(role, requiredPermission)) {
      logger.warn(`⚠️ [PERMISSIONS] Accès refusé: ${req.user.username} (${role}) tente d'accéder à ${route} (permission requise: ${requiredPermission})`);
      return res.status(403).json({ 
        success: false, 
        error: 'Vous n\'avez pas les permissions nécessaires pour accéder à cette ressource' 
      });
    }
  }

  next();
}

