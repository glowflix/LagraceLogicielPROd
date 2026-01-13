import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  DollarSign,
  X,
  Check,
  User,
  Package,
  FileText,
  Edit2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Printer,
  Layers,
  Circle,
  AlertCircle,
  TrendingUp,
  Clock,
  Receipt,
  BarChart3,
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useCurrentRate, useProducts } from '../store/selectors';
import { getSellerName } from '../utils/permissions';
import ErrorBoundary from '../components/ErrorBoundary';
import { ToastContainer } from '../components/Toast';
import { useToastNotifications } from '../hooks/useToastNotifications';
import { invalidateAllSalesCache } from '../hooks/useOfflineFirst';
import { useSmartProducts, useWebSocketStatus, isUserCurrentlyTyping, saveUIState, restoreUIState } from '../hooks/useSmartSync';
import axios from 'axios';
import { normalizeUnit, normalizeMark, getQtyPolicy, validateAndCorrectQty } from '../../core/qty-rules.js';
import { format, isToday, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

// ✅ SAFE_POLICY: Fallback garantie pour les quantités
const SAFE_POLICY = {
  integerOnly: false,
  allowDecimal: true,
  step: 1,
  minQty: 0,
};

// ✅ Helper: obtenir une policy "safe" (jamais undefined)
function getSafePolicy(unitLevel, unitMark) {
  const unitNorm = normalizeUnit(unitLevel);
  const markNorm = normalizeMark(unitMark || '');
  return getQtyPolicy(unitNorm, markNorm) || SAFE_POLICY;
}

// Debounce hook pour performance - flush immédiat si valeur vide
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    if (!value) {
      setDebouncedValue(''); // ✅ flush immédiat si vide
      return;
    }
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const SalesPOS = () => {
  // ✅ Sélecteurs atomiques: évite re-render POS à chaque changement du store
  const storeProducts = useProducts();
  const currentRate = useCurrentRate();
  const loadProducts = useStore((s) => s.loadProducts);
  const loadCurrentRate = useStore((s) => s.loadCurrentRate);
  
  // ✅ AUTO-ACTUALISATION INTELLIGENTE DES PRODUITS (toutes les 2 secondes)
  const { 
    data: smartProducts, 
    isConnected: wsConnected,
    lastUpdate: productsLastUpdate,
    refresh: refreshProducts, // ✅ Pour rafraîchir après Auto-Stock
  } = useSmartProducts({ enabled: true });
  
  // Utiliser les produits du smart sync si disponibles
  const products = smartProducts && smartProducts.length > 0 ? smartProducts : storeProducts;
  
  // État de connexion WebSocket pour l'indicateur
  const { isConnected, reconnecting } = useWebSocketStatus();

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [selectedProductUnits, setSelectedProductUnits] = useState([]);
  // ✅ activeSaleIndex est maintenant géré dans le CACHE PANIER PRO plus bas
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [quickQty, setQuickQty] = useState(0); // Commencer à 0 pour permettre saisie manuelle
  const [quickQtyRaw, setQuickQtyRaw] = useState(''); // Valeur brute pour permettre saisie libre
  const [quickPrice, setQuickPrice] = useState(null);
  const [uiError, setUiError] = useState(null); // ✅ État d'erreur UI (remplace alert)
  
  // ✅ AUTO-STOCK PRÉVENTIF: État pour la prévisualisation
  const [autoStockPreview, setAutoStockPreview] = useState(null);
  const [autoStockLoading, setAutoStockLoading] = useState(false);
  const autoStockAbortRef = useRef(null);
  const { toasts, closeToast, error: showError, success: showSuccess, info: showInfo } = useToastNotifications();
  
  // ✅ CACHE PANIER PRO: Clé unique pour le cache
  const CART_CACHE_KEY = 'lagrace-pos-cart-pro';
  const CART_INDEX_KEY = 'lagrace-pos-active-index';
  
  // ✅ CACHE PANIER PRO: Validation robuste des données de vente
  const validateSaleData = useCallback((sale) => {
    if (!sale || typeof sale !== 'object') return false;
    if (!Array.isArray(sale.items)) return false;
    if (typeof sale.clientName !== 'string') return false;
    if (typeof sale.currency !== 'string') return false;
    return true;
  }, []);
  
  // ✅ CACHE PANIER PRO: Créer une vente vide valide
  const createEmptySale = useCallback(() => ({
    id: Date.now(),
    clientName: '',
    clientPhone: '',
    clientAddress: '',
    clientEmail: '',
    isNewClient: false,
    items: [],
    currency: 'FC',
    isDebt: false,
    paidAmountUsd: 0,
    createdAt: new Date().toISOString(),
  }), []);
  
  // ✅ CACHE PANIER PRO: Flag pour savoir si le panier a été restauré
  const [cartRestored, setCartRestored] = useState(false);
  const [restoredItemsCount, setRestoredItemsCount] = useState(0);
  
  // ✅ CACHE PANIER PRO: Charger les ventes depuis localStorage au démarrage
  const [sales, setSales] = useState(() => {
    try {
      const cached = localStorage.getItem(CART_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        // Valider la structure complète
        if (data && Array.isArray(data.sales) && data.sales.length > 0) {
          // Valider chaque vente
          const validSales = data.sales.filter(sale => {
            if (!sale || typeof sale !== 'object') return false;
            if (!Array.isArray(sale.items)) return false;
            return true;
          }).map(sale => ({
            ...sale,
            // S'assurer que tous les champs existent
            id: sale.id || Date.now(),
            clientName: sale.clientName || '',
            clientPhone: sale.clientPhone || '',
            clientAddress: sale.clientAddress || '',
            clientEmail: sale.clientEmail || '',
            isNewClient: sale.isNewClient || false,
            items: sale.items || [],
            currency: sale.currency || 'FC',
            isDebt: sale.isDebt || false,
            paidAmountUsd: sale.paidAmountUsd || 0,
          }));
          
          if (validSales.length > 0) {
            // Compter le total des items restaurés
            const totalItems = validSales.reduce((sum, sale) => sum + sale.items.length, 0);
            console.log('✅ [CACHE PRO] Panier restauré:', validSales.length, 'client(s),', totalItems, 'produit(s)');
            return validSales;
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ [CACHE PRO] Erreur lecture cache panier:', e);
      // En cas d'erreur, supprimer le cache corrompu
      try { localStorage.removeItem(CART_CACHE_KEY); } catch {}
    }
    // Valeur par défaut si pas de cache valide
    return [createEmptySale()];
  });
  
  // ✅ CACHE PANIER PRO: Charger l'index de la vente active
  const [activeSaleIndex, setActiveSaleIndex] = useState(() => {
    try {
      const cached = localStorage.getItem(CART_INDEX_KEY);
      if (cached) {
        const index = parseInt(cached, 10);
        if (!isNaN(index) && index >= 0) {
          return index;
        }
      }
    } catch {}
    return 0;
  });
  
  // ✅ CACHE PANIER PRO: Notification de restauration au premier rendu
  useEffect(() => {
    const totalItems = sales.reduce((sum, sale) => sum + sale.items.length, 0);
    const hasContent = totalItems > 0 || sales.some(s => s.clientName.trim());
    
    if (hasContent && !cartRestored) {
      setCartRestored(true);
      setRestoredItemsCount(totalItems);
      // Afficher une notification de restauration
      setTimeout(() => {
        if (totalItems > 0) {
          showInfo(`🛒 Panier restauré: ${sales.length} client(s), ${totalItems} produit(s)`);
        }
      }, 500);
    }
  }, []); // Seulement au premier rendu
  
  // ✅ CACHE PANIER PRO: Sauvegarder automatiquement avec métadonnées
  useEffect(() => {
    try {
      const cacheData = {
        version: 2,
        savedAt: new Date().toISOString(),
        sales: sales,
      };
      localStorage.setItem(CART_CACHE_KEY, JSON.stringify(cacheData));
      localStorage.setItem(CART_INDEX_KEY, String(activeSaleIndex));
    } catch (e) {
      console.warn('⚠️ [CACHE PRO] Erreur sauvegarde cache panier:', e);
    }
  }, [sales, activeSaleIndex]);
  
  // ✅ CACHE PANIER PRO: Sauvegarder avant fermeture de la page
  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        const cacheData = {
          version: 2,
          savedAt: new Date().toISOString(),
          sales: sales,
        };
        localStorage.setItem(CART_CACHE_KEY, JSON.stringify(cacheData));
        localStorage.setItem(CART_INDEX_KEY, String(activeSaleIndex));
      } catch {}
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [sales, activeSaleIndex]);
  const [processing, setProcessing] = useState(false);
  const searchInputRef = useRef(null);
  const qtyInputRef = useRef(null);
  const clientNameInputRef = useRef(null);
  
  // ✅ FOCUS LOCK SYSTEM: Empêche le vol de focus pendant la saisie
  const isUserTypingRef = useRef(false);
  const lastActiveInputRef = useRef(null);
  const initialLoadDoneRef = useRef(false);
  
  // ✅ SILENT RELOAD FLAG: Empêche la restauration de focus lors des rechargements silencieux
  const isSilentReloadRef = useRef(false);
  
  // ✅ Helper: afficher une erreur UI (via Toast au lieu d'alert)
  const raiseError = useCallback((msg) => {
    showError(msg);
  }, [showError]);
  
  // Mémoire des noms de clients
  const [clientNamesHistory, setClientNamesHistory] = useState(() => {
    const stored = localStorage.getItem('lagrace-client-names');
    return stored ? JSON.parse(stored) : [];
  });
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [isCartExpanded, setIsCartExpanded] = useState(false);
  const [hoveredItemIndex, setHoveredItemIndex] = useState(null);
  const [focusedField, setFocusedField] = useState(null);
  const [hoveredButton, setHoveredButton] = useState(null);
  
  // ✅ MODE DETTE: Clients chargés depuis "Compte Utilisateur" (table users)
  const [debtClients, setDebtClients] = useState([]);
  const [debtClientsLoaded, setDebtClientsLoaded] = useState(false);
  
  // ✅ VENTES RÉCENTES: Statistiques de la session et historique
  const [recentSales, setRecentSales] = useState([]);
  const [sessionStats, setSessionStats] = useState({
    totalSalesCount: 0,
    totalFC: 0,
    totalUSD: 0,
    lastSaleTime: null,
  });
  const [deletingSale, setDeletingSale] = useState(null); // Invoice number en cours de suppression
  
  // ✅ PAGE READY: État pour l'animation d'entrée professionnelle
  const [isPageReady, setIsPageReady] = useState(false);

  // ✅ Refs: éviter re-attach des listeners globaux et closures stale
  const processingRef = useRef(false);
  const activeSaleIndexRef = useRef(0);
  const activeSaleHasItemsRef = useRef(false);
  const finalizeSaleRef = useRef(null);

  // Obtenir la vente active (doit être défini avant les useEffect qui l'utilisent)
  const activeSale = sales[activeSaleIndex];

  useEffect(() => {
    processingRef.current = !!processing;
  }, [processing]);

  useEffect(() => {
    activeSaleIndexRef.current = activeSaleIndex;
  }, [activeSaleIndex]);

  useEffect(() => {
    activeSaleHasItemsRef.current = (activeSale?.items?.length || 0) > 0;
  }, [activeSale?.items?.length]);
  
  // ✅ MODE DETTE: Charger les clients de "Compte Utilisateur" au démarrage
  useEffect(() => {
    const loadClientsFromCompteUtilisateur = async () => {
      try {
        console.log('🔄 Chargement des clients depuis Compte Utilisateur...');
        const response = await axios.get(`${API_URL}/api/sales/clients/search?q=`);
        
        let clients = [];
        if (response.data?.results) {
          clients = response.data.results;
        } else if (Array.isArray(response.data)) {
          clients = response.data;
        }
        
        console.log(`✅ ${clients.length} clients chargés depuis Compte Utilisateur:`, 
          clients.map(c => c.name || c.username).join(', '));
        
        setDebtClients(clients);
        setDebtClientsLoaded(true);
      } catch (error) {
        console.error('❌ Erreur chargement clients Compte Utilisateur:', error);
        setDebtClientsLoaded(true); // Marquer comme chargé même en erreur
      }
    };
    
    loadClientsFromCompteUtilisateur();
  }, []); // Charger une seule fois au démarrage
  
  // ✅ VENTES RÉCENTES: Charger les ventes du jour UNIQUEMENT (aujourd'hui)
  const loadRecentSales = useCallback(async () => {
    try {
      const sellerName = getSellerName(useStore.getState().user);
      
      // ✅ Date du jour avec début et fin précis (minuit à minuit)
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      
      const todayStartISO = todayStart.toISOString();
      const todayEndISO = todayEnd.toISOString();
      const todayDateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      
      console.log(`📅 [Session] Chargement ventes du ${todayDateStr} pour ${sellerName}`);
      
      // Charger les ventes du jour de cet utilisateur
      const response = await axios.get(`${API_URL}/api/sales`, {
        params: {
          seller: sellerName,
          start_date: todayDateStr,
          end_date: todayDateStr,
          limit: 50, // Charger plus pour avoir toutes les ventes du jour
        },
        timeout: 3000, // Timeout court pour ne pas bloquer l'UI
      });
      
      let salesData = [];
      if (response.data?.sales) {
        salesData = response.data.sales;
      } else if (Array.isArray(response.data)) {
        salesData = response.data;
      }
      
      // ✅ FILTRE STRICT: Ne garder que les ventes d'AUJOURD'HUI (double vérification)
      const todaySalesOnly = salesData.filter(sale => {
        try {
          const saleDate = sale.sold_at || sale.created_at;
          if (!saleDate) return false;
          
          const saleDateObj = parseISO(saleDate);
          
          // Vérifier que c'est bien aujourd'hui
          return isToday(saleDateObj);
        } catch {
          return false;
        }
      });
      
      // Calculer les stats de la session (UNIQUEMENT aujourd'hui)
      const totalFC = todaySalesOnly.reduce((sum, s) => sum + (Number(s.total_fc) || 0), 0);
      const totalUSD = todaySalesOnly.reduce((sum, s) => sum + (Number(s.total_usd) || 0), 0);
      
      // Trier par date décroissante (plus récent en premier)
      const sortedSales = [...todaySalesOnly].sort((a, b) => {
        const dateA = new Date(a.sold_at || a.created_at || 0);
        const dateB = new Date(b.sold_at || b.created_at || 0);
        return dateB - dateA;
      });
      
      setRecentSales(sortedSales.slice(0, 5));
      setSessionStats({
        totalSalesCount: todaySalesOnly.length,
        totalFC,
        totalUSD,
        lastSaleTime: sortedSales[0]?.sold_at || sortedSales[0]?.created_at || null,
      });
      
      console.log(`📊 Stats session AUJOURD'HUI: ${todaySalesOnly.length} ventes, ${totalFC.toLocaleString()} FC, $${totalUSD.toFixed(2)}`);
    } catch (error) {
      console.warn('⚠️ Impossible de charger les ventes récentes:', error.message);
      // Essayer depuis le cache localStorage avec filtre strict
      try {
        const cached = localStorage.getItem('offline_cache_sales');
        if (cached) {
          const { data } = JSON.parse(cached);
          if (data && Array.isArray(data)) {
            const todaySalesOnly = data.filter(s => {
              try {
                const saleDate = s.sold_at || s.created_at;
                if (!saleDate) return false;
                return isToday(parseISO(saleDate));
              } catch {
                return false;
              }
            });
            
            const sortedSales = [...todaySalesOnly].sort((a, b) => {
              const dateA = new Date(a.sold_at || a.created_at || 0);
              const dateB = new Date(b.sold_at || b.created_at || 0);
              return dateB - dateA;
            });
            
            setRecentSales(sortedSales.slice(0, 5));
            
            const totalFC = todaySalesOnly.reduce((sum, s) => sum + (Number(s.total_fc) || 0), 0);
            const totalUSD = todaySalesOnly.reduce((sum, s) => sum + (Number(s.total_usd) || 0), 0);
            
            setSessionStats({
              totalSalesCount: todaySalesOnly.length,
              totalFC,
              totalUSD,
              lastSaleTime: sortedSales[0]?.sold_at || null,
            });
          }
        }
      } catch {}
    }
  }, []);
  
  // ✅ Supprimer une vente récente et restaurer le stock
  const handleDeleteRecentSale = useCallback(async (invoiceNumber, e) => {
    e?.stopPropagation();
    
    if (!invoiceNumber) return;
    
    const confirmMsg = `🗑️ Supprimer la facture ${invoiceNumber} ?\n\nCette action va :\n• Restaurer le stock de tous les articles\n• Synchroniser les modifications\n• Supprimer définitivement la facture\n\nContinuer ?`;
    
    if (!confirm(confirmMsg)) return;
    
    setDeletingSale(invoiceNumber);
    
    try {
      const encodedInvoice = encodeURIComponent(invoiceNumber);
      console.log(`🗑️ [SalesPOS] DELETE ${API_URL}/api/sales/${encodedInvoice}`);
      
      const response = await axios.delete(`${API_URL}/api/sales/${encodedInvoice}`, {
        timeout: 30000
      });
      
      console.log(`✅ [SalesPOS] Vente supprimée:`, response.data);
      
      // Retirer immédiatement de la liste des ventes récentes
      setRecentSales(prev => prev.filter(s => s.invoice_number !== invoiceNumber));
      
      // Mettre à jour les stats de session
      const deletedSale = recentSales.find(s => s.invoice_number === invoiceNumber);
      if (deletedSale) {
        setSessionStats(prev => ({
          ...prev,
          totalSalesCount: Math.max(0, prev.totalSalesCount - 1),
          totalFC: Math.max(0, prev.totalFC - (Number(deletedSale.total_fc) || 0)),
          totalUSD: Math.max(0, prev.totalUSD - (Number(deletedSale.total_usd) || 0)),
        }));
      }
      
      // Invalider le cache des ventes pour que SalesHistory se mette à jour
      try {
        invalidateAllSalesCache();
      } catch {}
      
      // Recharger les produits pour voir le stock restauré
      try {
        await useStore.getState().loadProducts();
      } catch {}
      
      showSuccess?.(`✅ Facture ${invoiceNumber} supprimée - stock restauré`);
    } catch (error) {
      console.error(`❌ [SalesPOS] Erreur suppression:`, error);
      showError?.(`❌ Erreur: ${error.response?.data?.error || error.message}`);
    } finally {
      setDeletingSale(null);
    }
  }, [recentSales, showSuccess, showError]);
  
  // Charger les ventes récentes au démarrage et après chaque vente
  useEffect(() => {
    loadRecentSales();
  }, [loadRecentSales]);

  // ✅ CHARGEMENT INITIAL UNIQUE: Ne se déclenche qu'une seule fois au montage
  useEffect(() => {
    // Éviter les rechargements multiples - seulement au premier montage
    if (initialLoadDoneRef.current) return;
    
    const shouldLoad = !products || products.length === 0;
    
    if (shouldLoad) {
      initialLoadDoneRef.current = true;
      // ✅ SILENT RELOAD: Marquer comme rechargement silencieux
      isSilentReloadRef.current = true;
      // Lancer les chargements en parallèle, mais sans await
      Promise.allSettled([
        loadProducts(),
        loadCurrentRate()
      ]).catch(() => {
        // Silencieux - les données seront mises à jour via le store
      }).finally(() => {
        // ✅ Réinitialiser le flag après un court délai pour laisser le re-render se terminer
        setTimeout(() => {
          isSilentReloadRef.current = false;
          setIsPageReady(true);
        }, 200);
      });
    } else {
      initialLoadDoneRef.current = true;
      // ✅ Page déjà prête si les produits sont déjà chargés
      setTimeout(() => setIsPageReady(true), 100);
    }
    // ✅ AUCUN AUTO-FOCUS - L'utilisateur garde le contrôle total
  }, [loadProducts, loadCurrentRate, products]);

  // ❌ AUTO-FOCUS SUPPRIMÉ: Ne plus forcer le focus sur quantité automatiquement
  // L'utilisateur peut cliquer manuellement sur le champ qty quand il veut
  // Cela évite les interruptions pendant la saisie dans d'autres champs

  // Charger automatiquement le prix selon la devise active quand produit/unite change
  useEffect(() => {
    if (selectedProduct && selectedUnit && activeSale) {
      // Charger le prix automatiquement selon la devise active
      if (quickPrice === null) {
        // Le prix sera affiché automatiquement dans l'input via la valeur par défaut
        // Pas besoin de setQuickPrice ici, on laisse null pour utiliser le prix par défaut
      }
    }
  }, [selectedProduct, selectedUnit, activeSale?.currency]);

  // Réinitialiser quantité à 0 quand on change d'unité (pour permettre saisie manuelle)
  useEffect(() => {
    if (selectedUnit) {
      setQuickQty(0);
      setQuickQtyRaw('');
      setAutoStockPreview(null); // Reset auto-stock preview
    }
  }, [selectedUnit?.unit_level, selectedUnit?.unit_mark]);

  // ✅ AUTO-STOCK PRÉVENTIF: Vérifier si une conversion est nécessaire quand qty change
  useEffect(() => {
    // Annuler la requête précédente
    if (autoStockAbortRef.current) {
      autoStockAbortRef.current.abort();
    }

    // Reset si pas de produit/unité sélectionné ou qty <= 0
    if (!selectedProduct || !selectedUnit || quickQty <= 0) {
      setAutoStockPreview(null);
      return;
    }

    // Vérifier si c'est une unité détail (MILLIER ou PIECE)
    const unitLevel = (selectedUnit.unit_level || '').toUpperCase().trim();
    if (unitLevel !== 'MILLIER' && unitLevel !== 'PIECE') {
      setAutoStockPreview(null);
      return;
    }

    const stockDispo = selectedUnit.stock_current || 0;

    // Si stock suffisant, pas besoin d'auto-stock
    if (stockDispo >= quickQty) {
      setAutoStockPreview(null);
      return;
    }

    // Appeler l'API de prévisualisation
    const controller = new AbortController();
    autoStockAbortRef.current = controller;
    
    setAutoStockLoading(true);
    
    const fetchPreview = async () => {
      try {
        const response = await axios.post(`${API_URL}/api/autostock/preview`, {
          productKey: selectedProduct.code || selectedProduct.uuid,
          unit_level: unitLevel,
          qty_requested: quickQty,
        }, {
          signal: controller.signal,
          timeout: 5000,
        });

        if (!controller.signal.aborted && response.data?.ok) {
          setAutoStockPreview(response.data);
        }
      } catch (err) {
        if (!controller.signal.aborted && err.name !== 'CanceledError') {
          console.warn('[AutoStock Preview] Erreur:', err.message);
          setAutoStockPreview(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setAutoStockLoading(false);
        }
      }
    };

    // Debounce de 300ms pour éviter trop de requêtes
    const timeoutId = setTimeout(fetchPreview, 300);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [selectedProduct?.code, selectedProduct?.uuid, selectedUnit?.unit_level, selectedUnit?.stock_current, quickQty]);

  // Réinitialiser les suggestions client quand on change de vente
  useEffect(() => {
    if (activeSale && activeSale.clientName) {
      setShowClientSuggestions(false);
    }
  }, [activeSaleIndex, activeSale]);

  // ✅ RACCOURCI CLAVIER: listener stable (pas de re-attach)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        const activeElement = document.activeElement;
        const tagName = activeElement?.tagName?.toLowerCase();
        const inputType = activeElement?.type?.toLowerCase();

        // Ne pas déclencher si on est dans un textarea ou un input text (sauf recherche)
        if (tagName === 'textarea') return;
        if (tagName === 'input' && inputType === 'text' && !activeElement.classList.contains('search-input')) return;

        if (activeSaleHasItemsRef.current && !processingRef.current) {
          e.preventDefault();
          finalizeSaleRef.current?.(activeSaleIndexRef.current);
        }
      }

      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ✅ FOCUS PROTECTION SYSTEM PRO v2: Protège contre les re-renders SANS bloquer les clics utilisateur
  // Stocke l'élément actif et le restaure UNIQUEMENT après les re-renders React (pas les clics manuels)
  useEffect(() => {
    // ✅ Tracker si l'utilisateur a cliqué sur un élément interactif
    let userClickedInteractive = false;
    let clickTimeout = null;
    
    // ✅ Détecter les clics sur éléments interactifs AVANT le focusout
    const handleMouseDown = (e) => {
      const target = e.target;
      const interactive = target.closest('button, a, [role="button"], [onclick], .clickable, [data-clickable], label, select, [tabindex]');
      const isProductCard = target.closest('[data-product-card], .product-card, .cursor-pointer');
      const isCartItem = target.closest('[data-cart-item], .cart-item');
      const isDropdown = target.closest('[data-dropdown], .dropdown, [role="listbox"], [role="option"]');
      
      if (interactive || isProductCard || isCartItem || isDropdown) {
        userClickedInteractive = true;
        // Reset après un court délai (pour laisser le clic se terminer)
        if (clickTimeout) clearTimeout(clickTimeout);
        clickTimeout = setTimeout(() => {
          userClickedInteractive = false;
        }, 300);
      }
    };
    
    const handleFocusIn = (e) => {
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        isUserTypingRef.current = true;
        lastActiveInputRef.current = target;
        // Stocker aussi le nom du champ pour restauration
        if (target === clientNameInputRef.current) {
          lastActiveInputRef.current._fieldType = 'client';
        } else if (target === qtyInputRef.current) {
          lastActiveInputRef.current._fieldType = 'qty';
        } else if (target === searchInputRef.current) {
          lastActiveInputRef.current._fieldType = 'search';
        }
      }
    };
    
    const handleFocusOut = (e) => {
      // ✅ CRITIQUE: Vérifier si c'est une perte de focus involontaire (causée par re-render)
      // ou un clic manuel de l'utilisateur (qu'on doit respecter)
      setTimeout(() => {
        // ✅ SILENT RELOAD: Ne pas restaurer le focus pendant un rechargement silencieux
        if (isSilentReloadRef.current) {
          isUserTypingRef.current = false;
          return;
        }
        
        // ✅ CLIC UTILISATEUR: Si l'utilisateur a cliqué sur un élément interactif, ne PAS restaurer le focus
        // Cela permet aux boutons, produits, panier, etc. de fonctionner normalement
        if (userClickedInteractive) {
          console.log('👆 [FOCUS] Clic utilisateur détecté - focus non restauré');
          isUserTypingRef.current = false;
          userClickedInteractive = false; // Reset
          return;
        }
        
        // ✅ Vérifier si le focus est allé vers un autre élément interactif (via relatedTarget)
        const relatedTarget = e.relatedTarget;
        if (relatedTarget) {
          const isInteractive = relatedTarget.closest('button, a, [role="button"], input, textarea, select, [tabindex]');
          if (isInteractive) {
            console.log('👆 [FOCUS] Focus déplacé vers élément interactif:', relatedTarget.tagName);
            isUserTypingRef.current = false;
            return;
          }
        }
        
        const activeEl = document.activeElement;
        // Si le focus est parti vers body ou un élément non-input, c'est probablement involontaire (re-render React)
        if (activeEl === document.body || (activeEl?.tagName !== 'INPUT' && activeEl?.tagName !== 'TEXTAREA')) {
          // ✅ RESTAURATION AUTOMATIQUE: Si on était en train de taper, restaurer le focus
          // Seulement pour les champs qty et client, PAS pour la recherche (évite le bug de focus intempestif)
          if (isUserTypingRef.current && lastActiveInputRef.current) {
            const fieldType = lastActiveInputRef.current._fieldType;
            let targetInput = null;
            
            // Trouver le bon input à restaurer (car les refs peuvent changer après re-render)
            // ✅ Ne restaure que qty et client, pas search (pour éviter le focus intempestif)
            if (fieldType === 'client' && clientNameInputRef.current) {
              targetInput = clientNameInputRef.current;
            } else if (fieldType === 'qty' && qtyInputRef.current) {
              targetInput = qtyInputRef.current;
            }
            // ❌ SEARCH EXCLU: Ne plus restaurer automatiquement le focus sur la recherche
            
            if (targetInput && document.contains(targetInput)) {
              console.log('🔄 [FOCUS-RESTORE] Restauration du focus sur:', fieldType);
              requestAnimationFrame(() => {
                targetInput.focus();
              });
              return; // Ne pas reset isUserTypingRef
            }
          }
          isUserTypingRef.current = false;
        }
      }, 50);
    };
    
    // ✅ IMPORTANT: mousedown AVANT focusout pour détecter les clics
    document.addEventListener('mousedown', handleMouseDown, true); // Capture phase
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      if (clickTimeout) clearTimeout(clickTimeout);
    };
  }, []);

  // ✅ PROTECTION ANTI-BLOCAGE: Nettoyer les overlays sans toucher au focus
  useEffect(() => {
    if (!products || products.length === 0) return;
    
    // Nettoyer les overlays bloquants (silencieusement, sans toucher au focus)
    requestAnimationFrame(() => {
      const overlays = document.querySelectorAll('[class*="fixed"][class*="inset-0"]');
      overlays.forEach(overlay => {
        const style = window.getComputedStyle(overlay);
        if (style.opacity === '0' || style.visibility === 'hidden') {
          overlay.style.pointerEvents = 'none';
        }
      });
    });
  }, [products]);

  // Réinitialiser la sélection quand on change de produit ou recherche
  useEffect(() => {
    if (searchQuery.trim()) {
      setSelectedProduct(null);
      setSelectedUnit(null);
      setQuickPrice(null);
      setQuickQty(0);
      setQuickQtyRaw('');
    }
  }, [searchQuery]);

  // ✅ ESCAPE KEY: Fermer les suggestions de clients
  useEffect(() => {
    const handleEscapeKey = (e) => {
      if (e.key === 'Escape' && showClientSuggestions) {
        console.log('🎯 [ESCAPE] Closed client suggestions');
        setShowClientSuggestions(false);
      }
    };
    
    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, [showClientSuggestions]);

  // Transformer les produits pour regrouper par code avec toutes les unités
  const productsWithUnits = useMemo(() => {
    const grouped = {};
    products.forEach(product => {
      const code = product.code;
      if (!grouped[code]) {
        grouped[code] = {
          id: product.id,
          code: product.code,
          name: product.name,
          is_active: product.is_active,
          units: []
        };
      }
      if (product.units && Array.isArray(product.units)) {
        product.units.forEach(unit => {
          grouped[code].units.push({
            id: unit.id,
            unit_level: unit.unit_level,
            unit_mark: unit.unit_mark || '',
            stock_current: unit.stock_current || 0,
            sale_price_fc: unit.sale_price_fc || 0,
            sale_price_usd: unit.sale_price_usd || 0,
            qty_step: unit.qty_step || 1
          });
        });
      }
    });
    return Object.values(grouped);
  }, [products]);

  // Fonction pour normaliser le nom (enlever "Piece", "piece", "Pièce" ou "pièce" à la fin)
  const normalizeProductName = useCallback((name) => {
    if (!name) return '';
    const normalized = name.trim();
    // Enlever "Piece", "piece", "Pièce" ou "pièce" à la fin (insensible à la casse)
    return normalized.replace(/\s*(?:Piece|piece|Pièce|pièce)\s*$/i, '').trim();
  }, []);

  // Fonction pour obtenir l'icône et la couleur selon l'unité - Couleurs professionnelles améliorées
  const getUnitIconAndColor = useCallback((unitLevel) => {
    const normalized = normalizeUnit(unitLevel);
    // Gérer aussi DETAIL comme MILLIERS
    if (normalized === 'carton' || unitLevel === 'CARTON') {
      return {
        icon: Package,
        bgGradient: 'bg-gradient-to-br from-blue-500/20 via-blue-500/15 to-blue-600/25',
        borderColor: 'border-blue-500/40',
        textColor: 'text-blue-200',
        hoverBg: 'hover:bg-blue-500/25',
        iconColor: 'text-blue-400',
        shadowColor: 'rgba(59, 130, 246, 0.2)'
      };
    }
    if (normalized === 'milliers' || unitLevel === 'MILLIER' || unitLevel === 'DETAIL') {
      return {
        icon: Layers,
        bgGradient: 'bg-gradient-to-br from-purple-500/20 via-purple-500/15 to-purple-600/25',
        borderColor: 'border-purple-500/40',
        textColor: 'text-purple-200',
        hoverBg: 'hover:bg-purple-500/25',
        iconColor: 'text-purple-400',
        shadowColor: 'rgba(168, 85, 247, 0.2)'
      };
    }
    if (normalized === 'piece' || unitLevel === 'PIECE') {
      return {
        icon: Circle,
        bgGradient: 'bg-gradient-to-br from-emerald-500/20 via-emerald-500/15 to-emerald-600/25',
        borderColor: 'border-emerald-500/40',
        textColor: 'text-emerald-200',
        hoverBg: 'hover:bg-emerald-500/25',
        iconColor: 'text-emerald-400',
        shadowColor: 'rgba(16, 185, 129, 0.2)'
      };
    }
    return {
      icon: Package,
      bgGradient: 'bg-gradient-to-br from-gray-500/20 via-gray-500/15 to-gray-600/25',
      borderColor: 'border-gray-500/40',
      textColor: 'text-gray-300',
      hoverBg: 'hover:bg-gray-500/25',
      iconColor: 'text-gray-400',
      shadowColor: 'rgba(107, 114, 128, 0.2)'
    };
  }, []);

  // Filtrer et grouper les produits selon la recherche
  // ✅ SUPPRIMÉ setState() dans useMemo (interdit - cause freezes)
  const groupedFilteredProducts = useMemo(() => {
    if (!debouncedSearch.trim()) {
      return [];
    }
    
    const query = debouncedSearch.toLowerCase();
    const filtered = productsWithUnits.filter(product => {
      const normalizedName = normalizeProductName(product.name).toLowerCase();
      const originalName = product.name.toLowerCase();
      const code = product.code.toLowerCase();
      
      // Rechercher dans le nom normalisé, le nom original, ou le code
      return normalizedName.includes(query) || 
             originalName.includes(query) || 
             code.includes(query);
    });

    // Grouper par code et nom de base normalisé (ignorer "Piece"/"Pièce" dans le nom)
    const grouped = {};
    filtered.forEach(product => {
      const baseName = normalizeProductName(product.name);
      const key = `${product.code}_${baseName.toLowerCase()}`;
      
      if (!grouped[key]) {
        grouped[key] = {
          code: product.code,
          baseName: baseName,
          originalName: product.name, // Garder le nom original pour affichage
          productId: product.id,
          product: product, // Garder la référence complète au produit
          units: []
        };
      }
      
      // Ajouter toutes les unités de ce produit
      product.units.forEach(unit => {
        // Éviter les doublons d'unités
        const unitExists = grouped[key].units.some(u => 
          u.unit_level === unit.unit_level && 
          (u.unit_mark || '') === (unit.unit_mark || '')
        );
        
        if (!unitExists) {
          grouped[key].units.push({
            ...unit,
            productId: product.id,
            productName: product.name,
            originalProduct: product // Garder la référence au produit original
          });
        }
      });
    });

    // Trier les unités : Carton, puis Millier/Détail, puis Pièce
    Object.values(grouped).forEach(group => {
      group.units.sort((a, b) => {
        const orderA = a.unit_level === 'CARTON' ? 1 : 
                      (a.unit_level === 'MILLIER' || a.unit_level === 'DETAIL') ? 2 : 3;
        const orderB = b.unit_level === 'CARTON' ? 1 : 
                      (b.unit_level === 'MILLIER' || b.unit_level === 'DETAIL') ? 2 : 3;
        return orderA - orderB;
      });
    });

    return Object.values(grouped);
  }, [productsWithUnits, debouncedSearch, normalizeProductName]);

  // ✅ Reset selectedProductUnits dans useEffect (pas dans useMemo)
  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setSelectedProductUnits([]);
    }
  }, [debouncedSearch]);

  // Le panier ne s'ouvre plus automatiquement - l'utilisateur contrôle l'ouverture/fermeture

  // Vérifier si un produit existe déjà dans le panier (même code, unit_level, unit_mark)
  const isProductInCart = useCallback((product, unit) => {
    if (!product || !unit) return false;
    const sale = sales[activeSaleIndex];
    return sale.items.some(
      item => item.product_code === product.code &&
      item.unit_level === unit.unit_level &&
      item.unit_mark === (unit.unit_mark || '')
    );
  }, [sales, activeSaleIndex]);

  // Ajouter un item à la vente active (avec règles de quantité)
  const addItemToSale = useCallback((product, unit, qty, customPriceFC = null, customPriceUSD = null) => {
    // Appliquer les règles de quantité
    const policy = getSafePolicy(unit.unit_level, unit.unit_mark);
    const correctedQty = validateAndCorrectQty(qty, policy);
    
    // S'assurer que les prix sont toujours des nombres valides
    const priceFC = customPriceFC !== null && !isNaN(customPriceFC) 
      ? Number(customPriceFC) 
      : (unit.sale_price_fc && !isNaN(unit.sale_price_fc) ? Number(unit.sale_price_fc) : 0);
    const priceUSD = customPriceUSD !== null && !isNaN(customPriceUSD)
      ? Number(customPriceUSD)
      : (unit.sale_price_usd && !isNaN(unit.sale_price_usd) ? Number(unit.sale_price_usd) : 0);
    
    // ✅ IMMUTABLE: créer une nouvelle vente avec nouvel item
    setSales(prev => {
      const next = [...prev];
      const sale = next[activeSaleIndex];
      const items = [...(sale.items || [])];
    
      const existingItemIndex = items.findIndex(
        item => item.product_code === product.code &&
        item.unit_level === unit.unit_level &&
        item.unit_mark === (unit.unit_mark || '')
      );

      if (existingItemIndex >= 0) {
        // Mettre à jour la quantité si le produit existe déjà (avec règles)
        const newQty = items[existingItemIndex].qty + correctedQty;
        const finalQty = validateAndCorrectQty(newQty, policy);
        const unitPriceFC = items[existingItemIndex].unit_price_fc || priceFC;
        const unitPriceUSD = items[existingItemIndex].unit_price_usd || priceUSD;
        
        // ✅ IMMUTABLE: créer un nouvel objet item
        items[existingItemIndex] = {
          ...items[existingItemIndex],
          qty: finalQty,
          unit_price_fc: unitPriceFC,
          unit_price_usd: unitPriceUSD,
          subtotal_fc: unitPriceFC * finalQty,
          subtotal_usd: unitPriceUSD * finalQty,
        };
      } else {
        // Ajouter un nouvel item
        items.push({
          product_id: product.id,
          product_code: product.code,
          product_name: product.name,
          unit_level: unit.unit_level,
          unit_mark: unit.unit_mark || '',
          qty: correctedQty,
          qty_label: correctedQty.toString(),
          unit_price_fc: priceFC,
          unit_price_usd: priceUSD,
          subtotal_fc: priceFC * correctedQty,
          subtotal_usd: priceUSD * correctedQty,
          qty_step: unit.qty_step || 1,
        });
      }

      next[activeSaleIndex] = { ...sale, items };
      return next;
    });

    setSearchQuery('');
    setSelectedProductUnits([]);
    // Réinitialiser la sélection du produit après ajout
    setSelectedProduct(null);
    setSelectedUnit(null);
    setQuickPrice(null);
    setQuickQty(0);
    setQuickQtyRaw('');
    // ❌ AUTO-FOCUS SUPPRIMÉ: Ne plus forcer le focus après ajout
    // L'utilisateur garde le contrôle de où il veut taper
  }, [activeSaleIndex]);

  // ✅ Retirer un item de la vente (IMMUTABLE)
  const removeItemFromSale = useCallback((itemIndex) => {
    setSales(prev => {
      const sale = prev[activeSaleIndex];
      const items = sale.items.filter((_, idx) => idx !== itemIndex);
      const next = [...prev];
      next[activeSaleIndex] = { ...sale, items };
      return next;
    });
  }, [activeSaleIndex]);

  // Mettre à jour la quantité d'un item (avec règles strictes)
  // ✅ updateItemQty (IMMUTABLE + policy safe)
  const updateItemQty = useCallback((itemIndex, newQty) => {
    setSales(prev => {
      const sale = prev[activeSaleIndex];
      const items = [...(sale.items || [])];
      const item = items[itemIndex];
      if (!item) return prev;
      
      let normalizedQty = newQty;
      if (typeof normalizedQty === 'string') {
        normalizedQty = parseFloat(normalizedQty.replace(/,/g, '.')) || 0;
      }
      normalizedQty = Math.round(Number(normalizedQty) * 100) / 100;
      
      const policy = getSafePolicy(item.unit_level, item.unit_mark);
      const correctedQty = validateAndCorrectQty(normalizedQty, policy);
      
      const unitPriceFC = Number(item.unit_price_fc) || 0;
      const unitPriceUSD = Number(item.unit_price_usd) || 0;
      
      items[itemIndex] = {
        ...item,
        qty: correctedQty,
        subtotal_fc: unitPriceFC * correctedQty,
        subtotal_usd: unitPriceUSD * correctedQty,
      };
      
      const next = [...prev];
      next[activeSaleIndex] = { ...sale, items };
      return next;
    });
  }, [activeSaleIndex]);

  // ✅ updateItemPrice (IMMUTABLE + guard currentRate)
  const updateItemPrice = useCallback((itemIndex, newPrice, currency) => {
    const rate = Number(currentRate) || 0;
    
    setSales(prev => {
      const sale = prev[activeSaleIndex];
      const items = [...(sale.items || [])];
      const item = items[itemIndex];
      if (!item) return prev;
      
      const p = Number(newPrice);
      const safePrice = Number.isFinite(p) ? p : 0;
      
      let unitFC = item.unit_price_fc || 0;
      let unitUSD = item.unit_price_usd || 0;
      
      if (currency === 'FC') {
        unitFC = safePrice;
        unitUSD = rate > 0 ? safePrice / rate : 0;
      } else {
        unitUSD = safePrice;
        unitFC = rate > 0 ? safePrice * rate : 0;
      }
      
      const qty = Number(item.qty) || 0;
      
      items[itemIndex] = {
        ...item,
        unit_price_fc: unitFC,
        unit_price_usd: unitUSD,
        subtotal_fc: unitFC * qty,
        subtotal_usd: unitUSD * qty,
      };
      
      const next = [...prev];
      next[activeSaleIndex] = { ...sale, items };
      return next;
    });
  }, [activeSaleIndex, currentRate]);

  // Calculer les totaux de la vente active
  // ✅ Dépendre de sales et activeSaleIndex pour garantir le recalcul
  const activeSaleTotals = useMemo(() => {
    const sale = sales[activeSaleIndex];
    if (!sale?.items?.length) {
      return { fc: 0, usd: 0 };
    }
    
    const fc = sale.items.reduce((sum, it) => sum + (Number(it.subtotal_fc) || 0), 0);
    const usd = sale.items.reduce((sum, it) => sum + (Number(it.subtotal_usd) || 0), 0);
    
    return { fc, usd };
  }, [sales, activeSaleIndex]);

  // Ajouter une nouvelle vente
  const addNewSale = useCallback(() => {
    setSales([...sales, {
      id: Date.now(),
      clientName: '',
      clientPhone: '',
      clientAddress: '',
      clientEmail: '',
      isNewClient: false, // Nouvelle vente vide, pas de formulaire client détaillé
      items: [],
      currency: 'FC',
      isDebt: false,
      paidAmountUsd: 0, // Montant payé partiellement (mode dette)
    }]);
    setActiveSaleIndex(sales.length);
  }, [sales]);

  // Sauvegarder un nom de client dans l'historique
  const saveClientName = useCallback((name) => {
    if (!name || name.trim() === '') return;
    const trimmedName = name.trim();
    const updated = [trimmedName, ...clientNamesHistory.filter(n => n !== trimmedName)].slice(0, 20);
    setClientNamesHistory(updated);
    localStorage.setItem('lagrace-client-names', JSON.stringify(updated));
  }, [clientNamesHistory]);

  // Finaliser une vente
  const finalizeSale = async (saleIndex) => {
    // PROTECTION: Empêcher les doubles clics
    if (processing) {
      console.warn('⚠️ [SalesPOS] Tentative de finalisation alors qu\'une vente est déjà en cours');
      return;
    }

    const sale = sales[saleIndex];
    if (sale.items.length === 0) {
      raiseError('Le panier est vide');
      return;
    }

    // Vérifier le nom du client (obligatoire)
    if (!sale.clientName || sale.clientName.trim() === '') {
      raiseError('Le nom du client est obligatoire');
      setShowClientSuggestions(true);
      setFocusedField('client');
      requestAnimationFrame(() => {
        clientNameInputRef.current?.focus();
        clientNameInputRef.current?.select();
      });
      return;
    }

    // ✅ MODE DETTE: Validation du montant payé
    if (sale.isDebt) {
      const paidAmount = parseFloat(sale.paidAmountUsd) || 0;
      const totalUsd = activeSaleTotals?.usd || 0;
      
      // Le montant payé ne peut pas dépasser le total
      if (paidAmount > totalUsd) {
        raiseError(`Le montant payé (${paidAmount.toFixed(2)} USD) ne peut pas dépasser le total (${totalUsd.toFixed(2)} USD)`);
        return;
      }
      
      // Si le montant payé = total, suggérer de passer en mode payant
      if (paidAmount >= totalUsd && paidAmount > 0) {
        raiseError('Le client paie le total → utilisez le mode "Payant" au lieu de "Dette"');
        return;
      }
    }

    // Sauvegarder le nom dans l'historique
    saveClientName(sale.clientName);

    setProcessing(true);
    
    // LOG: Démarrer la finalisation
    console.log('🚀 [SalesPOS] ==========================================');
    console.log('🚀 [SalesPOS] DÉBUT FINALISATION DE VENTE');
    console.log('🚀 [SalesPOS] ==========================================');
    console.log(`📦 [SalesPOS] Nombre d'items: ${sale.items.length}`);
    console.log(`👤 [SalesPOS] Client: ${sale.clientName}`);
    console.log(`💰 [SalesPOS] Total FC: ${activeSaleTotals.fc}, Total USD: ${activeSaleTotals.usd}`);
    
    // LOG: Détails des items AVANT envoi
    console.log('📋 [SalesPOS] Détails des items AVANT envoi:');
    sale.items.forEach((item, idx) => {
      console.log(`   [${idx + 1}] ${item.product_code} (${item.product_name})`);
      console.log(`       - Unité: ${item.unit_level}, Mark: ${item.unit_mark || '(vide)'}`);
      console.log(`       - Quantité: ${item.qty} (type: ${typeof item.qty})`);
      console.log(`       - Prix FC: ${item.unit_price_fc}, Prix USD: ${item.unit_price_usd}`);
      console.log(`       - Sous-total FC: ${item.subtotal_fc}, Sous-total USD: ${item.subtotal_usd}`);
    });
    
    try {
      // Le backend génère automatiquement le numéro de facture au format YYYYMMDDHHmmss
      // ✅ MODE DETTE: Le backend gère la création de dette si isDebt=true
      const saleData = {
        // invoice_number sera généré côté backend si non fourni
        sold_at: new Date().toISOString(),
        client_name: sale.clientName || null,
        client_phone: sale.clientPhone || null,
        client_address: sale.clientAddress || null,
        client_email: sale.clientEmail || null,
        seller_name: getSellerName(useStore.getState().user),
        total_fc: activeSaleTotals.fc,
        total_usd: activeSaleTotals.usd,
        rate_fc_per_usd: currentRate,
        payment_mode: sale.isDebt ? 'dette' : 'cash',
        // ✅ MODE DETTE: Envoyer isDebt et paid_amount_usd pour que le backend crée une dette
        isDebt: sale.isDebt,
        paid_amount_usd: sale.isDebt ? (parseFloat(sale.paidAmountUsd) || 0) : activeSaleTotals.usd,
        // paid_fc/paid_usd calculés par le backend en mode dette
        paid_fc: sale.isDebt ? ((parseFloat(sale.paidAmountUsd) || 0) * currentRate) : activeSaleTotals.fc,
        paid_usd: sale.isDebt ? (parseFloat(sale.paidAmountUsd) || 0) : activeSaleTotals.usd,
        status: sale.isDebt ? (sale.paidAmountUsd > 0 ? 'partial' : 'unpaid') : 'paid',
        items: sale.items.map(item => ({
          ...item,
          // Normaliser les unités et marks pour le backend
          unit_level: item.unit_level, // Déjà normalisé côté UI
          unit_mark: item.unit_mark || '',
        })),
        printCurrency: sale.isDebt ? 'USD' : sale.currency, // ✅ Forcer USD pour dettes
        autoDette: sale.isDebt,
      };

      console.log('📤 [SalesPOS] Envoi de la requête POST à /api/sales');
      console.log('📤 [SalesPOS] Données envoyées:', JSON.stringify(saleData, null, 2));
      
      const response = await axios.post(`${API_URL}/api/sales`, saleData);
      
      console.log('✅ [SalesPOS] Réponse reçue du serveur');
      console.log('✅ [SalesPOS] Success:', response.data.success);
      console.log('✅ [SalesPOS] Invoice Number:', response.data.sale?.invoice_number);

      if (response.data.success) {
        const invoiceNumber = response.data.sale?.invoice_number;
        
        console.log('✅ [SalesPOS] ==========================================');
        console.log('✅ [SalesPOS] VENTE FINALISÉE AVEC SUCCÈS');
        console.log('✅ [SalesPOS] ==========================================');
        console.log(`📄 [SalesPOS] Numéro de facture: ${invoiceNumber}`);
        console.log(`📦 [SalesPOS] Items vendus: ${sale.items.length}`);
        
        // LOG: Détails des items APRÈS création
        if (response.data.sale?.items) {
          console.log('📋 [SalesPOS] Détails des items APRÈS création:');
          response.data.sale.items.forEach((item, idx) => {
            console.log(`   [${idx + 1}] ${item.product_code} (${item.product_name})`);
            console.log(`       - Unité: ${item.unit_level}, Mark: ${item.unit_mark || '(vide)'}`);
            console.log(`       - Quantité: ${item.qty}`);
          });
        }
        
        // L'impression est gérée automatiquement par le backend via print_job
        // Plus besoin d'appel séparé

        // ✅ MODE DETTE: La dette est maintenant créée automatiquement par le backend
        // via le flag isDebt=true dans le payload de POST /api/sales
        if (response.data.isDebt) {
          console.log('💳 [SalesPOS] Dette créée par le backend:');
          console.log(`   ID: ${response.data.debt?.id}`);
          console.log(`   Total: ${response.data.debt?.total_usd} USD`);
          console.log(`   Payé: ${response.data.debt?.paid_usd} USD`);
          console.log(`   Reste: ${response.data.debt?.remaining_usd} USD`);
          console.log(`   Statut: ${response.data.debt?.status}`);
        }

        // Réinitialiser la vente
        console.log('🔄 [SalesPOS] Réinitialisation du panier...');
        const newSales = [...sales];
        newSales[saleIndex] = {
          id: Date.now(),
          clientName: '',
          clientPhone: '',
          clientAddress: '',
          clientEmail: '',
          isNewClient: false,
          items: [],
          currency: 'FC',
          isDebt: false,
          paidAmountUsd: 0,
        };
        setSales(newSales);
        if (saleIndex === activeSaleIndex) {
          setSearchQuery('');
          // ❌ AUTO-FOCUS SUPPRIMÉ: Ne plus forcer le focus après finalisation
        }
        console.log('✅ [SalesPOS] Panier réinitialisé');
        
        // CRITIQUE: Recharger les produits pour afficher le nouveau stock
        console.log('🔄 [SalesPOS] Rechargement des produits pour mettre à jour le stock...');
        try {
          // ✅ SILENT RELOAD: Marquer comme rechargement silencieux (ne pas voler le focus)
          isSilentReloadRef.current = true;
          await loadProducts();
          console.log('✅ [SalesPOS] Produits rechargés avec succès (stock mis à jour)');
        } catch (error) {
          console.error('❌ [SalesPOS] Erreur lors du rechargement des produits:', error);
          // Ne pas bloquer l'utilisateur si le rechargement échoue
        } finally {
          // ✅ Réinitialiser le flag après un court délai
          setTimeout(() => {
            isSilentReloadRef.current = false;
          }, 200);
        }
        
        // ✅ CRUCIAL: Invalider le cache SalesHistory pour afficher la nouvelle vente immédiatement
        console.log('🔄 [SalesPOS] Invalidation du cache SalesHistory...');
        try {
          invalidateAllSalesCache();
          console.log('✅ [SalesPOS] Cache SalesHistory invalidé - la nouvelle vente apparaîtra immédiatement');
        } catch (error) {
          console.warn('⚠️ [SalesPOS] Erreur lors de l\'invalidation du cache:', error);
          // Ne pas bloquer l'utilisateur si l'invalidation échoue
        }
        
        // ✅ RAFRAÎCHIR les statistiques de la session
        console.log('🔄 [SalesPOS] Rafraîchissement des statistiques session...');
        loadRecentSales();
        
        console.log('✅ [SalesPOS] ==========================================');
      } else {
        console.error('❌ [SalesPOS] La vente n\'a pas été créée (success: false)');
        console.error('❌ [SalesPOS] Réponse:', response.data);
      }
    } catch (error) {
      console.error('❌ [SalesPOS] ==========================================');
      console.error('❌ [SalesPOS] ERREUR LORS DE LA FINALISATION');
      console.error('❌ [SalesPOS] ==========================================');
      console.error('❌ [SalesPOS] Erreur:', error);
      if (error.response) {
        console.error('❌ [SalesPOS] Status:', error.response.status);
        console.error('❌ [SalesPOS] Data:', error.response.data);
      }
      raiseError('Erreur lors de la finalisation de la vente');
    } finally {
      setProcessing(false);
      console.log('🏁 [SalesPOS] Finalisation terminée, processing = false');
    }
  };

  // ✅ Toujours exposer la dernière version à l'écouteur clavier stable
  useEffect(() => {
    finalizeSaleRef.current = finalizeSale;
  }, [finalizeSale]);

  // Obtenir le label de l'unité
  const getUnitLabel = (unitLevel) => {
    const labels = {
      'CARTON': 'Carton',
      'MILLIER': 'Millier',
      'PIECE': 'Pièce',
      'DETAIL': 'Détail'
    };
    return labels[unitLevel] || unitLevel;
  };

  // Vérification de sécurité
  if (!activeSale) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <m.div 
      className="space-y-4 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header avec animation d'entrée */}
      <m.div 
        className="flex items-center justify-between flex-wrap gap-4"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-1">Point de Vente</h1>
          <p className="text-gray-400 flex items-center gap-2">
            <span>Ventes rapides et professionnelles</span>
            {/* ✅ Indicateur de synchronisation temps réel */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              isConnected 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                : reconnecting 
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 animate-pulse' 
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}>
              {isConnected ? (
                <>
                  <Wifi className="w-3 h-3" />
                  <span>Live</span>
                </>
              ) : reconnecting ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>...</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" />
                  <span>Offline</span>
                </>
              )}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <m.div 
            className="glass px-4 py-2 rounded-lg"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.3 }}
          >
            <span className="text-sm text-gray-400">Taux: </span>
            <span className="font-semibold text-primary-400">{currentRate || 2800} FC/USD</span>
          </m.div>
        </div>
      </m.div>

      {/* ✅ OPTIMISATION: Écran de chargement professionnel */}
      <AnimatePresence mode="wait">
        {(!products || products.length === 0) && (
          <m.div 
            key="loading-skeleton"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}
            className="card p-8 bg-gradient-to-br from-gray-800/50 via-gray-700/30 to-gray-800/50 border border-gray-600/50 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center justify-center space-y-6">
              {/* Logo animé */}
              <m.div
                className="relative"
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              >
                <div className="w-16 h-16 border-4 border-primary-500/30 rounded-full"></div>
                <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-primary-500 rounded-full"></div>
              </m.div>
              
              {/* Texte de chargement */}
              <div className="text-center">
                <m.h3 
                  className="text-lg font-semibold text-gray-200 mb-2"
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  Préparation du Point de Vente
                </m.h3>
                <p className="text-sm text-gray-400">Chargement des produits et configurations...</p>
              </div>
              
              {/* Skeleton cards */}
              <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                {[1, 2, 3, 4].map(i => (
                  <m.div 
                    key={i} 
                    className="h-24 bg-gray-700/50 rounded-lg border border-gray-600/30"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: [0.3, 0.6, 0.3], scale: 1 }}
                    transition={{ 
                      duration: 1.5, 
                      repeat: Infinity, 
                      delay: i * 0.15,
                      ease: "easeInOut"
                    }}
                  />
                ))}
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* ✅ Message d'erreur UI (remplace alert) */}
      <AnimatePresence>
        {uiError && (
          <m.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="card p-3 border-2 border-red-500/40 bg-red-500/10 text-red-200 text-sm shadow-lg"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p>{uiError}</p>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      <div className="space-y-4">
        {/* ✅ INDICATEUR DE SAUVEGARDE AUTOMATIQUE */}
        {sales.some(s => s.items.length > 0) && (
          <m.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-end gap-2 text-xs text-gray-400"
          >
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20">
              <m.div 
                className="w-2 h-2 rounded-full bg-green-500"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <span className="text-green-400">Panier sauvegardé automatiquement</span>
            </div>
          </m.div>
        )}
        
        {/* Onglets des clients - En haut de la page (compact) */}
        <div className="card p-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {/* Bouton Nouveau client - Compact */}
            <m.button
              whileHover={{ scale: 1.05, y: -1 }}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
              style={{ 
                willChange: 'transform',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'translateZ(0)'
              }}
              onClick={addNewSale}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 glass text-gray-300 hover:bg-white/10 border border-white/10 relative z-10"
            >
              <User className="w-3 h-3" />
              <Plus className="w-2.5 h-2.5" />
              Nouveau client
            </m.button>

            {/* Onglets des clients */}
            {sales.map((sale, index) => {
              // Calculer le total FC pour ce client
              const clientTotal = sale.items.reduce((sum, item) => sum + (item.subtotal_fc || 0), 0);
              // Nom du client ou "Client X" si vide
              const clientDisplayName = sale.clientName && sale.clientName.trim() 
                ? (sale.clientName.length > 20 ? sale.clientName.substring(0, 20) + '...' : sale.clientName)
                : `Client ${index + 1}`;
              
              return (
                <m.div
                  key={sale.id}
                  role="button"
                  tabIndex={0}
                  whileHover={{ scale: 1.08, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                  style={{ 
                    willChange: 'transform',
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'translateZ(0)',
                    zIndex: index === activeSaleIndex ? 20 : 10
                  }}
                  onClick={() => setActiveSaleIndex(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveSaleIndex(index);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 relative cursor-pointer ${
                    index === activeSaleIndex
                      ? 'bg-primary-500 text-white shadow-lg border-2 border-cyan-400'
                      : 'glass text-gray-300 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  <span className="font-semibold text-xs">{clientDisplayName}</span>
                  <span className={`text-[10px] ${index === activeSaleIndex ? 'opacity-90' : 'opacity-70'}`}>
                    {clientTotal.toLocaleString()} FC
                  </span>
                  {sale.items.length > 0 && (
                    <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                      index === activeSaleIndex
                        ? 'bg-white/30'
                        : 'bg-white/20'
                    }`}>
                      {sale.items.length}
                    </span>
                  )}
                  {index !== activeSaleIndex && sales.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sales.length > 1) {
                          const newSales = sales.filter((_, i) => i !== index);
                          setSales(newSales);
                          if (activeSaleIndex >= newSales.length) {
                            setActiveSaleIndex(newSales.length - 1);
                          } else if (activeSaleIndex > index) {
                            setActiveSaleIndex(activeSaleIndex - 1);
                          }
                        }
                      }}
                      className="ml-1 p-0.5 rounded hover:bg-red-500/30 transition-colors relative z-20"
                      title="Fermer ce client"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </m.div>
              );
            })}
          </div>
        </div>

        {/* Nom client à gauche, Recherche + Produit dans même modal à droite */}
        <div className="grid grid-cols-1 md:grid-cols-[60%_40%] gap-4 items-stretch">
          {/* Colonne gauche: Nom du client + DEVISE + PANIER (60% de la largeur) */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Nom du client - VERSION SIMPLIFIÉE */}
            <div className="card p-2.5 flex-shrink-0 relative z-50" style={{ pointerEvents: 'auto' }}>
              <label className="block text-xs font-medium text-gray-300 mb-2">
                {activeSale.isDebt ? '👤 Nom du client (obligatoire) :' : 'Nom du client :'}
              </label>
              <div className="relative" style={{ pointerEvents: 'auto' }}>
                <input
                  ref={clientNameInputRef}
                  type="text"
                  value={activeSale.clientName || ''}
                  onChange={(e) => {
                    console.log('👤 [CLIENT-INPUT] onChange:', { value: e.target.value, isDebt: activeSale.isDebt });
                    const newSales = [...sales];
                    newSales[activeSaleIndex].clientName = e.target.value;
                    setSales(newSales);
                    setShowClientSuggestions(true);
                  }}
                  onFocus={() => {
                    console.log('🎯 [CLIENT-INPUT] onFocus');
                    setFocusedField('client');
                    setShowClientSuggestions(true);
                  }}
                  onBlur={() => {
                    console.log('📌 [CLIENT-INPUT] onBlur');
                    setFocusedField(null);
                    setTimeout(() => setShowClientSuggestions(false), 200);
                  }}
                  onClick={(e) => {
                    console.log('✋ [CLIENT-INPUT] onClick detected');
                  }}
                  placeholder={activeSale.isDebt ? "Tapez le nom du client..." : "Nom du client"}
                  className={`input-field w-full text-sm py-2 ${
                    activeSale.isDebt ? 'border-orange-500/50' : ''
                  }`}
                  style={{ pointerEvents: 'auto' }}
                />
                
                {/* ✅ LISTE DES CLIENTS - Affiche les noms de "Compte Utilisateur" en mode dette */}
                {showClientSuggestions && (() => {
                  // 🔥 MODE DETTE: Utiliser les clients de la base (Compte Utilisateur)
                  // MODE PAYANT: Utiliser l'historique local
                  const sourceList = activeSale.isDebt 
                    ? debtClients.map(c => ({ 
                        name: c.name || c.username, 
                        phone: c.phone,
                        role: c.role,
                        id: c.id 
                      }))
                    : clientNamesHistory.map(n => ({ name: n, phone: null, id: null }));
                  
                  // Filtrer selon la saisie (ou montrer tous si vide)
                  const searchTerm = (activeSale.clientName || '').toLowerCase().trim();
                  const filtered = sourceList.filter(item => {
                    if (!item.name) return false;
                    if (!searchTerm) return true; // Montrer tous si pas de recherche
                    return item.name.toLowerCase().includes(searchTerm);
                  }).slice(0, 10); // Max 10 résultats
                  
                  // En mode dette: afficher "Chargement" uniquement tant que la requête initiale n'a pas fini
                  if (activeSale.isDebt && !debtClientsLoaded) {
                    return (
                      <div className="absolute z-[300] w-full mt-1 rounded-lg border shadow-xl bg-orange-900/95 border-orange-500/50 p-3">
                        <div className="text-orange-200 text-xs text-center">
                          ⏳ Chargement des clients...
                        </div>
                      </div>
                    );
                  }

                  // Si chargé mais vide (aucun client ou erreur), éviter l'impression de "recherche infinie"
                  if (activeSale.isDebt && debtClientsLoaded && debtClients.length === 0) {
                    return (
                      <div className="absolute z-[300] w-full mt-1 rounded-lg border shadow-xl bg-orange-900/95 border-orange-500/50 p-3">
                        <div className="text-orange-200 text-xs text-center">
                          Aucun client disponible (vérifiez Compte Utilisateur)
                        </div>
                      </div>
                    );
                  }
                  
                  if (filtered.length === 0) {
                    if (activeSale.isDebt && searchTerm) {
                      return (
                        <div className="absolute z-[300] w-full mt-1 rounded-lg border shadow-xl bg-orange-900/95 border-orange-500/50 p-3">
                          <div className="text-orange-200 text-xs text-center">
                            Aucun client trouvé pour "{searchTerm}"
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }
                  
                  return (
                    <div 
                      className={`absolute z-[300] w-full mt-1 rounded-lg border shadow-xl max-h-56 overflow-y-auto ${
                        activeSale.isDebt 
                          ? 'bg-orange-900/95 border-orange-500/50' 
                          : 'bg-green-900/95 border-green-500/50'
                      }`}
                      style={{ pointerEvents: 'auto' }}
                    >
                      {activeSale.isDebt && (
                        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-orange-300/70 border-b border-orange-500/30 bg-orange-800/30">
                          👤 Clients depuis Compte Utilisateur ({debtClients.length})
                        </div>
                      )}
                      {filtered.map((item, idx) => (
                        <button
                          key={item.id || idx}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const newSales = [...sales];
                            newSales[activeSaleIndex].clientName = item.name;
                            if (item.phone) newSales[activeSaleIndex].clientPhone = item.phone;
                            if (item.id) newSales[activeSaleIndex].clientId = item.id;
                            setSales(newSales);
                            setShowClientSuggestions(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-white/20 flex items-center gap-2 transition-colors ${
                            activeSale.isDebt ? 'text-orange-100' : 'text-green-100'
                          }`}
                        >
                          <User className="w-4 h-4 opacity-70" />
                          <span className="flex-1 font-medium truncate">{item.name}</span>
                          {item.phone && <span className="text-xs opacity-50">{item.phone}</span>}
                          {item.role && activeSale.isDebt && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-600/30 text-orange-200">
                              {item.role}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* DEVISE - Horizontal, prend toute la largeur */}
            <div className="card flex-shrink-0 p-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-semibold text-gray-300 mb-2 whitespace-nowrap">
                    Mode de paiement :
                  </label>
                  <div className="flex gap-2">
                    <m.button
                      whileHover={{ scale: 1.05, y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                      style={{ 
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'translateZ(0)',
                        pointerEvents: 'auto',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        console.log('💵 [MODE-PAYANT] Clicked');
                        const newSales = [...sales];
                        newSales[activeSaleIndex].isDebt = false;
                        setSales(newSales);
                        console.log('💵 [MODE-PAYANT] Set to payant mode');
                      }}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all relative z-10 whitespace-nowrap ${
                        !activeSale.isDebt
                          ? 'bg-green-500/30 border-2 border-green-500/50 text-green-300 shadow-lg'
                          : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      💵 Payant
                    </m.button>
                    <m.button
                      whileHover={{ scale: 1.05, y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                      style={{ 
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'translateZ(0)',
                        pointerEvents: 'auto',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        console.log('📋 [MODE-DETTE] Clicked');
                        const newSales = [...sales];
                        newSales[activeSaleIndex].isDebt = true;
                        // ✅ MODE DETTE: Forcer la devise USD automatiquement
                        newSales[activeSaleIndex].currency = 'USD';
                        newSales[activeSaleIndex].paidAmountUsd = 0;
                        setSales(newSales);
                        console.log('📋 [MODE-DETTE] Set to debt mode, currency forced to USD');
                        // ✅ Focus sur le champ client
                        setTimeout(() => {
                          clientNameInputRef.current?.focus();
                          console.log('📋 [MODE-DETTE] Focused on client input');
                        }, 100);
                      }}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all relative z-10 whitespace-nowrap ${
                        activeSale.isDebt
                          ? 'bg-orange-500/30 border-2 border-orange-500/50 text-orange-300 shadow-lg'
                          : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      📋 Dette
                    </m.button>
                  </div>
                </div>
                <div className="flex-shrink-0 min-w-0">
                  <label className="block text-xs font-semibold text-gray-300 mb-2 whitespace-nowrap">
                    Devise :
                  </label>
                  <div className="flex gap-2">
                    <m.button
                      whileHover={{ scale: 1.1, y: -1 }}
                      whileTap={{ scale: 0.95 }}
                      transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                      style={{ 
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'translateZ(0)',
                        pointerEvents: 'auto',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        console.log('🏦 [CURRENCY-FC] Clicked, isDebt:', activeSale.isDebt);
                        // ✅ Ne pas permettre FC si mode dette actif
                        if (activeSale.isDebt) {
                          console.log('🏦 [CURRENCY-FC] Blocked - debt mode active');
                          return;
                        }
                        const newSales = [...sales];
                        newSales[activeSaleIndex].currency = 'FC';
                        console.log('🏦 [CURRENCY-FC] Changed to FC');
                        setSales(newSales);
                      }}
                      className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all relative z-10 whitespace-nowrap ${
                        activeSale.currency === 'FC'
                          ? 'bg-blue-500/30 border-2 border-blue-500/50 text-blue-300 shadow-lg'
                          : activeSale.isDebt 
                            ? 'glass border-2 border-white/5 text-gray-500 cursor-not-allowed opacity-50'
                            : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                      disabled={activeSale.isDebt}
                    >
                      FC
                    </m.button>
                    <m.button
                      whileHover={{ scale: 1.1, y: -1 }}
                      whileTap={{ scale: 0.95 }}
                      transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                      style={{ 
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'translateZ(0)',
                        pointerEvents: 'auto',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        console.log('💵 [CURRENCY-USD] Clicked');
                        const newSales = [...sales];
                        newSales[activeSaleIndex].currency = 'USD';
                        console.log('💵 [CURRENCY-USD] Changed to USD');
                        setSales(newSales);
                      }}
                      className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all relative z-10 whitespace-nowrap ${
                        activeSale.currency === 'USD'
                          ? 'bg-green-500/30 border-2 border-green-500/50 text-green-300 shadow-lg'
                          : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      USD
                    </m.button>
                  </div>
                </div>
              </div>
              
              {/* ✅ MODE DETTE: Champ de paiement partiel */}
              {activeSale.isDebt && (
                <m.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30"
                >
                  <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-orange-300 mb-1">
                        💵 Montant payé maintenant (USD) :
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={activeSale.paidAmountUsd || ''}
                          onChange={(e) => {
                            const newSales = [...sales];
                            newSales[activeSaleIndex].paidAmountUsd = e.target.value;
                            setSales(newSales);
                          }}
                          placeholder="0.00"
                          className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-orange-500/30 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
                        />
                        <span className="text-orange-300 font-semibold">USD</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">Reste à payer :</div>
                      <div className="text-lg font-bold text-orange-300">
                        {Math.max(0, (activeSaleTotals?.usd || 0) - (parseFloat(activeSale.paidAmountUsd) || 0)).toFixed(2)} USD
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    ⚠️ <strong>Mode dette :</strong> Seul le montant payé sera comptabilisé dans les statistiques du jour. 
                    {(parseFloat(activeSale.paidAmountUsd) || 0) > 0 
                      ? <span className="text-green-400"> +{parseFloat(activeSale.paidAmountUsd).toFixed(2)} USD encaissé aujourd'hui</span>
                      : <span className="text-orange-400"> Aucun montant encaissé (0 USD)</span>
                    }
                  </div>
                </m.div>
              )}
            </div>

            {/* PANIER - Horizontal, prend toute la largeur, flex-1 pour prendre l'espace restant */}
            <div className="card flex flex-col flex-1 min-h-0 overflow-hidden">
              <m.button
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.99 }}
                transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ 
                  willChange: 'transform',
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'translateZ(0)',
                  zIndex: 10,
                  pointerEvents: 'auto',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  console.log('🛒 [CART-TOGGLE] Clicked, isExpanded:', isCartExpanded);
                  setIsCartExpanded(!isCartExpanded);
                }}
                className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 glass rounded-lg border-2 border-primary-500/30 hover:border-primary-500/50 transition-all w-full group shadow-md flex-shrink-0"
              >
                <div className="relative flex-shrink-0">
                  <ShoppingCart className="w-5 h-5 sm:w-6 sm:h-6 text-primary-400" />
                  {activeSale.items.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] sm:text-xs font-bold rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center">
                      {activeSale.items.length}
                    </span>
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-1 sm:gap-2">
                    <h3 className="text-sm sm:text-lg font-semibold text-gray-100 truncate">
                      Panier {activeSale && activeSale.items && activeSale.items.length > 0 ? `(${activeSale.items.length})` : ''}
                    </h3>
                    {isCartExpanded ? (
                      <ChevronUp className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 group-hover:text-primary-400 transition-colors flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 group-hover:text-primary-400 transition-colors flex-shrink-0" />
                    )}
                  </div>
                  {activeSale && activeSale.items && activeSale.items.length > 0 && (
                    <div className="mt-0.5 sm:mt-1">
                      <span className="text-[10px] sm:text-xs text-gray-400 truncate block">
                        Total: {activeSale.currency === 'USD' 
                          ? `$${(Number(activeSaleTotals.usd) || 0).toFixed(2)}` 
                          : `${(Number(activeSaleTotals.fc) || 0).toLocaleString()} FC`}
                      </span>
                    </div>
                  )}
                </div>
              </m.button>

              {/* Contenu du panier (collapsible) */}
              <AnimatePresence>
                {isCartExpanded && (
                  <m.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                    className="overflow-hidden flex-1 min-h-0 flex flex-col"
                    style={{ maxHeight: 'calc(100vh - 500px)' }}
                  >
                    <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/10 flex-1 flex flex-col min-h-0">
                      {activeSale.items.length === 0 ? (
                        <div className="text-center py-6 sm:py-8 text-gray-400 flex-1 flex items-center justify-center">
                          <div>
                            <ShoppingCart className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-2 opacity-50" />
                            <p className="text-xs sm:text-sm">Panier vide</p>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* En-tête du tableau */}
                          <div className="grid grid-cols-12 gap-1 sm:gap-2 mb-2 sm:mb-3 pb-2 border-b border-white/10 text-[10px] sm:text-xs font-semibold text-gray-400 flex-shrink-0">
                            <div className="col-span-4 min-w-0">
                              <span className="truncate block">Produit</span>
                            </div>
                            <div className="col-span-2 text-center">Qté</div>
                            <div className="col-span-2 text-right">Prix</div>
                            <div className="col-span-3 text-right min-w-0">
                              <span className="truncate block">Total</span>
                            </div>
                            <div className="col-span-1 text-center">X</div>
                          </div>
                          
                          {/* Items compacts avec scroll */}
                          <div className="flex-1 overflow-y-auto pr-1 min-h-0">
                            {(activeSale.items || []).map((item, itemIndex) => (
                              <CartItem
                                key={itemIndex}
                                item={item}
                                itemIndex={itemIndex}
                                currency={activeSale.currency}
                                onRemove={removeItemFromSale}
                                onUpdateQty={updateItemQty}
                                onUpdatePrice={updateItemPrice}
                                getUnitLabel={getUnitLabel}
                                isHovered={hoveredItemIndex === itemIndex}
                                onHover={() => setHoveredItemIndex(itemIndex)}
                                onLeave={() => setHoveredItemIndex(null)}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </m.div>
                )}
              </AnimatePresence>

              {/* Bouton Finaliser */}
              {activeSale && activeSale.items && activeSale.items.length > 0 && (
                <m.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 pt-3 border-t border-primary-500/30 flex-shrink-0"
                >
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 mb-1">Net à payer</p>
                      <p className="text-lg sm:text-xl font-bold text-primary-400 truncate">
                        {activeSale.currency === 'USD'
                          ? `$${(Number(activeSaleTotals.usd) || 0).toFixed(2)}`
                          : `${(Number(activeSaleTotals.fc) || 0).toLocaleString()} FC`}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {activeSale.currency === 'USD'
                          ? `≈ ${(Number(activeSaleTotals.fc) || 0).toLocaleString()} FC`
                          : `≈ $${(Number(activeSaleTotals.usd) || 0).toFixed(2)} USD`}
                      </p>
                    </div>
                    <m.button
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => finalizeSale(activeSaleIndex)}
                      disabled={processing || activeSale.items.length === 0}
                      className="px-4 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-primary-500 to-primary-600 text-white text-sm sm:text-base font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                      <Printer className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span className="hidden sm:inline">Finaliser et imprimer</span>
                      <span className="sm:hidden">Finaliser</span>
                    </m.button>
                  </div>
                </m.div>
              )}
            </div>
          </div>

          {/* Colonne droite: Recherche + Sélection du Produit (40% de la largeur) */}
          <div className="flex flex-col min-w-0 max-w-full">
            {/* Recherche + Sélection du Produit - Grande section horizontale avec hauteur auto */}
            <div className="card flex flex-col flex-1 w-full overflow-hidden" style={{
              minHeight: '500px',
              maxHeight: 'calc(100vh - 200px)',
              height: '100%'
            }}>
              {/* Recherche - En haut */}
              <m.div 
                className="mb-3 pb-3 border-b border-white/10 flex-shrink-0 relative z-50"
                animate={{
                  scale: focusedField === 'search' ? 1 : focusedField ? 0.95 : 1,
                  opacity: focusedField === 'search' ? 1 : focusedField ? 0.7 : 1
                }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
              >
                <label className="block text-xs font-medium text-gray-300 mb-2">
                  Rechercher :
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
                  <input
                    id="salespos-search-input"
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                    }}
                    onFocus={() => {
                      setFocusedField('search');
                    }}
                    onBlur={(e) => {
                      // ✅ AMÉLIORÉ: Ne pas fermer si on clique sur un produit dans le dropdown
                      const relatedTarget = e.relatedTarget;
                      if (relatedTarget && (relatedTarget.closest('.search-dropdown') || relatedTarget.closest('[data-product-btn]'))) {
                        return;
                      }
                      // ✅ Délai plus long pour permettre le clic sur les boutons
                      setTimeout(() => {
                        setFocusedField(null);
                      }, 300);
                    }}
                    placeholder="Code ou Nom..."
                    className="input-field pl-9 w-full text-sm py-2 pr-2 relative z-20"
                    style={{ pointerEvents: 'auto' }}
                  />
                  
                  {/* Résultats de recherche directement sous le champ */}
                  {/* ✅ FIXED: AnimatePresence avec mode="wait" et pointer-events gérés proprement */}
                  <AnimatePresence mode="wait">
                    {searchQuery.trim().length > 0 && debouncedSearch.trim() && groupedFilteredProducts.length > 0 && (
                      <m.div
                        initial={{ opacity: 0, y: -5, scale: 0.98, pointerEvents: 'none' }}
                        animate={{ opacity: 1, y: 0, scale: 1, pointerEvents: 'auto' }}
                        exit={{ opacity: 0, y: -5, scale: 0.98, pointerEvents: 'none' }}
                        transition={{ 
                          duration: 0.12, 
                          ease: [0.25, 0.1, 0.25, 1],
                          // Exit rapide pour libérer les clics
                          exit: { duration: 0.08 }
                        }}
                        className="absolute z-[100] w-full mt-1.5 bg-gradient-to-br from-dark-800/98 via-dark-700/98 to-dark-800/98 backdrop-blur-lg rounded-xl border-2 border-primary-500/40 shadow-2xl overflow-hidden"
                        style={{
                          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(59, 130, 246, 0.3)',
                          top: '100%',
                          left: 0,
                          maxHeight: '400px',
                          overflowY: 'auto',
                          willChange: 'opacity, transform'
                        }}
                      >
                        <div className="hide-scrollbar max-h-[400px] overflow-y-auto">
                          <div className="p-1 space-y-1.5">
                            {groupedFilteredProducts.slice(0, 8).map((group, groupIdx) => {
                              if (!group.product) return null;
                              
                              return (
                                <m.div 
                                  key={`${group.code}_${group.baseName}`} 
                                  className="w-full mb-2"
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ 
                                    duration: 0.3, 
                                    delay: groupIdx * 0.1,
                                    ease: [0.25, 0.1, 0.25, 1]
                                  }}
                                >
                                  {/* Toutes les unités sur une ligne horizontale - Largeur auto-adaptative selon le nombre d'unités */}
                                  <div className="flex gap-1.5 w-full">
                                    {group.units.map((unit, unitIdx) => {
                                      const unitLabel = getUnitLabel(unit.unit_level);
                                      const priceFC = unit.sale_price_fc || 0;
                                      const priceUSD = currentRate > 0 ? priceFC / currentRate : 0;
                                      const displayPrice = activeSale.currency === 'FC' ? priceFC : priceUSD;
                                      const priceSymbol = activeSale.currency === 'FC' ? 'FC' : '$';
                                      const { icon: UnitIcon, bgGradient, borderColor, textColor, hoverBg, iconColor, shadowColor } = getUnitIconAndColor(unit.unit_level);
                                      
                                      // Format du label avec mark si présent
                                      const fullLabel = unit.unit_mark 
                                        ? `${unitLabel} [${unit.unit_mark}]`
                                        : unitLabel;
                                      
                                      // Format du prix selon le type d'unité
                                      const priceLabel = (unit.unit_level === 'MILLIER' || unit.unit_level === 'DETAIL') 
                                        ? `PU pack: ${displayPrice.toLocaleString()} ${priceSymbol}`
                                        : `PU: ${displayPrice.toLocaleString()} ${priceSymbol}`;
                                      
                                      // ✅ Handler de sélection de produit optimisé
                                      const handleSelectProduct = () => {
                                        if (unit.originalProduct) {
                                          const unitToSelect = unit.originalProduct.units.find(u => 
                                            u.unit_level === unit.unit_level && 
                                            (u.unit_mark || '') === (unit.unit_mark || '')
                                          );
                                          if (unitToSelect) {
                                            setSelectedProduct(unit.originalProduct);
                                            setSelectedUnit(unitToSelect);
                                            setQuickPrice(null);
                                            setQuickQty(unitToSelect.qty_step || 1);
                                            setSearchQuery('');
                                            setFocusedField(null);
                                          }
                                        }
                                      };
                                      
                                      return (
                                        <m.button
                                          key={`${group.code}-${unit.unit_level}-${unit.unit_mark || ''}-${unitIdx}`}
                                          data-product-btn="true"
                                          tabIndex={0}
                                          initial={{ opacity: 0, y: 5, scale: 0.95 }}
                                          animate={{ opacity: 1, y: 0, scale: 1 }}
                                          transition={{ 
                                            duration: 0.2, 
                                            delay: unitIdx * 0.05,
                                            ease: [0.25, 0.1, 0.25, 1]
                                          }}
                                          whileHover={{ 
                                            scale: 1.02, 
                                            y: -2,
                                            transition: { duration: 0.15 }
                                          }}
                                          whileTap={{ scale: 0.98 }}
                                          onMouseDown={(e) => {
                                            // ✅ CRITIQUE: Sélectionner le produit au mouseDown (avant blur)
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleSelectProduct();
                                          }}
                                          onClick={(e) => {
                                            // ✅ Fallback: si mouseDown n'a pas fonctionné
                                            e.preventDefault();
                                            e.stopPropagation();
                                          }}
                                          className={`flex-1 text-left px-2.5 py-2 text-[10px] font-medium transition-all duration-200 rounded-lg border ${borderColor} ${hoverBg} ${bgGradient} backdrop-blur-sm relative overflow-hidden group cursor-pointer select-none`}
                                          style={{
                                            boxShadow: `0 2px 8px ${shadowColor}, 0 0 0 0px ${shadowColor}`
                                          }}
                                        >
                                          {/* Effet de brillance au survol */}
                                          <m.div
                                            className="absolute inset-0 opacity-0 group-hover:opacity-10"
                                            style={{
                                              background: `linear-gradient(135deg, ${shadowColor} 0%, transparent 100%)`
                                            }}
                                            transition={{ duration: 0.3 }}
                                          />
                                          
                                          {/* Badge avec nom du produit en haut - Taille améliorée et plus claire */}
                                          <m.div 
                                            className={`absolute top-0 left-0 right-0 px-2 py-1 ${bgGradient} border-b ${borderColor} text-xs font-bold ${textColor} truncate`}
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ delay: unitIdx * 0.05 + 0.1 }}
                                          >
                                            <span className="drop-shadow-sm">{group.baseName}</span>
                                          </m.div>
                                          
                                          {/* Contenu principal avec padding-top pour le badge */}
                                          <div className="pt-4 flex items-start gap-1.5">
                                            {/* Icône avec couleur et animation */}
                                            <m.div 
                                              className={`p-1.5 rounded-md ${bgGradient} border ${borderColor} flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform duration-200`}
                                              whileHover={{ rotate: [0, -5, 5, 0] }}
                                              transition={{ duration: 0.3 }}
                                            >
                                              <UnitIcon className={`w-3.5 h-3.5 ${iconColor}`} />
                                            </m.div>
                                            
                                            {/* Contenu principal */}
                                            <div className="flex-1 min-w-0">
                                              <m.div 
                                                className={`text-[10px] font-bold ${textColor} mb-0.5 truncate`}
                                                initial={{ opacity: 0, x: -5 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: unitIdx * 0.05 + 0.15 }}
                                              >
                                                {fullLabel}
                                              </m.div>
                                              
                                              {/* Format : "— Stock: X • PU: Y FC" */}
                                              <m.div 
                                                className="text-[9px] text-gray-300 leading-tight"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ delay: unitIdx * 0.05 + 0.2 }}
                                              >
                                                <span className="text-gray-400">—</span> Stock: <span className="font-semibold text-gray-200">{unit.stock_current.toLocaleString()}</span>
                                                <span className="text-gray-500 mx-0.5">•</span>
                                                <span className={`font-semibold ${textColor}`}>{priceLabel}</span>
                                              </m.div>
                                            </div>
                                          </div>
                                        </m.button>
                                      );
                                    })}
                                  </div>
                                </m.div>
                              );
                            })}
                          </div>
                        </div>
                      </m.div>
                    )}
                    
                    {/* Message "Aucun résultat" */}
                    {/* ✅ FIXED: pointer-events gérés proprement pour ne pas bloquer les clics */}
                    {searchQuery.trim().length > 0 && debouncedSearch.trim() && groupedFilteredProducts.length === 0 && (
                      <m.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{ duration: 0.1, exit: { duration: 0.05 } }}
                        className="absolute z-[100] w-full mt-1.5 bg-dark-800/95 backdrop-blur-lg rounded-xl border-2 border-gray-600/40 shadow-xl p-4"
                        style={{
                          top: '100%',
                          left: 0,
                          pointerEvents: 'auto',
                          willChange: 'opacity, transform'
                        }}
                      >
                        <div className="text-center text-gray-400 text-sm">
                          <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
                          <p>Aucun produit trouvé</p>
                        </div>
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>
              </m.div>

              {/* Sélection du Produit - Juste en dessous de Recherche */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex items-center gap-3 mb-3 flex-shrink-0">
                  <label className="block text-xs font-semibold text-gray-300 flex-shrink-0 whitespace-nowrap">
                    Sélection du Produit :
                  </label>
                  <div className="flex-1 min-w-0">
                    <select
                      value={selectedProduct?.code || ''}
                      onChange={(e) => {
                        const product = productsWithUnits.find(p => p.code === e.target.value);
                        setSelectedProduct(product || null);
                        if (product && product.units.length > 0) {
                          const firstUnit = product.units[0];
                          setSelectedUnit(firstUnit);
                          setQuickPrice(null);
                          setQuickQty(0);
                          setQuickQtyRaw('');
                        } else {
                          setSelectedUnit(null);
                          setQuickQty(0);
                          setQuickQtyRaw('');
                        }
                      }}
                      className="input-field w-full text-xs py-2 pr-2"
                    >
                      <option value="">-- Rechercher et sélectionner --</option>
                      {productsWithUnits.map((product) => (
                        <option key={product.code} value={product.code}>
                          {product.name} ({product.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div 
                  className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 hide-scrollbar" 
                  style={{ 
                    maxHeight: 'calc(100vh - 400px)',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch'
                  }}
                >
                  {selectedProduct && selectedUnit ? (
                    <div className="p-3 glass rounded-lg border-2 border-primary-500/30 bg-gradient-to-br from-primary-500/5 to-transparent w-full"
                    >
              {/* Header compact : Nom + Code + Stock sur une ligne */}
              <div className="mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-gray-100 truncate">
                      {selectedProduct.name} <span className="text-xs text-gray-500 font-normal">({selectedProduct.code})</span>
                    </h3>
                  </div>
                  <div className={`text-xs font-bold flex-shrink-0 px-2 py-0.5 rounded ${
                    selectedUnit.stock_current <= 0 ? 'bg-red-500/20 text-red-400' :
                    selectedUnit.stock_current < 10 ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    Stock: {selectedUnit.stock_current}
                  </div>
                </div>
              </div>

              <div className="space-y-2 w-full">
                {/* Unité de vente - inline avec label */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-gray-300 flex-shrink-0">Unité:</label>
                  <select
                    value={`${selectedUnit.unit_level}-${selectedUnit.unit_mark}`}
                    onChange={(e) => {
                      const [level, mark] = e.target.value.split('-');
                      const unit = selectedProduct.units.find(u => 
                        u.unit_level === level && (u.unit_mark || '') === mark
                      );
                      if (unit) {
                        setSelectedUnit(unit);
                        setQuickPrice(null);
                        setQuickQty(0);
                        setQuickQtyRaw('');
                      }
                    }}
                    className="input-field flex-1 text-xs py-1.5"
                  >
                    {selectedProduct.units.map((unit, idx) => (
                      <option key={idx} value={`${unit.unit_level}-${unit.unit_mark || ''}`}>
                        {getUnitLabel(unit.unit_level)} {unit.unit_mark ? `[${unit.unit_mark}]` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quantité - ligne compacte */}
                {(() => {
                  const policy = selectedUnit ? getSafePolicy(selectedUnit.unit_level, selectedUnit.unit_mark) : null;
                  
                  return (
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-gray-300 flex-shrink-0">
                        Qty{policy && !policy.allowDecimal && <span className="text-gray-500 ml-0.5">(ent.)</span>}:
                      </label>
                      <div className="flex items-center gap-1 flex-1">
                        <button
                          onClick={() => {
                            if (!policy) return;
                            const newQty = Math.max(0, quickQty - policy.step);
                            setQuickQty(newQty);
                            setQuickQtyRaw(newQty === 0 ? '' : newQty.toString());
                          }}
                          className="p-2 glass rounded hover:bg-white/10 transition-colors"
                          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="text"
                          value={quickQtyRaw}
                          onChange={(e) => {
                            const rawVal = e.target.value;
                            setQuickQtyRaw(rawVal);
                            const normalizedVal = rawVal.replace(/,/g, '.');
                            if (rawVal === '' || rawVal === '0' || rawVal === '0.' || rawVal === '0,') {
                              setQuickQty(0);
                              return;
                            }
                            if (policy?.integerOnly) {
                              const intVal = parseInt(normalizedVal);
                              if (!isNaN(intVal)) {
                                setQuickQty(intVal);
                              } else if (normalizedVal === '' || normalizedVal === '-') {
                                setQuickQty(0);
                              }
                            } else {
                              const val = parseFloat(normalizedVal);
                              if (!isNaN(val)) {
                                const roundedVal = Math.round(val * 100) / 100;
                                setQuickQty(roundedVal);
                              } else if (normalizedVal === '' || normalizedVal === '-' || normalizedVal === '.' || normalizedVal === ',') {
                                setQuickQty(0);
                              }
                            }
                          }}
                          onBlur={() => {
                            if (quickQtyRaw === '' || quickQtyRaw === '0' || quickQtyRaw === '0.' || quickQtyRaw === '0,') {
                              setQuickQtyRaw('');
                              setQuickQty(0);
                            } else {
                              const normalized = quickQtyRaw.replace(/,/g, '.');
                              let parsed;
                              if (policy?.integerOnly) {
                                parsed = parseInt(normalized);
                              } else {
                                parsed = parseFloat(normalized);
                                if (!isNaN(parsed)) {
                                  parsed = Math.round(parsed * 100) / 100;
                                }
                              }
                              if (!isNaN(parsed)) {
                                setQuickQtyRaw(parsed.toString());
                                setQuickQty(parsed);
                              }
                            }
                          }}
                          onFocus={(e) => {
                            // ✅ Ne pas interférer avec le champ de recherche
                            setFocusedField('qty');
                            try {
                              e.target?.select();
                            } catch (err) {}
                          }}
                          placeholder="0"
                          className={`input-field text-sm flex-1 text-center font-semibold pointer-events-auto cursor-text ${
                            quickQty > (selectedUnit?.stock_current || 0) && quickQty > 0 ? 'border-yellow-500/50 bg-yellow-500/10' : ''
                          }`}
                          ref={qtyInputRef}
                          style={{ userSelect: 'auto', WebkitUserSelect: 'auto', pointerEvents: 'auto' }}
                        />
                        <button
                          onClick={() => {
                            if (!policy) return;
                            const newQty = (quickQty || 0) + policy.step;
                            setQuickQty(newQty);
                            setQuickQtyRaw(newQty.toString());
                          }}
                          className="p-2 glass rounded hover:bg-white/10 transition-colors"
                          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Prix unitaire - compact */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-gray-300 flex-shrink-0">
                    Prix ({activeSale.currency}):
                  </label>
                  <input
                    type="number"
                    value={quickPrice !== null ? quickPrice : (activeSale.currency === 'USD' ? selectedUnit.sale_price_usd : (selectedUnit.sale_price_usd * currentRate))}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setQuickPrice(isNaN(val) ? null : val);
                    }}
                    onDoubleClick={() => setQuickPrice(null)}
                    onFocus={() => setFocusedField('price')}
                    className="input-field text-xs flex-1 py-1.5 font-semibold"
                    placeholder={activeSale.currency === 'USD' ? selectedUnit.sale_price_usd.toFixed(2) : (selectedUnit.sale_price_usd * currentRate).toLocaleString()}
                    style={{ pointerEvents: 'auto' }}
                  />
                  <button
                    onClick={() => setQuickPrice(null)}
                    className="p-1.5 glass rounded text-gray-400 hover:bg-white/10 transition-colors flex-shrink-0"
                    title="Reset prix"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {/* Total - compact inline */}
                <div className="flex items-center justify-between gap-2 p-2 glass rounded-lg border border-primary-500/30 bg-primary-500/10">
                  <span className="text-xs text-gray-400">Total:</span>
                  <span className="text-base font-bold text-primary-400">
                    {(() => {
                      const priceUSD = quickPrice !== null 
                        ? (activeSale.currency === 'USD' ? quickPrice : quickPrice / currentRate)
                        : selectedUnit.sale_price_usd;
                      const priceFC = priceUSD * currentRate;
                      const price = activeSale.currency === 'USD' ? priceUSD : priceFC;
                      const qty = quickQty || 0;
                      const total = price * qty;
                      return qty <= 0 ? '—' : (activeSale.currency === 'USD' ? `$${total.toFixed(2)}` : `${total.toLocaleString()} FC`);
                    })()}
                  </span>
                  <span className="text-xs text-gray-500">
                    {(() => {
                      const qty = quickQty || 0;
                      if (qty <= 0) return '';
                      const priceUSD = quickPrice !== null 
                        ? (activeSale.currency === 'USD' ? quickPrice : quickPrice / currentRate)
                        : selectedUnit.sale_price_usd;
                      const total = priceUSD * qty;
                      const equivalent = activeSale.currency === 'USD' 
                        ? total * currentRate 
                        : total;
                      return activeSale.currency === 'USD' 
                        ? `≈ ${equivalent.toLocaleString()} FC` 
                        : `≈ $${(total).toFixed(2)}`;
                    })()}
                  </span>
                </div>
              </div>

              {/* Vérifier si le produit est déjà dans le panier + Auto-Stock */}
              {(() => {
                const productInCart = isProductInCart(selectedProduct, selectedUnit);
                const stockDispo = selectedUnit.stock_current || 0;
                const unitLevel = (selectedUnit.unit_level || '').toUpperCase().trim();
                const isDetailUnit = unitLevel === 'MILLIER' || unitLevel === 'PIECE';
                
                // ✅ AUTO-STOCK: Calculer si possible avec auto-stock
                const needsAutoStock = isDetailUnit && quickQty > stockDispo && quickQty > 0;
                const canAutoStock = needsAutoStock && autoStockPreview?.canFulfill === true;
                const autoStockImpossible = needsAutoStock && autoStockPreview?.canFulfill === false;
                
                return (
                  <>
                    {productInCart && (
                      <div className="mb-2 p-2 bg-yellow-500/20 border-2 border-yellow-500/50 rounded-lg">
                        <div className="flex items-center gap-1.5 text-yellow-300">
                          <Package className="w-3 h-3" />
                          <p className="text-xs font-semibold">
                            Déjà dans le panier
                          </p>
                        </div>
                      </div>
                    )}
                    
                    {/* ✅ AUTO-STOCK PREVIEW: Afficher l'info de conversion si nécessaire */}
                    {needsAutoStock && !productInCart && (
                      <div className={`mb-2 p-2 rounded-lg border-2 ${
                        autoStockLoading 
                          ? 'bg-blue-500/10 border-blue-500/30' 
                          : canAutoStock 
                            ? 'bg-emerald-500/20 border-emerald-500/50' 
                            : 'bg-red-500/20 border-red-500/50'
                      }`}>
                        {autoStockLoading ? (
                          <div className="flex items-center gap-2 text-blue-300">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <p className="text-xs">Calcul Auto-Stock...</p>
                          </div>
                        ) : canAutoStock ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-emerald-300">
                              <TrendingUp className="w-3.5 h-3.5" />
                              <p className="text-xs font-bold">Auto-Stock disponible</p>
                            </div>
                            <p className="text-[11px] text-emerald-200/80 leading-tight">
                              📦 <span className="font-semibold">{autoStockPreview.cartonsNeeded}</span> carton(s) → 
                              <span className="font-semibold text-emerald-300"> +{autoStockPreview.cartonsNeeded * (autoStockPreview.factor || 0)}</span> {unitLevel}
                            </p>
                            <p className="text-[10px] text-gray-400">
                              Stock actuel: {stockDispo} → après: {autoStockPreview.stockAfterConversion} | 
                              Reste après vente: {autoStockPreview.remainingAfterSale}
                            </p>
                          </div>
                        ) : autoStockImpossible ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-red-300">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <p className="text-xs font-bold">
                                {autoStockPreview?.noCartonsLeft ? '🚫 Aucun carton disponible' : 'Stock insuffisant'}
                              </p>
                            </div>
                            <p className="text-[11px] text-red-200/80 leading-tight">
                              {autoStockPreview?.message || `Pas assez de cartons pour couvrir ${quickQty} ${unitLevel}`}
                            </p>
                            {!autoStockPreview?.noCartonsLeft && autoStockPreview?.stockAfterConversion > 0 && (
                              <p className="text-[10px] text-gray-400">
                                Max possible: {autoStockPreview.stockAfterConversion} {unitLevel} 
                                (manque {autoStockPreview.shortage || (quickQty - autoStockPreview.stockAfterConversion)})
                              </p>
                            )}
                            {autoStockPreview?.noCartonsLeft && (
                              <p className="text-[10px] text-gray-400">
                                Stock actuel: {stockDispo} {unitLevel} | Cartons: 0
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-yellow-300">
                            <AlertCircle className="w-3 h-3" />
                            <p className="text-xs">Stock: {stockDispo}, demandé: {quickQty}</p>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Bouton d'ajout - Avec support Auto-Stock */}
                    <m.button
                      whileHover={(() => {
                        // ✅ Désactiver animation hover si bouton désactivé
                        const isDisabled = productInCart || quickQty <= 0 || autoStockLoading || 
                          (needsAutoStock && !canAutoStock) || 
                          (!needsAutoStock && (stockDispo <= 0 || quickQty > stockDispo));
                        return isDisabled ? {} : { scale: 1.05 };
                      })()}
                      whileTap={(() => {
                        const isDisabled = productInCart || quickQty <= 0 || autoStockLoading || 
                          (needsAutoStock && !canAutoStock) || 
                          (!needsAutoStock && (stockDispo <= 0 || quickQty > stockDispo));
                        return isDisabled ? {} : { scale: 0.97 };
                      })()}
                      transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                      style={{ 
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'translateZ(0)',
                        zIndex: 10,
                        pointerEvents: 'auto',
                        // ✅ Curseur dynamique selon l'état
                        cursor: (() => {
                          if (productInCart || quickQty <= 0) return 'not-allowed';
                          if (autoStockLoading) return 'wait';
                          if (needsAutoStock && !canAutoStock) return 'not-allowed';
                          if (!needsAutoStock && (stockDispo <= 0 || quickQty > stockDispo)) return 'not-allowed';
                          return 'pointer';
                        })()
                      }}
                      onClick={async () => {
                        const policy = getSafePolicy(selectedUnit.unit_level, selectedUnit.unit_mark);
                        
                        // ✅ BLOCAGE STRICT: Quantité invalide
                        if (quickQty <= 0) {
                          raiseError('Quantité invalide: entrez une valeur > 0');
                          return;
                        }
                        
                        // ✅ Validation selon policy
                        if (policy.integerOnly) {
                          if (!Number.isInteger(quickQty) || quickQty < 1) {
                            raiseError('Cette unité nécessite une quantité entière ≥ 1');
                            return;
                          }
                        }
                        
                        // ✅ AUTO-STOCK PRÉVENTIF: Appliquer si nécessaire
                        if (canAutoStock && autoStockPreview?.needsConversion) {
                          try {
                            showInfo(`🔄 Conversion Auto-Stock en cours...`);
                            
                            const response = await axios.post(`${API_URL}/api/autostock/apply-for-sale`, {
                              productKey: selectedProduct.code || selectedProduct.uuid,
                              unit_level: unitLevel,
                              qty_requested: quickQty,
                            }, { timeout: 10000 });
                            
                            if (response.data?.ok && response.data?.applied) {
                              showSuccess(`✅ ${response.data.message || 'Auto-Stock appliqué'}`);
                              
                              // ✅ IMPORTANT: Mettre à jour le stock local de l'unité sélectionnée
                              const newStock = response.data.stockFinal;
                              if (selectedUnit && typeof newStock === 'number') {
                                selectedUnit.stock_current = newStock;
                              }
                              
                              // ✅ Rafraîchir les produits en arrière-plan pour sync complète
                              setTimeout(() => {
                                if (refreshProducts) refreshProducts();
                                loadProducts();
                              }, 100);
                            } else if (!response.data?.applied) {
                              // Stock était déjà suffisant
                              console.log('[AutoStock] Stock déjà suffisant');
                            }
                          } catch (err) {
                            raiseError(`Erreur Auto-Stock: ${err.response?.data?.error || err.message}`);
                            return;
                          }
                        }
                        
                        // ✅ VÉRIFICATION FINALE: Stock suffisant après auto-stock?
                        const finalStock = selectedUnit.stock_current || 0;
                        if (quickQty > finalStock && !canAutoStock) {
                          raiseError(`Stock insuffisant! Disponible: ${finalStock}, demandé: ${quickQty}`);
                          return;
                        }
                        
                        let finalQty = validateAndCorrectQty(quickQty, policy);
                        
                        let normalizedFinalQty = finalQty;
                        if (typeof finalQty === 'string') {
                          normalizedFinalQty = parseFloat(finalQty.replace(/,/g, '.')) || 0;
                        }
                        normalizedFinalQty = Math.round(Number(normalizedFinalQty) * 100) / 100;
                        
                        let priceUSD;
                        if (quickPrice !== null) {
                          if (activeSale.currency === 'FC') {
                            priceUSD = quickPrice / currentRate;
                          } else {
                            priceUSD = quickPrice;
                          }
                        } else {
                          priceUSD = selectedUnit.sale_price_usd;
                        }
                        
                        const priceFC = priceUSD * currentRate;
                        
                        addItemToSale(selectedProduct, selectedUnit, normalizedFinalQty, priceFC, priceUSD);
                        setQuickQty(0);
                        setQuickQtyRaw('');
                        setQuickPrice(null);
                        setAutoStockPreview(null);
                      }}
                      disabled={(() => {
                        if (productInCart) return true;
                        if (quickQty <= 0) return true;
                        if (autoStockLoading) return true;
                        
                        // ✅ AUTO-STOCK: Permettre si auto-stock possible
                        if (needsAutoStock) {
                          // Bloquer seulement si auto-stock impossible
                          return !canAutoStock;
                        }
                        
                        // Stock normal
                        if (stockDispo <= 0) return true;
                        if (quickQty > stockDispo) return true;
                        
                        const policy = getSafePolicy(selectedUnit.unit_level, selectedUnit.unit_mark);
                        if (policy.integerOnly && (!Number.isInteger(quickQty) || quickQty < 1)) return true;
                        return false;
                      })()}
                      className={`w-full py-2 text-sm font-bold flex items-center justify-center gap-2 shadow-lg transition-all mt-2 rounded-lg ${
                        (() => {
                          if (productInCart) return 'bg-gray-600/50 text-gray-400 cursor-not-allowed opacity-60';
                          if (stockDispo <= 0 && !canAutoStock) return 'bg-gray-600/50 text-gray-400 cursor-not-allowed opacity-60';
                          if (quickQty <= 0) return 'bg-gray-600/50 text-gray-400 cursor-not-allowed opacity-60';
                          if (autoStockLoading) return 'bg-blue-600/50 text-blue-200 cursor-wait';
                          
                          // ✅ AUTO-STOCK STYLES
                          if (needsAutoStock) {
                            if (canAutoStock) return 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white hover:shadow-xl';
                            if (autoStockImpossible) return 'bg-red-600/80 text-white cursor-not-allowed';
                          }
                          
                          if (quickQty > stockDispo) return 'bg-red-600/80 text-white cursor-not-allowed';
                          return 'btn-primary hover:shadow-xl';
                        })()
                      }`}
                    >
                      {(() => {
                        if (productInCart) {
                          return <><X className="w-4 h-4" /><span className="text-xs">Déjà au panier</span></>;
                        }
                        if (quickQty <= 0) {
                          return <><X className="w-4 h-4" /><span className="text-xs">Entrez une quantité</span></>;
                        }
                        if (autoStockLoading) {
                          return <><RefreshCw className="w-4 h-4 animate-spin" /><span className="text-xs">Calcul Auto-Stock...</span></>;
                        }
                        
                        // ✅ AUTO-STOCK: Afficher le bon texte
                        if (needsAutoStock) {
                          if (canAutoStock) {
                            return <><TrendingUp className="w-4 h-4" /><span className="text-xs">Ajouter + Auto-Stock ({autoStockPreview?.cartonsNeeded} carton{autoStockPreview?.cartonsNeeded > 1 ? 's' : ''})</span></>;
                          }
                          if (autoStockImpossible) {
                            if (autoStockPreview?.noCartonsLeft) {
                              return <><X className="w-4 h-4" /><span className="text-xs">Cartons épuisés (dispo: {stockDispo})</span></>;
                            }
                            return <><AlertCircle className="w-4 h-4" /><span className="text-xs">Stock insuffisant (max: {autoStockPreview?.stockAfterConversion || stockDispo})</span></>;
                          }
                        }
                        
                        if (stockDispo <= 0) {
                          return <><AlertCircle className="w-4 h-4" /><span className="text-xs">Stock épuisé</span></>;
                        }
                        if (quickQty > stockDispo) {
                          return <><AlertCircle className="w-4 h-4" /><span className="text-xs">Stock insuffisant ({stockDispo} dispo)</span></>;
                        }
                        const policy = getSafePolicy(selectedUnit.unit_level, selectedUnit.unit_mark);
                        if (policy.integerOnly && (!Number.isInteger(quickQty) || quickQty < 1)) {
                          return <><X className="w-4 h-4" /><span className="text-xs">Quantité entière requise</span></>;
                        }
                        return <><Plus className="w-4 h-4" />Ajouter</>;
                      })()}
                    </m.button>
                  </>
                );
                  })()}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center p-8 min-h-[200px]">
                      <div className="text-center">
                        <Package className="w-12 h-12 mx-auto mb-3 text-gray-400 opacity-50" />
                        <p className="text-gray-400 text-sm">Sélectionnez un produit</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>



        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        {/* RÉSUMÉ & STATISTIQUES - Design raffiné et compact */}
        {/* ═══════════════════════════════════════════════════════════════════════════ */}
        <div className="mt-4">
          {/* Stats rapides en ligne - Design glassmorphism compact */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {/* Paniers actifs */}
            <div className="glass rounded-lg p-2.5 border border-white/10 hover:border-primary-500/30 transition-all group">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-blue-500/20 to-blue-600/30 group-hover:scale-110 transition-transform">
                  <ShoppingCart className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Paniers</p>
                  <p className="text-sm font-bold text-gray-100">{sales.length}</p>
                </div>
              </div>
            </div>
            
            {/* Items en cours */}
            <div className="glass rounded-lg p-2.5 border border-white/10 hover:border-purple-500/30 transition-all group">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-purple-500/20 to-purple-600/30 group-hover:scale-110 transition-transform">
                  <Package className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Articles</p>
                  <p className="text-sm font-bold text-gray-100">
                    {sales.reduce((sum, s) => sum + s.items.length, 0)}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Total paniers FC */}
            <div className="glass rounded-lg p-2.5 border border-white/10 hover:border-emerald-500/30 transition-all group">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-emerald-500/20 to-emerald-600/30 group-hover:scale-110 transition-transform">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Paniers FC</p>
                  <p className="text-sm font-bold text-emerald-400 truncate">
                    {sales.reduce((sum, s) => sum + s.items.reduce((itemSum, item) => itemSum + item.subtotal_fc, 0), 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Total paniers USD */}
            <div className="glass rounded-lg p-2.5 border border-white/10 hover:border-cyan-500/30 transition-all group">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-cyan-500/20 to-cyan-600/30 group-hover:scale-110 transition-transform">
                  <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Paniers $</p>
                  <p className="text-sm font-bold text-cyan-400">
                    ${sales.reduce((sum, s) => sum + s.items.reduce((itemSum, item) => itemSum + item.subtotal_usd, 0), 0).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Statistiques de la session du jour + Ventes récentes */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            {/* Stats de la session (2 colonnes) */}
            <div className="lg:col-span-2 glass rounded-xl p-3 border border-primary-500/20 bg-gradient-to-br from-primary-500/5 via-transparent to-primary-600/5">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-primary-500/20">
                  <BarChart3 className="w-4 h-4 text-primary-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-200">Mes ventes</h3>
                  <p className="text-[10px] text-primary-400/70 font-medium">
                    📅 {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
                  </p>
                </div>
                {sessionStats.lastSaleTime && (
                  <span className="text-[10px] text-gray-500 flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded">
                    <Clock className="w-3 h-3" />
                    {(() => {
                      try {
                        return format(parseISO(sessionStats.lastSaleTime), 'HH:mm', { locale: fr });
                      } catch {
                        return '--:--';
                      }
                    })()}
                  </span>
                )}
              </div>
              
              {/* Barre de progression visuelle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Ventes finalisées</span>
                  <span className="font-bold text-primary-400">{sessionStats.totalSalesCount}</span>
                </div>
                <div className="h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
                  <m.div 
                    className="h-full bg-gradient-to-r from-primary-500 to-cyan-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, sessionStats.totalSalesCount * 10)}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
                
                {/* Totaux avec design amélioré */}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-[10px] text-emerald-400/70 uppercase">Total FC</p>
                    <p className="text-sm font-bold text-emerald-400">
                      {sessionStats.totalFC.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                    <p className="text-[10px] text-cyan-400/70 uppercase">Total USD</p>
                    <p className="text-sm font-bold text-cyan-400">
                      ${sessionStats.totalUSD.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Dernières ventes (3 colonnes) */}
            <div className="lg:col-span-3 glass rounded-xl p-3 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-amber-500/20">
                  <Receipt className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-200">Ventes récentes</h3>
                  <p className="text-[10px] text-amber-400/70">Aujourd'hui uniquement</p>
                </div>
                <button 
                  onClick={loadRecentSales}
                  className="text-[10px] text-gray-500 hover:text-primary-400 transition-colors px-2 py-0.5 rounded hover:bg-white/5 flex items-center gap-1"
                >
                  <span>↻</span> Actualiser
                </button>
              </div>
              
              {recentSales.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-xs">
                  <Receipt className="w-6 h-6 mx-auto mb-1 opacity-30" />
                  <p>Aucune vente aujourd'hui</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-y-auto hide-scrollbar">
                  {recentSales.map((sale, idx) => (
                    <m.div 
                      key={sale.id || sale.invoice_number || idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 transition-colors group"
                    >
                      {/* Numéro facture */}
                      <span className="text-[10px] font-mono text-gray-500 w-16 truncate">
                        #{sale.invoice_number?.slice(-6) || '------'}
                      </span>
                      
                      {/* Client */}
                      <span className="flex-1 text-xs text-gray-300 truncate min-w-0">
                        {sale.client_name || 'Client'}
                      </span>
                      
                      {/* Heure */}
                      <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {(() => {
                          try {
                            return format(parseISO(sale.sold_at || sale.created_at), 'HH:mm', { locale: fr });
                          } catch {
                            return '--:--';
                          }
                        })()}
                      </span>
                      
                      {/* Montant */}
                      <span className="text-xs font-semibold text-primary-400 min-w-[60px] text-right">
                        ${(Number(sale.total_usd) || 0).toFixed(2)}
                      </span>
                      
                      {/* Status badge */}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        sale.payment_mode === 'dette' || sale.status === 'unpaid' || sale.status === 'partial'
                          ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                          : 'bg-green-500/20 text-green-400 border border-green-500/30'
                      }`}>
                        {sale.payment_mode === 'dette' || sale.status === 'unpaid' || sale.status === 'partial' ? 'Dette' : 'Payé'}
                      </span>
                      
                      {/* Bouton supprimer */}
                      <button
                        onClick={(e) => handleDeleteRecentSale(sale.invoice_number, e)}
                        disabled={deletingSale === sale.invoice_number}
                        className={`p-1 rounded transition-all ${
                          deletingSale === sale.invoice_number
                            ? 'bg-red-900/50 cursor-not-allowed'
                            : 'opacity-0 group-hover:opacity-100 hover:bg-red-600/30'
                        }`}
                        title="Supprimer et restaurer le stock"
                      >
                        {deletingSale === sale.invoice_number ? (
                          <RefreshCw className="w-3 h-3 text-red-400 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3 text-red-400 hover:text-red-300" />
                        )}
                      </button>
                    </m.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onCloseToast={closeToast} />
    </m.div>
  );
};

// Export avec ErrorBoundary
export default function SalesPOSWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <SalesPOS />
    </ErrorBoundary>
  );
}

// Composant pour sélectionner une unité (seulement pour Carton - design détaillé)
const UnitSelector = ({ product, unit, onAdd, getUnitLabel, currency, currentRate, onSelect }) => {
  const qtyInputRef = useRef(null);

  // ❌ AUTO-FOCUS SUPPRIMÉ: L'utilisateur clique manuellement sur le champ qty
  const [qty, setQty] = useState(unit.qty_step || 1);
  const [customPrice, setCustomPrice] = useState(null);

  const price = customPrice !== null ? customPrice : (currency === 'USD' ? unit.sale_price_usd : unit.sale_price_fc);
  const total = price * qty;

  return (
    <div className="p-3 glass rounded-lg border border-primary-500/30 flex flex-col gap-3">
      {/* En-tête compact */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-gray-100 text-sm truncate">
            {getUnitLabel(unit.unit_level)}
          </span>
          {unit.unit_mark && (
            <span className="px-1.5 py-0.5 bg-primary-500/20 text-primary-400 rounded text-xs font-medium flex-shrink-0">
              {unit.unit_mark}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400 flex-shrink-0">
          <span>Stock: <span className="text-gray-200 font-semibold">{unit.stock_current}</span></span>
          <span className="text-primary-400 font-semibold">
            {currency === 'USD' 
              ? `$${unit.sale_price_usd.toFixed(2)}` 
              : `${unit.sale_price_fc.toLocaleString()} FC`}
          </span>
        </div>
      </div>

      {/* Ligne compacte : Qty + Prix + Total + Bouton */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Quantité */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setQty(Math.max(unit.qty_step, qty - unit.qty_step))}
            className="p-1.5 glass rounded hover:bg-white/10 flex-shrink-0"
          >
            <Minus className="w-3 h-3" />
          </button>
          <input
            type="number"
            value={qty}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || unit.qty_step;
              setQty(Math.max(unit.qty_step, val));
            }}
            step={unit.qty_step}
            min={unit.qty_step}
            className="input-field text-center text-sm w-14 py-1"
            ref={qtyInputRef}
          />
          <button
            onClick={() => setQty(qty + unit.qty_step)}
            className="p-1.5 glass rounded hover:bg-white/10 flex-shrink-0"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Prix personnalisé */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">×</span>
          <input
            type="number"
            value={customPrice !== null ? customPrice : (currency === 'USD' ? unit.sale_price_usd : unit.sale_price_fc)}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setCustomPrice(isNaN(val) ? null : val);
            }}
            className="input-field text-sm w-20 py-1 text-center"
            placeholder={currency === 'USD' ? unit.sale_price_usd.toFixed(2) : unit.sale_price_fc.toLocaleString()}
          />
        </div>

        {/* Total */}
        <div className="flex items-center gap-1 px-2 py-1 glass rounded flex-shrink-0">
          <span className="text-xs text-gray-500">=</span>
          <span className="font-bold text-sm text-primary-400">
            {currency === 'USD' ? `$${total.toFixed(2)}` : `${total.toLocaleString()} FC`}
          </span>
        </div>

        {/* Bouton Ajouter - toujours visible */}
        <button
          onClick={() => {
            const priceFC = currency === 'FC' ? (customPrice !== null ? customPrice : unit.sale_price_fc) : (customPrice !== null ? customPrice * currentRate : unit.sale_price_fc);
            const priceUSD = currency === 'USD' ? (customPrice !== null ? customPrice : unit.sale_price_usd) : (customPrice !== null ? customPrice / currentRate : unit.sale_price_usd);
            onAdd(product, unit, qty, priceFC, priceUSD);
            setQty(unit.qty_step || 1);
            setCustomPrice(null);
          }}
          className="btn-primary text-xs py-1.5 px-3 flex-shrink-0 ml-auto"
        >
          <Plus className="w-3 h-3 inline mr-1" />
          Ajouter
        </button>
      </div>
    </div>
  );
};

// Composant pour l'icône selon l'unité et le mark
const UnitIcon = ({ unitLevel, unitMark }) => {
  // Règle 1: CARTON → toujours icône Carton
  if (unitLevel === 'CARTON') {
    return (
      <svg className="w-5 h-5 text-primary-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 7.5L12 3l9 4.5v9L12 21 3 16.5v-9Z" />
        <path d="M12 21v-9M3 7.5l9 4.5 9-4.5" />
      </svg>
    );
  }
  
  // Règle 2: PIECE → icône PIECE (même si mark vide ou PIECE)
  if (unitLevel === 'PIECE' || unitLevel === 'DETAIL') {
    return (
      <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6M12 18h.01" />
      </svg>
    );
  }
  
  // Règle 3: MILLIERS → afficher le texte du mark (pas d'icône SVG)
  if (unitLevel === 'MILLIER') {
    return (
      <div className="w-10 h-10 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center">
        <span className="text-xs font-bold text-primary-300">
          {unitMark || 'M'}
        </span>
      </div>
    );
  }
  
  // Par défaut: Package
  return <Package className="w-5 h-5 text-primary-400" />;
};

// Composant pour un item du panier - Design pro et avancé avec animation inverse
const CartItem = ({ item, itemIndex, currency, onRemove, onUpdateQty, onUpdatePrice, getUnitLabel, isHovered, onHover, onLeave }) => {
  const [editingPrice, setEditingPrice] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingQty, setEditingQty] = useState(false);
  const [priceValue, setPriceValue] = useState(
    currency === 'USD' ? item.unit_price_usd : item.unit_price_fc
  );
  const [nameValue, setNameValue] = useState(item.product_name);
  const [qtyValue, setQtyValue] = useState(item.qty);

  const handlePriceUpdate = () => {
    onUpdatePrice(itemIndex, priceValue, currency);
    setEditingPrice(false);
  };

  const handleQtyUpdate = () => {
    const val = Math.max(item.qty_step, parseFloat(qtyValue) || item.qty_step);
    onUpdateQty(itemIndex, val);
    setQtyValue(val);
    setEditingQty(false);
  };

  return (
    <m.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ 
        opacity: isHovered ? 1 : 0.5,
        scale: isHovered ? 1 : 0.8,
        y: 0
      }}
      whileTap={{ scale: isHovered ? 0.98 : 0.78 }}
      transition={{ 
        duration: 0.08,
        ease: [0.25, 0.1, 0.25, 1]
      }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{ 
        willChange: 'transform, opacity',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: 'translateZ(0)',
        zIndex: isHovered ? 30 : 10
      }}
      className={`group grid grid-cols-12 gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 glass rounded-lg border transition-all items-center bg-gradient-to-r from-white/5 to-transparent relative my-1 sm:my-1.5 ${
        isHovered 
          ? 'border-primary-500/60 shadow-xl' 
          : 'border-white/10 shadow-sm'
      }`}
    >
      {/* Produit - Design professionnel compact */}
      <div className="col-span-4 flex items-center gap-1.5 sm:gap-2 min-w-0">
        <m.div 
          className="flex-shrink-0"
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.95 }}
          transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ 
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'translateZ(0)',
            zIndex: 15
          }}
        >
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center group-hover:bg-primary-500/30 transition-colors shadow-sm">
            <UnitIcon unitLevel={item.unit_level} unitMark={item.unit_mark} />
          </div>
        </m.div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <p className="font-semibold text-gray-100 text-xs sm:text-sm truncate">
              {item.product_name}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="px-1.5 py-0.5 bg-blue-500/20 border border-blue-500/40 text-blue-300 rounded text-[10px] sm:text-xs font-semibold">
              {getUnitLabel(item.unit_level)}
            </span>
            {item.unit_mark && (
              <m.span 
                whileHover={{ scale: 1.08, y: -1 }}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ 
                  willChange: 'transform',
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'translateZ(0)',
                  zIndex: 10
                }}
                className="px-1.5 py-0.5 bg-gradient-to-r from-primary-500/25 to-primary-600/25 border border-primary-500/40 text-primary-200 rounded text-[10px] sm:text-xs font-semibold whitespace-nowrap flex items-center gap-1 shadow-sm"
              >
                <span className="w-1 h-1 bg-primary-400 rounded-full" />
                <span className="font-bold text-primary-300">MARK:</span>
                <span className="text-primary-100 font-semibold">{item.unit_mark}</span>
              </m.span>
            )}
          </div>
        </div>
      </div>

      {/* Quantité - Design amélioré avec animations fluides */}
      {(() => {
        const policy = getSafePolicy(item.unit_level, item.unit_mark);
        
        return (
      <div className="col-span-2 flex items-center justify-center gap-2">
        <m.button
          whileHover={{ scale: 1.15, y: -2 }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ 
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'translateZ(0)',
            zIndex: 10
          }}
              onClick={() => {
                const newQty = Math.max(0, item.qty - policy.step);
                onUpdateQty(itemIndex, newQty);
              }}
          className="p-2 glass rounded-lg hover:bg-red-500/20 hover:border-red-500/50 border border-white/10 transition-all shadow-sm"
          title="Diminuer"
        >
          <Minus className="w-4 h-4 text-gray-300" />
        </m.button>
        <m.input
          whileFocus={{ scale: 1.05, borderColor: 'rgba(59, 130, 246, 0.5)' }}
          transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
          type="number"
              value={item.qty === 0 ? '' : item.qty}
          onChange={(e) => {
                const rawVal = e.target.value;
                // Permettre la saisie libre (même vide pour effacer)
                if (rawVal === '' || rawVal === '0') {
                  onUpdateQty(itemIndex, 0);
                  return;
                }
                
                // CRITIQUE: Convertir toutes les virgules en points (gérer 0,5, 0,50, etc.)
                const normalizedVal = rawVal.replace(/,/g, '.');
                
                let val;
                if (policy.integerOnly) {
                  const intVal = parseInt(normalizedVal);
                  if (!isNaN(intVal)) {
                    val = intVal;
                  } else {
                    return;
                  }
                } else {
                  const floatVal = parseFloat(normalizedVal);
                  if (!isNaN(floatVal)) {
                    // Arrondir à 2 décimales pour éviter les problèmes de précision
                    val = Math.round(floatVal * 100) / 100;
                  } else {
                    return;
                  }
                }
                // Mettre à jour directement sans correction automatique
                onUpdateQty(itemIndex, val);
              }}
              onBlur={(e) => {
                // Validation finale au blur : corriger seulement si invalide
                if (item.qty <= 0) {
                  // Si 0 ou négatif, corriger au minQty
                  const corrected = validateAndCorrectQty(policy.minQty, policy);
                  onUpdateQty(itemIndex, corrected);
                } else {
                  // Valider et corriger si nécessaire
                  const corrected = validateAndCorrectQty(item.qty, policy);
                  if (corrected !== item.qty) {
                    onUpdateQty(itemIndex, corrected);
                  }
                }
              }}
              step={policy.step}
              min={0}
              placeholder="0"
          className="input-field text-center text-xs sm:text-sm font-semibold w-16 sm:w-20 bg-white/10 border-primary-500/30 focus:border-primary-500/50"
          style={{ 
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden'
          }}
        />
        <m.button
          whileHover={{ scale: 1.1, y: -1 }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ 
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'translateZ(0)',
            zIndex: 10
          }}
              onClick={() => {
                const newQty = (item.qty || 0) + policy.step;
                onUpdateQty(itemIndex, newQty);
              }}
          className="p-1 sm:p-1.5 glass rounded hover:bg-green-500/20 hover:border-green-500/50 border border-white/10 transition-all shadow-sm"
          title="Augmenter"
        >
          <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-300" />
        </m.button>
      </div>
        );
      })()}

      {/* Prix unitaire - Design amélioré compact */}
      <div className="col-span-2 text-right min-w-0">
        {editingPrice ? (
          <input
            type="number"
            value={priceValue}
            onChange={(e) => setPriceValue(parseFloat(e.target.value) || 0)}
            onBlur={handlePriceUpdate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handlePriceUpdate();
              }
              if (e.key === 'Escape') {
                setPriceValue(currency === 'USD' ? item.unit_price_usd : item.unit_price_fc);
                setEditingPrice(false);
              }
            }}
            className="input-field text-xs sm:text-sm font-semibold w-full text-right bg-white/10 border-primary-500/30 focus:border-primary-500/50"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditingPrice(true)}
            className="text-xs sm:text-sm font-bold text-gray-200 hover:text-primary-400 cursor-pointer px-1 sm:px-2 py-0.5 sm:py-1 rounded hover:bg-primary-500/10 transition-all truncate max-w-full"
            title="Cliquer pour modifier le prix"
          >
            {currency === 'USD'
              ? `$${(item.unit_price_usd || 0).toFixed(2)}`
              : `${(item.unit_price_fc || 0).toLocaleString()} FC`}
          </button>
        )}
      </div>

      {/* Total - Design amélioré compact */}
      <div className="col-span-3 text-right min-w-0">
        <div className="p-1 sm:p-1.5 bg-primary-500/10 rounded border border-primary-500/30">
          <p className="text-xs sm:text-sm font-bold text-primary-300 mb-0.5 truncate">
            {currency === 'USD'
              ? `$${(item.subtotal_usd || 0).toFixed(2)}`
              : `${(item.subtotal_fc || 0).toLocaleString()} FC`}
          </p>
          <p className="text-[10px] sm:text-xs text-gray-400 font-medium truncate">
            {currency === 'USD'
              ? `≈ ${(item.subtotal_fc || 0).toLocaleString()} FC`
              : `≈ $${(item.subtotal_usd || 0).toFixed(2)} USD`}
          </p>
        </div>
      </div>

      {/* Action - Bouton supprimer amélioré compact */}
      <div className="col-span-1 text-center">
        <m.button
          whileHover={{ scale: 1.15, rotate: 8, y: -1 }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ 
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'translateZ(0)',
            zIndex: 10
          }}
          onClick={() => onRemove(itemIndex)}
          className="p-1 sm:p-1.5 glass rounded hover:bg-red-500/20 hover:border-red-500/50 border border-white/10 transition-all group shadow-sm"
          title="Supprimer"
        >
          <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400 group-hover:text-red-400 transition-colors" />
        </m.button>
      </div>
    </m.div>
  );
};

