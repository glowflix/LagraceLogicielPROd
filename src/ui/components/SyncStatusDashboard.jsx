import { useState, useEffect, memo, useCallback } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Wifi,
  WifiOff,
  Clock,
  Upload,
  Download,
  Activity,
  ChevronDown,
  ChevronUp,
  X,
  Pause,
  Play,
  RotateCcw,
  Database,
  Server,
  Zap,
} from 'lucide-react';
import { useConnectionState } from '../store/selectors';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SYNC STATUS DASHBOARD - PRO LOCAL-FIRST
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Architecture de connexion LOCAL-FIRST:
 * 
 * 1. 🗄️ Backend Local (SQLite) - PRIORITÉ #1
 *    - Toujours accessible sur le réseau local (LAN/Wi-Fi)
 *    - L'application fonctionne 100% même sans Internet
 *    - Détecté via /api/health
 * 
 * 2. 🔌 WebSocket LAN - PRIORITÉ #2
 *    - Sync temps réel entre tous les PC/téléphones du réseau
 *    - Mises à jour instantanées du stock/ventes
 * 
 * 3. ☁️ Google Sheets - OPTIONNEL
 *    - Sync externe pour backup et accès distant
 *    - Ne bloque JAMAIS l'application locale
 * 
 * Affiche:
 * - État du backend local (SQL)
 * - Latence du réseau LAN
 * - État du WebSocket
 * - État de Google Sheets (optionnel)
 * - Queue de synchronisation
 */

// États possibles de la sync
const SyncState = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  PAUSED: 'paused',
  ERROR: 'error',
  OFFLINE: 'offline',
};

// Couleurs par état
const stateColors = {
  [SyncState.IDLE]: 'text-green-500',
  [SyncState.SYNCING]: 'text-blue-500',
  [SyncState.PAUSED]: 'text-yellow-500',
  [SyncState.ERROR]: 'text-red-500',
  [SyncState.OFFLINE]: 'text-gray-500',
};

const stateBgColors = {
  [SyncState.IDLE]: 'bg-green-500/10',
  [SyncState.SYNCING]: 'bg-blue-500/10',
  [SyncState.PAUSED]: 'bg-yellow-500/10',
  [SyncState.ERROR]: 'bg-red-500/10',
  [SyncState.OFFLINE]: 'bg-gray-500/10',
};

const stateIcons = {
  [SyncState.IDLE]: CheckCircle,
  [SyncState.SYNCING]: RefreshCw,
  [SyncState.PAUSED]: Pause,
  [SyncState.ERROR]: AlertCircle,
  [SyncState.OFFLINE]: CloudOff,
};

/**
 * Formater une date relative
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Jamais';
  
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 5000) return 'À l\'instant';
  if (diff < 60000) return `Il y a ${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `Il y a ${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `Il y a ${Math.floor(diff / 3600000)}h`;
  
  return new Date(timestamp).toLocaleDateString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Badge de statut compact
 */
