/**
 * Système de permissions RBAC PRO basé sur les colonnes de "Compter Utilisateur"
 * 
 * Colonnes utilisées :
 * - admi (Admin) : OUI = accès total
 * - Vendeur : OUI = accès ventes + historique
 * - Gerent Stock : OUI = accès produits (stock)
 * - Porudits est Vender : OUI = accès produits + ventes + historique
 * - is_active : OUI = compte actif, NON = compte bloqué
 * 
 * RÈGLES D'ACCÈS:
 * - Admin : Accès à TOUT, peut créer/modifier/bloquer des comptes
 * - Licences (LICENSE_ONLY) : Même accès qu'Admin
 * - Vendeur seulement : Accès uniquement à la page Ventes
 * - Gérant Stock : Accès à Ventes + Produits (peut modifier stock)
 * - Vendeur + Gérant Stock : Accès à Ventes + Produits
 * - Compte bloqué (is_active = false) : Message "Compte bloqué - Contactez La Grâce"
 */

/**
 * Structure des permissions d'un utilisateur
 */
export const PERMISSIONS = {
  // Pages principales
  SALES_POS: 'canAccessSalesPOS',
  SALES_HISTORY: 'canAccessSalesHistory',
  PRODUCTS: 'canAccessProducts',
  USERS: 'canAccessUsers',
  DEBTS: 'canAccessDebts',
  ANALYTICS: 'canAccessAnalytics',
  SETTINGS: 'canAccessSettings',
  SYNC: 'canAccessSync',
  LICENSE: 'canAccessLicense',
  DASHBOARD: 'canAccessDashboard',
  NEW_ARRIVAGE: 'canAccessNewArrivage',
  
  // Actions sur les produits
  MANAGE_PRODUCTS: 'canManageProducts',
  MODIFY_PRODUCT_PRICES: 'canModifyProductPrices',
  MODIFY_PRODUCT_STOCK: 'canModifyProductStock',
  
  // Actions sur les utilisateurs
  MANAGE_USERS: 'canManageUsers',
  MANAGE_USERS_SELF: 'canManageUsersSelf', // ✅ Modifier son propre compte
  MANAGE_USERS_ALL: 'canManageUsersAll',   // ✅ Modifier tous les comptes (ADMIN/OWNER)
  TOGGLE_ADMIN: 'canToggleAdmin',          // ✅ Promouvoir admin (OWNER seulement)
  CREATE_USERS: 'canCreateUsers',
  BLOCK_USERS: 'canBlockUsers',
  
  // Actions système
  MANAGE_SETTINGS: 'canManageSettings',
  MANAGE_SYNC: 'canManageSync',
  MANAGE_LICENSE: 'canManageLicense',
};

/**
 * Définition des permissions par profil utilisateur
 */
