/**
 * Génère un numéro de facture professionnel basé sur la date locale
 * Format: INV-YYYYMMDD-XXX (ex: INV-20251225-001)
 */
export function generateInvoiceNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;
  
  // Générer un numéro séquentiel pour la journée (001, 002, ...)
  // On utilise un timestamp pour garantir l'unicité, mais on peut aussi utiliser un compteur
  const timestamp = Date.now();
  const sequence = String(timestamp % 1000).padStart(3, '0');
  
  return `INV-${datePrefix}-${sequence}`;
}

/**
 * Génère un numéro de facture avec un compteur séquentiel basé sur la date
 * Nécessite une connexion à la base de données pour obtenir le dernier numéro
 */
export function generateSequentialInvoiceNumber(db) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;
  
  // Récupérer le dernier numéro de facture du jour
  const lastInvoice = db.prepare(`
    SELECT invoice_number 
    FROM sales 
    WHERE invoice_number LIKE ?
    ORDER BY invoice_number DESC 
    LIMIT 1
  `).get(`INV-${datePrefix}-%`);
  
  let sequence = 1;
  if (lastInvoice) {
    const lastSeq = parseInt(lastInvoice.invoice_number.split('-')[2] || '0');
    sequence = lastSeq + 1;
  }
  
  return `INV-${datePrefix}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Génère un numéro de facture au format YYYYMMDDHHmmss (heure locale PC)
 * Format utilisé pour la synchronisation avec Google Sheets
 */
export function generateTimestampInvoiceNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