const SyncStatusBadge = memo(({ state, onClick, mini = false }) => {
  const Icon = stateIcons[state] || Cloud;
  const colorClass = stateColors[state] || 'text-gray-500';
  const bgClass = stateBgColors[state] || 'bg-gray-500/10';
  
  const labels = {
    [SyncState.IDLE]: 'Synchronisé',
    [SyncState.SYNCING]: 'Sync...',
    [SyncState.PAUSED]: 'En pause',
    [SyncState.ERROR]: 'Erreur',
    [SyncState.OFFLINE]: 'Hors ligne',
  };
  
  if (mini) {
    return (
      <button
        onClick={onClick}
        className={`p-1.5 rounded-full ${bgClass} ${colorClass} transition-all hover:scale-110`}
        title={labels[state]}
      >
        <Icon 
          size={16} 
          className={state === SyncState.SYNCING ? 'animate-spin' : ''} 
        />
      </button>
    );
  }
  
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${bgClass} ${colorClass} transition-all hover:opacity-80`}
    >
      <Icon 
        size={14} 
        className={state === SyncState.SYNCING ? 'animate-spin' : ''} 
      />
      <span className="text-xs font-medium">{labels[state]}</span>
    </button>
  );
});

SyncStatusBadge.displayName = 'SyncStatusBadge';

/**
 * Panneau de détails de la sync
 */
const SyncDetailsPanel = memo(({
  isOpen,
  onClose,
  stats,
  onPause,
  onResume,
  onRetry,
  onClear,
}) => {
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <m.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="absolute top-full right-0 mt-2 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Activity size={16} />
            Synchronisation
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 transition-colors"
          >
            <X size={16} className="text-gray-400" />
          </button>
        </div>
        
        {/* État connexion PRO LOCAL-FIRST */}
        <div className="px-4 py-3 border-b border-gray-800 space-y-2">
          <div className="text-sm text-gray-400 mb-2">Connexions</div>
          
          {/* Backend Local (SQL) - Le plus important */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={14} className="text-gray-500" />
              <span className="text-xs text-gray-400">Backend Local</span>
            </div>
            <div className="flex items-center gap-2">
              {stats.backendConnected ? (
                <>
                  <CheckCircle size={14} className="text-green-500" />
                  <span className="text-xs text-green-500">
                    Connecté {stats.backendLatency ? `(${stats.backendLatency}ms)` : ''}
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle size={14} className="text-red-500" />
                  <span className="text-xs text-red-500">Déconnecté</span>
                </>
              )}
            </div>
          </div>
          
          {/* WebSocket LAN */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-gray-500" />
              <span className="text-xs text-gray-400">WebSocket LAN</span>
            </div>
            <div className="flex items-center gap-2">
              {stats.socketConnected ? (
                <>
                  <CheckCircle size={14} className="text-green-500" />
                  <span className="text-xs text-green-500">Temps réel</span>
                </>
              ) : (
                <>
                  <AlertCircle size={14} className="text-yellow-500" />
                  <span className="text-xs text-yellow-500">Polling</span>
                </>
              )}
            </div>
          </div>
          
          {/* Google Sheets (optionnel) */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud size={14} className="text-gray-500" />
              <span className="text-xs text-gray-400">Google Sheets</span>
            </div>
            <div className="flex items-center gap-2">
              {stats.sheetsConnected === null ? (
                <>
                  <Clock size={14} className="text-gray-500" />
                  <span className="text-xs text-gray-500">Pas testé</span>
                </>
              ) : stats.sheetsConnected ? (
                <>
                  <CheckCircle size={14} className="text-blue-500" />
                  <span className="text-xs text-blue-500">Sync activée</span>
                </>
              ) : (
                <>
                  <CloudOff size={14} className="text-gray-500" />
                  <span className="text-xs text-gray-500">Non connecté</span>
                </>
              )}
            </div>
          </div>
          
          {/* Indicateur global */}
          <div className="mt-2 pt-2 border-t border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-300">État global</span>
              {stats.backendConnected ? (
                <span className="text-xs font-medium text-green-400 flex items-center gap-1">
                  <CheckCircle size={12} />
                  Opérationnel
                </span>
              ) : (
                <span className="text-xs font-medium text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} />
                  Backend requis
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Queue */}
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="text-sm text-gray-400 mb-2">File d'attente</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-800 rounded p-2">
              <div className="flex items-center gap-1 text-blue-400">
                <Upload size={12} />
                <span className="text-xs">Push</span>
              </div>
              <div className="text-lg font-bold text-white">
                {stats.pushPending || 0}
              </div>
            </div>
            <div className="bg-gray-800 rounded p-2">
              <div className="flex items-center gap-1 text-purple-400">
                <Download size={12} />
                <span className="text-xs">Pull</span>
              </div>
              <div className="text-lg font-bold text-white">
                {stats.pullPending || 0}
              </div>
            </div>
          </div>
          
          {/* Détails par type */}
          {stats.queuedByPriority && (
            <div className="mt-2 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>Critique:</span>
                <span>{stats.queuedByPriority.critical || 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Haute:</span>
                <span>{stats.queuedByPriority.high || 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Normale:</span>
                <span>{stats.queuedByPriority.normal || 0}</span>
              </div>
            </div>
          )}
        </div>
        
        {/* Statistiques */}
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="text-sm text-gray-400 mb-2">Statistiques</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-gray-300">
              <span>Traités:</span>
              <span className="text-green-400">{stats.totalProcessed || 0}</span>
            </div>
            <div className="flex justify-between text-gray-300">
              <span>Échoués:</span>
              <span className="text-red-400">{stats.totalFailed || 0}</span>
            </div>
            <div className="flex justify-between text-gray-300">
              <span>Coalescés:</span>
              <span className="text-blue-400">{stats.totalCoalesced || 0}</span>
            </div>
          </div>
        </div>
        
        {/* Dernière sync */}
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-xs">
            <Clock size={12} className="text-gray-500" />
            <span className="text-gray-400">Dernière sync:</span>
            <span className="text-gray-300">
              {formatRelativeTime(stats.lastProcessedAt)}
            </span>
          </div>
          
          {stats.lastError && (
            <div className="mt-2 p-2 bg-red-500/10 rounded text-xs text-red-400">
              <div className="font-medium">Dernière erreur:</div>
              <div className="truncate">{stats.lastError}</div>
            </div>
          )}
        </div>
        
        {/* Actions */}
        <div className="px-4 py-3 flex gap-2">
          {stats.state === SyncState.PAUSED ? (
            <button
              onClick={onResume}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium text-white transition-colors"
            >
              <Play size={14} />
              Reprendre
            </button>
          ) : (
            <button
              onClick={onPause}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-sm font-medium text-white transition-colors"
            >
              <Pause size={14} />
              Pause
            </button>
          )}
          
          <button
            onClick={onRetry}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium text-white transition-colors"
            title="Forcer la synchronisation"
          >
            <RotateCcw size={14} />
          </button>
          
          {(stats.totalFailed || 0) > 0 && (
            <button
              onClick={onClear}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium text-white transition-colors"
              title="Effacer les erreurs"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </m.div>
    </AnimatePresence>
  );
});

SyncDetailsPanel.displayName = 'SyncDetailsPanel';

/**
 * Composant principal SyncStatusDashboard
 */
const SyncStatusDashboard = memo(({
  mini = true,
  position = 'top-right',
  onSyncRequested,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Utiliser le store pour l'état de connexion PRO LOCAL-FIRST
  const connectionState = useConnectionState();
  
  const [stats, setStats] = useState({
    state: SyncState.IDLE,
    isOnline: true,
    backendConnected: false,
    backendLatency: null,
    socketConnected: false,
    sheetsConnected: null,
    pushPending: 0,
    pullPending: 0,
    totalProcessed: 0,
    totalFailed: 0,
    totalCoalesced: 0,
    lastProcessedAt: null,
    lastError: null,
    queuedByPriority: {},
  });
  
  // Synchroniser l'état du store avec les stats locales
  useEffect(() => {
    setStats((prev) => ({
      ...prev,
      isOnline: connectionState.isOnline,
      backendConnected: connectionState.backendConnected,
      backendLatency: connectionState.backendLatency,
      socketConnected: connectionState.socketConnected,
      sheetsConnected: connectionState.sheetsConnected,
    }));
  }, [connectionState]);
  
  // Charger les stats de sync depuis le backend
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/sync/status');
        if (response.ok) {
          const data = await response.json();
          setStats((prev) => ({
            ...prev,
            pushPending: data.pushPending || data.pending || 0,
            pullPending: data.pullPending || 0,
            totalProcessed: data.totalProcessed || 0,
            totalFailed: data.totalFailed || data.errors || 0,
            totalCoalesced: data.totalCoalesced || 0,
            lastProcessedAt: data.lastProcessedAt || data.lastSync || null,
            lastError: data.lastError || null,
            queuedByPriority: data.queuedByPriority || {},
          }));
        }
      } catch (error) {
        // Ne pas logger l'erreur si le backend n'est pas connecté
        if (connectionState.backendConnected) {
          console.warn('Erreur chargement stats sync:', error);
        }
      }
    };
    
    // Fetch initial seulement si le backend est connecté
    if (connectionState.backendConnected) {
      fetchStats();
    }
    
    // Refresh toutes les 5 secondes si connecté
    const interval = setInterval(() => {
      if (connectionState.backendConnected) {
        fetchStats();
      }
    }, 5000);
    
    return () => {
      clearInterval(interval);
    };
  }, [connectionState.backendConnected]);
  
  // Déterminer l'état global PRO LOCAL-FIRST
  // Priorité: Backend Local > Socket > Sheets
  const currentState = (() => {
    if (!connectionState.backendConnected) return SyncState.OFFLINE;
    if (stats.pushPending > 0 || stats.pullPending > 0) return SyncState.SYNCING;
    if (stats.totalFailed > 0) return SyncState.ERROR;
    return SyncState.IDLE;
  })();
  
  // Handlers
  const handlePause = useCallback(async () => {
    try {
      await fetch('/api/sync/pause', { method: 'POST' });
      setStats((prev) => ({ ...prev, state: SyncState.PAUSED }));
    } catch (error) {
      console.error('Erreur pause sync:', error);
    }
  }, []);
  
  const handleResume = useCallback(async () => {
    try {
      await fetch('/api/sync/resume', { method: 'POST' });
      setStats((prev) => ({ ...prev, state: SyncState.IDLE }));
    } catch (error) {
      console.error('Erreur resume sync:', error);
    }
  }, []);
  
  const handleRetry = useCallback(async () => {
    try {
      await fetch('/api/sync/force', { method: 'POST' });
      if (onSyncRequested) onSyncRequested();
    } catch (error) {
      console.error('Erreur force sync:', error);
    }
  }, [onSyncRequested]);
  
  const handleClear = useCallback(async () => {
    try {
      await fetch('/api/sync/clear-errors', { method: 'POST' });
      setStats((prev) => ({ ...prev, totalFailed: 0, lastError: null }));
    } catch (error) {
      console.error('Erreur clear errors:', error);
    }
  }, []);
  
  // Position CSS
  const positionClasses = {
    'top-right': 'fixed top-4 right-4',
    'top-left': 'fixed top-4 left-4',
    'bottom-right': 'fixed bottom-4 right-4',
    'bottom-left': 'fixed bottom-4 left-4',
    'inline': 'relative',
  };
  
  return (
    <div className={`${positionClasses[position]} z-50 ${className}`}>
      <SyncStatusBadge
        state={currentState}
        onClick={() => setIsOpen(!isOpen)}
        mini={mini}
      />
      
      <SyncDetailsPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        stats={{ ...stats, state: currentState }}
        onPause={handlePause}
        onResume={handleResume}
        onRetry={handleRetry}
        onClear={handleClear}
      />
    </div>
  );
});

SyncStatusDashboard.displayName = 'SyncStatusDashboard';

export default SyncStatusDashboard;

// Exports nommés
export { SyncStatusBadge, SyncDetailsPanel, SyncState };