export const ROLE_PERMISSIONS = {
  /**
   * BLOCKED - Compte bloqué (is_active = false)
   * Aucun accès - Afficher message "Compte bloqué"
   */
  BLOCKED: {
    [PERMISSIONS.SALES_POS]: false,
    [PERMISSIONS.SALES_HISTORY]: false,
    [PERMISSIONS.PRODUCTS]: false,
    [PERMISSIONS.USERS]: false,
    [PERMISSIONS.DEBTS]: false,
    [PERMISSIONS.ANALYTICS]: false,
    [PERMISSIONS.SETTINGS]: false,
    [PERMISSIONS.SYNC]: false,
    [PERMISSIONS.LICENSE]: false,
    [PERMISSIONS.DASHBOARD]: false,
    [PERMISSIONS.NEW_ARRIVAGE]: false,
    [PERMISSIONS.MANAGE_PRODUCTS]: false,
    [PERMISSIONS.MODIFY_PRODUCT_PRICES]: false,
    [PERMISSIONS.MODIFY_PRODUCT_STOCK]: false,
    [PERMISSIONS.MANAGE_USERS]: false,
    [PERMISSIONS.MANAGE_USERS_SELF]: false,
    [PERMISSIONS.MANAGE_USERS_ALL]: false,
    [PERMISSIONS.TOGGLE_ADMIN]: false,
    [PERMISSIONS.CREATE_USERS]: false,
    [PERMISSIONS.BLOCK_USERS]: false,
    [PERMISSIONS.MANAGE_SETTINGS]: false,
    [PERMISSIONS.MANAGE_SYNC]: false,
    [PERMISSIONS.MANAGE_LICENSE]: false,
  },

  /**
   * ADMIN (admi = OUI)
   * Accès total à toutes les pages et toutes les actions
   */
  ADMIN: {
    [PERMISSIONS.SALES_POS]: true,
    [PERMISSIONS.SALES_HISTORY]: true,
    [PERMISSIONS.PRODUCTS]: true,
    [PERMISSIONS.USERS]: true,
    [PERMISSIONS.DEBTS]: true,
    [PERMISSIONS.ANALYTICS]: true,
    [PERMISSIONS.SETTINGS]: true,
    [PERMISSIONS.SYNC]: true,
    [PERMISSIONS.LICENSE]: true,
    [PERMISSIONS.DASHBOARD]: true,
    [PERMISSIONS.NEW_ARRIVAGE]: true,
    [PERMISSIONS.MANAGE_PRODUCTS]: true,
    [PERMISSIONS.MODIFY_PRODUCT_PRICES]: true,
    [PERMISSIONS.MODIFY_PRODUCT_STOCK]: true,
    [PERMISSIONS.MANAGE_USERS]: true,
    [PERMISSIONS.MANAGE_USERS_SELF]: true,
    [PERMISSIONS.MANAGE_USERS_ALL]: true,
    [PERMISSIONS.TOGGLE_ADMIN]: false, // ✅ Admins ne peuvent pas se donner OWNER
    [PERMISSIONS.CREATE_USERS]: true,
    [PERMISSIONS.BLOCK_USERS]: true,
    [PERMISSIONS.MANAGE_SETTINGS]: true,
    [PERMISSIONS.MANAGE_SYNC]: true,
    [PERMISSIONS.MANAGE_LICENSE]: true,
  },

  /**
   * OWNER (is_owner = true) - ✅ SUPER ADMIN
   * Créateur/Fondateur - Accès total + promotion admin
   */
  OWNER: {
    [PERMISSIONS.SALES_POS]: true,
    [PERMISSIONS.SALES_HISTORY]: true,
    [PERMISSIONS.PRODUCTS]: true,
    [PERMISSIONS.USERS]: true,
    [PERMISSIONS.DEBTS]: true,
    [PERMISSIONS.ANALYTICS]: true,
    [PERMISSIONS.SETTINGS]: true,
    [PERMISSIONS.SYNC]: true,
    [PERMISSIONS.LICENSE]: true,
    [PERMISSIONS.DASHBOARD]: true,
    [PERMISSIONS.NEW_ARRIVAGE]: true,
    [PERMISSIONS.MANAGE_PRODUCTS]: true,
    [PERMISSIONS.MODIFY_PRODUCT_PRICES]: true,
    [PERMISSIONS.MODIFY_PRODUCT_STOCK]: true,
    [PERMISSIONS.MANAGE_USERS]: true,
    [PERMISSIONS.MANAGE_USERS_SELF]: true,
    [PERMISSIONS.MANAGE_USERS_ALL]: true,   // ✅ Peut tout modifier
    [PERMISSIONS.TOGGLE_ADMIN]: true,       // ✅ Peut promouvoir admin
    [PERMISSIONS.CREATE_USERS]: true,
    [PERMISSIONS.BLOCK_USERS]: true,
    [PERMISSIONS.MANAGE_SETTINGS]: true,
    [PERMISSIONS.MANAGE_SYNC]: true,
    [PERMISSIONS.MANAGE_LICENSE]: true,
  },

  /**
   * VENDEUR_SEULEMENT (Vendeur = OUI, Produits = NON, Gerent Stock = NON)
   * Ex: archile
   * Accès : Ventes + Historique uniquement
   */
  VENDEUR_SEULEMENT: {
    [PERMISSIONS.SALES_POS]: true,
    [PERMISSIONS.SALES_HISTORY]: true,
    [PERMISSIONS.PRODUCTS]: false,
    [PERMISSIONS.USERS]: false,
    [PERMISSIONS.DEBTS]: false,
    [PERMISSIONS.ANALYTICS]: false,
    [PERMISSIONS.SETTINGS]: false,
    [PERMISSIONS.SYNC]: false,
    [PERMISSIONS.LICENSE]: false,
    [PERMISSIONS.DASHBOARD]: false, // Pas de dashboard, directement aux ventes
    [PERMISSIONS.NEW_ARRIVAGE]: false,
    [PERMISSIONS.MANAGE_PRODUCTS]: false,
    [PERMISSIONS.MODIFY_PRODUCT_PRICES]: false,
    [PERMISSIONS.MODIFY_PRODUCT_STOCK]: false,
    [PERMISSIONS.MANAGE_USERS]: false,
    [PERMISSIONS.MANAGE_USERS_SELF]: true,   // Peut modifier son propre compte
    [PERMISSIONS.MANAGE_USERS_ALL]: false,   // Ne peut pas modifier les autres
    [PERMISSIONS.TOGGLE_ADMIN]: false,       // Ne peut pas promouvoir admin
    [PERMISSIONS.CREATE_USERS]: false,
    [PERMISSIONS.BLOCK_USERS]: false,
    [PERMISSIONS.MANAGE_SETTINGS]: false,
    [PERMISSIONS.MANAGE_SYNC]: false,
    [PERMISSIONS.MANAGE_LICENSE]: false,
  },

  /**
   * VENDEUR_PRODUITS (Vendeur = OUI + Porudits est Vender = OUI)
   * Accès : Ventes + Historique + Produits
   */
  VENDEUR_PRODUITS: {
    [PERMISSIONS.SALES_POS]: true,
    [PERMISSIONS.SALES_HISTORY]: true,
    [PERMISSIONS.PRODUCTS]: true,
    [PERMISSIONS.USERS]: false,
    [PERMISSIONS.DEBTS]: false,
    [PERMISSIONS.ANALYTICS]: false,
    [PERMISSIONS.SETTINGS]: false,
    [PERMISSIONS.SYNC]: false,
    [PERMISSIONS.LICENSE]: false,
    [PERMISSIONS.DASHBOARD]: true,
    [PERMISSIONS.NEW_ARRIVAGE]: true,
    [PERMISSIONS.MANAGE_PRODUCTS]: true,
    [PERMISSIONS.MODIFY_PRODUCT_PRICES]: true,
    [PERMISSIONS.MODIFY_PRODUCT_STOCK]: true,
    [PERMISSIONS.MANAGE_USERS]: false,
    [PERMISSIONS.MANAGE_USERS_SELF]: true,   // Peut modifier son propre compte
    [PERMISSIONS.MANAGE_USERS_ALL]: false,   // Ne peut pas modifier les autres
    [PERMISSIONS.TOGGLE_ADMIN]: false,       // Ne peut pas promouvoir admin
    [PERMISSIONS.CREATE_USERS]: false,
    [PERMISSIONS.BLOCK_USERS]: false,
    [PERMISSIONS.MANAGE_SETTINGS]: false,
    [PERMISSIONS.MANAGE_SYNC]: false,
    [PERMISSIONS.MANAGE_LICENSE]: false,
  },

  /**
   * GERANT_STOCK (Gerent Stock = OUI, Vendeur = NON)
   * Accès : Produits (stock) + Ventes (lecture) uniquement
   */
  GERANT_STOCK: {
    [PERMISSIONS.SALES_POS]: true, // Peut voir les ventes
    [PERMISSIONS.SALES_HISTORY]: true, // Lecture seule pour voir les ventes
    [PERMISSIONS.PRODUCTS]: true,
    [PERMISSIONS.USERS]: false,
    [PERMISSIONS.DEBTS]: false,
    [PERMISSIONS.ANALYTICS]: false,
    [PERMISSIONS.SETTINGS]: false,
    [PERMISSIONS.SYNC]: false,
    [PERMISSIONS.LICENSE]: false,
    [PERMISSIONS.DASHBOARD]: true,
    [PERMISSIONS.NEW_ARRIVAGE]: true,
    [PERMISSIONS.MANAGE_PRODUCTS]: true,
    [PERMISSIONS.MODIFY_PRODUCT_PRICES]: false, // Ne peut pas modifier les prix
    [PERMISSIONS.MODIFY_PRODUCT_STOCK]: true,
    [PERMISSIONS.MANAGE_USERS]: false,
    [PERMISSIONS.MANAGE_USERS_SELF]: true,   // Peut modifier son propre compte
    [PERMISSIONS.MANAGE_USERS_ALL]: false,   // Ne peut pas modifier les autres
    [PERMISSIONS.TOGGLE_ADMIN]: false,       // Ne peut pas promouvoir admin
    [PERMISSIONS.CREATE_USERS]: false,
    [PERMISSIONS.BLOCK_USERS]: false,
    [PERMISSIONS.MANAGE_SETTINGS]: false,
    [PERMISSIONS.MANAGE_SYNC]: false,
    [PERMISSIONS.MANAGE_LICENSE]: false,
  },

  /**
   * VENDEUR_STOCK (Vendeur = OUI + Gerent Stock = OUI)
   * Ex: Frank
   * Accès : Ventes + Historique + Produits (mais pas Users ni Admin)
   */
  VENDEUR_STOCK: {
    [PERMISSIONS.SALES_POS]: true,
    [PERMISSIONS.SALES_HISTORY]: true,
    [PERMISSIONS.PRODUCTS]: true,
    [PERMISSIONS.USERS]: false,
    [PERMISSIONS.DEBTS]: false,
    [PERMISSIONS.ANALYTICS]: false,
    [PERMISSIONS.SETTINGS]: false,
    [PERMISSIONS.SYNC]: false,
    [PERMISSIONS.LICENSE]: false,
    [PERMISSIONS.DASHBOARD]: true,
    [PERMISSIONS.NEW_ARRIVAGE]: true,
    [PERMISSIONS.MANAGE_PRODUCTS]: true,
    [PERMISSIONS.MODIFY_PRODUCT_PRICES]: true,
    [PERMISSIONS.MODIFY_PRODUCT_STOCK]: true,
    [PERMISSIONS.MANAGE_USERS]: false,
    [PERMISSIONS.MANAGE_USERS_SELF]: true,   // Peut modifier son propre compte
    [PERMISSIONS.MANAGE_USERS_ALL]: false,   // Ne peut pas modifier les autres
    [PERMISSIONS.TOGGLE_ADMIN]: false,       // Ne peut pas promouvoir admin
    [PERMISSIONS.CREATE_USERS]: false,
    [PERMISSIONS.BLOCK_USERS]: false,
    [PERMISSIONS.MANAGE_SETTINGS]: false,
    [PERMISSIONS.MANAGE_SYNC]: false,
    [PERMISSIONS.MANAGE_LICENSE]: false,
  },

  /**
   * PRODUITS_SEULEMENT (Porudits est Vender = OUI, Vendeur = NON)
   * Accès : Produits uniquement
   */
  PRODUITS_SEULEMENT: {
    [PERMISSIONS.SALES_POS]: false,
    [PERMISSIONS.SALES_HISTORY]: false,
    [PERMISSIONS.PRODUCTS]: true,
    [PERMISSIONS.USERS]: false,
    [PERMISSIONS.DEBTS]: false,
    [PERMISSIONS.ANALYTICS]: false,
    [PERMISSIONS.SETTINGS]: false,
    [PERMISSIONS.SYNC]: false,
    [PERMISSIONS.LICENSE]: false,
    [PERMISSIONS.DASHBOARD]: true,
    [PERMISSIONS.NEW_ARRIVAGE]: true,
    [PERMISSIONS.MANAGE_PRODUCTS]: true,
    [PERMISSIONS.MODIFY_PRODUCT_PRICES]: true,
    [PERMISSIONS.MODIFY_PRODUCT_STOCK]: true,
    [PERMISSIONS.MANAGE_USERS]: false,
    [PERMISSIONS.MANAGE_USERS_SELF]: true,   // Peut modifier son propre compte
    [PERMISSIONS.MANAGE_USERS_ALL]: false,   // Ne peut pas modifier les autres
    [PERMISSIONS.TOGGLE_ADMIN]: false,       // Ne peut pas promouvoir admin
    [PERMISSIONS.CREATE_USERS]: false,
    [PERMISSIONS.BLOCK_USERS]: false,
    [PERMISSIONS.MANAGE_SETTINGS]: false,
    [PERMISSIONS.MANAGE_SYNC]: false,
    [PERMISSIONS.MANAGE_LICENSE]: false,
  },

  /**
   * LICENSE_ONLY (Licence activée mais pas de login)
   * Accès total comme ADMIN - La licence PRO donne tous les droits
   */
  LICENSE_ONLY: {
    [PERMISSIONS.SALES_POS]: true,
    [PERMISSIONS.SALES_HISTORY]: true,
    [PERMISSIONS.PRODUCTS]: true,
    [PERMISSIONS.USERS]: true, // Licence PRO = accès total
    [PERMISSIONS.DEBTS]: true,
    [PERMISSIONS.ANALYTICS]: true,
    [PERMISSIONS.SETTINGS]: true,
    [PERMISSIONS.SYNC]: true,
    [PERMISSIONS.LICENSE]: true,
    [PERMISSIONS.DASHBOARD]: true,
    [PERMISSIONS.NEW_ARRIVAGE]: true,
    [PERMISSIONS.MANAGE_PRODUCTS]: true,
    [PERMISSIONS.MODIFY_PRODUCT_PRICES]: true,
    [PERMISSIONS.MODIFY_PRODUCT_STOCK]: true,
    [PERMISSIONS.MANAGE_USERS]: true, // Licence PRO = accès total
    [PERMISSIONS.MANAGE_USERS_SELF]: true,   // Peut modifier son propre compte
    [PERMISSIONS.MANAGE_USERS_ALL]: true,    // Peut modifier tous les comptes
    [PERMISSIONS.TOGGLE_ADMIN]: false,       // Mais ne peut pas promouvoir admin
    [PERMISSIONS.CREATE_USERS]: true,
    [PERMISSIONS.BLOCK_USERS]: true,
    [PERMISSIONS.MANAGE_SETTINGS]: true,
    [PERMISSIONS.MANAGE_SYNC]: true,
    [PERMISSIONS.MANAGE_LICENSE]: true,
  },
};

