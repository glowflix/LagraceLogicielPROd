import { randomUUID } from 'crypto';

/**
 * Génère un UUID v4 professionnel
 */
export function generateUUID() {
  return randomUUID();
}

/**
 * Génère un ID court (pour affichage)
 */
export function generateShortId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

