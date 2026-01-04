/**
 * AI LaGrace - Composant d'intégration frontend
 * =============================================
 * Affiche le statut de l'AI et permet l'activation du micro
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

// Configuration
const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

// Icônes SVG inline
const MicrophoneIcon = ({ active }) => (
  <svg 
    viewBox="0 0 24 24" 
    width="20" 
    height="20" 
    fill={active ? '#10B981' : '#6B7280'}
    className="transition-colors duration-300"
  >
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
);

const SpeakerIcon = ({ speaking }) => (
  <svg 
    viewBox="0 0 24 24" 
    width="20" 
    height="20" 
    fill={speaking ? '#F59E0B' : '#6B7280'}
    className="transition-colors duration-300"
  >
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
  </svg>
);

const AIIcon = ({ connected }) => (
  <svg 
    viewBox="0 0 24 24" 
    width="24" 
    height="24" 
    fill={connected ? '#10B981' : '#EF4444'}
    className="transition-colors duration-300"
  >
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    <circle cx="9" cy="10" r="1.5" fill="currentColor"/>
    <circle cx="15" cy="10" r="1.5" fill="currentColor"/>
    <path d="M12 17c-1.1 0-2-.45-2.71-1.29l-.7.71c.9 1.16 2.29 1.92 3.41 1.92s2.51-.76 3.41-1.92l-.7-.71c-.71.84-1.61 1.29-2.71 1.29z"/>
  </svg>
);

/**
 * Composant principal AI LaGrace
 */