/**
 * Mapping des routes vers les permissions requises
 */
export const ROUTE_PERMISSIONS = {
  '/dashboard': PERMISSIONS.DASHBOARD,
  '/sales': PERMISSIONS.SALES_POS,
  '/sales/history': PERMISSIONS.SALES_HISTORY,
  '/products': PERMISSIONS.PRODUCTS,
  '/users': PERMISSIONS.USERS,
  '/profile': PERMISSIONS.DASHBOARD, // Tous peuvent accéder à leur profil
  '/debts': PERMISSIONS.DEBTS,
  '/analytics': PERMISSIONS.ANALYTICS,
  '/settings': PERMISSIONS.SETTINGS,
  '/sync': PERMISSIONS.SYNC,
  '/license': PERMISSIONS.LICENSE,
  '/newarrivage': PERMISSIONS.NEW_ARRIVAGE,
};

/**
 * Vérifie si un utilisateur est actif
 * @param {Object} user - Objet utilisateur
 * @returns {boolean} true si l'utilisateur est actif
 */
export function isUserActive(user) {
  if (!user) return true; // Pas d'utilisateur = licence seulement = actif
  const isActive = user.is_active;
  return isActive === 1 || isActive === true || isActive === 'OUI' || isActive === 'oui' || isActive === '1';
}

