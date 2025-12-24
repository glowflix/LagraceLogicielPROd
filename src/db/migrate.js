import { initSchema, getDb } from './sqlite.js';
import { logger } from '../core/logger.js';

/**
 * Script de migration de la base de données
 */
async function migrate() {
  try {
    logger.info('Démarrage des migrations...');
    
    // Initialiser le schéma
    initSchema();
    
    logger.info('✅ Migrations terminées avec succès');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Erreur lors des migrations:', error);
    process.exit(1);
  }
}

migrate();

