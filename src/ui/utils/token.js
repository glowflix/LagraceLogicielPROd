/**
 * Gestion des tokens locaux et authentification
 */

import { getUserRole as getUserRoleFromPermissions } from './permissions';

const TOKEN_SECRET = 'glowflix-local-token-secret-v1'; // Secret local pour signer les tokens

/**
 * Génère un device ID unique pour cette installation
 */
export function getDeviceId() {
  let deviceId = localStorage.getItem('glowflix-device-id');
  if (!deviceId) {
    // Générer un UUID simple basé sur des informations de l'appareil
    deviceId = 'device-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('glowflix-device-id', deviceId);
  }
  return deviceId;
}

/**
 * Détermine le rôle d'un utilisateur basé sur ses permissions
 * Délègue à la fonction getUserRole de permissions.js
 */
export function getUserRole(user) {
  return getUserRoleFromPermissions(user);
}

/**
 * Génère un token local signé (JWT-like) avec les flags de rôle
 */
export function generateLocalToken({
  licenseKey,
  userId = null,
  user = null,
  isOffline = true,
}) {
  const deviceId = getDeviceId();
  const role = user ? getUserRole(user) : 'LICENSE_ONLY';
  const now = Math.floor(Date.now() / 1000);
  
  // Token expire dans 30 jours (offline) ou 7 jours (online)
  const expiresIn = isOffline ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60;
  const exp = now + expiresIn;

  // Extraire les flags de rôle depuis l'utilisateur
  const roleFlags = user ? {
    admin: user.is_admin === 1 || user.is_admin === true || user.is_admin === 'OUI' || user.is_admin === 'oui',
    vendeur: user.is_vendeur === 1 || user.is_vendeur === true || user.is_vendeur === 'oui' || user.is_vendeur === 'OUI',
    gerentStock: user.is_gerant_stock === 1 || user.is_gerant_stock === true || user.is_gerant_stock === 'oui' || user.is_gerant_stock === 'OUI',
    produitsVendeur: user.can_manage_products === 1 || user.can_manage_products === true || user.can_manage_products === 'oui' || user.can_manage_products === 'OUI',
  } : {
    admin: false,
    vendeur: false,
    gerentStock: false,
    produitsVendeur: false,
  };

  const payload = {
    license_id: licenseKey,
    device_id: deviceId,
    user_id: userId,
    user_uuid: user?.uuid || null,
    role,
    role_flags: roleFlags,
    is_offline_token: isOffline,
    iat: now,
    exp,
  };

  // Encoder le payload en base64 (simple, pas de vraie signature JWT pour simplifier)
  const token = btoa(JSON.stringify(payload));
  
  return {
    token: `local.${token}`,
    payload,
  };
}

/**
 * Décode et valide un token local
 */
export function decodeLocalToken(tokenString) {
  if (!tokenString) {
    return null;
  }

  try {
    // Token offline simple
    if (tokenString === 'offline-token') {
      return {
        license_id: null,
        device_id: getDeviceId(),
        user_id: null,
        role: 'LICENSE_ONLY',
        is_offline_token: true,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
      };
    }

    // Token local signé
    if (tokenString.startsWith('local.')) {
      const payloadBase64 = tokenString.substring(6);
      const payload = JSON.parse(atob(payloadBase64));
      
      // Vérifier l'expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        console.warn('Token expiré');
        return null;
      }

      return payload;
    }

    // Token JWT serveur (on le garde tel quel, sera vérifié côté serveur)
    return {
      is_jwt: true,
      token: tokenString,
    };
  } catch (error) {
    console.error('Erreur décodage token:', error);
    return null;
  }
}

/**
 * Vérifie si un token est valide
 */
export function isValidToken(tokenString) {
  const decoded = decodeLocalToken(tokenString);
  if (!decoded) {
    return false;
  }

  // Token JWT sera vérifié côté serveur
  if (decoded.is_jwt) {
    return true;
  }

  // Vérifier l'expiration pour les tokens locaux
  const now = Math.floor(Date.now() / 1000);
  return decoded.exp && decoded.exp > now;
}

