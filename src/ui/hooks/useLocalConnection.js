/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * useLocalConnection - Hook PRO de détection de connexion LAN/SQL locale
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Ce hook détecte la connexion au BACKEND LOCAL (SQL), pas à Internet.
 * Pour une application local-first, ce qui compte c'est:
 * 1. La connexion au serveur backend local (SQLite)
 * 2. La connexion WebSocket pour les mises à jour temps réel
 * 3. Optionnellement, la connexion à Google Sheets (pour sync externe)
 * 
 * Avantages:
 * - Détection précise de la disponibilité du backend SQL
 * - Mise à jour en temps réel via WebSocket
 * - Fallback polling toutes les 5 secondes si WebSocket down
 * - Statistiques détaillées (latence, dernière sync, etc.)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiUrl, getSocketUrl } from '../utils/apiConfig.js';

// Constantes de configuration
const HEALTH_CHECK_INTERVAL_MS = 5000;    // Polling fallback: 5 secondes
const HEALTH_CHECK_TIMEOUT_MS = 3000;     // Timeout health check: 3 secondes
const RECONNECT_DELAY_MS = 1000;          // Délai avant tentative de reconnexion
const MAX_LATENCY_WARNING_MS = 500;       // Latence > 500ms = warning

/**
 * État de connexion détaillé
 */
export const ConnectionState = {
  CONNECTED: 'connected',         // Connecté au backend SQL local
  CONNECTING: 'connecting',       // Tentative de connexion en cours
  DISCONNECTED: 'disconnected',   // Déconnecté du backend local
  ERROR: 'error',                 // Erreur de connexion
};

/**
 * Hook principal de détection de connexion locale
 * @param {Object} options - Options de configuration
 * @returns {Object} État de connexion et méthodes
 */
