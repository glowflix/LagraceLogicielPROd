import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../core/logger.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * GET /api/license/check-file
 * Lit le fichier linkcodeelagrace.Jeariss depuis C:\Users\Jeariss Director\Documents\CDMjrs\lcs
 * et valide la licence
 */
router.get('/check-file', (req, res) => {
  try {
    // Chemin vers le fichier linkcodeelagrace.Jeariss dans le dossier Documents de l'utilisateur
    const userDocumentsPath = 'C:\\Users\\Jeariss Director\\Documents\\CDMjrs\\lcs';
    const licenseFilePath = path.join(userDocumentsPath, 'linkcodeelagrace.Jeariss');
    
    logger.info(`🔍 [LICENSE] Recherche du fichier de licence: ${licenseFilePath}`);
    
    // Vérifier si le fichier existe
    if (!fs.existsSync(licenseFilePath)) {
      logger.warn(`⚠️ [LICENSE] Fichier de licence non trouvé: ${licenseFilePath}`);
      return res.json({
        success: false,
        found: false,
        error: 'Fichier de licence non trouvé',
        path: licenseFilePath,
      });
    }
    
    // Lire le contenu du fichier
    const fileContent = fs.readFileSync(licenseFilePath, 'utf-8').trim();
    
    logger.info(`📄 [LICENSE] Contenu du fichier lu: ${fileContent.substring(0, 3)}*** (${fileContent.length} caractères)`);
    
    // Valider que le contenu correspond exactement à "987654321"
    const validLicenseKey = '987654321';
    const isValid = fileContent === validLicenseKey;
    
    if (isValid) {
      logger.info(`✅ [LICENSE] Licence valide détectée depuis le fichier`);
      return res.json({
        success: true,
        found: true,
        valid: true,
        licenseKey: validLicenseKey, // Retourner la clé pour l'activation
        path: licenseFilePath,
      });
    } else {
      logger.warn(`❌ [LICENSE] Licence invalide: contenu du fichier ne correspond pas à "${validLicenseKey}"`);
      logger.warn(`   Contenu actuel: "${fileContent}"`);
      return res.json({
        success: false,
        found: true,
        valid: false,
        error: 'Licence non valide',
        path: licenseFilePath,
      });
    }
  } catch (error) {
    logger.error(`❌ [LICENSE] Erreur lors de la lecture du fichier de licence:`, error);
    return res.status(500).json({
      success: false,
      found: false,
      error: error.message,
    });
  }
});

export default router;

