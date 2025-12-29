/**
 * Règles de quantité strictes pour les ventes
 * OFFLINE-FIRST : Validation locale immédiate
 */

/**
 * Normalise l'unité vers un format canonique
 * @param {string} unit - Unité brute (peut être "Carton", "CARTON", "box", etc.)
 * @returns {string} - Unité normalisée: "carton" | "milliers" | "piece"
 */
export function normalizeUnit(unit) {
  if (!unit || typeof unit !== 'string') return null;
  
  const normalized = String(unit).trim().toLowerCase();
  
  // Mapping exhaustif
  if (normalized === 'carton' || normalized === 'cartons' || normalized === 'ctn' || normalized === 'cart' || normalized === 'box') {
    return 'carton';
  }
  if (normalized === 'millier' || normalized === 'milliers' || normalized === 'mille' || normalized === 'det' || normalized === 'detail') {
    return 'milliers';
  }
  if (normalized === 'piece' || normalized === 'pièce' || normalized === 'pieces' || normalized === 'pièces' || normalized === 'pc' || normalized === 'pcs' || normalized === 'pce') {
    return 'piece';
  }
  
  // Si déjà en format canonique, retourner tel quel
  if (['carton', 'milliers', 'piece'].includes(normalized)) {
    return normalized;
  }
  
  return null;
}

/**
 * Normalise le MARK avec tolérance DZ
 * @param {string} mark - MARK brut
 * @returns {string} - MARK normalisé (DZ si douzaine, sinon uppercase)
 */
export function normalizeMark(mark) {
  if (!mark || typeof mark !== 'string') return '';
  
  const trimmed = String(mark).trim();
  if (!trimmed) return '';
  
  const normalized = trimmed.toLowerCase();
  
  // Détection douzaine (tolérance large)
  if (
    normalized === 'dz' ||
    normalized === 'dzn' ||
    normalized === 'douz' ||
    normalized === 'douzain' ||
    normalized === 'douzaine' ||
    normalized === 'dizaine' ||
    normalized === 'dozen'
  ) {
    return 'DZ';
  }
  
  // Sinon, uppercase
  return trimmed.toUpperCase();
}

/**
 * Calcule la politique de quantité pour une ligne
 * @param {string} unit - Unité normalisée ("carton" | "milliers" | "piece")
 * @param {string} markNorm - MARK normalisé
 * @returns {object} - { allowDecimal, minQty, step, integerOnly }
 */
export function getQtyPolicy(unit, markNorm) {
  const unitNorm = normalizeUnit(unit);
  const mark = normalizeMark(markNorm || '');
  
  // A) Unité = carton → décimal autorisé
  if (unitNorm === 'carton') {
    return {
      allowDecimal: true,
      minQty: 0.01,
      step: 0.25,
      integerOnly: false,
    };
  }
  
  // B) Unité = milliers
  if (unitNorm === 'milliers') {
    // Si markNorm = DZ → décimal autorisé
    if (mark === 'DZ') {
      return {
        allowDecimal: true,
        minQty: 0.01,
        step: 0.25,
        integerOnly: false,
      };
    }
    // Sinon (PAQUE/BT/PQT/JUTE/etc.) → décimal interdit, entier obligatoire, min = 1
    return {
      allowDecimal: false,
      minQty: 1,
      step: 1,
      integerOnly: true,
    };
  }
  
  // C) Unité = piece → décimal interdit, entier ≥ 1
  if (unitNorm === 'piece') {
    return {
      allowDecimal: false,
      minQty: 1,
      step: 1,
      integerOnly: true,
    };
  }
  
  // Par défaut (si unit non reconnue) → sécurisé (entier min 1)
  return {
    allowDecimal: false,
    minQty: 1,
    step: 1,
    integerOnly: true,
  };
}

/**
 * Valide et corrige une quantité selon la politique
 * @param {number} qty - Quantité brute
 * @param {object} policy - Politique de quantité (retour de getQtyPolicy)
 * @returns {number} - Quantité corrigée
 */
export function validateAndCorrectQty(qty, policy) {
  if (!policy) {
    return Math.max(1, Number(qty) || 1);
  }
  
  let corrected = Number(qty) || 0;
  
  // Si entier obligatoire et valeur décimale → arrondir vers le haut
  if (policy.integerOnly && !Number.isInteger(corrected)) {
    corrected = Math.ceil(corrected);
  }
  
  // Appliquer le minimum
  if (corrected < policy.minQty) {
    corrected = policy.minQty;
  }
  
  // Arrondir selon le step si nécessaire
  if (policy.step && policy.step !== 1) {
    corrected = Math.round(corrected / policy.step) * policy.step;
    // S'assurer qu'on ne descend pas en dessous du min après arrondi
    if (corrected < policy.minQty) {
      corrected = policy.minQty;
    }
  }
  
  return corrected;
}

/**
 * Valide une quantité côté backend (règles strictes)
 * @param {number} qty - Quantité
 * @param {string} unit - Unité normalisée
 * @param {string} markNorm - MARK normalisé
 * @returns {object} - { valid: boolean, error?: string, corrected?: number }
 */
export function validateQtyBackend(qty, unit, markNorm) {
  const unitNorm = normalizeUnit(unit);
  const mark = normalizeMark(markNorm || '');
  
  if (!unitNorm) {
    return { valid: false, error: 'Unité non reconnue' };
  }
  
  const numQty = Number(qty);
  if (isNaN(numQty) || numQty <= 0) {
    return { valid: false, error: 'Quantité doit être > 0' };
  }
  
  // Règle: milliers + non-DZ → entier obligatoire
  if (unitNorm === 'milliers' && mark !== 'DZ') {
    if (!Number.isInteger(numQty)) {
      return { valid: false, error: 'Quantité doit être entière pour milliers (non-DZ)', corrected: Math.ceil(numQty) };
    }
    if (numQty < 1) {
      return { valid: false, error: 'Quantité minimum = 1 pour milliers (non-DZ)', corrected: 1 };
    }
  }
  
  // Règle: piece → entier obligatoire
  if (unitNorm === 'piece') {
    if (!Number.isInteger(numQty)) {
      return { valid: false, error: 'Quantité doit être entière pour pièce', corrected: Math.ceil(numQty) };
    }
    if (numQty < 1) {
      return { valid: false, error: 'Quantité minimum = 1 pour pièce', corrected: 1 };
    }
  }
  
  // Règle: carton → décimal autorisé mais > 0
  if (unitNorm === 'carton' && numQty <= 0) {
    return { valid: false, error: 'Quantité doit être > 0 pour carton', corrected: 0.01 };
  }
  
  return { valid: true };
}