export function useLocalConnection(options = {}) {
  const {
    autoStart = true,
    healthCheckInterval = HEALTH_CHECK_INTERVAL_MS,
    onConnectionChange = null,
  } = options;

  // État local
  const [state, setState] = useState({
    // État de connexion
    isConnected: false,
    connectionState: ConnectionState.CONNECTING,
    
    // Détails backend
    backendConnected: false,
    backendLatency: null,
    backendLastCheck: null,
    
    // Détails WebSocket
    socketConnected: false,
    socketId: null,
    
    // Statistiques
    totalChecks: 0,
    successfulChecks: 0,
    failedChecks: 0,
    lastError: null,
    
    // Sync Google Sheets (optionnel)
    sheetsConnected: null, // null = pas testé, true/false = résultat
    sheetsLastSync: null,
  });

  // Refs pour éviter les re-renders inutiles
  const intervalRef = useRef(null);
  const abortControllerRef = useRef(null);
  const socketRef = useRef(null);
  const mountedRef = useRef(true);

  /**
   * Vérifie la connexion au backend local via /api/health
   */
  const checkBackendHealth = useCallback(async () => {
    if (!mountedRef.current) return null;

    // Annuler la requête précédente si elle existe
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const startTime = performance.now();
    const apiUrl = getApiUrl();
    const healthUrl = apiUrl ? `${apiUrl}/api/health` : '/api/health';

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: abortControllerRef.current.signal,
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      });

      const latency = Math.round(performance.now() - startTime);

      if (response.ok) {
        const data = await response.json();
        return {
          connected: true,
          latency,
          timestamp: data.timestamp || new Date().toISOString(),
          status: data.status || 'ok',
        };
      } else {
        return {
          connected: false,
          latency,
          error: `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return null; // Requête annulée, ignorer
      }
      
      return {
        connected: false,
        latency: Math.round(performance.now() - startTime),
        error: error.message || 'Network error',
      };
    }
  }, []);

  /**
   * Met à jour l'état après un health check
   */
  const updateStateFromHealthCheck = useCallback((result) => {
    if (!mountedRef.current || !result) return;

    setState(prev => {
      const isConnected = result.connected;
      const newState = {
        ...prev,
        isConnected,
        connectionState: isConnected 
          ? ConnectionState.CONNECTED 
          : ConnectionState.DISCONNECTED,
        backendConnected: result.connected,
        backendLatency: result.latency,
        backendLastCheck: new Date().toISOString(),
        totalChecks: prev.totalChecks + 1,
        successfulChecks: isConnected 
          ? prev.successfulChecks + 1 
          : prev.successfulChecks,
        failedChecks: isConnected 
          ? prev.failedChecks 
          : prev.failedChecks + 1,
        lastError: result.error || null,
      };

      // Callback si l'état de connexion change
      if (prev.isConnected !== isConnected && onConnectionChange) {
        setTimeout(() => onConnectionChange(isConnected, newState), 0);
      }

      return newState;
    });
  }, [onConnectionChange]);

  /**
   * Démarre le polling de health check
   */
  const startHealthCheckPolling = useCallback(() => {
    // Nettoyer l'intervalle existant
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Premier check immédiat
    checkBackendHealth().then(updateStateFromHealthCheck);

    // Polling régulier
    intervalRef.current = setInterval(async () => {
      const result = await checkBackendHealth();
      updateStateFromHealthCheck(result);
    }, healthCheckInterval);
  }, [checkBackendHealth, updateStateFromHealthCheck, healthCheckInterval]);

  /**
   * Arrête le polling
   */
  const stopHealthCheckPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  /**
   * Force un health check immédiat
   */
  const forceCheck = useCallback(async () => {
    setState(prev => ({
      ...prev,
      connectionState: ConnectionState.CONNECTING,
    }));

    const result = await checkBackendHealth();
    updateStateFromHealthCheck(result);
    return result?.connected || false;
  }, [checkBackendHealth, updateStateFromHealthCheck]);

  /**
   * Vérifie la connexion à Google Sheets (optionnel)
   */
  const checkSheetsConnection = useCallback(async () => {
    const apiUrl = getApiUrl();
    const syncStatusUrl = apiUrl ? `${apiUrl}/api/sync/status` : '/api/sync/status';

    try {
      const response = await fetch(syncStatusUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        setState(prev => ({
          ...prev,
          sheetsConnected: data.connected ?? true,
          sheetsLastSync: data.lastSync || data.last_sync || null,
        }));
        return true;
      }
      setState(prev => ({ ...prev, sheetsConnected: false }));
      return false;
    } catch (error) {
      setState(prev => ({ ...prev, sheetsConnected: false }));
      return false;
    }
  }, []);

  /**
   * Met à jour l'état WebSocket
   */
  const updateSocketState = useCallback((connected, socketId = null) => {
    setState(prev => ({
      ...prev,
      socketConnected: connected,
      socketId: socketId,
      // Si le socket est connecté, on considère qu'on est connecté au backend
      isConnected: connected || prev.backendConnected,
      connectionState: connected || prev.backendConnected 
        ? ConnectionState.CONNECTED 
        : prev.connectionState,
    }));
  }, []);

  // Effet principal: démarrage et nettoyage
  useEffect(() => {
    mountedRef.current = true;

    if (autoStart) {
      startHealthCheckPolling();
    }

    return () => {
      mountedRef.current = false;
      stopHealthCheckPolling();
    };
  }, [autoStart, startHealthCheckPolling, stopHealthCheckPolling]);

  // Retourner l'état et les méthodes
  return {
    // État principal
    isConnected: state.isConnected,
    connectionState: state.connectionState,
    
    // Détails
    backendConnected: state.backendConnected,
    backendLatency: state.backendLatency,
    socketConnected: state.socketConnected,
    
    // Statistiques
    stats: {
      totalChecks: state.totalChecks,
      successfulChecks: state.successfulChecks,
      failedChecks: state.failedChecks,
      lastCheck: state.backendLastCheck,
      lastError: state.lastError,
    },
    
    // Sync Sheets
    sheetsConnected: state.sheetsConnected,
    sheetsLastSync: state.sheetsLastSync,
    
    // Méthodes
    forceCheck,
    checkSheetsConnection,
    updateSocketState,
    start: startHealthCheckPolling,
    stop: stopHealthCheckPolling,
    
    // Indicateurs utiles
    isLatencyHigh: state.backendLatency > MAX_LATENCY_WARNING_MS,
    isStable: state.successfulChecks > 3 && state.failedChecks === 0,
  };
}

/**
 * Hook simplifié pour juste savoir si on est connecté au backend local
 */
export function useIsLocalConnected() {
  const { isConnected } = useLocalConnection({
    healthCheckInterval: 10000, // Check moins fréquent
  });
  return isConnected;
}

/**
 * Hook pour obtenir l'état de connexion global (combine backend + socket)
 */
export function useConnectionStatus() {
  const [status, setStatus] = useState({
    backend: false,
    socket: false,
    overall: false,
    latency: null,
  });

  const { 
    backendConnected, 
    socketConnected, 
    backendLatency,
    forceCheck,
  } = useLocalConnection();

  useEffect(() => {
    setStatus({
      backend: backendConnected,
      socket: socketConnected,
      overall: backendConnected || socketConnected,
      latency: backendLatency,
    });
  }, [backendConnected, socketConnected, backendLatency]);

  return {
    ...status,
    refresh: forceCheck,
  };
}

export default useLocalConnection;