/**
 * Vérifie si un utilisateur est admin
 * @param {Object} user - Objet utilisateur
 * @returns {boolean} true si l'utilisateur est admin
 */
export function isUserAdmin(user) {
  if (!user) return false;
  const admin = user.is_admin;
  return admin === 1 || admin === true || admin === 'OUI' || admin === 'oui' || admin === '1';
}

/**
 * Détermine le rôle d'un utilisateur basé sur ses flags de la table "Compter Utilisateur"
 * 
 * @param {Object} user - Objet utilisateur avec les flags : is_admin, is_vendeur, is_gerant_stock, can_manage_products, is_active, is_owner
 * @returns {string} Le rôle déterminé
 */
export function getUserRole(user) {
  if (!user) {
    return 'LICENSE_ONLY';
  }

  // 0. Vérifier si le compte est bloqué (is_active = false)
  if (!isUserActive(user)) {
    return 'BLOCKED';
  }

  // 0.5. Owner = accès total + gestion des permissions
  const isOwner = user.is_owner === 1 || user.is_owner === true || user.is_owner === 'oui' || user.is_owner === 'OUI';
  if (isOwner) {
    return 'OWNER';
  }

  // 1. Admin = accès total
  if (isUserAdmin(user)) {
    return 'ADMIN';
  }

  const isVendeur = user.is_vendeur === 1 || user.is_vendeur === true || user.is_vendeur === 'oui' || user.is_vendeur === 'OUI';
  const isGerentStock = user.is_gerant_stock === 1 || user.is_gerant_stock === true || user.is_gerant_stock === 'oui' || user.is_gerant_stock === 'OUI';
  const canManageProducts = user.can_manage_products === 1 || user.can_manage_products === true || user.can_manage_products === 'oui' || user.can_manage_products === 'OUI';

  // 2. Vendeur + Gerent Stock = VENDEUR_STOCK (ex: Frank)
  if (isVendeur && isGerentStock) {
    return 'VENDEUR_STOCK';
  }

  // 3. Vendeur + Produits = VENDEUR_PRODUITS
  if (isVendeur && canManageProducts) {
    return 'VENDEUR_PRODUITS';
  }

  // 4. Vendeur seulement = VENDEUR_SEULEMENT (ex: archile)
  if (isVendeur) {
    return 'VENDEUR_SEULEMENT';
  }

  // 5. Gerent Stock seulement = GERANT_STOCK
  if (isGerentStock) {
    return 'GERANT_STOCK';
  }

  // 6. Produits seulement = PRODUITS_SEULEMENT
  if (canManageProducts) {
    return 'PRODUITS_SEULEMENT';
  }

  // 7. Par défaut = LICENSE_ONLY
  return 'LICENSE_ONLY';
}

