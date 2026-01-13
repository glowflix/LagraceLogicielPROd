import { useState, useEffect, useMemo, useRef, useCallback, startTransition } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Search,
  Package,
  TrendingUp,
  Printer,
  Download,
  Filter,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ArrowUp,
  Upload,
  Loader2,
  Trash2,
  Wifi,
  WifiOff,
  RefreshCw
} from 'lucide-react';
import { useStore } from '../store/useStore';
import ErrorBoundary from '../components/ErrorBoundary';
import { ToastContainer } from '../components/Toast';
import { useToastNotifications } from '../hooks/useToastNotifications';
import { useSmartProducts, useWebSocketStatus, isUserCurrentlyTyping, saveUIState, restoreUIState } from '../hooks/useSmartSync';
import { SyncIndicator } from '../components/SyncIndicator';
import axios from 'axios';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');
const PRINT_API_URL = `${API_URL}/api/print`;
const IS_DEV = import.meta.env.DEV;

// Composant pour animer les valeurs numériques (compteur animé)
const AnimatedCounter = ({ value, duration = 500, formatter = (v) => v, className = '' }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef(null);
  const startValueRef = useRef(value);
  const startTimeRef = useRef(null);

  useEffect(() => {
    if (value === displayValue) return;

    const startValue = displayValue;
    const endValue = value;
    const difference = endValue - startValue;
    
    if (Math.abs(difference) < 0.01) {
      setDisplayValue(value);
      return;
    }

    setIsAnimating(true);
    startValueRef.current = startValue;
    startTimeRef.current = performance.now();

    const animate = (currentTime) => {
      if (!startTimeRef.current) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function (ease-out)
      const easeOut = 1 - Math.pow(1 - progress, 3);
      
      const currentValue = startValueRef.current + (difference * easeOut);
      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
        setIsAnimating(false);
        startTimeRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  return (
    <span className={`${className} ${isAnimating ? 'transition-all duration-75' : ''}`}>
      {formatter(displayValue)}
    </span>
  );
};

// Modal WhatsApp-like
const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, productName, onCustomName, onCancel }) => {
  const [customName, setCustomName] = useState('');
  
  // ✅ FIXED: Return null early but ensure no phantom DOM elements remain
  if (!isOpen) return null;
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{ 
        // ✅ Explicit pointer-events to prevent blocking when closed
        pointerEvents: isOpen ? 'auto' : 'none'
      }}
      onClick={(e) => {
        // Close when clicking backdrop
        if (e.target === e.currentTarget) {
          if (onCancel) onCancel();
          else onClose();
        }
      }}
    >
      <div 
        className="bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 border border-white/10"
        onClick={(e) => e.stopPropagation()}
        style={{ pointerEvents: 'auto' }}
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-primary-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-100">{title}</h3>
          </div>
          
          <p className="text-gray-300 mb-4 whitespace-pre-line">{message}</p>
          
          {productName && (
            <div className="bg-white/5 rounded-lg p-3 mb-4">
              <p className="text-sm text-gray-400 mb-1">Nom trouvé:</p>
              <p className="font-semibold text-gray-100">{productName}</p>
            </div>
          )}
          
          {onCustomName && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Ou saisir un autre nom:
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Nom du produit"
                className="input-field w-full"
                autoFocus
                style={{ pointerEvents: 'auto' }}
              />
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (onCustomName && customName.trim()) {
                  onCustomName(customName.trim());
                } else {
                  onConfirm();
                }
                setCustomName('');
              }}
              className="flex-1 btn-primary flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              Oui
            </button>
            <button
              onClick={() => {
                // ✅ FIX CRITIQUE #1: Appeler onCancel pour rejeter la Promise
                if (onCancel) {
                  onCancel();
                } else {
                  onClose();
                }
                setCustomName('');
              }}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-100 px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <XCircle className="w-5 h-5" />
              Non
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProductsPage = () => {
  const { products: storeProducts, loadProducts, currentRate, loadCurrentRate, token: storeToken, isAuthenticated, socket } = useStore();
  const navigate = useNavigate();
  const { toasts, closeToast, error: showError, success: showSuccess, info: showInfo } = useToastNotifications();
  
  // ✅ AUTO-ACTUALISATION INTELLIGENTE (toutes les 2 secondes)
  const { 
    data: smartProducts, 
    loading: smartLoading, 
    refresh: smartRefresh, 
    lastUpdate,
    isConnected: wsConnected,
    changes: productChanges,
  } = useSmartProducts({
    enabled: true,
    onDataChange: (newProducts, changes) => {
      // Notifier des changements si > 0 items modifiés
      if (changes.hasChanges && IS_DEV) {
        console.log('📊 [SmartSync] Produits modifiés:', {
          added: changes.added.length,
          updated: changes.updated.length,
          removed: changes.removed.length,
        });
      }
    },
  });
  
  // Utiliser les produits du smart sync si disponibles, sinon ceux du store
  const products = smartProducts && smartProducts.length > 0 ? smartProducts : storeProducts;
  
  // État de connexion WebSocket
  const { isConnected, reconnecting } = useWebSocketStatus();
  
  // Constante pour le token offline
  const OFFLINE_BEARER = 'offline-token';
  
  // Ref pour éviter les warnings répétés
  const warnedRef = useRef({ missingToken: false });
  
  // Fonction pure pour lire le token persisté Zustand
  const readPersistedToken = useCallback(() => {
    try {
      const stored = localStorage.getItem('glowflix-store');
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      return parsed?.state?.token || null;
    } catch {
      return null;
    }
  }, []);
  
  // State token "stabilisé" - priorité : storeToken -> zustand persisted -> localStorage token direct
  const [authToken, setAuthToken] = useState(null);
  
  useEffect(() => {
    const t = storeToken || readPersistedToken() || localStorage.getItem('token');
    setAuthToken(t || null);
    
    // Vérifier la connexion et rediriger si nécessaire
    if (!t && !isAuthenticated) {
      // Pas de token et pas authentifié → rediriger vers login après un délai
      // (pour éviter les redirections pendant le chargement initial)
      const timeoutId = setTimeout(() => {
        if (!localStorage.getItem('glowflix-store') || !readPersistedToken()) {
          if (IS_DEV) {
            console.warn('⚠️ [ProductsPage] Aucun token trouvé, redirection vers login');
          }
          navigate('/login', { replace: true });
        }
      }, 2000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [storeToken, isAuthenticated, readPersistedToken, navigate]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('TOUS');
  const [editingCell, setEditingCell] = useState(null);
  const [editingValues, setEditingValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState({ type: '', text: '' });
  const [modalState, setModalState] = useState({ isOpen: false, type: '', data: null });
  const [focusedField, setFocusedField] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  
  // État pour garder les valeurs modifiées visuellement même après sauvegarde
  // Ces valeurs restent affichées pendant 3-4 secondes après la sauvegarde
  const [visualValues, setVisualValues] = useState({}); // Map<rowId, {field: value}>
  const visualValuesTimeoutsRef = useRef(new Map()); // Map<rowId, timeoutId>
  
  // ✅ PRO: Tracker les 3 derniers produits modifiés pour animation visuelle (persisté dans localStorage)
  const RECENT_MOD_KEY = 'lagrace_recently_modified_products';
  const RECENT_MOD_DURATION = 10000; // 10 secondes
  
  // Charger depuis localStorage au démarrage
  const loadRecentlyModified = useCallback(() => {
    try {
      const stored = localStorage.getItem(RECENT_MOD_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      const now = Date.now();
      // Filtrer les entrées expirées (plus de 10 secondes)
      return parsed.filter(r => (now - r.timestamp) < RECENT_MOD_DURATION).slice(0, 3);
    } catch {
      return [];
    }
  }, []);
  
  const [recentlyModifiedRows, setRecentlyModifiedRows] = useState(() => loadRecentlyModified());
  const recentlyModifiedTimeoutsRef = useRef(new Map()); // Map<rowId, timeoutId>
  
  // Sauvegarder dans localStorage quand ça change
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_MOD_KEY, JSON.stringify(recentlyModifiedRows));
    } catch {
      // Ignorer les erreurs localStorage
    }
  }, [recentlyModifiedRows]);
  
  // ✅ PRO: Au montage, programmer les timeouts pour les entrées restaurées
  useEffect(() => {
    const now = Date.now();
    recentlyModifiedRows.forEach(r => {
      const remaining = RECENT_MOD_DURATION - (now - r.timestamp);
      if (remaining > 0 && !recentlyModifiedTimeoutsRef.current.has(r.rowId)) {
        const timeoutId = setTimeout(() => {
          if (isMountedRef.current) {
            setRecentlyModifiedRows(prev => prev.filter(row => row.rowId !== r.rowId));
          }
          recentlyModifiedTimeoutsRef.current.delete(r.rowId);
        }, remaining);
        recentlyModifiedTimeoutsRef.current.set(r.rowId, timeoutId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Seulement au montage
  
  // ✅ PRO: Fonction pour marquer un produit comme récemment modifié (animation 10s)
  const markRowAsModified = useCallback((rowId) => {
    if (!rowId || !isMountedRef.current) return;
    
    // Annuler le timeout existant pour ce rowId
    if (recentlyModifiedTimeoutsRef.current.has(rowId)) {
      clearTimeout(recentlyModifiedTimeoutsRef.current.get(rowId));
    }
    
    setRecentlyModifiedRows(prev => {
      // Retirer si déjà présent
      const filtered = prev.filter(r => r.rowId !== rowId);
      // Ajouter en premier (le plus récent)
      const updated = [{ rowId, timestamp: Date.now() }, ...filtered];
      // Garder seulement les 3 derniers
      return updated.slice(0, 3);
    });
    
    // Retirer l'animation après 10 secondes
    const timeoutId = setTimeout(() => {
      if (isMountedRef.current) {
        setRecentlyModifiedRows(prev => prev.filter(r => r.rowId !== rowId));
      }
      recentlyModifiedTimeoutsRef.current.delete(rowId);
    }, RECENT_MOD_DURATION);
    
    recentlyModifiedTimeoutsRef.current.set(rowId, timeoutId);
  }, []);
  
  // Refs pour auto-save IA
  const pendingSavesRef = useRef(new Map());
  const savingLoopRef = useRef(false); // ✅ Boucle de sauvegarde au lieu d'un lock simple
  const idleSaveTimersRef = useRef(new Map()); // Map<rowId, timeoutId>
  const lastInputAtRef = useRef(new Map());    // Map<rowId, timestamp>
  
  // ✅ PRO: Ref pour tracker les suppressions en attente de sync
  const pendingDeletionsRef = useRef(new Set()); // Set<productCode>

  // ✅ FOCUS PROTECTION SYSTEM PRO: Empêche le vol de focus pendant la saisie
  const isUserTypingRef = useRef(false);
  const lastActiveInputRef = useRef(null);
  const initialMountDoneRef = useRef(false);
  const searchInputRef = useRef(null);

  // ✅ Robustesse: éviter setState après unmount + cleanup timers (évite freeze / fuites)
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;

      // Stopper la boucle de save
      savingLoopRef.current = false;

      // Nettoyer tous les timers connus
      try {
        for (const t of visualValuesTimeoutsRef.current.values()) {
          clearTimeout(t);
        }
        visualValuesTimeoutsRef.current.clear();

        for (const t of idleSaveTimersRef.current.values()) {
          clearTimeout(t);
        }
        idleSaveTimersRef.current.clear();

        pendingSavesRef.current.clear();
        lastInputAtRef.current.clear();
      } catch {
        // noop
      }

      // Annuler rAF de scroll si actif
      try {
        if (scrollCheckTimeoutRef.current) {
          cancelAnimationFrame(scrollCheckTimeoutRef.current);
          scrollCheckTimeoutRef.current = null;
        }
      } catch {
        // noop
      }
    };
  }, []);
  
  // ✅ Ref pour éviter les closures stale dans les callbacks
  const editingValuesRef = useRef({});
  useEffect(() => {
    editingValuesRef.current = editingValues;
  }, [editingValues]);

  // ✅ FOCUS PROTECTION SYSTEM PRO: Détection et restauration automatique du focus
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleFocusIn = (e) => {
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        isUserTypingRef.current = true;
        lastActiveInputRef.current = target;
      }
    };

    const handleFocusOut = (e) => {
      // Délai pour permettre le changement de focus naturel entre champs
      setTimeout(() => {
        const activeEl = document.activeElement;
        const isStillInInput = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || activeEl?.tagName === 'SELECT';
        
        if (!isStillInInput) {
          // L'utilisateur a quitté les champs de saisie normalement
          isUserTypingRef.current = false;
        }
        
        // ✅ PROTECTION ANTI-VOL: Si on était en train de taper et le focus a été volé
        if (isUserTypingRef.current && lastActiveInputRef.current) {
          const lastInput = lastActiveInputRef.current;
          
          // Vérifier si le focus a été perdu de manière inattendue (pas un clic ailleurs)
          if (!isStillInInput && e.relatedTarget === null) {
            // Le focus a été volé ! Restaurer immédiatement
            if (IS_DEV) {
              console.log('🔒 [FOCUS PROTECTION] Focus volé détecté, restauration...');
            }
            
            requestAnimationFrame(() => {
              if (lastInput && document.contains(lastInput) && document.activeElement !== lastInput) {
                try {
                  lastInput.focus();
                  // Restaurer la position du curseur à la fin
                  if (lastInput.type === 'text' || lastInput.type === 'number') {
                    const len = String(lastInput.value || '').length;
                    lastInput.setSelectionRange?.(len, len);
                  }
                  if (IS_DEV) {
                    console.log('✅ [FOCUS PROTECTION] Focus restauré sur:', lastInput.placeholder || lastInput.name || 'input');
                  }
                } catch (e) {
                  // Silencieux
                }
              }
            });
          }
        }
      }, 50);
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);

    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
    };
  }, []);

  // ✅ AUTO-FOCUS INITIAL UNIQUE: Seulement au premier montage
  useEffect(() => {
    if (!initialMountDoneRef.current && searchInputRef.current) {
      // Focus sur recherche seulement au premier montage
      searchInputRef.current.focus();
      initialMountDoneRef.current = true;
    }
  }, []);
  
  // ✅ Ref pour tracker le dernier champ prix édité (USD ou FC)
  const lastPriceEditedRef = useRef(new Map()); // Map<rowId, 'sale_price_usd' | 'sale_price_fc'>
  
  // Note: Pas de hover state nécessaire - utilisation de CSS hover uniquement (comme DebtsPage)
  // Les variables handleTableMouseLeave, hoveredRowIndex, isHovered ne sont pas utilisées
  
  useEffect(() => {
    const init = async () => {
      try {
        // Log du token une seule fois au démarrage
        if (IS_DEV && authToken) {
          console.log('🔐 [ProductsPage] Token chargé:', authToken.substring(0, 20) + '...');
        }
        
        // ✅ Log du système PRO d'auto-save
        if (IS_DEV) {
          console.log('%c✨ [ProductsPage] AUTO-SAVE PRO ACTIF', 'color: #10b981; font-size: 14px; font-weight: bold;');
          console.log('%c📋 Système intelligent d\'auto-save:', 'color: #10b981; font-weight: bold;');
          console.log('%c  • 500ms debounce après dernière frappe', 'color: #10b981;');
          console.log('%c  • Save immédiat au blur (sortie du champ)', 'color: #10b981;');
          console.log('%c  • Save immédiat si souris quitte la ligne', 'color: #10b981;');
          console.log('%c  • Déduplication: pas de save si valeur inchangée', 'color: #10b981;');
          console.log('%c  • Retry automatique (3x) en cas d\'erreur', 'color: #10b981;');
        }
        
        await Promise.all([loadProducts(), loadCurrentRate()]);
        
        // 🔍 DIAGNOSTIC IMMÉDIAT: Vérifier si le backend renvoie bien les unités du produit 1
        setTimeout(() => {
          const products_check = useStore.getState().products || [];
          const p1 = products_check.find(p => String(p.code) === "1" || p.id === 1);
          if (p1) {
            console.log('%c🔍 [DIAGNOSTIC] PRODUCT 1 FROM API =', 'color: #f59e0b; font-weight: bold;', p1);
            console.log('%c📊 UNITS LENGTH =', 'color: #f59e0b; font-weight: bold;', p1.units?.length || 0);
            if (p1.units?.length === 1) {
              console.warn('%c⚠️  BACKEND PROBLEM: Seulement 1 unité trouvée (au lieu de 2)\n   → Vérifier la requête /api/products et le GROUP BY', 'color: #ef4444; font-weight: bold;');
            } else if (p1.units?.length === 2) {
              console.log('%c✅ Backend OK: 2 unités trouvées\n   → Si l\'UI affiche mal, c\'est une collision de clé React', 'color: #10b981; font-weight: bold;');
              p1.units.forEach((u, i) => {
                console.log(`   Unit ${i}: level=${u.unit_level}, mark=${u.unit_mark}, uuid=${u.uuid}, id=${u.id}`);
              });
            }
          }
        }, 100);
      } catch (error) {
        // En mode Electron, éviter les console.error qui peuvent causer des problèmes
        if (IS_DEV) {
          console.error('Erreur chargement initial:', error);
        }
      } finally {
        setInitialLoading(false);
      }
    };
    init();
    
    // Nettoyer les timeouts au démontage du composant
    return () => {
      // Nettoyer aussi les timeouts des valeurs visuelles
      visualValuesTimeoutsRef.current.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      visualValuesTimeoutsRef.current.clear();
      
      // Cleanup idle-save timers
      idleSaveTimersRef.current.forEach((t) => clearTimeout(t));
      idleSaveTimersRef.current.clear();
      lastInputAtRef.current.clear();
    };
  }, [loadProducts, loadCurrentRate, authToken]);

  // ✅ Scroll helpers MUST be declared before effects that reference them (avoid TDZ)
  const scrollContainerRef = useRef(null);
  const scrollCheckTimeoutRef = useRef(null);
  const [scrollPosition, setScrollPosition] = useState('top');

  const captureScrollTop = useCallback(() => {
    const sc = scrollContainerRef.current;
    if (!sc) return null;
    return sc.scrollTop ?? 0;
  }, []);

  const restoreScrollTopIfJumped = useCallback((savedTop) => {
    if (savedTop == null) return;

    const restore = () => {
      const sc = scrollContainerRef.current;
      if (!sc) return;

      // Évite de casser un scroll volontaire de l'utilisateur.
      // On restaure uniquement si le scroll est retombé en haut de façon inattendue.
      if (savedTop > 20 && (sc.scrollTop ?? 0) < 5) {
        sc.scrollTop = savedTop;
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(restore);
    } else {
      setTimeout(restore, 0);
    }
  }, []);

  // ✅ PRO: Socket.IO listener avec debounce + startTransition pour ne pas bloquer les inputs
  // Ref pour debounce Socket.IO (évite les re-renders massifs)
  const socketDebounceRef = useRef(null);
  const SOCKET_DEBOUNCE_MS = 500; // 500ms de debounce

  useEffect(() => {
    if (!socket) return;
    
    const handleProductsUpdated = (data) => {
      if (IS_DEV) {
        console.log('📡 [ProductsPage] Event "products:updated" reçu:', data);
        console.log(`   → ${data.count} produit(s) mis à jour depuis Google Sheets`);
      }
      
      // ✅ PRO: Debounce pour éviter les re-renders massifs si plusieurs events arrivent
      if (socketDebounceRef.current) {
        clearTimeout(socketDebounceRef.current);
      }
      
      socketDebounceRef.current = setTimeout(() => {
        // ✅ FOCUS PROTECTION PRO: Utilise le système global de détection de saisie
        if (isUserCurrentlyTyping()) {
          if (IS_DEV) {
            console.log('⏳ [ProductsPage] Utilisateur en train de taper (global), reload différé de 3s');
          }
          // ✅ Réessayer dans 3 secondes
          socketDebounceRef.current = setTimeout(() => {
            // Vérifier à nouveau si l'utilisateur tape
            if (isUserCurrentlyTyping()) {
              // Encore en train de taper, réessayer plus tard
              return;
            }
            // ✅ PRÉSERVER L'ÉTAT UI
            const savedUIState = saveUIState();
            const savedTop = captureScrollTop();
            startTransition(() => {
              loadProducts()
                .then(() => {
                  restoreScrollTopIfJumped(savedTop);
                  restoreUIState(savedUIState);
                })
                .catch(() => {});
            });
          }, 3000);
          return;
        }
        
        // ✅ PRÉSERVER L'ÉTAT UI AVANT LE RECHARGEMENT
        const savedUIState = saveUIState();
        const savedTop = captureScrollTop();
        
        // ✅ PRO: startTransition pour ne pas bloquer les inputs pendant le reload
        startTransition(() => {
          loadProducts()
            .then(() => {
              restoreScrollTopIfJumped(savedTop);
              // ✅ RESTAURER L'ÉTAT UI APRÈS LE RECHARGEMENT
              setTimeout(() => restoreUIState(savedUIState), 50);
              if (IS_DEV) {
                console.log('✅ [ProductsPage] Produits rechargés (startTransition, UI préservé)');
              }
            })
            .catch(error => {
              // ✅ Silencieux en production
              if (IS_DEV) {
                console.error('❌ [ProductsPage] Erreur rechargement:', error);
              }
            });
        });
      }, SOCKET_DEBOUNCE_MS);
    };
    
    socket.on('products:updated', handleProductsUpdated);
    
    if (IS_DEV) {
      console.log('🔗 [ProductsPage] Listener Socket.IO "products:updated" (debounced + startTransition)');
    }
    
    return () => {
      socket.off('products:updated', handleProductsUpdated);
      if (socketDebounceRef.current) {
        clearTimeout(socketDebounceRef.current);
      }
      if (IS_DEV) {
        console.log('🔓 [ProductsPage] Listener Socket.IO "products:updated" désabonné');
      }
    };
  }, [socket, captureScrollTop, loadProducts, restoreScrollTopIfJumped]);

  // ✅ PRO: Socket.IO listener pour sync avec startTransition (non-bloquant)
  const syncDebounceRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    const handleProductsSynced = (data) => {
      if (IS_DEV) {
        console.log('🔄 [AutoSync] Event "products:synced" reçu:', {
          updated: data.updated,
          skipped: data.skipped,
          pending: data.pending,
          duration: `${data.duration}ms`
        });
      }

      // ✅ Seulement recharger si il y a eu des updates
      if (data.updated > 0) {
        // ✅ PRO: Debounce pour éviter surcharge
        if (syncDebounceRef.current) {
          clearTimeout(syncDebounceRef.current);
        }
        
        syncDebounceRef.current = setTimeout(() => {
          // ✅ FOCUS PROTECTION PRO: Utilise le système global
          if (isUserCurrentlyTyping()) {
            if (IS_DEV) {
              console.log('⏳ [AutoSync] Utilisateur en train de taper (global), sync différé de 3s');
            }
            syncDebounceRef.current = setTimeout(() => {
              if (isUserCurrentlyTyping()) return; // Encore en train de taper
              const savedUIState = saveUIState();
              const savedTop = captureScrollTop();
              startTransition(() => {
                loadProducts()
                  .then(() => {
                    restoreScrollTopIfJumped(savedTop);
                    restoreUIState(savedUIState);
                  })
                  .catch(() => {});
              });
            }, 3000);
            return;
          }
          
          // ✅ PRÉSERVER L'ÉTAT UI
          const savedUIState = saveUIState();
          const savedTop = captureScrollTop();
          
          // ✅ PRO: startTransition pour ne pas bloquer les inputs
          startTransition(() => {
            loadProducts()
              .then(() => {
                restoreScrollTopIfJumped(savedTop);
                setTimeout(() => restoreUIState(savedUIState), 50);
                if (IS_DEV) {
                  console.log(`✅ [AutoSync] ${data.updated} produit(s) rechargé(s) (UI préservé)`);
                }
              })
              .catch(error => {
                // ✅ Silencieux en production
                if (IS_DEV) {
                  console.error('❌ [AutoSync] Erreur rechargement:', error);
                }
              });
          });
        }, SOCKET_DEBOUNCE_MS);
      }
    };

    socket.on('products:synced', handleProductsSynced);

    if (IS_DEV) {
      console.log('🔗 [ProductsPage] Listener Socket.IO "products:synced" (debounced + startTransition)');
    }

    return () => {
      socket.off('products:synced', handleProductsSynced);
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
      }
      if (IS_DEV) {
        console.log('🔓 [ProductsPage] Listener Socket.IO "products:synced" désabonné');
      }
    };
  }, [socket, captureScrollTop, loadProducts, restoreScrollTopIfJumped]);

  // ✅ PRO: Socket.IO listener pour confirmation de suppression produit
  useEffect(() => {
    if (!socket) return;

    const handleProductDeleted = (data) => {
      const code = data?.code || data?.product_code;
      if (!code) return;
      
      if (IS_DEV) {
        console.log('🗑️ [Socket] Event "product:deleted" reçu:', code);
      }

      // Supprimer du pending deletions (sync confirmée)
      pendingDeletionsRef.current.delete(code);
      
      // S'assurer que le produit n'est plus dans le store
      const currentStore = useStore.getState();
      const stillExists = (currentStore.products || []).some(p => {
        const pCode = String(p.code || p.product_code || '').trim();
        return pCode === code;
      });
      
      if (stillExists) {
        // Le produit est encore là (peut-être rechargé par un pull) → le supprimer
        const updatedProducts = (currentStore.products || []).filter(p => {
          const pCode = String(p.code || p.product_code || '').trim();
          return pCode !== code;
        });
        useStore.setState({ products: updatedProducts }, false);
        
        if (IS_DEV) {
          console.log(`🗑️ [Socket] Produit ${code} supprimé du store (confirmation sync)`);
        }
      }
      
      showSuccess(`✅ Produit "${code}" synchronisé - supprimé de Sheets`);
    };

    socket.on('product:deleted', handleProductDeleted);

    if (IS_DEV) {
      console.log('🔗 [ProductsPage] Listener Socket.IO "product:deleted" enregistré');
    }

    return () => {
      socket.off('product:deleted', handleProductDeleted);
      if (IS_DEV) {
        console.log('🔓 [ProductsPage] Listener Socket.IO "product:deleted" désabonné');
      }
    };
  }, [socket, showSuccess]);

  // Fonction helper pour obtenir les headers d'authentification (optimisée)
  const getAuthHeaders = useCallback(() => {
    if (!authToken) {
      // Warning une seule fois
      if (IS_DEV && !warnedRef.current.missingToken) {
        console.warn('⚠️ [ProductsPage] Aucun token → mode offline (offline-token)');
        warnedRef.current.missingToken = true;
      }
      return { headers: { Authorization: `Bearer ${OFFLINE_BEARER}` } };
    }
    
    return { headers: { Authorization: `Bearer ${authToken}` } };
  }, [authToken]);

  // Calculer FC depuis USD
  const calculateFC = useCallback((usd) => {
    return Math.round((usd || 0) * (currentRate || 2800));
  }, [currentRate]);

  // Calculer USD depuis FC
  const calculateUSD = useCallback((fc) => {
    return Number(((fc || 0) / (currentRate || 2800)).toFixed(2));
  }, [currentRate]);

  // ✅ HELPERS: Payload normalization + bump last_update
  const nowISO = () => new Date().toISOString();

  const normalizeMark = (v) => {
    const s = String(v ?? '').trim();
    return s; // ✅ Jamais null - retourne '' si vide (DB-safe)
  };

  const omitUndefined = (obj) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

  const toNumberSafe = (v, fallback = 0) => {
    const s = String(v ?? '').trim();
    if (s === '') return fallback;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : fallback;
  };

  // Construit une unit "safe" (sans created_at/updated_at etc.)
  const buildUnitPayload = (u, overrides = {}) => {
    const merged = { ...u, ...overrides };

    // ✅ PRO Pattern: Mark est MODIFIABLE, jamais utilisé pour identification
    // Ne l'envoyer que s'il existe et a été modifié ou qu'il existe déjà
    const result = omitUndefined({
      id: merged.id, // important pour identifier l'unité
      unit_level: merged.unit_level,
      
      // ⚠️ ATTENTION: unit_mark MODIFIABLE
      // Seulement envoyer si:
      // 1. L'utilisateur l'a modifié (dans overrides)
      // 2. Ou s'il existe déjà dans la base (merged.unit_mark !== undefined)
      ...(overrides.unit_mark !== undefined 
        ? { unit_mark: normalizeMark(overrides.unit_mark) }
        : merged.unit_mark !== undefined
          ? { unit_mark: normalizeMark(merged.unit_mark) }
          : {}),

      stock_initial: merged.stock_initial !== undefined ? toNumberSafe(merged.stock_initial, 0) : undefined,
      stock_current: merged.stock_current !== undefined ? toNumberSafe(merged.stock_current, 0) : undefined,

      purchase_price_usd: merged.purchase_price_usd !== undefined ? toNumberSafe(merged.purchase_price_usd, 0) : undefined,
      sale_price_usd: merged.sale_price_usd !== undefined ? toNumberSafe(merged.sale_price_usd, 0) : undefined,

      auto_stock_factor: merged.auto_stock_factor !== undefined ? Math.round(toNumberSafe(merged.auto_stock_factor, 1)) : undefined,
      qty_step: merged.qty_step !== undefined ? Math.round(toNumberSafe(merged.qty_step, 1)) : undefined,

      extra1: merged.extra1 ?? null,
      extra2: merged.extra2 ?? null,
      
      // ✅ CRITIQUE: UUID STABLE - DOIT ÊTRE ENVOYÉ pour identifier l'unité au backend
      // Le backend utilise uuid pour retrouver l'unité existante et la modifier
      // Ne JAMAIS envoyer undefined - on le laisse absent du payload plutôt
      ...(merged.uuid ? { uuid: merged.uuid } : {}),

      // ✅ champs de sync
      last_update: merged.last_update || nowISO(),
      synced_at: merged.synced_at ?? null,
    });

    return result;
  };

  // Endpoint: utilise ID si dispo, sinon code
  const getProductKeyFromRow = (row) => row?.product_id ?? row?.product_code;

  // ✅ Affichage "optimiste" post-save (ou pendant sync)
  const setVisualForRow = useCallback((rowId, patch, ttlMs = 8000) => {
    setVisualValues((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || {}), ...patch },
    }));

    const old = visualValuesTimeoutsRef.current.get(rowId);
    if (old) clearTimeout(old);

    const t = setTimeout(() => {
      setVisualValues((prev) => {
        const copy = { ...prev };
        delete copy[rowId];
        return copy;
      });
      visualValuesTimeoutsRef.current.delete(rowId);
    }, ttlMs);

    visualValuesTimeoutsRef.current.set(rowId, t);
  }, []);

  // Transformer les produits en format tableau - simplifié et protégé
  const tableData = useMemo(() => {
    try {
      const rows = [];
      
      if (!Array.isArray(products)) {
        return rows;
      }
      
      products.forEach((product, pIndex) => {
        try {
          if (!product || !product.units || !Array.isArray(product.units)) return;
          
          product.units.forEach((unit, uIndex) => {
            try {
              // Filtrer selon l'unité
              if (activeFilter !== 'TOUS') {
                if (activeFilter === 'CARTON' && unit.unit_level !== 'CARTON') return;
                if (activeFilter === 'DETAIL' && unit.unit_level !== 'MILLIER') return;
                if (activeFilter === 'PIECE' && unit.unit_level !== 'PIECE') return;
              }
              
              const salePriceUSD = Number(unit.sale_price_usd) || 0;
              const calculatedFC = calculateFC(salePriceUSD);
              
              // ✅ CORRECTION A: Créer une clé VRAIMENT unique et déterministe
              // Inclure: product_code + unit_level + unit_uuid (pas d'index qui peut varier)
              const productKey = String(product.code ?? product.id ?? `p${pIndex}`);
              const unitKey = String(unit.uuid ?? unit.id ?? `u${uIndex}`);
              const rowId = `${productKey}:${unit.unit_level}:${unitKey}`; // Format déterministe
              
              // ✅ CORRECTION B: Valider unit_mark (arrêter de l'effacer si c'est 'MILLIER')
              // unit_mark est le marking/label RÉEL de la BD (ex: 'MILLIER' peut être un vrai mark)
              // On ne l'efface que si c'est réellement une unité-level (CARTON) qui a MILLIER dessus (cas rare)
              let normalizedUnitMark = String(unit.unit_mark ?? '').trim();
              // Optionnel: interdire 'MILLIER' comme mark SUR CARTON seulement (si métier l'exige)
              if (unit.unit_level === 'CARTON' && normalizedUnitMark.toUpperCase() === 'MILLIER') {
                normalizedUnitMark = '';
              }
              
              rows.push({
                id: rowId, // ✅ Clé unique et déterministe par ligne
                product_id: product.id,
                product_code: product.code || '',
                product_name: product.name || '',
                unit_id: unit.id,
                unit_uuid: unit.uuid ?? null,                    // ✅ utile si id absent / sync
                unit_level: unit.unit_level || '',
                unit_mark: normalizedUnitMark, // ✅ CORRIGÉ: valeur validée
                stock_current: Number(unit.stock_current) || 0,
                sale_price_usd: salePriceUSD,
                sale_price_fc: calculatedFC,
                purchase_price_usd: Number(unit.purchase_price_usd) || 0,
                // NOUVEAU: Automatisation Stock (seuil d'alerte stock)
                auto_stock_factor: (unit.auto_stock_factor ?? 1), // ✅ 0 reste 0
              });
            } catch (err) {
              if (IS_DEV) {
                console.error('Erreur traitement unité:', err);
              }
            }
          });
        } catch (err) {
          if (IS_DEV) {
            console.error('Erreur traitement produit:', err);
          }
        }
      });
      
      // Ajouter seulement 5 lignes vides pour réduire la charge
      for (let i = 0; i < 5; i++) {
        rows.push({
          id: `empty-${i}`,
          is_empty: true,
          product_code: '',
          product_name: '',
          unit_level: activeFilter === 'TOUS' ? '' : activeFilter === 'DETAIL' ? 'MILLIER' : activeFilter,
          unit_mark: '',
          stock_current: 0,
          sale_price_usd: 0,
          sale_price_fc: 0,
          purchase_price_usd: 0,
          auto_stock_factor: 1,
        });
      }
      
      return rows;
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur calcul tableData:', error);
      }
      return [];
    }
  }, [products, activeFilter, calculateFC]);

  // ✅ Accès O(1) aux lignes (évite tableData.find dans les boucles de save)
  const tableDataById = useMemo(() => {
    const map = new Map();
    for (const row of tableData) {
      if (row?.id != null) map.set(row.id, row);
    }
    return map;
  }, [tableData]);

  // Fonction pour générer un code automatique intelligent
  const generateAutoCode = useCallback((unitLevel) => {
    if (unitLevel !== 'CARTON') return null;
    if (!Array.isArray(products)) return 'PROD-1';
    
    try {
      // Extraire tous les codes numériques existants
      const codes = products
        .map(p => {
          if (!p || !p.code || typeof p.code !== 'string') return null;
          try {
            const match = p.code.match(/(\d+)$/);
            return match ? parseInt(match[1], 10) : null;
          } catch {
            return null;
          }
        })
        .filter(c => c !== null && !isNaN(c))
        .sort((a, b) => b - a);
      
      if (codes.length === 0) return 'PROD-1';
      
      // Prendre le dernier chiffre et ajouter 1
      const lastCode = codes[0];
      return `PROD-${lastCode + 1}`;
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur génération code:', error);
      }
      return 'PROD-1';
    }
  }, [products]);

  // Filtrer selon la recherche - simplifié et protégé
  const filteredData = useMemo(() => {
    try {
      if (!Array.isArray(tableData)) return [];
      if (!searchQuery.trim()) return tableData;
      
      const query = searchQuery.toLowerCase();
      const matched = tableData.filter(row => {
        try {
          if (row.is_empty) return false;
          const name = String(row.product_name || '').toLowerCase();
          const code = String(row.product_code || '').toLowerCase();
          const mark = String(row.unit_mark || '').toLowerCase();
          return name.includes(query) || code.includes(query) || mark.includes(query);
        } catch (err) {
          return false;
        }
      });
      
      const emptyRows = tableData.filter(row => row.is_empty);
      return [...matched, ...emptyRows];
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur filtrage:', error);
      }
      return Array.isArray(tableData) ? tableData : [];
    }
  }, [tableData, searchQuery]);

  // Supprimer le système de hover JavaScript pour éviter les décalages
  // Utiliser uniquement CSS pour le hover

  // Navigation : trouver le dernier produit réel (non vide)
  const lastRealProductIndex = useMemo(() => {
    for (let i = filteredData.length - 1; i >= 0; i--) {
      if (!filteredData[i].is_empty) {
        return i;
      }
    }
    return -1;
  }, [filteredData]);

  // ✅ Virtualisation de table : rendre seulement les lignes visibles
  const rowVirtualizer = useVirtualizer({
    count: Array.isArray(filteredData) ? filteredData.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 56, // Hauteur estimée d'une ligne (py-3 = ~56px)
    overscan: 10, // Buffer de lignes hors écran pour smooth scroll
    measureElement: typeof window !== 'undefined' ? (el) => el?.getBoundingClientRect().height : undefined,
  });

  // Navigation : scroll vers le bas (dernier produit) - virtualisé
  const scrollToBottom = useCallback(() => {
    if (lastRealProductIndex === -1) return;
    try {
      rowVirtualizer.scrollToIndex(lastRealProductIndex, { align: 'center' });
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur scrollToBottom (virtualisé):', error);
      }
    }
  }, [lastRealProductIndex, rowVirtualizer]);

  // Navigation : scroll vers le haut
  const scrollToTop = useCallback(() => {
    try {
      rowVirtualizer.scrollToOffset(0);
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur scrollToTop (virtualisé):', error);
      }
    }
  }, [rowVirtualizer]);

  // Vérifier la position de scroll - protégé pour Electron
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    
    const handleScroll = () => {
      try {
        if (scrollCheckTimeoutRef.current) {
          cancelAnimationFrame(scrollCheckTimeoutRef.current);
        }
        
        scrollCheckTimeoutRef.current = requestAnimationFrame(() => {
          try {
            const scrollContainer = scrollContainerRef.current;
            
            if (!scrollContainer) {
              if (typeof window !== 'undefined') {
                const scrollY = window.scrollY || window.pageYOffset || 0;
                const windowHeight = window.innerHeight || 0;
                const documentHeight = document?.documentElement?.scrollHeight || 0;
                
                if (scrollY < 100) {
                  setScrollPosition('top');
                } else if (scrollY + windowHeight >= documentHeight - 100) {
                  setScrollPosition('bottom');
                } else {
                  setScrollPosition('middle');
                }
              }
              return;
            }
            
            const scrollTop = scrollContainer.scrollTop || 0;
            const scrollHeight = scrollContainer.scrollHeight || 0;
            const clientHeight = scrollContainer.clientHeight || 0;
            const scrollPercentage = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
            
            if (scrollPercentage < 0.1 || scrollTop < 50) {
              setScrollPosition('top');
            } else if (scrollPercentage > 0.9 || scrollHeight - scrollTop <= clientHeight + 50) {
              setScrollPosition('bottom');
            } else {
              setScrollPosition('middle');
            }
          } catch (err) {
            if (IS_DEV) {
              console.error('Erreur calcul scroll:', err);
            }
          }
        });
      } catch (error) {
        if (IS_DEV) {
          console.error('Erreur handleScroll:', error);
        }
      }
    };

    try {
      const scrollContainer = scrollContainerRef.current;
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();

        return () => {
          if (scrollContainer.removeEventListener) {
            scrollContainer.removeEventListener('scroll', handleScroll);
          }
          if (scrollCheckTimeoutRef.current) {
            cancelAnimationFrame(scrollCheckTimeoutRef.current);
          }
        };
      }

      // Fallback (rare): si le conteneur n'existe pas, on observe le scroll global
      if (window?.addEventListener) {
        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
        return () => {
          window?.removeEventListener?.('scroll', handleScroll);
          if (scrollCheckTimeoutRef.current) {
            cancelAnimationFrame(scrollCheckTimeoutRef.current);
          }
        };
      }
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur setup scroll:', error);
      }
    }
  }, [filteredData]);

  // ✅ Obtenir le code du produit depuis la ligne
  const getProductCode = (row) => {
    // ✅ IMPORTANT: Utiliser product_code, PAS product_id (product_id est un ID numérique)
    // L'API attend un code pour les endpoints GET/PUT /:code
    return row?.product_code || '';
  };

  // Créer un produit
  // IMPORTANT: USD est toujours la source de vérité, FC est calculé côté backend
  const handleCreateProduct = useCallback(async (row, edits) => {
    const unitLevel = row.unit_level || edits?.unit_level || 'CARTON';
    const productName = (edits?.product_name || row.product_name || '').trim();
    
    // ✅ PRO FIX: Si le nom est vide sur une ligne vide, c'est une "création annulée"
    // Ne pas afficher d'erreur, juste ignorer silencieusement
    if (!productName) {
      if (row?.is_empty) {
        // Création annulée silencieusement - l'utilisateur a vidé le champ
        if (IS_DEV) console.log('⏹️ [handleCreateProduct] Création annulée - champ vide');
        throw new Error('Annulé'); // ✅ Ce message spécial est ignoré par le catch
      }
      throw new Error('Le nom du produit est requis');
    }

    // ✅ FIX PRO: Mark peut être vide - l'utilisateur est libre
    const mark = normalizeMark(edits?.unit_mark);
    
    // Calculer USD depuis les edits (si FC modifié, convertir en USD)
    // ✅ Convertir en string d'abord pour s'assurer qu'on parse la valeur complète
    let salePriceUSD = 0;
    if (edits?.sale_price_usd !== undefined) {
      const usdStr = String(edits.sale_price_usd || '').trim();
      if (usdStr !== '') {
        const parsed = parseFloat(usdStr);
        if (!isNaN(parsed) && isFinite(parsed)) {
          salePriceUSD = parsed;
        }
      }
    }
    if (!salePriceUSD && edits?.sale_price_fc !== undefined) {
      // Si seulement FC est fourni, calculer USD depuis FC
      const fcStr = String(edits.sale_price_fc || '').trim();
      if (fcStr !== '') {
        const parsed = parseFloat(fcStr);
        if (!isNaN(parsed) && isFinite(parsed)) {
          salePriceUSD = calculateUSD(parsed);
        }
      }
    }
    
    // Pour MILLIER et PIECE, vérifier si existe en CARTON
    if (unitLevel === 'MILLIER' || unitLevel === 'PIECE') {
      // ✅ FIX PRO: Si l'utilisateur a sélectionné un produit depuis les suggestions, utiliser son code
      const linkedProductCode = edits?._link_to_product;
      
      if (IS_DEV) {
        console.log('🔍 [handleCreateProduct] Recherche CARTON pour MILLIER/PIECE:', {
          linkedProductCode,
          productName,
          unitLevel,
          productsCount: products?.length
        });
      }
      
      // Rechercher un produit avec le même nom (ou code lié) qui a une unité CARTON
      const existingCarton = Array.isArray(products) ? products.find(p => {
        if (!p || !p.name || typeof p.name !== 'string') return false;
        try {
          // Si un code lié est fourni, chercher par code
          if (linkedProductCode) {
            const match = p.code === linkedProductCode || p.id === linkedProductCode;
            if (match && IS_DEV) {
              console.log('✅ [handleCreateProduct] CARTON trouvé par code lié:', p.name, p.code);
            }
            return match;
          }
          // Sinon chercher par nom
          const nameMatch = p.name.toLowerCase().trim() === productName.toLowerCase().trim();
          const hasCarton = Array.isArray(p.units) && p.units.some(u => u && u.unit_level === 'CARTON');
          return nameMatch && hasCarton;
        } catch {
          return false;
        }
      }) : null;
      
      if (existingCarton) {
        const auth = getAuthHeaders();
        // ✅ FIX CRITIQUE: Utiliser CODE (pas ID numérique) - l'API attend /api/products/:code
        const productKey = existingCarton.code || existingCarton.id;
        
        if (IS_DEV) {
          console.log('🔗 [handleCreateProduct] Utilisation productKey:', productKey, '(code:', existingCarton.code, ', id:', existingCarton.id, ')');
        }

        // Reprendre le produit "frais" (évite unités périmées)
        let currentProduct = existingCarton;
        try {
          const r = await axios.get(`${API_URL}/api/products/${productKey}`, auth);
          currentProduct = r.data;
        } catch (err) {
          // si GET échoue, on fallback sur existingCarton
          if (IS_DEV) console.warn('⚠️ GET produit échoué, fallback:', err.message);
        }

        const now = nowISO();

        // ✅ valeurs numériques propres
        const stockValue = toNumberSafe(edits?.stock_current, 0);
        const purchaseValue = toNumberSafe(edits?.purchase_price_usd, 0);

        const autoStock = Math.round(toNumberSafe(edits?.auto_stock_factor, 1));
        
        // ✅ FIX CRITIQUE: NOUVELLE unité = PAS d'UUID (le backend le génère)
        // Ne pas utiliser buildUnitPayload qui pourrait copier un UUID existant
        const newUnit = {
          unit_level: unitLevel,
          unit_mark: mark || '', // ✅ Mark peut être vide
          stock_current: stockValue,
          purchase_price_usd: purchaseValue,
          sale_price_usd: salePriceUSD, // USD source de vérité
          auto_stock_factor: autoStock,
          qty_step: 1,
          extra1: null,
          extra2: null,
          last_update: now,
          synced_at: null,
          // ⚠️ PAS de uuid ici - le backend le génère pour nouvelle unité
        };

        const safeUnits = (currentProduct.units || []).map((u) => buildUnitPayload(u));
        safeUnits.push(newUnit);

        const payload = {
          name: currentProduct.name,
          units: safeUnits,
        };

        // ✅ UPDATE (pas POST)
        await axios.put(`${API_URL}/api/products/${productKey}`, payload, auth);
        return;
      } else {
        // ✅ FIX: Pas de modal - juste un message d'info et on annule silencieusement
        // L'utilisateur doit d'abord sélectionner un produit CARTON existant dans les suggestions
        showInfo(`⚠️ Créez d'abord un produit CARTON avec ce nom, puis ajoutez l'unité ${unitLevel}`);
        
        // Nettoyer la ligne vide (ne pas la laisser en erreur)
        if (row?.id) {
          pendingSavesRef.current.delete(row.id);
          setEditingValues(prev => {
            const copy = { ...prev };
            delete copy[row.id];
            return copy;
          });
        }
        
        // Annuler silencieusement (pas d'erreur console)
        return;
      }
    } else {
      // CARTON peut être créé directement MAIS vérifier si le nom existe déjà
      
      // ✅ PRO FIX: Vérifier si un produit avec le même nom existe déjà (case-insensitive)
      const existingProduct = Array.isArray(products) ? products.find(p => {
        if (!p || !p.name || typeof p.name !== 'string') return false;
        return p.name.toLowerCase().trim() === productName.toLowerCase().trim();
      }) : null;
      
      if (existingProduct) {
        // ✅ Le produit existe déjà - ne pas recréer
        // Vérifier s'il a déjà une unité CARTON
        const hasCarton = Array.isArray(existingProduct.units) && 
          existingProduct.units.some(u => u && u.unit_level === 'CARTON');
        
        if (hasCarton) {
          showInfo(`⚠️ Le produit "${existingProduct.name}" existe déjà en CARTON. Sélectionnez-le dans la liste.`);
        } else {
          // Le produit existe mais sans CARTON - ajouter l'unité CARTON
          showInfo(`ℹ️ Ajout de l'unité CARTON au produit existant "${existingProduct.name}"`);
          
          const auth = getAuthHeaders();
          const productKey = existingProduct.code || existingProduct.id;
          
          // Récupérer le produit frais
          let currentProduct = existingProduct;
          try {
            const r = await axios.get(`${API_URL}/api/products/${productKey}`, auth);
            currentProduct = r.data;
          } catch (err) {
            if (IS_DEV) console.warn('⚠️ GET produit échoué, fallback:', err.message);
          }
          
          const stockStr = String(edits?.stock_current || '').trim();
          const stockValue = stockStr !== '' ? (parseFloat(stockStr) || 0) : 0;
          const purchaseStr = String(edits?.purchase_price_usd || '').trim();
          const purchaseValue = purchaseStr !== '' ? (parseFloat(purchaseStr) || 0) : 0;
          const autoStock = Math.round(toNumberSafe(edits?.auto_stock_factor, 1));
          
          const newUnit = {
            unit_level: 'CARTON',
            unit_mark: mark || '',
            stock_current: stockValue,
            sale_price_usd: salePriceUSD,
            purchase_price_usd: purchaseValue,
            auto_stock_factor: autoStock,
            qty_step: 1,
            last_update: nowISO(),
          };
          
          const safeUnits = (currentProduct.units || []).map((u) => buildUnitPayload(u));
          safeUnits.push(newUnit);
          
          await axios.put(`${API_URL}/api/products/${productKey}`, {
            name: currentProduct.name,
            units: safeUnits,
          }, auth);
          
          return;
        }
        
        // Nettoyer la ligne vide
        if (row?.id) {
          pendingSavesRef.current.delete(row.id);
          setEditingValues(prev => {
            const copy = { ...prev };
            delete copy[row.id];
            return copy;
          });
        }
        return;
      }
      
      // ✅ Nouveau produit - créer
      const code = edits?.product_code || `PROD-${Date.now()}`;
      // ✅ Parser correctement les valeurs numériques
      const stockStr = String(edits?.stock_current || '').trim();
      const stockValue = stockStr !== '' ? (parseFloat(stockStr) || 0) : 0;
      const purchaseStr = String(edits?.purchase_price_usd || '').trim();
      const purchaseValue = purchaseStr !== '' ? (parseFloat(purchaseStr) || 0) : 0;
      
      const autoStock = Math.round(toNumberSafe(edits?.auto_stock_factor, 1));
      const unitPayload = {
        unit_level: 'CARTON',
        unit_mark: mark || '', // ✅ Mark peut être vide
        stock_current: stockValue,
        sale_price_usd: salePriceUSD, // USD comme source de vérité
        // Ne pas envoyer sale_price_fc, le backend le calculera depuis USD
        purchase_price_usd: purchaseValue,
        auto_stock_factor: autoStock,
      };
      await axios.post(`${API_URL}/api/products`, {
        code,
        name: productName,
        units: [unitPayload]
      }, getAuthHeaders());
    }
  }, [products, calculateFC, calculateUSD, getAuthHeaders, showInfo]);

  // Mettre à jour un produit
  // IMPORTANT: USD est la source de vérité; FC est dérivé (backend + UI)
  const handleUpdateProduct = useCallback(async (row, edits) => {
    if (!row || row.is_empty) return;

    const auth = getAuthHeaders(); // ✅ défini ici pour être dispo dans catch
    // ✅ CORRECTION: Utiliser product_code (pas product_id) car l'API attend /api/products/:code
    const productCode = getProductCode(row);
    if (!productCode) {
      throw new Error('Code produit invalide');
    }

    // --- construire unitUpdates (sans sale_price_fc) ---
    const unitUpdates = {};
    let productNameUpdate;

    // Prix: si FC modifié => calcul USD; sinon si USD modifié => USD direct
    if (edits.sale_price_fc !== undefined) {
      const fc = toNumberSafe(edits.sale_price_fc, NaN);
      if (!Number.isFinite(fc)) return; // valeur invalide => ne pas save
      unitUpdates.sale_price_usd = calculateUSD(fc);
    } else if (edits.sale_price_usd !== undefined) {
      const usd = toNumberSafe(edits.sale_price_usd, NaN);
      if (!Number.isFinite(usd)) return;
      unitUpdates.sale_price_usd = usd;
    }

    if (edits.stock_current !== undefined) unitUpdates.stock_current = toNumberSafe(edits.stock_current, 0);
    if (edits.purchase_price_usd !== undefined) unitUpdates.purchase_price_usd = toNumberSafe(edits.purchase_price_usd, 0);

    if (edits.auto_stock_factor !== undefined) unitUpdates.auto_stock_factor = Math.round(toNumberSafe(edits.auto_stock_factor, 1));
    if (edits.unit_mark !== undefined) {
      // ✅ FIX PRO: L'utilisateur peut modifier le Mark librement (y compris vide)
      unitUpdates.unit_mark = normalizeMark(edits.unit_mark);
    }

    if (edits.product_name !== undefined) productNameUpdate = String(edits.product_name ?? '').trim();

    // ✅ RETRY AUTOMATIQUE: Si erreur temporaire, réessayer jusqu'à 3 fois
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const productResponse = await axios.get(`${API_URL}/api/products/${productCode}`, auth);
        const currentProduct = productResponse.data;

        const now = nowISO();

        // ✅ update uniquement l'unité ciblée + bump last_update + synced_at=null
        const updatedUnits = (currentProduct.units || []).map((u) => {
          const isTargetUnit =
            (u?.id != null && row.unit_id != null && u.id === row.unit_id) ||
            (u?.uuid && row.unit_uuid && u.uuid === row.unit_uuid);
          if (isTargetUnit) {
            const merged = { ...u, ...unitUpdates };
            return buildUnitPayload(merged, { last_update: now, synced_at: null });
          }
          // autres unités: payload propre, on ne bump pas
          return buildUnitPayload(u);
        });

        const updatePayload = {
          name: productNameUpdate || currentProduct.name,
          units: updatedUnits,
        };

        // ✅ DEBUG: Vérifier que unit_mark est bien dans le payload
        if (IS_DEV && attempt === 1) {
          const targetUnit = updatedUnits.find(u => u.id === row.unit_id);
          console.log('📋 [handleUpdateProduct] DEBUG unit_mark:');
          console.log('   ├─ edits.unit_mark (raw):', edits?.unit_mark);
          console.log('   ├─ unitUpdates.unit_mark:', unitUpdates.unit_mark);
          console.log('   └─ payload.unit_mark:', targetUnit?.unit_mark);
        }

        if (IS_DEV && attempt === 1) {
          console.log(`📤 [ProductsPage] PUT /api/products/${productCode}`);
          console.log('   Payload:', JSON.stringify(updatePayload, null, 2));
        }

        const response = await axios.put(`${API_URL}/api/products/${productCode}`, updatePayload, auth);

        if (IS_DEV) {
          console.log('✅ [ProductsPage] Produit mis à jour:', response.data);
        }

        // ✅ Succès - sortir de la boucle de retry
        return;

      } catch (error) {
        lastError = error;
        
        // ✅ Vérifier si c'est une erreur temporaire (409 Conflict, 503 Service Unavailable, timeout, etc.)
        const statusCode = error.response?.status;
        const isTemporaryError = statusCode === 409 || statusCode === 503 || !statusCode; // 409=Conflict, 503=Unavailable, no status=timeout/network
        
        if (attempt === 1) {
          if (IS_DEV) {
            console.error(`❌ [ProductsPage] Tentative ${attempt}/${maxRetries} - Erreur mise à jour produit:`, error);
            console.error('   Status:', statusCode);
            console.error('   Message:', error.response?.data?.error || error.message);
            console.error('   Temporaire:', isTemporaryError);
            console.error('   productCode:', productCode);
          }
        }

        // Si c'est une erreur temporaire ET qu'on peut réessayer, attendre puis réessayer
        if (isTemporaryError && attempt < maxRetries) {
          if (IS_DEV) {
            console.log(`⏳ [ProductsPage] Retry ${attempt + 1}/${maxRetries} après 500ms...`);
          }
          await new Promise(r => setTimeout(r, 500 + attempt * 200)); // Délai croissant: 500ms, 700ms, 900ms
          continue; // Réessayer
        }

        // ✅ Erreur non-temporaire ou dernier essai: jeter l'erreur
        throw error;
      }
    }

    // Ne devrait pas arriver ici (lancé dans le try/catch)
    throw lastError;

  }, [getAuthHeaders, calculateUSD, buildUnitPayload, getProductCode]);

  // ✅ PRO: Supprimer un produit avec tracking de suppression pending - NON-BLOQUANT
  const handleDeleteProduct = useCallback(async (row) => {
    if (!row || row.is_empty) return;

    const savedTop = captureScrollTop();

    const productCode = getProductCode(row);
    if (!productCode) {
      showError('Code produit invalide');
      return;
    }

    // ✅ PRO: Éviter double-suppression si déjà en cours
    if (pendingDeletionsRef.current.has(productCode)) {
      showInfo(`Suppression de "${row.product_name}" déjà en cours...`);
      return;
    }

    // Demander confirmation
    const confirmed = window.confirm(
      `Êtes-vous sûr de vouloir supprimer le produit "${row.product_name}" (${productCode})?\n\nLa suppression sera synchronisée avec Google Sheets.`
    );
    if (!confirmed) return;

    // ✅ YIELD TO MAIN THREAD: Permettre au DOM de se mettre à jour après le confirm
    await new Promise(resolve => requestAnimationFrame(resolve));

    // ✅ PRO: Marquer comme pending deletion
    pendingDeletionsRef.current.add(productCode);
    
    // ✅ PRO: UI optimiste - supprimer du store IMMÉDIATEMENT
    const currentStore = useStore.getState();
    const updatedProducts = (currentStore.products || []).filter(p => {
      const pCode = String(p.code || p.product_code || '').trim();
      return pCode !== productCode;
    });
    useStore.setState({ products: updatedProducts }, false);
    
    if (IS_DEV) {
      console.log(`🗑️ [ProductsPage] Suppression optimiste produit: ${productCode}`);
    }
    
    // Afficher message de sync en cours
    setSaveMessage({ type: 'info', text: `Suppression de "${row.product_name}" en cours...` });

    try {
      const auth = getAuthHeaders();
      
      await axios.delete(`${API_URL}/api/products/${productCode}`, auth);

      if (IS_DEV) {
        console.log('✅ [ProductsPage] Produit supprimé en local, sync Sheets en arrière-plan');
      }

      // ✅ PRO: Message de succès - la sync Sheets se fait en arrière-plan
      setSaveMessage({ type: 'success', text: `✅ "${row.product_name}" supprimé - sync Sheets en cours...` });
      setTimeout(() => {
        if (isMountedRef.current) {
          setSaveMessage({ type: '', text: '' });
        }
      }, 3000);
      
      restoreScrollTopIfJumped(savedTop);

      // ✅ PRO: Supprimer du pendingDeletions après délai (le sync worker va s'en occuper)
      // On garde le pending pendant 30s pour éviter que le produit revienne lors d'un pull
      setTimeout(() => {
        pendingDeletionsRef.current.delete(productCode);
        if (IS_DEV) {
          console.log(`🗑️ [ProductsPage] Pending deletion expiré: ${productCode}`);
        }
      }, 30000);

    } catch (error) {
      // ✅ PRO: Rollback - remettre le produit dans le store si erreur
      pendingDeletionsRef.current.delete(productCode);
      
      if (IS_DEV) {
        console.error('❌ [ProductsPage] Erreur suppression produit:', error);
        console.error('   Status:', error.response?.status);
        console.error('   Message:', error.response?.data?.error || error.message);
      }

      // ✅ PRO: Rollback avec startTransition pour ne pas bloquer les inputs
      setTimeout(() => {
        startTransition(() => {
          loadProducts().catch(reloadErr => {
            if (IS_DEV) {
              console.warn('⚠️ Erreur rechargement après rollback:', reloadErr.message);
            }
          });
        });
      }, 16); // 1 frame pour libérer le thread d'abord

      let errorMessage = 'Erreur lors de la suppression';
      if (error.response?.status === 401) {
        errorMessage = 'Erreur d\'authentification. Veuillez vous reconnecter.';
      } else if (error.response?.status === 404) {
        // 404 = produit déjà supprimé, ce n'est pas une erreur
        setSaveMessage({ type: 'success', text: 'Produit déjà supprimé' });
        setTimeout(() => setSaveMessage({ type: '', text: '' }), 2000);
        return;
      } else {
        errorMessage = error.response?.data?.error || errorMessage;
      }

      showError(errorMessage);
    }
  }, [captureScrollTop, getAuthHeaders, getProductCode, loadProducts, restoreScrollTopIfJumped, showError, showInfo]);

  // Sauvegarder les changements en attente avec boucle (défini avant scheduleSave)
  // ✅ Utilise une boucle au lieu d'un lock pour éviter de perdre les modifications pendant la sauvegarde
  const savePendingChanges = useCallback(async () => {
    const savedTop = captureScrollTop();

    // Empêcher la ré-entrée
    if (savingLoopRef.current) {
      if (IS_DEV) {
        console.log('⏸️ [ProductsPage] Boucle de sauvegarde déjà en cours');
      }
      return;
    }
    
    savingLoopRef.current = true;
    if (isMountedRef.current) {
      setSaving(true);
      setSaveMessage({ type: 'info', text: 'Sauvegarde en cours...' });
    }
    
    try {
      // ✅ FIX #3: Track creation flag en dehors de la boucle
      let hadCreation = false;
      
      // ✅ Boucle pour traiter tous les changements, même ceux qui arrivent pendant la sauvegarde
      while (pendingSavesRef.current.size > 0) {
        // Prendre un snapshot puis vider immédiatement (les nouveaux edits peuvent être ajoutés pendant la requête)
        const batch = Array.from(pendingSavesRef.current.keys());
        pendingSavesRef.current.clear();
        
        if (IS_DEV) {
          console.log(`💾 [ProductsPage] Sauvegarde de ${batch.length} produit(s) dans cette itération`);
        }
        
        const batchSize = 12;
        const yieldToUI = () => new Promise((resolve) => {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
          } else {
            setTimeout(resolve, 0);
          }
        });

        for (let start = 0; start < batch.length; start += batchSize) {
          const chunk = batch.slice(start, start + batchSize);

          const promises = chunk.map(async (rowId) => {
            const row = tableDataById.get(rowId);
          // ✅ Utiliser editingValuesRef pour éviter les closures stale
          const editsRaw = editingValuesRef.current[rowId];
          if (!row || !editsRaw) return;
          
          // ✅ Corriger le bug USD/FC : utiliser le dernier champ prix édité
          const edits = { ...editsRaw };
          const lastPriceField = lastPriceEditedRef.current.get(rowId);
          
          // Supprimer le champ dérivé pour ne garder que la source de vérité
          if (lastPriceField === 'sale_price_usd') {
            delete edits.sale_price_fc; // USD est la source, FC est dérivé
          } else if (lastPriceField === 'sale_price_fc') {
            delete edits.sale_price_usd; // FC est la source, USD sera calculé
          }
          
          if (IS_DEV) {
            console.log(`   📦 ${rowId}:`, {
              produit: row?.product_code || 'Nouveau',
              'dernier champ prix': lastPriceField,
              edits: edits,
              'sale_price_fc (raw)': edits?.sale_price_fc,
              'sale_price_usd (raw)': edits?.sale_price_usd,
            });
          }
          
          // Si c'est une ligne vide, créer le produit
          if (row.is_empty) {
            // ✅ PRO FIX: Ne pas tenter de créer si le nom est vide (garder les autres edits comme unit_level)
            const productName = (edits?.product_name || row.product_name || '').trim();
            if (!productName) {
              if (IS_DEV) console.log(`⏹️ [ProductsPage] Création différée - nom vide pour ${rowId}, garder les edits`);
              // ✅ Ne PAS supprimer les edits (unit_level, etc.) - juste retirer du pending
              pendingSavesRef.current.delete(rowId);
              return; // Pas de création, garder les edits pour plus tard
            }
            
            hadCreation = true; // ✅ FIX #3: tracker la création
            return handleCreateProduct(row, edits).catch(err => {
              // ✅ FIX: Ignorer les annulations silencieusement (pas d'erreur console)
              if (err?.message === 'Annulé') {
                if (IS_DEV) console.log(`⏹️ [ProductsPage] Création annulée pour ${rowId}`);
                // ✅ PRO: Nettoyer seulement le pending, garder les edits (unit_level sélectionné, etc.)
                pendingSavesRef.current.delete(rowId);
                return; // Pas de throw, juste ignorer
              }
              if (IS_DEV) {
                console.error(`❌ [ProductsPage] Erreur création produit ${rowId}:`, err);
                console.error('   Code:', err.response?.status);
                console.error('   Message:', err.response?.data?.error || err.message);
              }
              throw err;
            });
          }
          
          // ✅ PRO: Vérifier que les données ont RÉELLEMENT changé (évite 409 sur update inutile)
          const hasActualChanges = () => {
            if (edits.product_name !== undefined && String(edits.product_name ?? '').trim() !== String(row.product_name ?? '').trim()) return true;
            if (edits.unit_mark !== undefined && normalizeMark(edits.unit_mark) !== normalizeMark(row.unit_mark)) return true;
            if (edits.stock_current !== undefined && toNumberSafe(edits.stock_current, 0) !== toNumberSafe(row.stock_current, 0)) return true;
            if (edits.purchase_price_usd !== undefined && toNumberSafe(edits.purchase_price_usd, 0) !== toNumberSafe(row.purchase_price_usd, 0)) return true;
            
            const lastPriceField = lastPriceEditedRef.current.get(rowId);
            if (lastPriceField === 'sale_price_fc' && edits.sale_price_fc !== undefined) {
              const fc = toNumberSafe(edits.sale_price_fc, 0);
              if (fc !== toNumberSafe(row.sale_price_fc, 0)) return true;
            }
            if (lastPriceField === 'sale_price_usd' && edits.sale_price_usd !== undefined) {
              const usd = toNumberSafe(edits.sale_price_usd, 0);
              if (usd !== toNumberSafe(row.sale_price_usd, 0)) return true;
            }
            
            // ✅ Auto Stock
            if (edits.auto_stock_factor !== undefined) {
              const newVal = Math.round(toNumberSafe(edits.auto_stock_factor, 1));
              const oldVal = Math.round(toNumberSafe(row.auto_stock_factor, 1));
              if (newVal !== oldVal) return true;
            }
            
            return false;
          };
          
          if (!hasActualChanges()) {
            if (IS_DEV) {
              console.log(`⏭️ [savePendingChanges] Aucun changement pour ${rowId}, skip update`);
            }
            // Nettoyer pending et edits
            pendingSavesRef.current.delete(rowId);
            setEditingValues((prev) => {
              const copy = { ...prev };
              delete copy[rowId];
              return copy;
            });
            return; // Skip update
          }
          
          // Sinon, mettre à jour
          return handleUpdateProduct(row, edits).catch(err => {
            if (IS_DEV) {
              console.error(`❌ [ProductsPage] Erreur mise à jour produit ${rowId}:`, err);
              console.error('   Code:', err.response?.status);
              console.error('   Message:', err.response?.data?.error || err.message);
              console.error('   Produit:', row?.product_code);
              console.error('   Token présent:', !!authToken);
            }
            throw err;
          }).then(() => {
            // ✅ UI post-save: afficher tout de suite les valeurs
            const lastPriceField = lastPriceEditedRef.current.get(rowId);
            const patch = {};

            if (edits.product_name !== undefined) patch.product_name = String(edits.product_name ?? '');
            
            // ✅ Normaliser Mark aussi au patch visuel (pas juste au save)
            if (edits.unit_mark !== undefined) {
              const m = normalizeMark(edits.unit_mark);
              // ✅ FIX: Ne pas jeter d'erreur si Mark vide - c'est un champ optionnel
              patch.unit_mark = m;
            }

            if (edits.stock_current !== undefined) patch.stock_current = toNumberSafe(edits.stock_current, 0);
            if (edits.purchase_price_usd !== undefined) patch.purchase_price_usd = toNumberSafe(edits.purchase_price_usd, 0);

            if (lastPriceField === 'sale_price_fc' && edits.sale_price_fc !== undefined) {
              const fc = toNumberSafe(edits.sale_price_fc, 0);
              patch.sale_price_fc = fc;
              patch.sale_price_usd = calculateUSD(fc);
            }
            if (lastPriceField === 'sale_price_usd' && edits.sale_price_usd !== undefined) {
              const usd = toNumberSafe(edits.sale_price_usd, 0);
              patch.sale_price_usd = usd;
              patch.sale_price_fc = calculateFC(usd);
            }

            if (edits.auto_stock_factor !== undefined) {
              patch.auto_stock_factor = Math.round(toNumberSafe(edits.auto_stock_factor, 1));
            }

            setVisualForRow(rowId, patch, 8000);  // ✅ 8s pour le cache visuel
            
            // ✅ PRO: Marquer comme récemment modifié pour animation visuelle
            markRowAsModified(rowId);

            // ✅ nettoyer l'état d'édition après save (mais garder si pending)
            setEditingValues((prev) => {
              // ✅ Si pendant la requête il reste des changements, on ne supprime pas
              if (pendingSavesRef.current.has(rowId)) return prev;

              const copy = { ...prev };
              delete copy[rowId];
              return copy;
            });
          });

          });

          const results = await Promise.allSettled(promises);
          const rejected = results.find((r) => r.status === 'rejected');
          if (rejected && rejected.status === 'rejected') {
            throw rejected.reason;
          }

          // ✅ Yield pour garder l'UI réactive (clics, navigation, scroll)
          await yieldToUI();
        }
        
        // Si de nouveaux changements sont arrivés pendant la sauvegarde, on continue la boucle
        if (IS_DEV && pendingSavesRef.current.size > 0) {
          console.log(`   🔄 Nouveaux changements détectés (${pendingSavesRef.current.size}), nouvelle itération...`);
        }
      }

      if (isMountedRef.current) {
        setSaveMessage({ type: 'success', text: 'Sauvegarde réussie' });
      }
      
      // ✅ PRO: hadCreation reload avec startTransition pour ne pas bloquer les inputs
      if (hadCreation) {
        setTimeout(() => {
          startTransition(() => {
            loadProducts()
              .then(() => restoreScrollTopIfJumped(savedTop))
              .catch(err => {
                if (IS_DEV) console.warn('⚠️ Reload après création:', err.message);
              });
          });
        }, 150);
      }

      // ✅ Conserver le scroll même sans reload (si un rerender a remis en haut)
      restoreScrollTopIfJumped(savedTop);
      
      // Effacer le message après 2 secondes
      setTimeout(() => {
        if (isMountedRef.current) {
          setSaveMessage({ type: '', text: '' });
        }
      }, 2000);
    } catch (error) {
      // ✅ FIX: Ignorer les annulations silencieusement
      if (error?.message === 'Annulé') {
        if (IS_DEV) console.log('⏹️ [ProductsPage] Sauvegarde annulée');
        return;
      }
      
      if (IS_DEV) {
        console.error('❌ [ProductsPage] Erreur sauvegarde:', error);
        console.error('   Code:', error.response?.status);
        console.error('   Message:', error.response?.data?.error || error.message);
        if (error.response?.status === 409) {
          console.error('   📋 Détails UNIQUE:', error.response?.data?.details);  // ✅ Log les détails SQL
        }
        console.error('   Token présent:', !!authToken);
      }
      
      // ✅ Handle UNIQUE constraint errors (e.g., duplicate mark)
      let errorMessage = 'Erreur lors de la sauvegarde';
      if (error.response?.status === 401) {
        errorMessage = 'Erreur d\'authentification. Veuillez vous reconnecter.';
      } else if (error.response?.status === 404) {
        // ✅ AMÉLIORATION: Message 404 plus clair
        errorMessage = '❌ Produit non trouvé. Vérifiez que le code du produit est correct.';
      } else if (error.response?.status === 409) {
        // ✅ PRO FIX: Message d'erreur 409 selon le type de conflit
        const details = error.response?.data?.details || '';
        if (details.includes('uuid')) {
          errorMessage = '❌ Erreur technique: UUID en conflit. Réessayez.';
        } else if (details.includes('unit_level')) {
          errorMessage = '❌ Cette unité existe déjà pour ce produit.';
        } else if (details.includes('unit_mark')) {
          errorMessage = '❌ Ce Mark est déjà utilisé. Choisissez un autre Mark.';
        } else {
          errorMessage = error.response?.data?.error || '❌ Conflit: cette donnée existe déjà.';
        }
      } else {
        errorMessage = error.response?.data?.error || errorMessage;
      }
      
      if (isMountedRef.current) {
        setSaveMessage({ type: 'error', text: errorMessage });
      }
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
      savingLoopRef.current = false; // ✅ Utiliser savingLoopRef au lieu de savingInFlightRef
    }
  }, [captureScrollTop, restoreScrollTopIfJumped, tableDataById, loadProducts, handleCreateProduct, handleUpdateProduct, calculateFC, calculateUSD, setVisualForRow, markRowAsModified]);

  // ✅ AUTO-SAVE IA : save si 5s sans frappe ET la ligne reste active (focus dans la ligne)
  // + save immédiat uniquement quand on quitte réellement la ligne (pas quand on change de cellule dans la même ligne)
  const IDLE_SAVE_MS = 5000;

  // Est-ce que le focus est encore dans la ligne ?
  const isRowFocused = useCallback((rowId) => {
    if (typeof document === 'undefined') return false;
    const el = document.activeElement;
    return !!(el && el.closest && el.closest(`[data-rowid="${rowId}"]`));
  }, []);

  const cancelIdleSave = useCallback((rowId) => {
    const t = idleSaveTimersRef.current.get(rowId);
    if (t) clearTimeout(t);
    idleSaveTimersRef.current.delete(rowId);
  }, []);

  const recordTyping = useCallback((rowId) => {
    lastInputAtRef.current.set(rowId, Date.now());
  }, []);

  // ✅ Save après 5s d'inactivité, seulement si la ligne est toujours active (focus dans la ligne)
  const scheduleIdleSave = useCallback((rowId) => {
    cancelIdleSave(rowId);

    // Marquer dirty
    pendingSavesRef.current.set(rowId, true);

    // init timestamp si absent
    if (!lastInputAtRef.current.has(rowId)) recordTyping(rowId);

    const t = setTimeout(() => {
      const last = lastInputAtRef.current.get(rowId) || 0;
      const idleFor = Date.now() - last;

      // Si l'utilisateur a retapé (ou rendu lent), on réarme
      if (idleFor < IDLE_SAVE_MS - 50) {
        scheduleIdleSave(rowId);
        return;
      }

      // Condition IA demandée : le champ/ligne reste active
      if (!isRowFocused(rowId)) return;

      if (IS_DEV) console.log(`🤖 [AUTO-SAVE IA] 5s inactif → save row=${rowId}`);
      savePendingChanges();
    }, IDLE_SAVE_MS);

    idleSaveTimersRef.current.set(rowId, t);
  }, [cancelIdleSave, isRowFocused, recordTyping, savePendingChanges]);

  // ✅ Save immédiat forcé (Enter, clic dehors, etc.)
  const flushRowNow = useCallback((rowId, reason = 'manual') => {
    cancelIdleSave(rowId);
    
    // ✅ PRO FIX: Si on a des edits pour cette ligne, forcer l'ajout au pending
    // MAIS seulement si le nom est rempli (pour éviter de créer un produit sans nom)
    const edits = editingValuesRef.current?.[rowId];
    const row = tableDataById.get(rowId);
    if (edits && Object.keys(edits).length > 0) {
      // Pour les lignes vides, vérifier que le nom est rempli avant de forcer le pending
      const productName = (edits.product_name ?? row?.product_name ?? '').trim();
      if (!row?.is_empty || productName) {
        pendingSavesRef.current.set(rowId, true);
      }
    }
    
    if (!pendingSavesRef.current.has(rowId)) return;
    if (IS_DEV) console.log(`⚡ [AUTO-SAVE IA] ${reason} → save immédiat row=${rowId}`);
    savePendingChanges();
  }, [cancelIdleSave, savePendingChanges, tableDataById]);

  // ✅ Blur intelligent :
  // - si le focus reste dans la même ligne (autre cellule) => PAS de save immédiat (groupage)
  // - si le focus sort de la ligne => save immédiat
  const smartBlurRow = useCallback((rowId) => {
    cancelIdleSave(rowId);

    requestAnimationFrame(() => {
      // Focus encore dans la ligne => on ne flush pas, on repart sur idle-save
      if (isRowFocused(rowId)) {
        scheduleIdleSave(rowId);
        return;
      }

      // ✅ PRO FIX: Si on a des edits pour cette ligne, forcer l'ajout au pending
      // MAIS seulement si le nom est rempli (pour éviter de créer un produit sans nom)
      const edits = editingValuesRef.current?.[rowId];
      const row = tableDataById.get(rowId);
      if (edits && Object.keys(edits).length > 0) {
        const productName = (edits.product_name ?? row?.product_name ?? '').trim();
        if (!row?.is_empty || productName) {
          pendingSavesRef.current.set(rowId, true);
        }
      }

      // Focus sorti => save immédiat
      if (pendingSavesRef.current.has(rowId)) {
        if (IS_DEV) console.log(`⚡ [AUTO-SAVE IA] sortie ligne row=${rowId} → save immédiat`);
        savePendingChanges();
      }
    });
  }, [cancelIdleSave, isRowFocused, scheduleIdleSave, savePendingChanges, tableDataById]);

  // ✅ PRO FIX B: si clic dehors de la ligne active, flush NON-BLOQUANT (après l'event)
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const onPointerDownCapture = (e) => {
      const activeRowId = editingCell?.rowId;
      if (!activeRowId) return;

      // ✅ FIX: Ignorer les clics sur les suggestions (createPortal sur document.body)
      const onSuggestions = e.target?.closest?.('[data-suggestions]');
      if (onSuggestions) {
        // Clic sur une suggestion = ne pas flush, laisser la suggestion gérer
        return;
      }

      const inside = e.target?.closest?.(`[data-rowid="${activeRowId}"]`);

      if (!inside && pendingSavesRef.current.has(activeRowId)) {
        // ✅ PRO FIX B: déclencher après l'événement de clic (non-bloquant)
        setTimeout(() => {
          flushRowNow(activeRowId, 'clic-dehors');
        }, 0);
      }
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
  }, [editingCell?.rowId, flushRowNow]);

  // Démarrer l'édition d'une cellule
  const startEdit = useCallback((rowId, field, currentValue) => {
    if (!rowId || !field) return;
    
    try {
      setEditingCell({ rowId, field });
      setFocusedField(`${rowId}-${field}`);
      
      // ✅ Convertir les valeurs numériques en string pour préserver la valeur complète pendant la saisie
      let initialValue = currentValue ?? '';
      const numericFields = ['sale_price_usd', 'sale_price_fc', 'purchase_price_usd', 'stock_current', 'auto_stock_factor'];
      if (numericFields.includes(field) && (initialValue !== null && initialValue !== undefined && initialValue !== '')) {
        // Convertir en string pour préserver la valeur exacte
        initialValue = String(initialValue);
      }
      
      setEditingValues(prev => {
        const newValues = {
          ...prev,
          [rowId]: {
            ...(prev[rowId] || {}),
            [field]: initialValue
          }
        };
        // ✅ PRO: Sync ref immédiatement (pas de lag jusqu'au prochain render)
        editingValuesRef.current = newValues;
        return newValues;
      });
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur startEdit:', error);
      }
    }
  }, []);

  // Cache pour les suggestions de produits
  const productSuggestionsCache = useRef(new Map());
  const markSuggestionsCache = useRef(new Map());
  
  // Champs qui déclenchent l'autosave automatique
  // ⚠️ product_name n'est PAS inclus - sauvegarde seulement sur blur/clic externe
  const AUTO_SAVE_FIELDS = new Set([
    'sale_price_fc',
    'sale_price_usd',
    'purchase_price_usd',
    'stock_current',
    'auto_stock_factor',
    'unit_mark',      // ✅ Ajouter pour éviter perte du mark
  ]);

  // Obtenir les suggestions de produits par nom - avec cache
  const getProductSuggestions = useCallback((productName, unitLevel) => {
    // ✅ FIX: Réduire à 1 caractère pour recherche temps réel immédiate
    if (!productName || typeof productName !== 'string' || productName.trim().length < 1) return [];
    if (!Array.isArray(products)) return [];
    
    const cacheKey = `${productName.toLowerCase().trim()}-${unitLevel || 'all'}`;
    if (productSuggestionsCache.current.has(cacheKey)) {
      return productSuggestionsCache.current.get(cacheKey);
    }
    
    try {
      const query = productName.toLowerCase().trim();
      
      // ✅ FIX PRO: Pour MILLIER/PIECE, chercher les produits qui ont un CARTON
      const suggestions = products.filter(p => {
        if (!p || !p.name) return false;
        try {
          const nameMatch = p.name.toLowerCase().includes(query);
          if (!nameMatch) return false;
          
          // Pour MILLIER ou PIECE, on cherche les produits avec CARTON
          if (unitLevel === 'MILLIER' || unitLevel === 'PIECE') {
            return p.units?.some(u => u && u.unit_level === 'CARTON');
          }
          
          return true;
        } catch {
          return false;
        }
      }).slice(0, 8); // ✅ Plus de suggestions
      
      productSuggestionsCache.current.set(cacheKey, suggestions);
      return suggestions;
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur suggestions produits:', error);
      }
      return [];
    }
  }, [products]);

  // Obtenir les suggestions de marks par unité - avec cache
  const getMarkSuggestions = useCallback((unitLevel) => {
    if (!unitLevel) return [];
    if (!Array.isArray(products)) return [];
    
    if (markSuggestionsCache.current.has(unitLevel)) {
      return markSuggestionsCache.current.get(unitLevel);
    }
    
    try {
      const marks = new Set();
      products.forEach(p => {
        if (!p || !Array.isArray(p.units)) return;
        p.units.forEach(u => {
          if (u && u.unit_level === unitLevel && u.unit_mark) {
            marks.add(u.unit_mark);
          }
        });
      });
      
      const sorted = Array.from(marks).sort();
      markSuggestionsCache.current.set(unitLevel, sorted);
      return sorted;
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur suggestions marks:', error);
      }
      return [];
    }
  }, [products]);

  // Mettre à jour la valeur en édition
  const updateEditValue = (rowId, field, value) => {
    if (!rowId || !field) return;
    
    const row = tableData.find(r => r && r.id === rowId);
    if (!row) return;
    
    setEditingValues(prev => {
      const newValues = {
        ...prev,
        [rowId]: {
          ...(prev[rowId] || {}),
          [field]: value // ✅ Préserver la valeur exacte saisie (string)
        }
      };
      
      // Génération automatique de code pour CARTON uniquement
      if (field === 'product_name' && row?.is_empty && row?.unit_level === 'CARTON' && value?.trim()) {
        const autoCode = generateAutoCode('CARTON');
        if (autoCode && !newValues[rowId].product_code) {
          newValues[rowId].product_code = autoCode;
        }
      }
      
      // Calculer l'autre valeur seulement si la valeur saisie est valide et complète
      // ✅ Ne pas calculer si la valeur est vide ou invalide pour éviter les conversions prématurées
      const valueStr = String(value || '').trim();
      const isValidNumber = valueStr !== '' && !isNaN(parseFloat(valueStr)) && isFinite(parseFloat(valueStr));
      
      // ✅ Tracker le dernier champ prix édité (USD ou FC)
      if (field === 'sale_price_fc' || field === 'sale_price_usd') {
        lastPriceEditedRef.current.set(rowId, field);
      }
      
      // Si on modifie FC, calculer USD en temps réel avec animation
      if (field === 'sale_price_fc' && isValidNumber) {
        const fc = parseFloat(valueStr);
        if (!isNaN(fc) && isFinite(fc)) {
          const calculatedUSD = calculateUSD(fc);
          // ✅ Ne pas écraser si l'utilisateur est en train de modifier USD aussi
          if (editingCell?.rowId !== rowId || editingCell?.field !== 'sale_price_usd') {
            newValues[rowId].sale_price_usd = calculatedUSD;
          }
        }
      }
      // Si on modifie USD, calculer FC en temps réel avec animation
      else if (field === 'sale_price_usd' && isValidNumber) {
        const usd = parseFloat(valueStr);
        if (!isNaN(usd) && isFinite(usd)) {
          const calculatedFC = calculateFC(usd);
          // ✅ Ne pas écraser si l'utilisateur est en train de modifier FC aussi
          if (editingCell?.rowId !== rowId || editingCell?.field !== 'sale_price_fc') {
            newValues[rowId].sale_price_fc = calculatedFC;
          }
        }
      }
      
      // ✅ PRO: Sync ref immédiatement (pas de lag jusqu'au prochain render)
      editingValuesRef.current = newValues;
      
      return newValues;
    });
    
    // ✅ AUTOSAVE IA: Si unit_mark est vide, annuler autosave
    if (field === 'unit_mark') {
      const vNorm = String(value ?? '').trim();
      
      // ✅ Si vide -> annuler autosave + enlever pending
      if (!vNorm) {
        cancelIdleSave(rowId);
        pendingSavesRef.current.delete(rowId);
        if (IS_DEV) {
          console.log(`🚫 [updateEditValue] unit_mark vide pour ${rowId}, autosave annulé`);
        }
        return;
      }
      
      // ✅ Mark valide -> IA auto-save OK
      recordTyping(rowId);
      scheduleIdleSave(rowId);
      return;
    }
    
    // Autosave IA uniquement sur champs numériques pour éviter re-renders pendant la saisie
    if (AUTO_SAVE_FIELDS.has(field)) {
      recordTyping(rowId);
      scheduleIdleSave(rowId);
    } else {
      // Marquer comme modifié sans reload agressif pendant la saisie
      recordTyping(rowId);
      pendingSavesRef.current.set(rowId, true);
    }
  };

  // Obtenir le label de l'unité
  const getUnitLabel = (unitLevel) => {
    const labels = {
      'CARTON': 'Carton',
      'MILLIER': 'Détail',
      'PIECE': 'Pièce',
      'DETAIL': 'Détail'
    };
    return labels[unitLevel] || unitLevel;
  };

  // Obtenir la valeur d'édition ou la valeur actuelle
  // Priorité: valeurs visuelles (après sauvegarde) > valeurs en édition > valeurs de la ligne
  const getCellValue = (row, field) => {
    if (!row) return '';

    // ✅ PRO: Priorité correcte
    // 1) Si la cellule est EN COURS D'ÉDITION → valeur d'édition
    const isEditingThisCell =
      editingCell?.rowId === row.id && editingCell?.field === field;

    if (isEditingThisCell) {
      const v = editingValues?.[row.id]?.[field];
      if (v !== undefined) return v;
    }

    // 2) Si on force un affichage "après save" (visualValues post-sauvegarde)
    const visual = visualValues?.[row.id]?.[field];
    if (visual !== undefined) return visual;

    // 3) Si une valeur a été éditée mais on n'est plus sur la cellule
    const edit = editingValues?.[row.id]?.[field];
    if (edit !== undefined) return edit;

    // 4) Valeur venant des données chargées (backend/local DB)
    return row[field] ?? '';
  };

  // État pour la progression d'impression
  const [printProgress, setPrintProgress] = useState({ current: 0, total: 0, isActive: false });
  const printAbortRef = useRef(false);

  // Imprimer la liste - PRO avec progression animée
  const handlePrint = async () => {
    try {
      printAbortRef.current = false;
      setLoading(true);
      
      // Préparer les données pour l'impression (un ticket par produit)
      const productsToPrint = filteredData.filter(row => !row.is_empty);
      
      if (productsToPrint.length === 0) {
        setSaveMessage({ type: 'error', text: 'Aucun produit à imprimer' });
        setTimeout(() => setSaveMessage({ type: '', text: '' }), 2000);
        return;
      }

      // Confirmation si beaucoup de tickets
      if (productsToPrint.length > 50) {
        const proceed = window.confirm(`🖨️ Vous allez imprimer ${productsToPrint.length} tickets produits.\n\nCette opération peut prendre quelques minutes.\n\nContinuer ?`);
        if (!proceed) {
          setLoading(false);
          return;
        }
      }
      
      // Helpers pour formatage
      const getUnitLabelPrint = (unitLevel) => {
        const labels = {
          'CARTON': 'CARTON',
          'MILLIER': 'DÉTAIL',
          'PIECE': 'PIÈCE',
          'DETAIL': 'DÉTAIL'
        };
        return labels[unitLevel] || unitLevel;
      };

      const formatPrixFCPrint = (price) => {
        return (price || 0).toLocaleString('fr-CD') + ' FC';
      };

      const cleanProductNamePrint = (name) => {
        return String(name || '').trim().replace(/\s+/g, ' ').toUpperCase();
      };

      // Initialiser la progression
      setPrintProgress({ current: 0, total: productsToPrint.length, isActive: true });
      
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let successCount = 0;
      let errorCount = 0;
      
      // Envoyer les jobs par batch (5 à la fois pour vitesse)
      const BATCH_SIZE = 5;
      
      for (let i = 0; i < productsToPrint.length; i += BATCH_SIZE) {
        if (printAbortRef.current) {
          setSaveMessage({ type: 'error', text: 'Impression annulée' });
          break;
        }
        
        const batch = productsToPrint.slice(i, Math.min(i + BATCH_SIZE, productsToPrint.length));
        
        const batchPromises = batch.map(async (row) => {
          const prixFc = formatPrixFCPrint(row.sale_price_fc);
          const nom = cleanProductNamePrint(row.product_name);
          const unite = getUnitLabelPrint(row.unit_level);
          const mark = (row.unit_mark || '').toUpperCase();
          const stock = (row.stock_current || 0).toLocaleString('fr-CD');
          
          const job = {
            template: 'receipt-produit-80mm',
            ticketWidthMM: 80,
            copies: 1,
            forceReprint: true, // ✅ Permettre re-impression des produits
            data: {
              prixFc: prixFc,
              nom: nom,
              unite: unite,
              mark: mark,
              stock: stock
            }
          };
          
          try {
            await axios.post(`${PRINT_API_URL}/jobs`, job, getAuthHeaders());
            return { success: true };
          } catch (error) {
            if (IS_DEV) {
              console.error(`❌ Erreur impression ${row.product_code}:`, error?.message);
            }
            return { success: false, error };
          }
        });
        
        const results = await Promise.all(batchPromises);
        results.forEach(r => {
          if (r.success) successCount++;
          else errorCount++;
        });
        
        // Mettre à jour la progression
        const newCurrent = Math.min(i + BATCH_SIZE, productsToPrint.length);
        setPrintProgress({ current: newCurrent, total: productsToPrint.length, isActive: true });
        
        // Petit délai entre les batchs pour éviter surcharge
        if (i + BATCH_SIZE < productsToPrint.length) {
          await delay(100);
        }
      }
      
      // Résultat final
      setPrintProgress({ current: 0, total: 0, isActive: false });
      
      if (errorCount === 0) {
        setSaveMessage({ 
          type: 'success', 
          text: `🎉 ${successCount} ticket(s) envoyé(s) à l'imprimante !` 
        });
      } else if (successCount > 0) {
        setSaveMessage({ 
          type: 'success', 
          text: `✅ ${successCount} OK, ⚠️ ${errorCount} erreur(s)` 
        });
      } else {
        setSaveMessage({ type: 'error', text: 'Erreur: aucun ticket imprimé' });
      }
      
      setTimeout(() => setSaveMessage({ type: '', text: '' }), 4000);
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur impression:', error);
      }
      setPrintProgress({ current: 0, total: 0, isActive: false });
      setSaveMessage({ type: 'error', text: 'Erreur lors de l\'impression' });
    } finally {
      setLoading(false);
    }
  };

  // Imprimer un seul produit (ticket vertical PRO)
  const handlePrintSingleProduct = async (row) => {
    if (!row || row.is_empty) return;
    
    try {
      // Helpers locaux
      const getUnitLabelSingle = (unitLevel) => {
        const labels = {
          'CARTON': 'CARTON',
          'MILLIER': 'DÉTAIL',
          'PIECE': 'PIÈCE',
          'DETAIL': 'DÉTAIL'
        };
        return labels[unitLevel] || unitLevel;
      };

      const formatPrixFCSingle = (price) => {
        return (price || 0).toLocaleString('fr-CD') + ' FC';
      };

      const cleanProductNameSingle = (name) => {
        return String(name || '').trim().replace(/\s+/g, ' ').toUpperCase();
      };

      const prixFc = formatPrixFCSingle(row.sale_price_fc);
      const nom = cleanProductNameSingle(row.product_name);
      const unite = getUnitLabelSingle(row.unit_level);
      const mark = (row.unit_mark || '').toUpperCase();
      const stock = (row.stock_current || 0).toLocaleString('fr-CD');
      
      const job = {
        template: 'receipt-produit-80mm',
        ticketWidthMM: 80,
        copies: 1,
        forceReprint: true, // ✅ Permettre re-impression
        data: {
          prixFc: prixFc,
          nom: nom,
          unite: unite,
          mark: mark,
          stock: stock
        }
      };
      
      // Animation feedback immédiat
      setSaveMessage({ type: 'info', text: '🖨️ Envoi en cours...' });
      
      await axios.post(`${PRINT_API_URL}/jobs`, job, getAuthHeaders());
      
      setSaveMessage({ type: 'success', text: `🎉 Ticket "${row.product_name}" envoyé !` });
      setTimeout(() => setSaveMessage({ type: '', text: '' }), 2500);
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur impression produit:', error);
      }
      setSaveMessage({ type: 'error', text: '❌ Erreur d\'impression' });
      setTimeout(() => setSaveMessage({ type: '', text: '' }), 3000);
    }
  };

  // Exporter en CSV
  const handleExportCSV = () => {
    const csv = [
      ['Produit', 'Code', 'Unité', 'Mark', 'Stock', 'Prix USD', 'Prix FC'].join(','),
      ...filteredData
        .filter(row => !row.is_empty)
        .map(row => [
          row.product_name,
          row.product_code,
          row.unit_level,
          row.unit_mark,
          row.stock_current,
          row.sale_price_usd,
          row.sale_price_fc
        ].join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produits-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Calculer le nombre de produits de manière sécurisée
  let productCount = 0;
  try {
    if (Array.isArray(filteredData)) {
      productCount = filteredData.filter(r => r && !r.is_empty).length;
    }
  } catch (err) {
    productCount = 0;
  }

  return (
    <div className="space-y-6 p-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2 flex items-center gap-3">
            Produits
            {/* Indicateur de synchronisation pending */}
            {saving && (
              <span className="inline-flex items-center gap-2 text-sm bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin" />
                Sync...
              </span>
            )}
            {!saving && pendingSavesRef.current.size > 0 && (
              <span 
                className="inline-flex items-center gap-2 text-sm bg-orange-500/20 text-orange-300 px-3 py-1 rounded-full cursor-pointer hover:bg-orange-500/30"
                onClick={() => savePendingChanges()}
                title="Cliquer pour synchroniser maintenant"
              >
                <Upload className="w-4 h-4" />
                {pendingSavesRef.current.size} en attente
              </span>
            )}
          </h1>
          <p className="text-gray-400 flex items-center gap-2 flex-wrap">
            <span>
              {initialLoading ? 'Chargement...' : `${productCount} produit(s)`} • Taux: {currentRate || 2800} FC/USD
            </span>
            {activeFilter !== 'TOUS' && (
              <span className="text-primary-400">
                • Filtre: {activeFilter === 'DETAIL' ? 'Détail (Milliers)' : activeFilter}
              </span>
            )}
            {/* ✅ Indicateur de synchronisation temps réel */}
            <span className="ml-2">•</span>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
              isConnected 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                : reconnecting 
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 animate-pulse' 
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}>
              {isConnected ? (
                <>
                  <Wifi className="w-3 h-3" />
                  <span>Sync auto 2s</span>
                </>
              ) : reconnecting ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Reconnexion...</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" />
                  <span>Hors ligne</span>
                </>
              )}
            </span>
            {lastUpdate && (
              <span className="text-xs text-gray-500">
                (màj: {new Date(lastUpdate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Progression d'impression PRO - Style moderne avec animation fluide */}
          {printProgress.isActive && (
            <div className="relative flex items-center gap-3 bg-gradient-to-r from-blue-600/25 via-primary-500/20 to-cyan-500/25 px-5 py-3 rounded-2xl border border-blue-400/50 shadow-lg shadow-blue-500/20 overflow-hidden">
              {/* Effet de brillance animé */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div 
                  className="absolute -inset-x-full top-0 h-full w-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent"
                  style={{ animation: 'shimmer 2.5s ease-in-out infinite' }} 
                />
              </div>
              
              {/* Icône d'impression animée */}
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-primary-500 shadow-lg">
                <Printer className="w-5 h-5 text-white animate-pulse" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-gray-900 animate-ping" />
              </div>
              
              <div className="relative flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">
                    Impression en cours
                  </span>
                  <span className="px-2 py-0.5 text-xs font-bold bg-blue-500/40 text-blue-200 rounded-full">
                    {Math.round((printProgress.current / printProgress.total) * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-gray-700/60 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 via-primary-400 to-cyan-400 transition-all duration-500 ease-out shadow-lg shadow-blue-500/50"
                      style={{ width: `${Math.round((printProgress.current / printProgress.total) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono font-bold text-cyan-300">
                    {printProgress.current}/{printProgress.total}
                  </span>
                </div>
              </div>
              
              <button
                onClick={() => { printAbortRef.current = true; }}
                className="relative ml-2 p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-400 hover:text-red-300 transition-all duration-200"
                title="Annuler l'impression"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          )}
          
          {/* Bouton d'impression PRO avec animation */}
          <button
            onClick={handlePrint}
            disabled={loading || printProgress.isActive}
            className={`group relative flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-semibold transition-all duration-300 overflow-hidden ${
              printProgress.isActive 
                ? 'bg-gray-700/50 text-gray-400 cursor-not-allowed' 
                : 'bg-gradient-to-r from-blue-600 via-primary-500 to-cyan-600 text-white hover:shadow-xl hover:shadow-primary-500/40 hover:scale-[1.02] active:scale-[0.98]'
            }`}
          >
            {/* Effet hover brillant */}
            {!printProgress.isActive && (
              <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            )}
            
            <span className="relative flex items-center gap-2.5">
              {loading && !printProgress.isActive ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <div className="relative">
                  <Printer className="w-5 h-5 transition-transform group-hover:scale-110" />
                  {!printProgress.isActive && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
              )}
              <span className="hidden sm:inline">Imprimer tous les produits</span>
              <span className="sm:hidden">Imprimer</span>
            </span>
          </button>
          
          {/* Bouton Arrivages */}
          <button
            onClick={() => navigate('/newarrivage')}
            className="group relative flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:shadow-lg hover:shadow-green-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
            title="Voir les nouveaux arrivages"
          >
            <TrendingUp className="w-5 h-5 transition-transform group-hover:scale-110" />
            <span className="hidden sm:inline">Arrivages</span>
          </button>
          
          <button
            onClick={handleExportCSV}
            className="btn-secondary flex items-center gap-2 hover:scale-105 transition-transform"
          >
            <Download className="w-5 h-5" />
            CSV
          </button>
        </div>
      </div>

      {/* Recherche et filtres */}
      <div className="card">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="products-search-input"
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher (nom, code)..."
            className="input-field pl-10 w-full"
            // ❌ autoFocus SUPPRIMÉ: Utiliser initialMountDoneRef pour focus unique au montage
            // Cela évite le vol de focus lors des rechargements de produits via Socket.IO
          />
        </div>
        
        {/* Filtres */}
        <div className="flex gap-2 flex-wrap">
          {['TOUS', 'CARTON', 'DETAIL', 'PIECE'].map(filter => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                activeFilter === filter
                  ? 'bg-primary-500 text-white'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              <Filter className="w-4 h-4" />
              {filter === 'DETAIL' ? 'Détail' : filter}
            </button>
          ))}
        </div>
      </div>

      {/* Message de sauvegarde - AMÉLIORÉ */}
      {saveMessage.text && (
        <div
          className={`card flex items-center gap-3 px-6 py-4 font-semibold ${
            saveMessage.type === 'success'
              ? 'bg-gradient-to-r from-green-500/30 to-green-500/10 border-2 border-green-500/60 rounded-xl'
              : saveMessage.type === 'error'
              ? 'bg-gradient-to-r from-red-500/30 to-red-500/10 border-2 border-red-500/60 rounded-xl'
              : 'bg-gradient-to-r from-blue-500/30 to-blue-500/10 border-2 border-blue-500/60 rounded-xl'
          } shadow-lg animate-in fade-in`}
          role="alert"
        >
          {saveMessage.type === 'success' ? (
            <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0" />
          ) : saveMessage.type === 'error' ? (
            <XCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
          ) : (
            <Loader2 className="w-6 h-6 text-blue-400 flex-shrink-0 animate-spin" />
          )}
          <span className={`text-base ${
            saveMessage.type === 'success' ? 'text-green-300' :
            saveMessage.type === 'error' ? 'text-red-300' : 'text-blue-300'
          }`}>
            {saveMessage.text}
          </span>
        </div>
      )}

      {/* Tableau */}
      {initialLoading ? (
        <div className="card text-center py-12">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Chargement des produits...</p>
        </div>
      ) : (!Array.isArray(filteredData) || filteredData.length === 0) && !searchQuery ? (
        <div className="card text-center py-12">
          <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-400 text-lg mb-2">Aucun produit disponible</p>
          <p className="text-gray-500 text-sm">Les produits apparaîtront ici une fois chargés</p>
        </div>
      ) : (
        <div className="card p-0">
          {/* ✅ FIX #2: overflow-y-auto + maxHeight pour que virtualisation fonctionne */}
          <div 
            ref={scrollContainerRef}
            className="overflow-x-auto overflow-y-auto"
            style={{ maxHeight: 'calc(100vh - 260px)' }}
          >
            <table className="w-full">
              <thead className="bg-gradient-to-r from-primary-500/10 to-primary-600/5 border-b-2 border-primary-500/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Produit
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Unité
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Mark
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Prix Ventes (FC)
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Prix vente (USD)
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Prix achat (USD)
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Stock
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-300 uppercase tracking-wider" title="Seuil d'alerte stock (Automatisation)">
                    Auto Stock
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5" style={{ overflow: 'visible' }}>
                {/* Bouton pour descendre au dernier produit - au début des lignes vides */}
                {(() => {
                  try {
                    if (!Array.isArray(filteredData)) return null;
                    const firstEmptyIndex = filteredData.findIndex(r => r && r.is_empty);
                    if (firstEmptyIndex !== -1 && lastRealProductIndex !== -1) {
                    return (
                      <tr key="scroll-to-bottom-btn" data-navigation className="border-b border-white/10">
                        <td colSpan={9} className="px-4 py-2">
                          <button
                            onClick={scrollToBottom}
                            className="w-full px-4 py-2 bg-primary-500/20 hover:bg-primary-500/30 border border-primary-500/40 hover:border-primary-500/60 rounded-lg text-primary-300 hover:text-primary-200 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                          >
                            <ChevronDown className="w-4 h-4" />
                            <span>Aller au dernier produit</span>
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                    }
                    return null;
                  } catch (err) {
                    if (IS_DEV) {
                      console.error('Erreur rendu navigation:', err);
                    }
                    return null;
                  }
                })()}
                
                {/* ✅ FIX #5: Calculer les spacers proprement */}
                {(() => {
                  const virtualItems = rowVirtualizer.getVirtualItems();
                  const topPad = virtualItems[0]?.start ?? 0;
                  const bottomPad = Math.max(0, rowVirtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0));
                  
                  return (
                    <>
                      {/* Padding top */}
                      <tr>
                        <td colSpan={9} style={{ height: `${topPad}px` }} />
                      </tr>

                      {/* ✅ Virtualisation: rendre seulement les lignes visibles */}
                      {virtualItems.map((virtualRow) => {
                        const row = filteredData[virtualRow.index];
                        // ✅ FIX: Protection complète contre null/undefined/missing id
                        if (!row || row.id == null) return null;

                        const index = virtualRow.index;
                        const rowId = row.id;
                        const isEditingThisRow = editingCell?.rowId === rowId && !row.is_empty;
                        const hasPendingChanges = pendingSavesRef.current.has(rowId);
                        
                        // ✅ PRO: Vérifier si c'est une ligne récemment modifiée
                        const recentModIndex = recentlyModifiedRows.findIndex(r => r.rowId === rowId);
                        const isRecentlyModified = recentModIndex !== -1;
                        const recentModRank = recentModIndex + 1; // 1 = le plus récent

                        try {
                          return (
                            <tr
                              key={rowId || `row-${index}`}
                              data-rowid={rowId}
                              data-index={virtualRow.index}
                              ref={rowVirtualizer.measureElement}
                              style={{
                                height: `${virtualRow.size}px`,
                                // ✅ FIX: Permettre aux suggestions de déborder
                                overflow: isEditingThisRow ? 'visible' : undefined,
                                position: isEditingThisRow ? 'relative' : undefined,
                                zIndex: isEditingThisRow ? 50 : undefined,
                              }}
                              className={`group ${
                                row.is_empty ? 'opacity-30' : 'hover:bg-dark-700/50'
                              } ${
                                isEditingThisRow
                                  ? 'bg-primary-500/10 border-l-2 border-primary-500/50' 
                                  : hasPendingChanges
                                  ? 'bg-orange-500/5 border-l-2 border-orange-500/30'
                                  : isRecentlyModified
                                  ? recentModRank === 1 
                                    ? 'bg-emerald-500/20 border-l-4 border-emerald-400 animate-pulse' 
                                    : recentModRank === 2
                                    ? 'bg-emerald-500/10 border-l-3 border-emerald-500/70'
                                    : 'bg-emerald-500/5 border-l-2 border-emerald-500/40'
                                  : ''
                              } transition-all duration-300`}
                      >
                    {/* Produit */}
                    <td className="px-4 py-3" style={{ position: 'relative', overflow: 'visible' }}>
                      {editingCell?.rowId === rowId && editingCell?.field === 'product_name' ? (
                        <div className="relative" style={{ overflow: 'visible' }}>
                          <input
                            ref={(el) => {
                              // Stocker la ref de l'input pour positionner le dropdown
                              if (el) el._inputRef = el;
                            }}
                            type="text"
                            value={getCellValue(row, 'product_name') || ''}
                            onChange={(e) => {
                              updateEditValue(rowId, 'product_name', e.target.value);
                            }}
                            onBlur={(e) => {
                              // ✅ FIX: Vérifier si le clic est sur une suggestion avant de blur
                              const relatedTarget = e.relatedTarget;
                              if (relatedTarget && relatedTarget.closest('[data-suggestions]')) {
                                // Ne pas blur si on clique sur les suggestions
                                return;
                              }
                              setTimeout(() => {
                                smartBlurRow(rowId);
                                setEditingCell(null);
                                setFocusedField(null);
                              }, 150);
                            }}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                flushRowNow(rowId, 'enter');
                                setEditingCell(null);
                                setFocusedField(null);
                              }
                            }}
                            className="input-field text-sm w-full px-4 py-2.5 bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[200px] relative z-10"
                            autoFocus
                          />
                          {/* Suggestions de produits pour MILLIER/PIECE - PORTAL pour être au-dessus de tout */}
                          {(() => {
                            try {
                              const productName = getCellValue(row, 'product_name') || '';
                              const unitLevel = getCellValue(row, 'unit_level') || row?.unit_level || '';
                              
                              // ✅ FIX PRO: Pour MILLIER/PIECE, chercher les produits CARTON existants
                              const isSubUnit = unitLevel === 'MILLIER' || unitLevel === 'PIECE';
                              // ✅ FIX: Afficher suggestions dès 1 caractère pour recherche temps réel
                              const suggestions = isSubUnit && productName && typeof productName === 'string' && productName.length >= 1 
                                ? getProductSuggestions(productName, unitLevel)
                                : [];
                              const autoCode = row?.is_empty && unitLevel === 'CARTON' && productName && productName.trim()
                                ? generateAutoCode('CARTON')
                                : null;
                              
                              // ✅ Afficher un message d'aide si c'est MILLIER/PIECE et le champ est vide
                              const showHelpMessage = isSubUnit && (!productName || productName.length === 0);
                              
                              // ✅ PORTAL: Calculer la position de l'input pour afficher le dropdown
                              const inputEl = document.activeElement;
                              const inputRect = inputEl?.getBoundingClientRect?.() || { left: 0, bottom: 0, width: 300 };
                              
                              // Le contenu des suggestions à rendre via Portal
                              const suggestionsContent = (
                                <>
                                  {/* Message d'aide compact pour MILLIER/PIECE quand le champ est vide */}
                                  {showHelpMessage && createPortal(
                                    <div 
                                      data-suggestions="true"
                                      className="bg-blue-900/90 border border-blue-400/50 rounded-lg shadow-lg px-3 py-2"
                                      style={{ 
                                        position: 'fixed',
                                        left: `${inputRect.left}px`,
                                        top: `${inputRect.bottom + 4}px`,
                                        width: `${Math.max(inputRect.width, 280)}px`,
                                        zIndex: 99999,
                                      }}
                                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    >
                                      <div className="text-blue-200 text-xs">
                                        🔍 Tapez le nom d'un CARTON existant
                                      </div>
                                    </div>,
                                    document.body
                                  )}
                                  {Array.isArray(suggestions) && suggestions.length > 0 && createPortal(
                                    <div 
                                      data-suggestions="true"
                                      tabIndex={-1}
                                      className="bg-gradient-to-br from-gray-900 via-dark-900 to-dark-800 border-2 border-primary-400 rounded-xl overflow-hidden"
                                      style={{ 
                                        position: 'fixed',
                                        left: `${Math.max(inputRect.left - 10, 10)}px`,
                                        top: `${inputRect.bottom + 4}px`,
                                        width: `${Math.max(inputRect.width + 20, 350)}px`,
                                        maxHeight: '320px',
                                        zIndex: 99999,
                                        boxShadow: '0 15px 50px rgba(0,0,0,0.8), 0 0 0 2px rgba(139,92,246,0.5)'
                                      }}
                                      onMouseDown={(e) => {
                                        // ✅ CRITIQUE: Empêcher le blur de l'input parent
                                        e.preventDefault();
                                        e.stopPropagation();
                                      }}
                                    >
                                      {/* Header compact - juste le nombre de résultats */}
                                      <div className="px-3 py-2 text-sm font-medium text-gray-300 border-b border-primary-500/40 bg-dark-800/80 flex items-center justify-between">
                                        <span>📦 Produits CARTON</span>
                                        <span className="bg-primary-500/30 text-primary-200 px-2 py-0.5 rounded-full text-xs">
                                          {suggestions.length}
                                        </span>
                                      </div>
                                      {/* Liste scrollable */}
                                      <div className="max-h-[280px] overflow-y-auto">
                                      {suggestions.map((p, idx) => {
                                        if (!p || !p.name) return null;
                                        // Trouver l'unité CARTON pour afficher son info
                                        const cartonUnit = p.units?.find(u => u?.unit_level === 'CARTON');
                                        return (
                                          <button
                                            key={p.id || idx}
                                            type="button"
                                            onMouseDown={(e) => {
                                              // ✅ Empêcher blur
                                              e.preventDefault();
                                              e.stopPropagation();
                                            }}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              console.log('✅ [Suggestion] Sélection produit:', p.name, p.code);
                                              
                                              // ✅ FIX CRITIQUE: Annuler tout save en attente AVANT de modifier les valeurs
                                              cancelIdleSave(rowId);
                                              
                                              // ✅ FIX: Fermer IMMÉDIATEMENT les suggestions (avant toute autre action)
                                              setEditingCell(null);
                                              setFocusedField(null);
                                              
                                              // ✅ FIX PRO: Mettre à jour DIRECTEMENT la ref (pas via setState qui est async)
                                              const currentEdits = editingValuesRef.current[rowId] || {};
                                              const updatedEdits = {
                                                ...currentEdits,
                                                product_name: p.name || '',
                                                product_code: p.code || '',
                                                _link_to_product: p.code || p.id  // ✅ CRITIQUE: pour trouver le CARTON existant
                                              };
                                              editingValuesRef.current = {
                                                ...editingValuesRef.current,
                                                [rowId]: updatedEdits
                                              };
                                              
                                              // ✅ Aussi sync avec le state React pour le rendu
                                              setEditingValues(prev => ({
                                                ...prev,
                                                [rowId]: updatedEdits
                                              }));
                                              
                                              // ✅ FIX: Marquer comme pending (Map.set, pas Set.add)
                                              pendingSavesRef.current.set(rowId, true);
                                              
                                              // ✅ Affichage visuel immédiat
                                              setVisualForRow(rowId, { product_name: p.name || '' }, 8000);
                                              
                                              // ✅ FIX PRO: Sauvegarder IMMÉDIATEMENT après sélection
                                              setTimeout(() => {
                                                console.log('💾 [Suggestion] Sauvegarde immédiate après sélection:', rowId, 'avec _link_to_product:', p.code);
                                                flushRowNow(rowId, 'suggestion-select');
                                              }, 150);
                                            }}
                                            className="w-full text-left px-3 py-2.5 hover:bg-primary-500/40 active:bg-primary-600/60 text-gray-100 border-b border-white/10 last:border-0 cursor-pointer transition-all duration-75"
                                          >
                                            <div className="font-semibold text-white text-sm">{p.name || ''}</div>
                                            <div className="flex justify-between items-center text-xs text-gray-300 mt-0.5">
                                              <span className="text-gray-400">{p.code || '—'}</span>
                                              {cartonUnit && (
                                                <span className="text-green-400">
                                                  Stock: {cartonUnit.stock_current || 0}
                                                </span>
                                              )}
                                            </div>
                                          </button>
                                        );
                                      })}
                                      </div>
                                    </div>,
                                    document.body
                                  )}
                                  {/* Message si pas de CARTON trouvé pour MILLIER/PIECE */}
                                  {isSubUnit && productName && productName.length >= 1 && suggestions.length === 0 && createPortal(
                                    <div 
                                      data-suggestions="true"
                                      className="bg-orange-950/90 border border-orange-500/50 rounded-lg shadow-lg px-3 py-2"
                                      style={{ 
                                        position: 'fixed',
                                        left: `${inputRect.left}px`,
                                        top: `${inputRect.bottom + 4}px`,
                                        width: `${Math.max(inputRect.width, 280)}px`,
                                        zIndex: 99999,
                                      }}
                                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    >
                                      <div className="text-orange-300 text-xs font-medium">
                                        ⚠️ Aucun CARTON pour "{productName}" - Créez-le d'abord
                                      </div>
                                    </div>,
                                    document.body
                                  )}
                                  {autoCode && (
                                    <div className="absolute -bottom-6 left-0 text-xs text-primary-400 font-medium">
                                      Code auto: {autoCode}
                                    </div>
                                  )}
                                </>
                              );
                              
                              return suggestionsContent;
                            } catch (err) {
                              if (IS_DEV) {
                                console.error('Erreur suggestions produits:', err);
                              }
                              return null;
                            }
                          })()}
                        </div>
                      ) : (
                        <div
                          onClick={() => {
                            startEdit(rowId, 'product_name', getCellValue(row, 'product_name') || '');
                          }}
                          className={`cursor-pointer ${
                            row?.is_empty 
                              ? 'text-gray-500 hover:text-gray-400' 
                              : 'text-gray-200 group-hover:text-gray-100 group-hover:font-semibold'
                          }`}
                        >
                          {String(getCellValue(row, 'product_name') || '').trim() ? (
                            String(getCellValue(row, 'product_name')).trim()
                          ) : (
                            <span className="text-gray-500 italic">Nouveau produit...</span>
                          )}
                        </div>
                      )}
                      {!row?.is_empty && (
                        <div className="text-xs text-gray-500 group-hover:text-gray-400">
                          ({getCellValue(row, 'product_code') || '...'})
                        </div>
                      )}
                      {row?.is_empty && editingValues[row?.id]?.product_code && (
                        <div className="text-xs text-primary-400 font-medium">
                          ({editingValues[row.id]?.product_code || ''})
                        </div>
                      )}
                    </td>

                    {/* Unité */}
                    <td className="px-4 py-3">
                      {editingCell?.rowId === rowId && editingCell?.field === 'unit_level' ? (
                        <select
                          value={getCellValue(row, 'unit_level') || ''}
                          onChange={(e) => {
                            const newLevel = e.target.value;
                            // ✅ PRO FIX: Ne pas traiter si valeur vide sélectionnée
                            if (!newLevel) return;
                            
                            updateEditValue(rowId, 'unit_level', newLevel);
                            
                            // ✅ FIX PRO: Quand on passe à MILLIER/PIECE sur une nouvelle ligne
                            // Vider le nom pour forcer la recherche d'un produit CARTON existant
                            if ((newLevel === 'MILLIER' || newLevel === 'PIECE') && row?.is_empty) {
                              updateEditValue(rowId, 'product_name', '');
                              updateEditValue(rowId, 'product_code', '');
                              // Ouvrir automatiquement le champ de nom pour recherche
                              setTimeout(() => {
                                // ✅ PRO FIX: Utiliser startEdit pour initialiser correctement le champ
                                // Cela préserve unit_level car startEdit fait un merge des valeurs
                                startEdit(rowId, 'product_name', '');
                              }, 100);
                            }
                          }}
                          onBlur={() => {
                            // ✅ PRO FIX: Ne pas déclencher de sauvegarde si ligne vide sans nom
                            // IMPORTANT: Utiliser editingValuesRef (synchrone) au lieu du state (asynchrone)
                            // car updateEditValue peut avoir vidé le nom mais le state n'est pas encore à jour
                            const edits = editingValuesRef.current?.[rowId] || {};
                            const productName = (edits.product_name ?? row?.product_name ?? '').trim();
                            
                            if (row?.is_empty && !productName) {
                              // Juste fermer l'édition, ne pas sauvegarder - garder unit_level sélectionné
                              setEditingCell(null);
                              setFocusedField(null);
                              return;
                            }
                            smartBlurRow(rowId);
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          className="input-field text-sm px-4 py-2.5 bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[140px] relative z-10"
                        >
                          {/* ✅ PRO FIX: Option vide par défaut pour éviter l'auto-sélection de Carton */}
                          {(!getCellValue(row, 'unit_level') && row?.is_empty) && (
                            <option value="">— Sélectionner —</option>
                          )}
                          <option value="CARTON">Carton</option>
                          <option value="MILLIER">Détail</option>
                          <option value="PIECE">Pièce</option>
                        </select>
                      ) : (
                        <span
                          onClick={() => {
                            startEdit(rowId, 'unit_level', getCellValue(row, 'unit_level') || '');
                          }}
                          className="cursor-pointer text-gray-200 group-hover:text-primary-300 group-hover:font-semibold hover:text-primary-400"
                        >
                          {/* ✅ PRO FIX: Afficher la valeur éditée si elle existe */}
                          {getUnitLabel(getCellValue(row, 'unit_level')) || '—'}
                        </span>
                      )}
                    </td>

                    {/* Mark */}
                    <td className="px-4 py-3">
                      {editingCell?.rowId === rowId && editingCell?.field === 'unit_mark' ? (
                        <div className="relative">
                          <input
                            type="text"
                            value={getCellValue(row, 'unit_mark') || ''}
                            onChange={(e) => {
                              updateEditValue(rowId, 'unit_mark', e.target.value);
                            }}
                            onBlur={(e) => {
                              const vNorm = String(e.currentTarget.value ?? '').trim();

                              // ✅ PRO FIX D: Si mark inchangé => ne pas déclencher pending/save, juste fermer l'édition
                              const current = normalizeMark(row.unit_mark);
                              if (normalizeMark(vNorm) === current) {
                                // Nettoyer seulement l'édition du champ mark
                                setEditingValues((prev) => {
                                  const copy = { ...prev };
                                  if (copy[rowId]) {
                                    const rowCopy = { ...copy[rowId] };
                                    delete rowCopy.unit_mark;
                                    // Si vide, supprimer la ligne
                                    if (Object.keys(rowCopy).length === 0) delete copy[rowId];
                                    else copy[rowId] = rowCopy;
                                  }
                                  return copy;
                                });
                                pendingSavesRef.current.delete(rowId);
                                cancelIdleSave(rowId);

                                setEditingCell(null);
                                setFocusedField(null);
                                return;
                              }

                              // ✅ FIX PRO: Mark peut être vide - l'utilisateur est libre

                              // ✅ cache visuel immédiat 8s
                              setVisualForRow(rowId, { unit_mark: vNorm }, 8000);

                              // ✅ Pousser la valeur normalisée dans editingValues
                              updateEditValue(rowId, 'unit_mark', vNorm);

                              // ✅ IA: Blur intelligent - save immédiat si focus sort de la ligne
                              smartBlurRow(rowId);

                              setEditingCell(null);
                              setFocusedField(null);
                            }}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                const vNorm = String(e.currentTarget.value ?? '').trim();

                                // ✅ FIX PRO: Mark peut être vide - l'utilisateur est libre

                                // ✅ cache visuel immédiat 8s
                                setVisualForRow(rowId, { unit_mark: vNorm }, 8000);

                                // ✅ Pousser la valeur normalisée
                                updateEditValue(rowId, 'unit_mark', vNorm);

                                // ✅ IA: save immédiat à Enter
                                flushRowNow(rowId, 'enter');

                                setEditingCell(null);
                                setFocusedField(null);
                              }
                            }}
                            className="input-field text-sm px-4 py-2.5 bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[120px] relative z-10"
                            autoFocus
                          />
                          {/* Suggestions de marks */}
                          {(() => {
                            try {
                              const unitLevel = getCellValue(row, 'unit_level') || row?.unit_level || '';
                              const markSuggestions = getMarkSuggestions(unitLevel);
                              const currentMark = getCellValue(row, 'unit_mark') || '';
                              
                              if (!Array.isArray(markSuggestions) || markSuggestions.length === 0) return null;
                              
                              return (
                                <div
                                  className="absolute z-[100] mt-1 w-full bg-dark-800 border border-primary-500/30 rounded-lg shadow-xl max-h-32 overflow-y-auto"
                                  onMouseDown={(e) => {
                                    // ✅ FIX: Empêche le blur de l'input sans bloquer les clics enfants
                                    e.preventDefault();
                                  }}
                                >
                                  {markSuggestions
                                    .filter(m => m && typeof m === 'string' && (!currentMark || m.toLowerCase().includes(currentMark.toLowerCase())))
                                    .slice(0, 8)
                                    .map((mark, idx) => (
                                      <button
                                        key={idx}
                                        type="button"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                        }}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          if (mark) {
                                            console.log('✅ [Mark Suggestion] Sélection:', mark);
                                            updateEditValue(rowId, 'unit_mark', mark);
                                            // ✅ Affichage visuel immédiat
                                            setVisualForRow(rowId, { unit_mark: mark }, 8000);
                                            flushRowNow(rowId, 'mark-suggestion');
                                            setEditingCell(null);
                                            setFocusedField(null);
                                          }
                                        }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-primary-500/20 text-gray-200 text-sm border-b border-white/5 last:border-0 cursor-pointer"
                                      >
                                        {mark || ''}
                                      </button>
                                    ))}
                                </div>
                              );
                            } catch (err) {
                              if (IS_DEV) {
                                console.error('Erreur suggestions marks:', err);
                              }
                              return null;
                            }
                          })()}
                        </div>
                      ) : (
                        <span
                          onClick={() => {
                            startEdit(rowId, 'unit_mark', getCellValue(row, 'unit_mark') || '');
                          }}
                          className="cursor-pointer text-gray-200 group-hover:text-primary-300 group-hover:font-semibold group-hover:px-2 group-hover:py-1 group-hover:bg-primary-500/20 group-hover:rounded hover:text-primary-400"
                        >
                          {String(getCellValue(row, 'unit_mark') || '').trim() || '—'}
                        </span>
                      )}
                    </td>

                    {/* Prix vente FC */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === rowId && editingCell?.field === 'sale_price_fc' ? (
                        <input
                          type="number"
                          value={String(getCellValue(row, 'sale_price_fc') || '')}
                          onChange={(e) => {
                            const newValue = e.target.value; // ✅ Toujours une string depuis e.target.value
                            if (IS_DEV) {
                              console.log(`⌨️ [ProductsPage] Saisie: "${newValue}" (type: ${typeof newValue}) pour ${rowId}`);
                            }
                            // ✅ Préserver la valeur exacte saisie comme string
                            updateEditValue(rowId, 'sale_price_fc', newValue);
                          }}
                          onBlur={() => {
                            // IA auto-save intelligent avec blur detection
                            if (pendingSavesRef.current.has(rowId)) {
                              smartBlurRow(rowId);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              // Flush immédiat à Enter
                              if (pendingSavesRef.current.has(rowId)) {
                                flushRowNow(rowId, 'enter');
                              }
                              setEditingCell(null);
                              setFocusedField(null);
                            }
                          }}
                          className="input-field text-sm px-4 py-2.5 text-right bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[140px] relative z-10"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => {
                            startEdit(rowId, 'sale_price_fc', row?.sale_price_fc || 0);
                          }}
                          className="cursor-pointer font-mono text-gray-200 group-hover:text-blue-300 group-hover:font-bold hover:text-blue-400"
                        >
                          <AnimatedCounter
                            value={parseFloat(getCellValue(row, 'sale_price_fc')) || 0}
                            duration={600}
                            formatter={(v) => Math.round(v).toLocaleString('fr-FR')}
                            className="inline"
                          /> FC
                        </span>
                      )}
                    </td>

                    {/* Prix vente USD */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === rowId && editingCell?.field === 'sale_price_usd' ? (
                        <input
                          type="number"
                          step="0.01"
                          value={String(getCellValue(row, 'sale_price_usd') || '')}
                          onChange={(e) => {
                            const newValue = e.target.value; // ✅ Toujours une string depuis e.target.value
                            if (IS_DEV) {
                              console.log(`⌨️ [ProductsPage] Saisie: "${newValue}" (type: ${typeof newValue}) pour ${rowId}`);
                            }
                            // ✅ Préserver la valeur exacte saisie comme string
                            updateEditValue(rowId, 'sale_price_usd', newValue);
                          }}
                          onBlur={() => {
                            // IA auto-save intelligent avec blur detection
                            if (pendingSavesRef.current.has(rowId)) {
                              smartBlurRow(rowId);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              // Flush immédiat à Enter
                              if (pendingSavesRef.current.has(rowId)) {
                                flushRowNow(rowId, 'enter');
                              }
                              setEditingCell(null);
                              setFocusedField(null);
                            }
                          }}
                          className="input-field text-sm px-4 py-2.5 text-right bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[130px] relative z-10"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => {
                            startEdit(rowId, 'sale_price_usd', row?.sale_price_usd || 0);
                          }}
                          className="cursor-pointer font-mono font-semibold text-primary-400 group-hover:text-primary-300 group-hover:font-bold group-hover:text-lg hover:text-primary-300"
                        >
                          $<AnimatedCounter
                            value={parseFloat(getCellValue(row, 'sale_price_usd')) || 0}
                            duration={600}
                            formatter={(v) => v.toFixed(2)}
                            className="inline"
                          />
                        </span>
                      )}
                    </td>

                    {/* Prix achat USD */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === rowId && editingCell?.field === 'purchase_price_usd' ? (
                        <input
                          type="number"
                          step="0.01"
                          value={String(getCellValue(row, 'purchase_price_usd') || '')}
                          onChange={(e) => {
                            const newValue = e.target.value; // ✅ Toujours une string depuis e.target.value
                            if (IS_DEV) {
                              console.log(`⌨️ [ProductsPage] Saisie: "${newValue}" (type: ${typeof newValue}) pour ${rowId}`);
                            }
                            // ✅ Préserver la valeur exacte saisie comme string
                            updateEditValue(rowId, 'purchase_price_usd', newValue);
                          }}
                          onBlur={() => {
                            // IA auto-save intelligent avec blur detection
                            if (pendingSavesRef.current.has(rowId)) {
                              smartBlurRow(rowId);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              // Flush immédiat à Enter
                              if (pendingSavesRef.current.has(rowId)) {
                                flushRowNow(rowId, 'enter');
                              }
                              setEditingCell(null);
                              setFocusedField(null);
                            }
                          }}
                          className="input-field text-sm px-4 py-2.5 text-right bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[130px] relative z-10"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => {
                            startEdit(rowId, 'purchase_price_usd', row?.purchase_price_usd || 0);
                          }}
                          className="cursor-pointer font-mono text-gray-300 group-hover:text-gray-200 group-hover:font-bold hover:text-gray-200"
                        >
                          ${(row?.purchase_price_usd || 0).toFixed(2)}
                        </span>
                      )}
                    </td>

                    {/* Stock */}
                    <td className="px-4 py-3 text-right" style={{ maxWidth: '120px' }}>
                      {editingCell?.rowId === rowId && editingCell?.field === 'stock_current' ? (
                        <input
                          type="number"
                          value={String(getCellValue(row, 'stock_current') || '')}
                          onChange={(e) => {
                            const newValue = e.target.value; // ✅ Toujours une string depuis e.target.value
                            // ✅ Limiter à 10 chiffres max pour éviter débordement
                            if (newValue.replace('-', '').length > 10) return;
                            if (IS_DEV) {
                              console.log(`⌨️ [ProductsPage] Saisie: "${newValue}" (type: ${typeof newValue}) pour ${rowId}`);
                            }
                            // ✅ Préserver la valeur exacte saisie comme string
                            updateEditValue(rowId, 'stock_current', newValue);
                          }}
                          onBlur={() => {
                            // IA auto-save intelligent avec blur detection
                            if (pendingSavesRef.current.has(rowId)) {
                              smartBlurRow(rowId);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              // Flush immédiat à Enter
                              if (pendingSavesRef.current.has(rowId)) {
                                flushRowNow(rowId, 'enter');
                              }
                              setEditingCell(null);
                              setFocusedField(null);
                            }
                          }}
                          className="input-field text-sm px-4 py-2.5 text-right bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg w-[100px] relative z-10"
                          autoFocus
                          max={9999999999}
                          min={-9999999999}
                        />
                      ) : (
                        <span
                          onClick={() => {
                            startEdit(rowId, 'stock_current', row?.stock_current || 0);
                          }}
                          className="cursor-pointer font-mono text-gray-200 group-hover:text-green-300 group-hover:font-bold hover:text-green-400 truncate block"
                          title={String(row?.stock_current || 0)}
                        >
                          {/* ✅ Format intelligent: nombres très grands = notation abrégée */}
                          {(() => {
                            const val = row?.stock_current || 0;
                            const absVal = Math.abs(val);
                            if (absVal >= 1000000000) return `${(val/1000000000).toFixed(1)}G`;
                            if (absVal >= 1000000) return `${(val/1000000).toFixed(1)}M`;
                            if (absVal >= 100000) return `${(val/1000).toFixed(0)}K`;
                            return val.toLocaleString('fr-FR');
                          })()}
                        </span>
                      )}
                    </td>

                    {/* Auto Stock (Automatisation Stock - seuil d'alerte) */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === rowId && editingCell?.field === 'auto_stock_factor' ? (
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={String(getCellValue(row, 'auto_stock_factor') || '')}
                          onChange={(e) => {
                            updateEditValue(rowId, 'auto_stock_factor', e.target.value);
                          }}
                          onBlur={() => {
                            if (pendingSavesRef.current.has(rowId)) {
                              smartBlurRow(rowId);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              if (pendingSavesRef.current.has(rowId)) {
                                flushRowNow(rowId, 'enter');
                              }
                              setEditingCell(null);
                              setFocusedField(null);
                            }
                          }}
                          className="input-field text-sm px-4 py-2.5 text-right bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[100px] relative z-10"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => {
                            startEdit(rowId, 'auto_stock_factor', row?.auto_stock_factor || 1);
                          }}
                          className="cursor-pointer font-mono text-gray-400 group-hover:text-orange-300 group-hover:font-bold hover:text-orange-400"
                          title="Seuil d'alerte stock (cliquer pour modifier)"
                        >
                          {(row?.auto_stock_factor || 1).toLocaleString('fr-FR')}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-center">
                      {!row?.is_empty && row && (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              if (row) {
                                handlePrintSingleProduct(row);
                              }
                            }}
                            className="p-2 bg-dark-700 hover:bg-blue-500/20 rounded-lg border border-dark-600 hover:border-blue-500/50 transition-colors"
                            title="Imprimer ce produit"
                          >
                            <Printer className="w-4 h-4 text-blue-400" />
                          </button>
                          <button
                            onClick={() => {
                              if (row) {
                                handleDeleteProduct(row);
                              }
                            }}
                            className="p-2 bg-dark-700 hover:bg-red-500/20 rounded-lg border border-dark-600 hover:border-red-500/50 transition-colors"
                            title="Supprimer ce produit"
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                      )}
                    </td>
                        </tr>
                      );
                    } catch (err) {
                      if (IS_DEV) {
                        console.error('Erreur rendu ligne virtuelle:', err);
                      }
                      return null;
                    }
                        })}

                      {/* Padding bottom */}
                      <tr>
                        <td colSpan={9} style={{ height: `${bottomPad}px` }} />
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de confirmation - création CARTON + unité */}
      <ConfirmModal
        isOpen={modalState.isOpen && modalState.type === 'create_confirm'}
        onClose={() => setModalState({ isOpen: false, type: '', data: null })}
        onConfirm={modalState.data?.onConfirm}
        onCustomName={modalState.data?.onCustomName}
        onCancel={modalState.data?.onCancel}
        title="Créer le produit en CARTON d'abord"
        message={`Le produit "${modalState.data?.edits?.product_name || ''}" n'existe pas encore.\n\n✅ Cliquer "Oui" va créer:\n• Le produit en CARTON (obligatoire)\n• L'unité ${modalState.data?.unitLevel === 'MILLIER' ? 'Détail' : modalState.data?.unitLevel === 'PIECE' ? 'Pièce' : modalState.data?.unitLevel || ''} que vous demandez`}
        productName={modalState.data?.edits?.product_name}
      />

      {/* Bouton flottant pour remonter en haut - visible seulement au milieu ou en bas */}
      {(scrollPosition === 'middle' || scrollPosition === 'bottom') && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-8 right-8 z-50 w-14 h-14 bg-primary-500 hover:bg-primary-600 rounded-full shadow-2xl border-2 border-primary-400/50 hover:border-primary-300 flex items-center justify-center text-white transition-colors"
          title="Remonter en haut"
        >
          <ArrowUp className="w-6 h-6" />
        </button>
      )}

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onCloseToast={closeToast} />
    </div>
  );
};

export default function ProductsPageWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <ProductsPage />
    </ErrorBoundary>
  );
}
