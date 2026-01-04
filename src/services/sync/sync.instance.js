import { SyncWorker } from './sync.worker.js';

/**
 * Singleton instance du SyncWorker
 * Utilisé par les routes Express et autres services
 */
export const syncWorker = new SyncWorker();