/**
 * Détermine la route de redirection selon le rôle de l'utilisateur
 * @param {string} role - Le rôle de l'utilisateur
 * @returns {string} La route vers laquelle rediriger
 */
export function getDefaultRouteForRole(role) {
  switch (role) {
    case 'BLOCKED':
      return '/blocked'; // Page compte bloqué
    case 'ADMIN':
    case 'LICENSE_ONLY':
      return '/dashboard'; // Admin et Licence -> Dashboard
    case 'VENDEUR_SEULEMENT':
      return '/sales'; // Vendeur seulement -> Ventes directement
    case 'GERANT_STOCK':
      return '/products'; // Gérant stock -> Produits directement
    case 'VENDEUR_STOCK':
    case 'VENDEUR_PRODUITS':
      return '/sales'; // Vendeur + Stock -> Ventes (peut accéder aux 2)
    case 'PRODUITS_SEULEMENT':
      return '/products'; // Produits seulement -> Produits
    default:
      return '/sales'; // Par défaut -> Ventes
  }
}

/**
 * Obtient le nom du vendeur à utiliser pour les ventes
 * @param {Object} user - Objet utilisateur
 * @returns {string} Le nom du vendeur
 */
export function getSellerName(user) {
  if (!user) {
    return 'Admin'; // Pas d'utilisateur connecté = licence seule = Admin
  }
  
  // Si c'est un admin, utiliser "Admin"
  if (isUserAdmin(user)) {
    return 'Admin';
  }
  
  // Sinon, utiliser le username de l'utilisateur connecté
  return user.username || user.name || 'Vendeur';
}

