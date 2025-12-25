import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  ArrowUp
} from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';
const PRINT_API_URL = `${API_URL}/api/print`;
const IS_DEV = import.meta.env.DEV;

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
  const { products, loadProducts, currentRate, loadCurrentRate } = useStore();
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
  
  // Refs pour debounce
  const saveTimeoutRef = useRef(null);
  const pendingSavesRef = useRef(new Map());
  
  // Note: Pas de hover state nécessaire - utilisation de CSS hover uniquement (comme DebtsPage)
  // Les variables handleTableMouseLeave, hoveredRowIndex, isHovered ne sont pas utilisées
  
  useEffect(() => {
    const init = async () => {
      try {
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
  }, [loadProducts, loadCurrentRate]);

  // Calculer FC depuis USD
  const calculateFC = useCallback((usd) => {
    return Math.round((usd || 0) * (currentRate || 2800));
  }, [currentRate]);

  // Calculer USD depuis FC
  const calculateUSD = useCallback((fc) => {
    return Number(((fc || 0) / (currentRate || 2800)).toFixed(2));
  }, [currentRate]);

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
                unit_level: unit.unit_level || '',
                unit_mark: unit.unit_mark || '',
                stock_current: Number(unit.stock_current) || 0,
                sale_price_usd: salePriceUSD,
                sale_price_fc: calculatedFC,
                purchase_price_usd: Number(unit.purchase_price_usd) || 0,
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

  // Créer un produit
  const handleCreateProduct = useCallback(async (row, edits) => {
    const unitLevel = row.unit_level || edits?.unit_level || 'CARTON';
    const productName = (edits?.product_name || row.product_name || '').trim();
    
    if (!productName) {
      throw new Error('Le nom du produit est requis');
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
        // Utiliser le code et nom du CARTON existant
        const code = existingCarton.code;
        const name = existingCarton.name;
        
        // Ajouter la nouvelle unité au produit existant
        const existingUnits = existingCarton.units || [];
        const newUnit = {
          unit_level: unitLevel,
          unit_mark: edits?.unit_mark || '',
          stock_current: parseFloat(edits?.stock_current) || 0,
          sale_price_usd: parseFloat(edits?.sale_price_usd) || 0,
          sale_price_fc: parseFloat(edits?.sale_price_fc) || calculateFC(parseFloat(edits?.sale_price_usd) || 0),
          purchase_price_usd: parseFloat(edits?.purchase_price_usd) || 0,
        };
        
        await axios.post(`${API_URL}/api/products`, {
          code,
          name,
          units: [...existingUnits, newUnit]
        });
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
                  const code = `PROD-${Date.now()}`;
                  await axios.post(`${API_URL}/api/products`, {
                    code,
                    name: productName,
                    units: [{
                      unit_level: unitLevel,
                      unit_mark: edits?.unit_mark || '',
                      stock_current: parseFloat(edits?.stock_current) || 0,
                      sale_price_usd: parseFloat(edits?.sale_price_usd) || 0,
                      sale_price_fc: parseFloat(edits?.sale_price_fc) || calculateFC(parseFloat(edits?.sale_price_usd) || 0),
                      purchase_price_usd: parseFloat(edits?.purchase_price_usd) || 0,
                    }]
                  });
                  setModalState({ isOpen: false, type: '', data: null });
                  resolve();
                } catch (error) {
                  reject(error);
                }
              },
              onCustomName: async (customName) => {
                try {
                  const code = `PROD-${Date.now()}`;
                  await axios.post(`${API_URL}/api/products`, {
                    code,
                    name: customName,
                    units: [{
                      unit_level: unitLevel,
                      unit_mark: edits?.unit_mark || '',
                      stock_current: parseFloat(edits?.stock_current) || 0,
                      sale_price_usd: parseFloat(edits?.sale_price_usd) || 0,
                      sale_price_fc: parseFloat(edits?.sale_price_fc) || calculateFC(parseFloat(edits?.sale_price_usd) || 0),
                      purchase_price_usd: parseFloat(edits?.purchase_price_usd) || 0,
                    }]
                  });
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
      const code = `PROD-${Date.now()}`;
      await axios.post(`${API_URL}/api/products`, {
        code,
        name: productName,
        units: [{
          unit_level: 'CARTON',
          unit_mark: edits?.unit_mark || '',
          stock_current: parseFloat(edits?.stock_current) || 0,
          sale_price_usd: parseFloat(edits?.sale_price_usd) || 0,
          sale_price_fc: parseFloat(edits?.sale_price_fc) || calculateFC(parseFloat(edits?.sale_price_usd) || 0),
          purchase_price_usd: parseFloat(edits?.purchase_price_usd) || 0,
        }]
      });
    }
  }, [products, calculateFC]);

  // Mettre à jour un produit
  const handleUpdateProduct = useCallback(async (row, edits) => {
    if (row.is_empty) return;
    
    const unitUpdates = {};
    let productNameUpdate;
    
    if (edits.sale_price_usd !== undefined) {
      unitUpdates.sale_price_usd = parseFloat(edits.sale_price_usd) || 0;
      unitUpdates.sale_price_fc = calculateFC(unitUpdates.sale_price_usd);
    }
    if (edits.sale_price_fc !== undefined) {
      unitUpdates.sale_price_fc = parseFloat(edits.sale_price_fc) || 0;
      unitUpdates.sale_price_usd = calculateUSD(unitUpdates.sale_price_fc);
    }
    if (edits.stock_current !== undefined) unitUpdates.stock_current = parseFloat(edits.stock_current) || 0;
    if (edits.unit_mark !== undefined) unitUpdates.unit_mark = edits.unit_mark;
    if (edits.product_name !== undefined) productNameUpdate = edits.product_name;
    
    // Récupérer le produit actuel pour préserver les autres unités
    try {
      const productResponse = await axios.get(`${API_URL}/api/products/${row.product_code}`);
      const currentProduct = productResponse.data;
      
      // Mettre à jour l'unité spécifique
      const updatedUnits = (currentProduct.units || []).map(u => {
        if (u.id === row.unit_id) {
          return { ...u, ...unitUpdates };
        }
        return u;
      });
      
      // Mettre à jour via l'API - séparer product name des unit updates
      await axios.put(`${API_URL}/api/products/${row.product_code}`, {
        name: productNameUpdate ?? currentProduct.name,
        units: updatedUnits
      });
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur mise à jour produit:', error);
      }
      throw error;
    }
  }, [calculateFC, calculateUSD]);

  // Sauvegarder les changements en attente (défini avant scheduleSave)
  const savePendingChanges = useCallback(async () => {
    const toSave = Array.from(pendingSavesRef.current.keys());
    if (toSave.length === 0) return;
    
    setSaving(true);
    setSaveMessage({ type: 'info', text: 'Sauvegarde en cours...' });
    
    try {
      const promises = toSave.map(rowId => {
        const row = tableData.find(r => r.id === rowId);
        const edits = editingValues[rowId];
        if (!row || !edits) return Promise.resolve();
        
        // Si c'est une ligne vide, créer le produit
        if (row.is_empty) {
          return handleCreateProduct(row, edits).catch(err => {
            if (IS_DEV) {
              console.error(`Erreur création produit ${rowId}:`, err);
            }
            throw err;
          });
        }
        
        // Sinon, mettre à jour
        return handleUpdateProduct(row, edits).catch(err => {
          if (IS_DEV) {
            console.error(`Erreur mise à jour produit ${rowId}:`, err);
          }
          throw err;
        });
      });
      
      await Promise.all(promises);
      
      setSaveMessage({ type: 'success', text: 'Sauvegarde réussie' });
      pendingSavesRef.current.clear();
      
      // Recharger les produits
      await loadProducts();
      
      // Effacer le message après 2 secondes
      setTimeout(() => {
        setSaveMessage({ type: '', text: '' });
      }, 2000);
    } catch (error) {
      if (IS_DEV) {
        console.error('Erreur sauvegarde:', error);
      }
      setSaveMessage({ type: 'error', text: 'Erreur lors de la sauvegarde' });
    } finally {
      setSaving(false);
    }
  }, [tableData, editingValues, loadProducts, handleCreateProduct, handleUpdateProduct]);

  // Programmer la sauvegarde avec debounce
  const scheduleSave = useCallback((rowId) => {
    // Annuler le timeout précédent
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Marquer comme à sauvegarder
    pendingSavesRef.current.set(rowId, true);
    
    // Programmer la sauvegarde après 3 secondes
    saveTimeoutRef.current = setTimeout(() => {
      savePendingChanges();
    }, 3000);
  }, [savePendingChanges]);

  // Démarrer l'édition d'une cellule
  const startEdit = useCallback((rowId, field, currentValue) => {
    if (!rowId || !field) return;
    
    try {
      setEditingCell({ rowId, field });
      setFocusedField(`${rowId}-${field}`);
      setEditingValues(prev => ({
        ...prev,
        [rowId]: {
          ...(prev[rowId] || {}),
          [field]: currentValue ?? ''
        }
      }));
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
    'stock_current'
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
          [field]: value
        }
      };
      
      // Génération automatique de code pour CARTON uniquement
      if (field === 'product_name' && row?.is_empty && row?.unit_level === 'CARTON' && value?.trim()) {
        const autoCode = generateAutoCode('CARTON');
        if (autoCode && !newValues[rowId].product_code) {
          newValues[rowId].product_code = autoCode;
        }
      }
      
      // Si on modifie FC, calculer USD en temps réel
      if (field === 'sale_price_fc') {
        const fc = parseFloat(value) || 0;
        newValues[rowId].sale_price_usd = calculateUSD(fc);
      }
      // Si on modifie USD, calculer FC en temps réel
      else if (field === 'sale_price_usd') {
        const usd = parseFloat(value) || 0;
        newValues[rowId].sale_price_fc = calculateFC(usd);
      }
      
      return newValues;
    });
    
    // Autosave uniquement sur champs numériques pour éviter re-renders pendant la saisie
    if (AUTO_SAVE_FIELDS.has(field)) {
      scheduleSave(rowId);
    } else {
      // Marquer comme modifié sans reload agressif pendant la saisie
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
  const getCellValue = (row, field) => {
    if (!row) return '';
    if (editingCell?.rowId === row.id && editingCell?.field === field) {
      return editingValues[row.id]?.[field] ?? row[field] ?? '';
    }
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
          await axios.post(`${PRINT_API_URL}/jobs`, job);
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
      
      await axios.post(`${PRINT_API_URL}/jobs`, job);
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
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Produits</h1>
          <p className="text-gray-400">
            {initialLoading ? 'Chargement...' : `${productCount} produit(s)`} • Taux: {currentRate || 2800} FC/USD
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

      {/* Message de sauvegarde */}
      {saveMessage.text && (
        <div
          className={`card flex items-center gap-2 ${
            saveMessage.type === 'success'
              ? 'bg-green-500/20 border-green-500/30'
              : saveMessage.type === 'error'
              ? 'bg-red-500/20 border-red-500/30'
              : 'bg-blue-500/20 border-blue-500/30'
          }`}
        >
          {saveMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          ) : saveMessage.type === 'error' ? (
            <XCircle className="w-5 h-5 text-red-400" />
          ) : (
            <TrendingUp className="w-5 h-5 text-blue-400" />
          )}
          <span className={`text-sm ${
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
                        <td colSpan={8} className="px-4 py-2">
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
                      
                      return (
                        <tr
                          key={row.id || `row-${index}`}
                          className={`group ${
                            row.is_empty ? 'opacity-30' : 'hover:bg-dark-700/50'
                          } ${
                            isEditingThisRow
                              ? 'bg-primary-500/10 border-l-2 border-primary-500/50' 
                              : ''
                          } transition-colors`}
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
                                  scheduleSave(row.id); // ✅ save au blur pour product_name
                                }
                                setEditingCell(null);
                                setFocusedField(null);
                              }, 50);
                            }}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                if (row?.id) {
                                  scheduleSave(row.id);
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
                              startEdit(row.id, 'product_name', row?.product_name || '');
                            }
                          }}
                          className={`cursor-pointer ${
                            row?.is_empty 
                              ? 'text-gray-500 hover:text-gray-400' 
                              : 'text-gray-200 group-hover:text-gray-100 group-hover:font-semibold'
                          }`}
                        >
                          {row?.product_name || (
                            <span className="text-gray-500 italic">Nouveau produit...</span>
                          )}
                        </div>
                      )}
                      {!row?.is_empty && (
                        <div className="text-xs text-gray-500 group-hover:text-gray-400">
                          ({row?.product_code || editingValues[row?.id]?.product_code || '...'})
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
                              scheduleSave(row.id); // ✅ save au blur pour unit_level
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
                            onBlur={() => {
                              setTimeout(() => {
                                if (row?.id) {
                                  scheduleSave(row.id); // ✅ save au blur pour unit_mark
                                }
                                setEditingCell(null);
                                setFocusedField(null);
                              }, 50);
                            }}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                if (row?.id) {
                                  scheduleSave(row.id);
                                }
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
                              startEdit(row.id, 'unit_mark', row?.unit_mark || '');
                            }
                          }}
                          className="cursor-pointer text-gray-200 group-hover:text-primary-300 group-hover:font-semibold group-hover:px-2 group-hover:py-1 group-hover:bg-primary-500/20 group-hover:rounded hover:text-primary-400"
                        >
                          {row?.unit_mark || '—'}
                        </span>
                      )}
                    </td>

                    {/* Prix vente FC */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === row?.id && editingCell?.field === 'sale_price_fc' ? (
                        <input
                          type="number"
                          value={getCellValue(row, 'sale_price_fc') || ''}
                          onChange={(e) => {
                            if (row?.id) {
                              updateEditValue(row.id, 'sale_price_fc', e.target.value);
                            }
                          }}
                          onBlur={() => {
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
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
                          {(row?.sale_price_fc || 0).toLocaleString('fr-FR')} FC
                        </span>
                      )}
                    </td>

                    {/* Prix vente USD */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === row?.id && editingCell?.field === 'sale_price_usd' ? (
                        <input
                          type="number"
                          step="0.01"
                          value={getCellValue(row, 'sale_price_usd') || ''}
                          onChange={(e) => {
                            if (row?.id) {
                              updateEditValue(row.id, 'sale_price_usd', e.target.value);
                            }
                          }}
                          onBlur={() => {
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
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
                          ${(row?.sale_price_usd || 0).toFixed(2)}
                        </span>
                      )}
                    </td>

                    {/* Prix achat USD */}
                    <td className="px-4 py-3 text-right">
                      {editingCell?.rowId === row?.id && editingCell?.field === 'purchase_price_usd' ? (
                        <input
                          type="number"
                          step="0.01"
                          value={getCellValue(row, 'purchase_price_usd') || ''}
                          onChange={(e) => {
                            if (row?.id) {
                              updateEditValue(row.id, 'purchase_price_usd', e.target.value);
                            }
                          }}
                          onBlur={() => {
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
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
                          value={getCellValue(row, 'stock_current') || ''}
                          onChange={(e) => {
                            if (row?.id) {
                              updateEditValue(row.id, 'stock_current', e.target.value);
                            }
                          }}
                          onBlur={() => {
                            setEditingCell(null);
                            setFocusedField(null);
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
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
                          <td colSpan={8} className="px-4 py-2 text-center text-gray-500 text-sm">
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
