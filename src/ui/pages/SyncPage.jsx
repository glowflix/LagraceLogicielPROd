import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Wifi, WifiOff, CheckCircle2, XCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

const SyncPage = () => {
  const { isOnline, socketConnected } = useStore();
  const [syncStatus, setSyncStatus] = useState({
    lastPush: null,
    lastPull: null,
    pending: 0,
    errors: 0,
  });
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadSyncStatus();
    const interval = setInterval(loadSyncStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadSyncStatus = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/sync/status`);
      setSyncStatus(response.data);
    } catch (error) {
      console.error('Erreur chargement statut sync:', error);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await axios.post(`${API_URL}/api/sync/push-now`);
      await axios.post(`${API_URL}/api/sync/pull-now`);
      await loadSyncStatus();
    } catch (error) {
      console.error('Erreur synchronisation:', error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Synchronisation</h1>
        <p className="text-gray-400">État de la synchronisation avec Google Sheets</p>
      </div>

      {/* Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-100">État de connexion</h2>
            {isOnline && socketConnected ? (
              <div className="flex items-center gap-2 text-green-400">
                <Wifi className="w-5 h-5" />
                <span>En ligne</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-yellow-400">
                <WifiOff className="w-5 h-5" />
                <span>Hors ligne</span>
              </div>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card"
        >
          <h2 className="text-xl font-bold text-gray-100 mb-4">Dernière synchronisation</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Dernier push:</span>
              <span className="text-gray-200">
                {syncStatus.lastPush
                  ? new Date(syncStatus.lastPush).toLocaleString()
                  : 'Jamais'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Dernier pull:</span>
              <span className="text-gray-200">
                {syncStatus.lastPull
                  ? new Date(syncStatus.lastPull).toLocaleString()
                  : 'Jamais'}
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="card"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-100 mb-2">Synchronisation manuelle</h2>
            <p className="text-sm text-gray-400">
              {syncStatus.pending} opérations en attente
            </p>
          </div>
          <button
            onClick={handleSyncNow}
            disabled={syncing || !isOnline}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {syncing ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <RefreshCw className="w-5 h-5" />
                </motion.div>
                Synchronisation...
              </>
            ) : (
              <>
                <RefreshCw className="w-5 h-5" />
                Synchroniser maintenant
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default SyncPage;