export default function AILaGrace({ className = '' }) {
  const [aiStatus, setAiStatus] = useState({
    status: 'disconnected', // 'connected', 'disconnected', 'reconnecting'
    message: 'Initialisation...',
    speaking: false,
    listening: false,
  });
  
  // FIX: Memoize isConnected to replace aiStatus.connected reference
  const isConnected = React.useMemo(() => {
    return aiStatus.status === 'connected';
  }, [aiStatus.status]);
  
  const [showPanel, setShowPanel] = useState(false);
  const [messages, setMessages] = useState([]);
  const socketRef = useRef(null);
  const audioContextRef = useRef(null);

  // Connexion Socket.IO
  // Vérifier le statut de l'IA (pour navigateur web)
  const checkAIStatus = useCallback(async () => {
    if (window.electronAPI) return;
    
    try {
      console.log('📡 Vérification du statut IA...');
      const response = await fetch(`${SOCKET_URL}/api/ai/status`);
      if (response.ok) {
        const data = await response.json();
        console.log('📡 Réponse statut IA:', data);
        const newStatus = data.running ? 'connected' : 'disconnected';
        setAiStatus(prev => {
          if (prev.status !== newStatus) {
            console.log(`✅ Changement statut: ${prev.status} → ${newStatus}`);
            return {
              ...prev,
              status: newStatus,
              message: data.running ? 'IA en cours d\'exécution' : 'IA arrêtée'
            };
          }
          return prev;
        });
      } else {
        console.error('Erreur réponse:', response.status);
      }
    } catch (error) {
      console.error('Erreur vérification IA:', error);
      setAiStatus(prev => ({ ...prev, status: 'disconnected', message: 'Erreur connexion' }));
    }
  }, []); // Dépendance vide - pas de dépendance circulaire

  // ✅ DÉCLARER addMessage AVANT useEffect (évite TDZ - Temporal Dead Zone)
  // Sinon: ReferenceError: Cannot access 'addMessage' before initialization
  const addMessage = useCallback((type, text) => {
    const newMsg = {
      id: Date.now(),
      type,
      text,
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev.slice(-20), newMsg]); // Garder les 20 derniers
    setAiStatus(prev => ({ ...prev, lastMessage: text }));
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    // REGISTER ALL LISTENERS FIRST - BEFORE ANY EARLY RETURNS
    // Events de connexion
    socket.on('connect', () => {
      console.log('🔌 [AILaGrace] Connecté au serveur');
      addMessage('system', 'Connecté au serveur La Grâce');
      
      setTimeout(() => {
        if (!window.electronAPI) {
          console.log('🔍 Vérification du statut IA (navigateur web)');
          checkAIStatus();
        }
      }, 500);
    });

    socket.on('disconnect', () => {
      console.log('🔌 [AILaGrace] Déconnecté');
    });

    // Événements de vente
    socket.on('sale:created', (data) => {
      const client = data.client || data.customer || '';
      const total = data.total_usd || data.totalUSD || 0;
      const msg = client 
        ? `Vente finalisée pour ${client} - ${total}$`
        : `Nouvelle vente - ${total}$`;
      addMessage('sale', msg);
    });

    // Événements d'impression
    socket.on('print:started', (data) => {
      const facture = data.factureNum || data.facture || '';
      addMessage('print', `Impression lancée${facture ? ` (${facture})` : ''}`);
    });

    socket.on('print:done', (data) => {
      const facture = data.factureNum || data.facture || '';
      addMessage('print', `Impression terminée${facture ? ` (${facture})` : ''}`);
    });

    socket.on('print:error', (data) => {
      addMessage('error', `Erreur impression: ${data.hint || data.message || 'Erreur inconnue'}`);
    });

    // Événements utilisateur
    socket.on('user:login', (data) => {
      const username = data.username || data.name || 'Utilisateur';
      addMessage('user', `${username} s'est connecté`);
    });

    // NOW define cleanup with all subscriptions registered
    let cleanup = null;
    let interval = null;

    // Écouter les mises à jour de statut de l'IA depuis Electron
    if (window.electronAPI) {
      cleanup = window.electronAPI.onAIStatusUpdate(({ status, message }) => {
        console.log(`[IPC] Statut AI reçu: ${status}`, message);
        setAiStatus(prev => ({ ...prev, status, message }));
        
        if (status === 'connected') {
          addMessage('ai', message || 'AI LaGrace connectée et prête');
        } else if (status === 'disconnected') {
          addMessage('error', message || 'AI LaGrace déconnectée');
        } else if (status === 'reconnecting') {
          addMessage('system', message || 'Reconnexion de l\'IA...');
        }
      });
    } else {
      // Pour navigateur web : vérifier le statut immédiatement et ensuite périodiquement
      checkAIStatus();
      
      interval = setInterval(() => {
        console.log('⏰ Vérification périodique du statut IA');
        checkAIStatus();
      }, 5000);
    }

    // Return single cleanup function - all listeners guaranteed registered above
    return () => {
      if (cleanup) cleanup();
      if (interval) clearInterval(interval);
      socket.disconnect();
    };
  }, [checkAIStatus, addMessage]);

  // Démarrer l'IA (pour navigateur web)
  const startAIWeb = useCallback(async () => {
    if (window.electronAPI) return;
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/ai/start`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        addMessage('system', '✅ IA en cours de démarrage...');
        setTimeout(() => checkAIStatus(), 2000);
      } else {
        addMessage('error', `Erreur: ${data.message}`);
      }
    } catch (error) {
      addMessage('error', `Erreur démarrage IA: ${error.message}`);
    }
  }, []);

  // Arrêter l'IA (pour navigateur web)
  const stopAIWeb = useCallback(async () => {
    if (window.electronAPI) return;
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/ai/stop`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        addMessage('system', '✅ IA arrêtée');
        setTimeout(() => checkAIStatus(), 1000);
      } else {
        addMessage('error', `Erreur: ${data.message}`);
      }
    } catch (error) {
      addMessage('error', `Erreur arrêt IA: ${error.message}`);
    }
  }, []);

  // Demander l'activation du micro (Web Speech API)
  const requestMicrophoneAccess = useCallback(async () => {
    try {
      // Demander la permission du micro
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Créer un contexte audio pour activer le micro
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Fermer le stream après avoir obtenu la permission
      stream.getTracks().forEach(track => track.stop());
      
      addMessage('system', 'Microphone activé avec succès');
      setAiStatus(prev => ({ ...prev, listening: true }));
      
      // Notifier le serveur
      if (socketRef.current) {
        socketRef.current.emit('ai:microphone_enabled', { enabled: true });
      }
      
      return true;
    } catch (error) {
      console.error('Erreur activation micro:', error);
      addMessage('error', 'Impossible d\'activer le microphone');
      return false;
    }
  }, [addMessage]);

  // Style des messages selon le type
  const getMessageStyle = (type) => {
    const styles = {
      system: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      ai: 'bg-green-500/20 text-green-300 border-green-500/30',
      sale: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
      print: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      user: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
      error: 'bg-red-500/20 text-red-300 border-red-500/30',
    };
    return styles[type] || styles.system;
  };

  // Icône selon le type
  const getMessageIcon = (type) => {
    const icons = {
      system: '⚙️',
      ai: '🤖',
      sale: '💰',
      print: '🖨️',
      user: '👤',
      error: '❌',
    };
    return icons[type] || '📢';
  };

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 40 }}>
      {/* Conteneur flottant AI LaGrace avec pointer-events isolation */}
      <div className="relative">
        {/* Bouton flottant AI */}
        <button
        onClick={() => setShowPanel(!showPanel)}
        className={`
          fixed bottom-4 right-4 z-50 pointer-events-auto
          w-14 h-14 rounded-full shadow-lg
          flex items-center justify-center
          transition-all duration-300 transform hover:scale-110
          ${isConnected 
            ? 'bg-gradient-to-br from-green-500 to-emerald-600' 
            : 'bg-gradient-to-br from-gray-600 to-gray-700'}
          ${aiStatus.speaking ? 'animate-pulse ring-4 ring-yellow-400/50' : ''}
        `}
        title={isConnected ? 'AI LaGrace - Connectée' : 'AI LaGrace - Déconnectée'}
      >
        <AIIcon connected={isConnected} />
        
        {/* Indicateur de statut */}
        <span 
          className={`
            absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-gray-900
            ${aiStatus.status === 'connected' ? 'bg-green-400' : (aiStatus.status === 'reconnecting' ? 'bg-yellow-400' : 'bg-red-400')}
            ${aiStatus.listening ? 'animate-ping' : ''}
          `}
        />
      </button>

      {/* Panel de contrôle */}
      {showPanel && (
        <div className="
          fixed bottom-20 right-4 z-50 pointer-events-auto
          w-80 max-h-96
          bg-gray-900/95 backdrop-blur-xl
          border border-gray-700/50 rounded-2xl
          shadow-2xl overflow-hidden
          animate-in slide-in-from-bottom-4
        ">
          {/* Header */}
          <div className="
            px-4 py-3 
            bg-gradient-to-r from-green-600/20 to-emerald-600/20
            border-b border-gray-700/50
          ">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AIIcon connected={isConnected} />
                <div>
                  <h3 className="font-semibold text-white text-sm">AI LaGrace</h3>
                  <p className={`text-xs ${
                    aiStatus.status === 'connected' ? 'text-green-400' : 
                    aiStatus.status === 'reconnecting' ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {aiStatus.status === 'connected' ? 'Connectée' : 
                     aiStatus.status === 'reconnecting' ? 'Reconnexion...' : 'Déconnectée'}
                  </p>
                </div>
              </div>
              
              {/* Contrôles */}
              <div className="flex items-center gap-2">
                {/* Contrôles IA */}
              <div className="flex items-center gap-1 mr-2">
                <button
                  onClick={window.electronAPI ? 
                    (async () => {
                      try {
                        const result = await window.electronAPI.startAI();
                        if (result.success) {
                          addMessage('system', 'IA démarrée');
                        } else {
                          addMessage('error', `Erreur démarrage IA: ${result.error}`);
                        }
                      } catch (error) {
                        addMessage('error', 'Erreur démarrage IA');
                      }
                    }) : startAIWeb
                  }
                  className="px-2 py-1 text-xs bg-green-600/20 text-green-400 rounded hover:bg-green-600/30 transition-colors"
                  title="Démarrer l'IA"
                >
                  ▶️
                </button>
                
                <button
                  onClick={window.electronAPI ?
                    (async () => {
                      try {
                        const result = await window.electronAPI.stopAI();
                        if (result.success) {
                          addMessage('system', 'IA arrêtée');
                        } else {
                          addMessage('error', `Erreur arrêt IA: ${result.error}`);
                        }
                      } catch (error) {
                        addMessage('error', 'Erreur arrêt IA');
                      }
                    }) : stopAIWeb
                  }
                  className="px-2 py-1 text-xs bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 transition-colors"
                  title="Arrêter l'IA"
                >
                  ⏹️
                </button>
              </div>
                
                <button
                  onClick={requestMicrophoneAccess}
                  className={`
                    p-2 rounded-lg transition-colors
                    ${aiStatus.listening 
                      ? 'bg-green-500/30 text-green-400' 
                      : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'}
                  `}
                  title="Activer le microphone"
                >
                  <MicrophoneIcon active={aiStatus.listening} />
                </button>
                
                <div className={`
                  p-2 rounded-lg
                  ${aiStatus.speaking ? 'bg-yellow-500/30' : 'bg-gray-700/30'}
                `}>
                  <SpeakerIcon speaking={aiStatus.speaking} />
                </div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="
            h-64 overflow-y-auto p-3 space-y-2
            scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent
          ">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-8">
                <p>👋 Bienvenue !</p>
                <p className="mt-1 text-xs">Les événements apparaîtront ici</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`
                    px-3 py-2 rounded-lg border text-sm
                    ${getMessageStyle(msg.type)}
                    animate-in slide-in-from-right-2
                  `}
                >
                  <div className="flex items-start gap-2">
                    <span>{getMessageIcon(msg.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="break-words">{msg.text}</p>
                      <p className="text-xs opacity-60 mt-0.5">{msg.time}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer avec dernier message */}
          {aiStatus.lastMessage && (
            <div className="
              px-4 py-2 
              bg-gray-800/50 border-t border-gray-700/50
              text-xs text-gray-400 truncate
            ">
              Dernier: {aiStatus.lastMessage}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * Hook pour utiliser l'AI LaGrace depuis d'autres composants
 */
export function useAILaGrace() {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const s = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
    });
    setSocket(s);
    return () => s.disconnect();
  }, []);

  const announce = useCallback((message) => {
    if (socket) {
      socket.emit('ai:announce', { message });
    }
  }, [socket]);

  return { socket, announce };
}
