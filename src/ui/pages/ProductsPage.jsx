import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Trash2
} from 'lucide-react';
import { useStore } from '../store/useStore';
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
const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, productName, onCustomName }) => {
  const [customName, setCustomName] = useState('');
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 border border-white/10">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-primary-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-100">{title}</h3>
          </div>
          
          <p className="text-gray-300 mb-4">{message}</p>
          
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
                onClose();
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
  const { products, loadProducts, currentRate, loadCurrentRate, token: storeToken, isAuthenticated } = useStore();
  const navigate = useNavigate();
  
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
  
  // Refs pour auto-save IA
  const pendingSavesRef = useRef(new Map());
  const savingLoopRef = useRef(false); // ✅ Boucle de sauvegarde au lieu d'un lock simple
  const idleSaveTimersRef = useRef(new Map()); // Map<rowId, timeoutId>
  const lastInputAtRef = useRef(new Map());    // Map<rowId, timestamp>
  
  // ✅ Ref pour éviter les closures stale dans les callbacks
  const editingValuesRef = useRef({});
  useEffect(() => {
    editingValuesRef.current = editingValues;
  }, [editingValues]);
  
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
              if (activeFilter === 'CARTON' && unit.unit_level !== 'CARTON') return;
              if (activeFilter === 'DETAIL' && unit.unit_level !== 'MILLIER') return;
              if (activeFilter === 'PIECE' && unit.unit_level !== 'PIECE') return;
              
              const salePriceUSD = Number(unit.sale_price_usd) || 0;
              const calculatedFC = calculateFC(salePriceUSD);
              
              // IDs stables pour éviter les re-renders React
              const stableProductKey = product.id ?? product.code ?? `p${pIndex}`;
              const stableUnitKey = unit.id ?? `${unit.unit_level ?? 'U'}-${uIndex}`;
              
              rows.push({
                id: `${stableProductKey}-${stableUnitKey}`, // ✅ stable
                product_id: product.id,
                product_code: product.code || '',
                product_name: product.name || '',
                unit_id: unit.id,
                unit_uuid: unit.uuid ?? null,                    // ✅ utile si id absent / sync
                unit_level: unit.unit_level || '',
                unit_mark: unit.unit_mark || '',
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

  // Navigation : scroll vers le bas (dernier produit) - protégé pour Electron
  const scrollToBottom = useCallback(() => {
    try {
      if (lastRealProductIndex === -1) return;
      
      // Attendre que le DOM soit prêt (important pour Electron)
      setTimeout(() => {
        try {
          const tableElement = document?.querySelector('tbody');
          if (!tableElement) return;
          
          const rows = tableElement.querySelectorAll('tr:not([data-navigation])');
          if (rows[lastRealProductIndex]) {
            rows[lastRealProductIndex].scrollIntoView({ 
              behavior: 'auto', 
              block: 'center' 
            });
          }
        } catch (err) {
          if (IS_DEV) {
            console.error('Erreur scrollToBottom:', err);
          }
        }
      }, 100);
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur scrollToBottom:', error);
      }
    }
  }, [lastRealProductIndex]);

  // Navigation : scroll vers le haut - protégé pour Electron
  const scrollToTop = useCallback(() => {
    try {
      const scrollContainer = scrollContainerRef.current || document?.querySelector('.overflow-x-auto');
      if (scrollContainer) {
        scrollContainer.scrollTo({ 
          top: 0, 
          behavior: 'auto' 
        });
      } else {
        const tableHeader = document?.querySelector('thead');
        if (tableHeader) {
          tableHeader.scrollIntoView({ 
            behavior: 'auto', 
            block: 'start' 
          });
        } else if (typeof window !== 'undefined' && window.scrollTo) {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
      }
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur scrollToTop:', error);
      }
    }
  }, []);

  // État pour savoir la position de scroll
  const [scrollPosition, setScrollPosition] = useState('top');
  const scrollContainerRef = useRef(null);
  const scrollCheckTimeoutRef = useRef(null);

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
            const scrollContainer = scrollContainerRef.current || document?.querySelector('.overflow-x-auto');
            
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
      const scrollContainer = document?.querySelector('.overflow-x-auto');
      if (scrollContainer) {
        scrollContainerRef.current = scrollContainer;
        scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
        
        if (typeof window !== 'undefined' && window.addEventListener) {
          window.addEventListener('scroll', handleScroll, { passive: true });
        }
        
        return () => {
          if (scrollContainer && scrollContainer.removeEventListener) {
            scrollContainer.removeEventListener('scroll', handleScroll);
          }
          if (typeof window !== 'undefined' && window.removeEventListener) {
            window.removeEventListener('scroll', handleScroll);
          }
          if (scrollCheckTimeoutRef.current) {
            cancelAnimationFrame(scrollCheckTimeoutRef.current);
          }
        };
      } else if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
        return () => {
          if (window.removeEventListener) {
            window.removeEventListener('scroll', handleScroll);
          }
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
    
    if (!productName) {
      throw new Error('Le nom du produit est requis');
    }

    // ✅ Normaliser Mark (peut être vide; validation au blur)
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
      // Rechercher un produit avec le même nom qui a une unité CARTON
      const existingCarton = Array.isArray(products) ? products.find(p => {
        if (!p || !p.name || typeof p.name !== 'string') return false;
        try {
          const nameMatch = p.name.toLowerCase().trim() === productName.toLowerCase().trim();
          const hasCarton = Array.isArray(p.units) && p.units.some(u => u && u.unit_level === 'CARTON');
          return nameMatch && hasCarton;
        } catch {
          return false;
        }
      }) : null;
      
      if (existingCarton) {
        const auth = getAuthHeaders();
        const productKey = existingCarton.id ?? existingCarton.code;

        // Reprendre le produit "frais" (évite unités périmées)
        let currentProduct = existingCarton;
        try {
          const r = await axios.get(`${API_URL}/api/products/${productKey}`, auth);
          currentProduct = r.data;
        } catch {
          // si GET échoue, on fallback sur existingCarton
        }

        const now = nowISO();

        // ✅ valeurs numériques propres
        const stockValue = toNumberSafe(edits?.stock_current, 0);
        const purchaseValue = toNumberSafe(edits?.purchase_price_usd, 0);

        const autoStock = Math.round(toNumberSafe(edits?.auto_stock_factor, 1));
        const newUnit = buildUnitPayload(
          {
            unit_level: unitLevel,
            unit_mark: mark,
            stock_current: stockValue,
            purchase_price_usd: purchaseValue,
            sale_price_usd: salePriceUSD, // USD source de vérité
            auto_stock_factor: autoStock,
            qty_step: 1,
            extra1: null,
            extra2: null,
          },
          { last_update: now, synced_at: null }
        );

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
        // Demander confirmation via modal
        return new Promise((resolve, reject) => {
          setModalState({
            isOpen: true,
            type: 'create_confirm',
            data: {
              row,
              edits,
              unitLevel,
              onConfirm: async () => {
                try {
                  // Générer un code unique
                  const code = edits?.product_code || `PROD-${Date.now()}`;
                  // ✅ Parser correctement les valeurs numériques
                  const stockStr = String(edits?.stock_current || '').trim();
                  const stockValue = stockStr !== '' ? (parseFloat(stockStr) || 0) : 0;
                  const purchaseStr = String(edits?.purchase_price_usd || '').trim();
                  const purchaseValue = purchaseStr !== '' ? (parseFloat(purchaseStr) || 0) : 0;
                  
                  const autoStock = Math.round(toNumberSafe(edits?.auto_stock_factor, 1));
                  await axios.post(`${API_URL}/api/products`, {
                    code,
                    name: productName,
                    units: [{
                      unit_level: unitLevel,
                      unit_mark: mark,
                      stock_current: stockValue,
                      sale_price_usd: salePriceUSD, // USD comme source de vérité
                      // Ne pas envoyer sale_price_fc, le backend le calculera depuis USD
                      purchase_price_usd: purchaseValue,
                      auto_stock_factor: autoStock,  // ✅ ADD
                    }]
                  }, getAuthHeaders());
                  setModalState({ isOpen: false, type: '', data: null });
                  resolve();
                } catch (error) {
                  reject(error);
                }
              },
              onCustomName: async (customName) => {
                try {
                  const code = edits?.product_code || `PROD-${Date.now()}`;
                  // ✅ Parser correctement les valeurs numériques
                  const stockStr = String(edits?.stock_current || '').trim();
                  const stockValue = stockStr !== '' ? (parseFloat(stockStr) || 0) : 0;
                  const purchaseStr = String(edits?.purchase_price_usd || '').trim();
                  const purchaseValue = purchaseStr !== '' ? (parseFloat(purchaseStr) || 0) : 0;
                  
                  const autoStock = Math.round(toNumberSafe(edits?.auto_stock_factor, 1));
                  await axios.post(`${API_URL}/api/products`, {
                    code,
                    name: customName,
                    units: [{
                      unit_level: unitLevel,
                      unit_mark: mark,
                      stock_current: stockValue,
                      sale_price_usd: salePriceUSD, // USD comme source de vérité
                      // Ne pas envoyer sale_price_fc, le backend le calculera depuis USD
                      purchase_price_usd: purchaseValue,
                      auto_stock_factor: autoStock,  // ✅ ADD
                    }]
                  }, getAuthHeaders());
                  setModalState({ isOpen: false, type: '', data: null });
                  resolve();
                } catch (error) {
                  reject(error);
                }
              },
              onCancel: () => {
                setModalState({ isOpen: false, type: '', data: null });
                reject(new Error('Annulé'));
              }
            }
          });
        });
      }
    } else {
      // CARTON peut être créé directement
      const code = edits?.product_code || `PROD-${Date.now()}`;
      // ✅ Parser correctement les valeurs numériques
      const stockStr = String(edits?.stock_current || '').trim();
      const stockValue = stockStr !== '' ? (parseFloat(stockStr) || 0) : 0;
      const purchaseStr = String(edits?.purchase_price_usd || '').trim();
      const purchaseValue = purchaseStr !== '' ? (parseFloat(purchaseStr) || 0) : 0;
      
      const autoStock = Math.round(toNumberSafe(edits?.auto_stock_factor, 1));
      await axios.post(`${API_URL}/api/products`, {
        code,
        name: productName,
        units: [{
          unit_level: 'CARTON',
          unit_mark: mark,
          stock_current: stockValue,
          sale_price_usd: salePriceUSD, // USD comme source de vérité
          // Ne pas envoyer sale_price_fc, le backend le calculera depuis USD
          purchase_price_usd: purchaseValue,
          auto_stock_factor: autoStock,  // ✅ ADD
        }]
      }, getAuthHeaders());
    }
  }, [products, calculateFC, calculateUSD, getAuthHeaders]);

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
      unitUpdates.unit_mark = normalizeMark(edits.unit_mark);  // ✅ trim; never null (always '' or string)
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

  // ✅ NOUVEAU: Supprimer un produit
  const handleDeleteProduct = useCallback(async (row) => {
    if (!row || row.is_empty) return;

    const productCode = getProductCode(row);
    if (!productCode) {
      alert('Code produit invalide');
      return;
    }

    // Demander confirmation
    const confirmed = window.confirm(
      `Êtes-vous sûr de vouloir supprimer le produit "${row.product_name}" (${productCode})?\n\nCette action est irréversible.`
    );
    if (!confirmed) return;

    try {
      const auth = getAuthHeaders();
      
      if (IS_DEV) {
        console.log(`🗑️ [ProductsPage] Suppression produit: ${productCode}`);
      }

      await axios.delete(`${API_URL}/api/products/${productCode}`, auth);

      if (IS_DEV) {
        console.log('✅ [ProductsPage] Produit supprimé avec succès');
      }

      // Afficher message de succès
      setSaveMessage({ type: 'success', text: 'Produit supprimé avec succès' });
      setTimeout(() => setSaveMessage({ type: '', text: '' }), 2000);

      // Recharger les produits via le store
      await loadProducts();

    } catch (error) {
      if (IS_DEV) {
        console.error('❌ [ProductsPage] Erreur suppression produit:', error);
        console.error('   Status:', error.response?.status);
        console.error('   Message:', error.response?.data?.error || error.message);
      }

      let errorMessage = 'Erreur lors de la suppression';
      if (error.response?.status === 401) {
        errorMessage = 'Erreur d\'authentification. Veuillez vous reconnecter.';
      } else if (error.response?.status === 404) {
        errorMessage = 'Produit non trouvé';
      } else {
        errorMessage = error.response?.data?.error || errorMessage;
      }

      setSaveMessage({ type: 'error', text: errorMessage });
      setTimeout(() => setSaveMessage({ type: '', text: '' }), 3000);
    }
  }, [getAuthHeaders, getProductCode, loadProducts]);

  // Sauvegarder les changements en attente avec boucle (défini avant scheduleSave)
  // ✅ Utilise une boucle au lieu d'un lock pour éviter de perdre les modifications pendant la sauvegarde
  const savePendingChanges = useCallback(async () => {
    // Empêcher la ré-entrée
    if (savingLoopRef.current) {
      if (IS_DEV) {
        console.log('⏸️ [ProductsPage] Boucle de sauvegarde déjà en cours');
      }
      return;
    }
    
    savingLoopRef.current = true;
    setSaving(true);
    setSaveMessage({ type: 'info', text: 'Sauvegarde en cours...' });
    
    try {
      // ✅ Boucle pour traiter tous les changements, même ceux qui arrivent pendant la sauvegarde
      while (pendingSavesRef.current.size > 0) {
        // Prendre un snapshot puis vider immédiatement (les nouveaux edits peuvent être ajoutés pendant la requête)
        const batch = Array.from(pendingSavesRef.current.keys());
        pendingSavesRef.current.clear();
        
        if (IS_DEV) {
          console.log(`💾 [ProductsPage] Sauvegarde de ${batch.length} produit(s) dans cette itération`);
        }
        
        const promises = batch.map(async (rowId) => {
          const row = tableData.find(r => r.id === rowId);
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
            return handleCreateProduct(row, edits).catch(err => {
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
              if (!m) {
                throw new Error('Le Mark est obligatoire');
              }
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
        
        await Promise.all(promises);
        
        // Si de nouveaux changements sont arrivés pendant la sauvegarde, on continue la boucle
        if (IS_DEV && pendingSavesRef.current.size > 0) {
          console.log(`   🔄 Nouveaux changements détectés (${pendingSavesRef.current.size}), nouvelle itération...`);
        }
      }
      
      setSaveMessage({ type: 'success', text: 'Sauvegarde réussie' });
      
      // Recharger les produits après un court délai pour laisser le backend se mettre à jour
      setTimeout(async () => {
        await loadProducts();
      }, 500);
      
      // Effacer le message après 2 secondes
      setTimeout(() => {
        setSaveMessage({ type: '', text: '' });
      }, 2000);
    } catch (error) {
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
        // UNIQUE constraint violation
        const detail = error.response?.data?.error || '';
        if (detail.toLowerCase().includes('mark') || detail.toLowerCase().includes('unique')) {
          errorMessage = 'Ce Mark existe déjà pour ce produit et cette unité';
        } else {
          errorMessage = error.response?.data?.error || 'Conflit: cette donnée existe déjà';
        }
      } else {
        errorMessage = error.response?.data?.error || errorMessage;
      }
      
      setSaveMessage({ type: 'error', text: errorMessage });
    } finally {
      setSaving(false);
      savingLoopRef.current = false; // ✅ Utiliser savingLoopRef au lieu de savingInFlightRef
    }
  }, [tableData, loadProducts, handleCreateProduct, handleUpdateProduct, calculateFC, calculateUSD, setVisualForRow]);

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
    if (!pendingSavesRef.current.has(rowId)) return;
    if (IS_DEV) console.log(`⚡ [AUTO-SAVE IA] ${reason} → save immédiat row=${rowId}`);
    savePendingChanges();
  }, [cancelIdleSave, savePendingChanges]);

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

      // Focus sorti => save immédiat
      if (pendingSavesRef.current.has(rowId)) {
        if (IS_DEV) console.log(`⚡ [AUTO-SAVE IA] sortie ligne row=${rowId} → save immédiat`);
        savePendingChanges();
      }
    });
  }, [cancelIdleSave, isRowFocused, scheduleIdleSave, savePendingChanges]);

  // ✅ PRO : si clic dehors de la ligne active, on flush AVANT les handlers (capture)
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const onPointerDownCapture = (e) => {
      const activeRowId = editingCell?.rowId;
      if (!activeRowId) return;

      const inside = e.target?.closest?.(`[data-rowid="${activeRowId}"]`);
      if (!inside && pendingSavesRef.current.has(activeRowId)) {
        flushRowNow(activeRowId, 'clic-dehors');
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
  const AUTO_SAVE_FIELDS = new Set([
    'sale_price_fc',
    'sale_price_usd',
    'purchase_price_usd',
    'stock_current',
    'auto_stock_factor',
    'unit_mark',      // ✅ Ajouter pour éviter perte du mark
    'product_name'    // ✅ Ajouter pour nom du produit
  ]);

  // Obtenir les suggestions de produits par nom - avec cache
  const getProductSuggestions = useCallback((productName, unitLevel) => {
    if (!productName || typeof productName !== 'string' || productName.trim().length < 2) return [];
    if (!Array.isArray(products)) return [];
    
    const cacheKey = `${productName.toLowerCase().trim()}-${unitLevel || 'all'}`;
    if (productSuggestionsCache.current.has(cacheKey)) {
      return productSuggestionsCache.current.get(cacheKey);
    }
    
    try {
      const query = productName.toLowerCase().trim();
      const suggestions = products.filter(p => {
        if (!p || !p.name) return false;
        try {
          return p.name.toLowerCase().includes(query) &&
            (!unitLevel || unitLevel === 'CARTON' || p.units?.some(u => u && u.unit_level === unitLevel));
        } catch {
          return false;
        }
      }).slice(0, 5);
      
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

  // Imprimer la liste
  const handlePrint = async () => {
    try {
      setLoading(true);
      
      // Préparer les données pour l'impression (un ticket par produit)
      const productsToPrint = filteredData.filter(row => !row.is_empty);
      
      if (productsToPrint.length === 0) {
        setSaveMessage({ type: 'error', text: 'Aucun produit à imprimer' });
        setTimeout(() => setSaveMessage({ type: '', text: '' }), 2000);
        return;
      }

      // Confirmation si beaucoup de tickets
      if (productsToPrint.length > 80) {
        const proceed = window.confirm(`Vous allez envoyer ${productsToPrint.length} tickets à l'impression. Continuer ?`);
        if (!proceed) {
          setLoading(false);
          return;
        }
      }
      
      // Obtenir le label de l'unité
      const getUnitLabel = (unitLevel) => {
        const labels = {
          'CARTON': 'CARTON',
          'MILLIER': 'DÉTAIL',
          'PIECE': 'PIÈCE',
          'DETAIL': 'DÉTAIL'
        };
        return labels[unitLevel] || unitLevel;
      };

      // Fonction pour formater le prix en FC
      const formatPrixFC = (price) => {
        return (price || 0).toLocaleString('fr-CD') + ' FC';
      };

      // Fonction pour nettoyer le nom du produit
      const cleanProductName = (name) => {
        return String(name || '').trim().replace(/\s+/g, ' ');
      };

      // Délai entre chaque envoi (comme dans prix.js)
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      
      // Envoyer un job par produit (séquentiellement avec délai pour éviter surcharge)
      setSaveMessage({ type: 'info', text: `Envoi des tickets (${productsToPrint.length})…` });
      
      for (const row of productsToPrint) {
        const prixFc = formatPrixFC(row.sale_price_fc);
        const nom = cleanProductName(row.product_name);
        const unite = getUnitLabel(row.unit_level);
        const mark = row.unit_mark || '';
        const stock = (row.stock_current || 0).toLocaleString('fr-CD');
        
        const job = {
          template: 'receipt-produit-80mm',
          ticketWidthMM: 80,
          copies: 1,
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
        } catch (error) {
          if (IS_DEV) {
            console.error(`Erreur impression produit ${row.product_code}:`, error);
          }
          // Continue avec les autres produits même en cas d'erreur
        }
        
        // Délai de 180ms entre chaque ticket (comme dans prix.js)
        await delay(180);
      }
      
      setSaveMessage({ type: 'success', text: `${productsToPrint.length} ticket(s) envoyé(s) à l'impression` });
      setTimeout(() => setSaveMessage({ type: '', text: '' }), 2000);
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur impression:', error);
      }
      setSaveMessage({ type: 'error', text: 'Erreur lors de l\'impression' });
    } finally {
      setLoading(false);
    }
  };

  // Imprimer un seul produit (ticket inverse)
  const handlePrintSingleProduct = async (row) => {
    if (!row || row.is_empty) return;
    
    try {
      // Obtenir le label de l'unité
      const getUnitLabel = (unitLevel) => {
        const labels = {
          'CARTON': 'CARTON',
          'MILLIER': 'DÉTAIL',
          'PIECE': 'PIÈCE',
          'DETAIL': 'DÉTAIL'
        };
        return labels[unitLevel] || unitLevel;
      };

      // Formater le prix en FC
      const formatPrixFC = (price) => {
        return (price || 0).toLocaleString('fr-CD') + ' FC';
      };

      // Nettoyer le nom du produit
      const cleanProductName = (name) => {
        return String(name || '').trim().replace(/\s+/g, ' ');
      };

      const prixFc = formatPrixFC(row.sale_price_fc);
      const nom = cleanProductName(row.product_name);
      const unite = getUnitLabel(row.unit_level);
      const mark = row.unit_mark || '';
      const stock = (row.stock_current || 0).toLocaleString('fr-CD');
      
      const job = {
        template: 'receipt-produit-80mm',
        ticketWidthMM: 80,
        copies: 1,
        data: {
          prixFc: prixFc,
          nom: nom,
          unite: unite,
          mark: mark,
          stock: stock
        }
      };
      
      await axios.post(`${PRINT_API_URL}/jobs`, job, getAuthHeaders());
      setSaveMessage({ type: 'success', text: 'Ticket envoyé à l\'impression' });
      setTimeout(() => setSaveMessage({ type: '', text: '' }), 2000);
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur impression produit:', error);
      }
      setSaveMessage({ type: 'error', text: 'Erreur lors de l\'impression' });
      setTimeout(() => setSaveMessage({ type: '', text: '' }), 2000);
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
          <p className="text-gray-400">
            {initialLoading ? 'Chargement...' : `${productCount} produit(s)`} • Taux: {currentRate || 2800} FC/USD
            {activeFilter !== 'TOUS' && (
              <span className="ml-2 text-primary-400">
                • Filtre: {activeFilter === 'DETAIL' ? 'Détail (Milliers)' : activeFilter}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            <Printer className="w-5 h-5" />
            Imprimer liste
          </button>
          <button
            onClick={handleExportCSV}
            className="btn-secondary flex items-center gap-2"
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
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher (nom, code)..."
            className="input-field pl-10 w-full"
            autoFocus
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
          <div className="overflow-x-auto" ref={scrollContainerRef}>
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
              <tbody className="divide-y divide-white/5">
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
                {Array.isArray(filteredData) && filteredData.map((row, index) => {
                    if (!row) return null;
                    
                    try {
                      const isEditingThisRow = editingCell?.rowId === row.id && !row.is_empty;
                      const hasPendingChanges = pendingSavesRef.current.has(row.id);
                      
                      return (
                        <tr
                          key={row.id || `row-${index}`}
                          data-rowid={row.id}
                          className={`group ${
                            row.is_empty ? 'opacity-30' : 'hover:bg-dark-700/50'
                          } ${
                            isEditingThisRow
                              ? 'bg-primary-500/10 border-l-2 border-primary-500/50' 
                              : hasPendingChanges
                              ? 'bg-orange-500/5 border-l-2 border-orange-500/30'
                              : ''
                          } transition-colors`}
                          onMouseLeave={() => smartBlurRow(row.id)}
                        >
                    {/* Produit */}
                    <td className="px-4 py-3">
                      {editingCell?.rowId === row?.id && editingCell?.field === 'product_name' ? (
                        <div className="relative">
                          <input
                            type="text"
                            value={getCellValue(row, 'product_name') || ''}
                            onChange={(e) => {
                              if (row?.id) {
                                updateEditValue(row.id, 'product_name', e.target.value);
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                if (row?.id) {
                                  smartBlurRow(row.id);
                                }
                                setEditingCell(null);
                                setFocusedField(null);
                              }, 50);
                            }}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                if (row?.id) {
                                  flushRowNow(row.id, 'enter');
                                }
                                setEditingCell(null);
                                setFocusedField(null);
                              }
                            }}
                            className="input-field text-sm w-full px-4 py-2.5 bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[200px] relative z-10"
                            autoFocus
                          />
                          {/* Suggestions de produits pour autres unités */}
                          {(() => {
                            try {
                              const productName = getCellValue(row, 'product_name') || '';
                              const unitLevel = getCellValue(row, 'unit_level') || row?.unit_level || '';
                              const suggestions = unitLevel !== 'CARTON' && productName && typeof productName === 'string' && productName.length >= 2 
                                ? getProductSuggestions(productName, unitLevel)
                                : [];
                              const autoCode = row?.is_empty && unitLevel === 'CARTON' && productName && productName.trim()
                                ? generateAutoCode('CARTON')
                                : null;
                              
                              return (
                                <>
                                  {Array.isArray(suggestions) && suggestions.length > 0 && (
                                    <div className="absolute z-[100] mt-1 w-full bg-dark-800 border border-primary-500/30 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                                      {suggestions.map((p, idx) => {
                                        if (!p || !p.name) return null;
                                        return (
                                          <button
                                            key={p.id || idx}
                                            type="button"
                                            onClick={() => {
                                              if (row?.id) {
                                                updateEditValue(row.id, 'product_name', p.name || '');
                                                updateEditValue(row.id, 'product_code', p.code || '');
                                                setTimeout(() => {
                                                  setEditingCell(null);
                                                  setFocusedField(null);
                                                }, 100);
                                              }
                                            }}
                                            className="w-full text-left px-4 py-2 hover:bg-primary-500/20 text-gray-200 text-sm border-b border-white/5 last:border-0"
                                          >
                                            <div className="font-semibold">{p.name || ''}</div>
                                            <div className="text-xs text-gray-400">Code: {p.code || ''}</div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {autoCode && (
                                    <div className="absolute -bottom-6 left-0 text-xs text-primary-400 font-medium">
                                      Code auto: {autoCode}
                                    </div>
                                  )}
                                </>
                              );
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
                            if (row?.id) {
                              startEdit(row.id, 'product_name', getCellValue(row, 'product_name') || '');
                            }
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
                      {editingCell?.rowId === row?.id && editingCell?.field === 'unit_level' ? (
                        <select
                          value={getCellValue(row, 'unit_level') || ''}
                          onChange={(e) => {
                            if (row?.id) {
                              updateEditValue(row.id, 'unit_level', e.target.value);
                            }
                          }}
                          onBlur={() => {
                            if (row?.id) {
                              smartBlurRow(row.id);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          className="input-field text-sm px-4 py-2.5 bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[140px] relative z-10"
                        >
                          <option value="CARTON">Carton</option>
                          <option value="MILLIER">Détail</option>
                          <option value="PIECE">Pièce</option>
                        </select>
                      ) : (
                        <span
                          onClick={() => {
                            if (row?.id) {
                              startEdit(row.id, 'unit_level', row?.unit_level || '');
                            }
                          }}
                          className="cursor-pointer text-gray-200 group-hover:text-primary-300 group-hover:font-semibold hover:text-primary-400"
                        >
                          {getUnitLabel(row?.unit_level) || '—'}
                        </span>
                      )}
                    </td>

                    {/* Mark */}
                    <td className="px-4 py-3">
                      {editingCell?.rowId === row?.id && editingCell?.field === 'unit_mark' ? (
                        <div className="relative">
                          <input
                            type="text"
                            value={getCellValue(row, 'unit_mark') || ''}
                            onChange={(e) => {
                              if (row?.id) {
                                updateEditValue(row.id, 'unit_mark', e.target.value);
                              }
                            }}
                            onBlur={(e) => {
                              const vNorm = String(e.currentTarget.value ?? '').trim(); // ✅ CORRECT: e.currentTarget

                              // ✅ VALIDATION: Mark ne peut pas être vide (DB constraint)
                              if (!vNorm) {
                                cancelIdleSave(row.id);
                                pendingSavesRef.current.delete(row.id);
                                
                                setSaveMessage({ 
                                  type: 'error', 
                                  text: 'Le Mark (unité de vente) est obligatoire' 
                                });
                                setTimeout(() => setSaveMessage({ type: '', text: '' }), 3000);
                                // Rester en édition pour que l'utilisateur corrige
                                return;
                              }

                              // ✅ cache visuel immédiat 8s
                              setVisualForRow(row.id, { unit_mark: vNorm }, 8000);

                              // ✅ Pousser la valeur normalisée dans editingValues
                              updateEditValue(row.id, 'unit_mark', vNorm);

                              // ✅ IA: Blur intelligent - save immédiat si focus sort de la ligne
                              smartBlurRow(row.id);

                              setEditingCell(null);
                              setFocusedField(null);
                            }}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                const vNorm = String(e.currentTarget.value ?? '').trim();

                                // ✅ VALIDATION: Mark ne peut pas être vide (DB constraint)
                                if (!vNorm) {
                                  setSaveMessage({ 
                                    type: 'error', 
                                    text: 'Le Mark (unité de vente) est obligatoire' 
                                  });
                                  setTimeout(() => setSaveMessage({ type: '', text: '' }), 3000);
                                  return;
                                }

                                // ✅ cache visuel immédiat 8s
                                setVisualForRow(row.id, { unit_mark: vNorm }, 8000);

                                // ✅ Pousser la valeur normalisée
                                updateEditValue(row.id, 'unit_mark', vNorm);

                                // ✅ IA: save immédiat à Enter
                                flushRowNow(row.id, 'enter');

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
                                <div className="absolute z-[100] mt-1 w-full bg-dark-800 border border-primary-500/30 rounded-lg shadow-xl max-h-32 overflow-y-auto">
                                  {markSuggestions
                                    .filter(m => m && typeof m === 'string' && (!currentMark || m.toLowerCase().includes(currentMark.toLowerCase())))
                                    .slice(0, 8)
                                    .map((mark, idx) => (
                                      <button
                                        key={idx}
                                        type="button"
                                        onClick={() => {
                                          if (row?.id && mark) {
                                            updateEditValue(row.id, 'unit_mark', mark);
                                            setTimeout(() => {
                                              setEditingCell(null);
                                              setFocusedField(null);
                                            }, 100);
                                          }
                                        }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-primary-500/20 text-gray-200 text-sm border-b border-white/5 last:border-0"
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
                            if (row?.id) {
                              startEdit(row.id, 'unit_mark', getCellValue(row, 'unit_mark') || '');
                            }
                          }}
                          className="cursor-pointer text-gray-200 group-hover:text-primary-300 group-hover:font-semibold group-hover:px-2 group-hover:py-1 group-hover:bg-primary-500/20 group-hover:rounded hover:text-primary-400"
                        >
                          {String(getCellValue(row, 'unit_mark') || '').trim() || '—'}
                        </span>
                      )}
                    </td>

                    {/* Prix vente FC */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === row?.id && editingCell?.field === 'sale_price_fc' ? (
                        <input
                          type="number"
                          value={String(getCellValue(row, 'sale_price_fc') || '')}
                          onChange={(e) => {
                            if (row?.id) {
                              const newValue = e.target.value; // ✅ Toujours une string depuis e.target.value
                              if (IS_DEV) {
                                console.log(`⌨️ [ProductsPage] Saisie: "${newValue}" (type: ${typeof newValue}) pour ${row.id}`);
                              }
                              // ✅ Préserver la valeur exacte saisie comme string
                              updateEditValue(row.id, 'sale_price_fc', newValue);
                            }
                          }}
                          onBlur={() => {
                            // IA auto-save intelligent avec blur detection
                            if (row?.id && pendingSavesRef.current.has(row.id)) {
                              smartBlurRow(row.id);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              // Flush immédiat à Enter
                              if (row?.id && pendingSavesRef.current.has(row.id)) {
                                flushRowNow(row.id, 'enter');
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
                            if (row?.id) {
                              startEdit(row.id, 'sale_price_fc', row?.sale_price_fc || 0);
                            }
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
                      {editingCell?.rowId === row?.id && editingCell?.field === 'sale_price_usd' ? (
                        <input
                          type="number"
                          step="0.01"
                          value={String(getCellValue(row, 'sale_price_usd') || '')}
                          onChange={(e) => {
                            if (row?.id) {
                              const newValue = e.target.value; // ✅ Toujours une string depuis e.target.value
                              if (IS_DEV) {
                                console.log(`⌨️ [ProductsPage] Saisie: "${newValue}" (type: ${typeof newValue}) pour ${row.id}`);
                              }
                              // ✅ Préserver la valeur exacte saisie comme string
                              updateEditValue(row.id, 'sale_price_usd', newValue);
                            }
                          }}
                          onBlur={() => {
                            // IA auto-save intelligent avec blur detection
                            if (row?.id && pendingSavesRef.current.has(row.id)) {
                              smartBlurRow(row.id);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              // Flush immédiat à Enter
                              if (row?.id && pendingSavesRef.current.has(row.id)) {
                                flushRowNow(row.id, 'enter');
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
                            if (row?.id) {
                              startEdit(row.id, 'sale_price_usd', row?.sale_price_usd || 0);
                            }
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
                      {editingCell?.rowId === row?.id && editingCell?.field === 'purchase_price_usd' ? (
                        <input
                          type="number"
                          step="0.01"
                          value={String(getCellValue(row, 'purchase_price_usd') || '')}
                          onChange={(e) => {
                            if (row?.id) {
                              const newValue = e.target.value; // ✅ Toujours une string depuis e.target.value
                              if (IS_DEV) {
                                console.log(`⌨️ [ProductsPage] Saisie: "${newValue}" (type: ${typeof newValue}) pour ${row.id}`);
                              }
                              // ✅ Préserver la valeur exacte saisie comme string
                              updateEditValue(row.id, 'purchase_price_usd', newValue);
                            }
                          }}
                          onBlur={() => {
                            // IA auto-save intelligent avec blur detection
                            if (row?.id && pendingSavesRef.current.has(row.id)) {
                              smartBlurRow(row.id);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              // Flush immédiat à Enter
                              if (row?.id && pendingSavesRef.current.has(row.id)) {
                                flushRowNow(row.id, 'enter');
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
                            if (row?.id) {
                              startEdit(row.id, 'purchase_price_usd', row?.purchase_price_usd || 0);
                            }
                          }}
                          className="cursor-pointer font-mono text-gray-300 group-hover:text-gray-200 group-hover:font-bold hover:text-gray-200"
                        >
                          ${(row?.purchase_price_usd || 0).toFixed(2)}
                        </span>
                      )}
                    </td>

                    {/* Stock */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === row?.id && editingCell?.field === 'stock_current' ? (
                        <input
                          type="number"
                          value={String(getCellValue(row, 'stock_current') || '')}
                          onChange={(e) => {
                            if (row?.id) {
                              const newValue = e.target.value; // ✅ Toujours une string depuis e.target.value
                              if (IS_DEV) {
                                console.log(`⌨️ [ProductsPage] Saisie: "${newValue}" (type: ${typeof newValue}) pour ${row.id}`);
                              }
                              // ✅ Préserver la valeur exacte saisie comme string
                              updateEditValue(row.id, 'stock_current', newValue);
                            }
                          }}
                          onBlur={() => {
                            // IA auto-save intelligent avec blur detection
                            if (row?.id && pendingSavesRef.current.has(row.id)) {
                              smartBlurRow(row.id);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              // Flush immédiat à Enter
                              if (row?.id && pendingSavesRef.current.has(row.id)) {
                                flushRowNow(row.id, 'enter');
                              }
                              setEditingCell(null);
                              setFocusedField(null);
                            }
                          }}
                          className="input-field text-sm px-4 py-2.5 text-right bg-dark-800/50 border border-primary-500/60 focus:border-primary-500 rounded-lg min-w-[120px] relative z-10"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => {
                            if (row?.id) {
                              startEdit(row.id, 'stock_current', row?.stock_current || 0);
                            }
                          }}
                          className="cursor-pointer font-mono text-gray-200 group-hover:text-green-300 group-hover:font-bold hover:text-green-400"
                        >
                          {(row?.stock_current || 0).toLocaleString('fr-FR')}
                        </span>
                      )}
                    </td>

                    {/* Auto Stock (Automatisation Stock - seuil d'alerte) */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === row?.id && editingCell?.field === 'auto_stock_factor' ? (
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={String(getCellValue(row, 'auto_stock_factor') || '')}
                          onChange={(e) => {
                            if (row?.id) {
                              updateEditValue(row.id, 'auto_stock_factor', e.target.value);
                            }
                          }}
                          onBlur={() => {
                            if (row?.id && pendingSavesRef.current.has(row.id)) {
                              smartBlurRow(row.id);
                            }
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              if (row?.id && pendingSavesRef.current.has(row.id)) {
                                flushRowNow(row.id, 'enter');
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
                            if (row?.id) {
                              startEdit(row.id, 'auto_stock_factor', row?.auto_stock_factor || 1);
                            }
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
                      // Erreur silencieuse pour éviter de casser le rendu
                      if (IS_DEV) {
                        console.error('Erreur rendu ligne:', err, row);
                      }
                      // Retourner une ligne vide au lieu de null pour éviter les problèmes de clés
                      return (
                        <tr key={row?.id || `error-${index}`} className="opacity-50">
                          <td colSpan={9} className="px-4 py-2 text-center text-gray-500 text-sm">
                            Erreur de rendu
                          </td>
                        </tr>
                      );
                    }
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de confirmation */}
      <ConfirmModal
        isOpen={modalState.isOpen && modalState.type === 'create_confirm'}
        onClose={() => setModalState({ isOpen: false, type: '', data: null })}
        onConfirm={modalState.data?.onConfirm}
        onCustomName={modalState.data?.onCustomName}
        title="Créer un nouveau produit?"
        message={`Le produit "${modalState.data?.edits?.product_name || ''}" n'existe pas en CARTON. Voulez-vous créer un nouveau produit ${modalState.data?.unitLevel === 'MILLIER' ? 'Détail' : modalState.data?.unitLevel === 'PIECE' ? 'Pièce' : ''} avec ce nom?`}
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
    </div>
  );
};

export default ProductsPage;
