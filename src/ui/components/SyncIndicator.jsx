/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SYNC INDICATOR - Indicateur visuel de synchronisation temps réel
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Affiche l'état de connexion WebSocket et la dernière mise à jour
 * S'intègre facilement dans n'importe quelle page
 */

import { memo, useEffect, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { useWebSocketStatus } from '../hooks/useSmartSync';

/**
 * Indicateur de synchronisation compact
 */
export const SyncIndicator = memo(({ 
  lastUpdate = null, 
  dataType = 'données',
  showLastUpdate = true,
  className = '',
  size = 'sm' // 'sm' | 'md' | 'lg'
}) => {
  const { isConnected, reconnecting, lastPing } = useWebSocketStatus();
  const [timeSinceUpdate, setTimeSinceUpdate] = useState('');
  
  // Calculer le temps depuis la dernière mise à jour
  useEffect(() => {
    if (!lastUpdate) {
      setTimeSinceUpdate('');
      return;
    }
    
    const updateTime = () => {
      const now = Date.now();
      const updateTs = new Date(lastUpdate).getTime();
      const diff = now - updateTs;
      
      if (diff < 5000) {
        setTimeSinceUpdate('à l\'instant');
      } else if (diff < 60000) {
        setTimeSinceUpdate(`il y a ${Math.floor(diff / 1000)}s`);
      } else if (diff < 3600000) {
        setTimeSinceUpdate(`il y a ${Math.floor(diff / 60000)}min`);
      } else {
        setTimeSinceUpdate(`il y a ${Math.floor(diff / 3600000)}h`);
      }
    };
    
    updateTime();
    const interval = setInterval(updateTime, 5000);
    
    return () => clearInterval(interval);
  }, [lastUpdate]);
  
  const sizeClasses = {
    sm: 'text-xs gap-1',
    md: 'text-sm gap-2',
    lg: 'text-base gap-3',
  };
  
  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };
  
  return (
    <div className={`flex items-center ${sizeClasses[size]} ${className}`}>
      {/* État de connexion */}
      {reconnecting ? (
        <div className="flex items-center gap-1 text-yellow-400" title="Reconnexion en cours...">
          <RefreshCw className={`${iconSizes[size]} animate-spin`} />
          <span>Reconnexion...</span>
        </div>
      ) : isConnected ? (
        <div className="flex items-center gap-1 text-green-400" title="Connecté au serveur">
          <Wifi className={iconSizes[size]} />
          <span className="hidden sm:inline">Connecté</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-red-400" title="Déconnecté">
          <WifiOff className={iconSizes[size]} />
          <span className="hidden sm:inline">Hors ligne</span>
        </div>
      )}
      
      {/* Dernière mise à jour */}
      {showLastUpdate && timeSinceUpdate && (
        <>
          <span className="text-gray-600">•</span>
          <div className="flex items-center gap-1 text-gray-400" title={`Dernière mise à jour des ${dataType}`}>
            <Clock className={iconSizes[size]} />
            <span>{timeSinceUpdate}</span>
          </div>
        </>
      )}
    </div>
  );
});

SyncIndicator.displayName = 'SyncIndicator';

/**
 * Badge de synchronisation (plus compact)
 */
export const SyncBadge = memo(({ isConnected, hasChanges = false, className = '' }) => {
  if (!isConnected) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 ${className}`}>
        <WifiOff className="w-3 h-3" />
        Hors ligne
      </span>
    );
  }
  
  if (hasChanges) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 ${className}`}>
        <RefreshCw className="w-3 h-3 animate-spin" />
        Sync...
      </span>
    );
  }
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30 ${className}`}>
      <CheckCircle className="w-3 h-3" />
      Sync
    </span>
  );
});

SyncBadge.displayName = 'SyncBadge';

/**
 * Toast de notification de changements
 */
export const ChangeToast = memo(({ changes, dataType = 'éléments', onDismiss }) => {
  const { added, updated, removed, hasChanges } = changes || {};
  
  if (!hasChanges) return null;
  
  const messages = [];
  if (added?.length > 0) messages.push(`${added.length} ajouté(s)`);
  if (updated?.length > 0) messages.push(`${updated.length} modifié(s)`);
  if (removed?.length > 0) messages.push(`${removed.length} supprimé(s)`);
  
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-gray-800 border border-primary-500/30 rounded-lg shadow-xl p-4 max-w-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-primary-500/20">
            <RefreshCw className="w-5 h-5 text-primary-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-100">
              {dataType} mis à jour
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {messages.join(' • ')}
            </p>
          </div>
          {onDismiss && (
            <button 
              onClick={onDismiss}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

ChangeToast.displayName = 'ChangeToast';

export default SyncIndicator;