// Composant pour afficher un produit avec toutes ses unités comme badges
const ProductWithUnitsRow = ({ product, onAdd, onSelect, getUnitLabel, currency, currentRate }) => {
  // Vérifier que product et units existent
  if (!product) {
    return null;
  }

  if (!product.units || !Array.isArray(product.units) || product.units.length === 0) {
    return (
      <div className="p-2 glass rounded-lg border border-white/10">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm text-gray-100 truncate">{product.name || 'Produit sans nom'}</h4>
            <p className="text-xs text-gray-400">({product.code || 'N/A'})</p>
          </div>
          <span className="text-xs text-gray-500">Aucune unité disponible</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 glass rounded-lg border border-white/10">
      {/* En-tête du produit */}
      <div className="flex items-center gap-2 mb-2">
        <Package className="w-4 h-4 text-primary-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm text-gray-100 truncate">{product.name || 'Produit sans nom'}</h4>
          <p className="text-xs text-gray-400">({product.code || 'N/A'})</p>
        </div>
      </div>

      {/* Unités comme badges compacts en ligne */}
      <div className="flex flex-wrap gap-2">
        {product.units.map((unit, index) => {
          if (!unit) return null;
          return (
            <button
              key={unit.id || `unit-${index}`}
              onClick={() => {
                if (onSelect) {
                  onSelect(product, unit);
                }
              }}
              className="px-3 py-1.5 glass rounded-lg border border-white/10 hover:border-primary-500/50 transition-all text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-primary-400 flex-shrink-0">
                  {unit.unit_level === 'CARTON' ? (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 7.5L12 3l9 4.5v9L12 21 3 16.5v-9Z" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5Z" />
                    </svg>
                  )}
                </span>
                <span className="font-semibold text-xs text-gray-100">
                  {getUnitLabel(unit.unit_level)}
                </span>
                {unit.unit_mark && (
                  <span className="px-1.5 py-0.5 bg-primary-500/20 text-primary-400 rounded text-xs">
                    [{unit.unit_mark}]
                  </span>
                )}
                <span className="text-gray-400 mx-1">—</span>
                <span className="text-xs text-gray-400">
                  Stock: <span className="text-gray-200 font-medium">{unit.stock_current.toLocaleString()}</span>
                </span>
                <span className="text-gray-500">•</span>
                <span className="text-xs text-gray-400">
                  PU: <span className="text-gray-200 font-medium">
                    {currency === 'USD' 
                      ? `$${unit.sale_price_usd.toFixed(2)}` 
                      : `${unit.sale_price_fc.toLocaleString()} FC`}
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Badge d'unité compact (comme sur l'image)
const UnitBadge = ({ product, unit, onAdd, getUnitLabel, currency, currentRate, onSelect }) => {
  const [showForm, setShowForm] = useState(false);
  const [qty, setQty] = useState(unit.qty_step || 1);
  const [customPrice, setCustomPrice] = useState(null);
  const qtyInputRef = useRef(null);

  const price = customPrice !== null ? customPrice : (currency === 'USD' ? unit.sale_price_usd : unit.sale_price_fc);
  const total = price * qty;

  // ❌ AUTO-FOCUS SUPPRIMÉ: L'utilisateur clique manuellement sur le champ qty

  // Icône selon le type d'unité
  const getUnitIcon = () => {
    if (unit.unit_level === 'CARTON') {
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 7.5L12 3l9 4.5v9L12 21 3 16.5v-9Z" />
          <path d="M12 21v-9M3 7.5l9 4.5 9-4.5" />
        </svg>
      );
    }
    // Icône pour Millier/Détail
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5Z" />
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    );
  };

  if (showForm) {
    // Afficher le formulaire si Carton
    if (unit.unit_level === 'CARTON') {
      return (
        <div className="p-3 glass rounded-lg border border-primary-500/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {getUnitIcon()}
              <span className="font-semibold text-gray-100">
                {getUnitLabel(unit.unit_level)}
              </span>
              {unit.unit_mark && (
                <span className="px-2 py-0.5 bg-primary-500/20 text-primary-400 rounded text-xs">
                  {unit.unit_mark}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setShowForm(false);
                setQty(unit.qty_step || 1);
                setCustomPrice(null);
              }}
              className="text-gray-400 hover:text-gray-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <UnitSelector
            product={product}
            unit={unit}
            onAdd={(p, u, q, fc, usd) => {
              onAdd(p, u, q, fc, usd);
              setShowForm(false);
              setQty(unit.qty_step || 1);
              setCustomPrice(null);
            }}
            getUnitLabel={getUnitLabel}
            currency={currency}
            currentRate={currentRate}
          />
        </div>
      );
    }
  }

  // Badge compact par défaut (comme sur l'image - une ligne)
  return (
    <div className="relative">
      <button
        onClick={() => {
          if (unit.unit_level === 'CARTON') {
            setShowForm(!showForm);
            if (!showForm && onSelect) {
              onSelect();
            }
          } else {
            // Pour Millier/Pièce, ajouter directement avec quantité par défaut
            const qty = unit.qty_step || 1;
            onAdd(product, unit, qty, unit.sale_price_fc, unit.sale_price_usd);
          }
        }}
        className="px-4 py-2.5 glass rounded-lg border border-white/10 hover:border-primary-500/50 transition-all text-left w-full"
      >
        <div className="flex items-center gap-2">
          <span className="text-primary-400 flex-shrink-0">{getUnitIcon()}</span>
          <span className="font-semibold text-sm text-gray-100">
            {getUnitLabel(unit.unit_level)}
          </span>
          {unit.unit_mark && (
            <span className="px-2 py-0.5 bg-primary-500/20 text-primary-400 rounded text-xs">
              [{unit.unit_mark}]
            </span>
          )}
          <span className="text-gray-400 mx-2">—</span>
          <span className="text-xs text-gray-400">
            Stock: <span className="text-gray-200 font-medium">{unit.stock_current.toLocaleString()}</span>
          </span>
          <span className="text-gray-500">•</span>
          <span className="text-xs text-gray-400">
            PU{unit.unit_level === 'MILLIER' || unit.unit_level === 'DETAIL' ? ' pack' : ''}: <span className="text-gray-200 font-medium">
              {currency === 'USD' 
                ? `$${unit.sale_price_usd.toFixed(2)}` 
                : `${unit.sale_price_fc.toLocaleString()} FC`}
            </span>
          </span>
        </div>
      </button>
    </div>
  );
};