/**
 * Vérifie si un rôle a accès à une route
 * 
 * @param {string} role - Le rôle de l'utilisateur
 * @param {string} pathname - Le chemin de la route
 * @returns {boolean} true si l'accès est autorisé
 */
export function canAccessRoute(role, pathname) {
  if (!role || !ROLE_PERMISSIONS[role]) {
    return false;
  }

  const permissions = ROLE_PERMISSIONS[role];

  // Vérifier chaque route
  for (const [route, requiredPermission] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname.startsWith(route)) {
      return permissions[requiredPermission] === true;
    }
  }

  // Routes publiques toujours autorisées
  if (pathname === '/login' || pathname === '/license' || pathname === '/unauthorized') {
    return true;
  }

  // Par défaut, refuser pour les routes inconnues (sécurité)
  return false;
}

/**
 * Vérifie si un rôle a une permission spécifique
 * 
 * @param {string} role - Le rôle de l'utilisateur
 * @param {string} permission - La permission à vérifier
 * @returns {boolean} true si la permission est accordée
 */
export function hasPermission(role, permission) {
  if (!role || !ROLE_PERMISSIONS[role]) {
    return false;
  }

  return ROLE_PERMISSIONS[role][permission] === true;
}

/**
 * Obtient toutes les permissions d'un rôle
 * 
 * @param {string} role - Le rôle de l'utilisateur
 * @returns {Object} Toutes les permissions du rôle
 */
export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.LICENSE_ONLY;
}

/**
 * Obtient les permissions d'un utilisateur directement depuis son objet user
 * 
 * @param {Object} user - Objet utilisateur avec les flags
 * @param {boolean} isLicensed - Si la licence est activée
 * @returns {Object} Toutes les permissions de l'utilisateur
 */
export function getUserPermissions(user, isLicensed = false) {
  const role = getUserRole(user, isLicensed);
  return getRolePermissions(role);
}
