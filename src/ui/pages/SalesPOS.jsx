import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
} from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

// Debounce hook pour performance
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const SalesPOS = () => {
  const {
    products,
    currentRate,
    loadProducts,
    loadCurrentRate,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [selectedProductUnits, setSelectedProductUnits] = useState([]);
  const [activeSaleIndex, setActiveSaleIndex] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [quickQty, setQuickQty] = useState(1);
  const [quickPrice, setQuickPrice] = useState(null);
  const [sales, setSales] = useState([
    {
      id: Date.now(),
      clientName: '',
      clientPhone: '',
      clientAddress: '',
      clientEmail: '',
      isNewClient: false,
      items: [],
      currency: 'FC',
      isDebt: false,
    }
  ]);
  const [processing, setProcessing] = useState(false);
  const searchInputRef = useRef(null);
  const qtyInputRef = useRef(null);
  const clientNameInputRef = useRef(null);
  
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

  // Obtenir la vente active (doit être défini avant les useEffect qui l'utilisent)
  const activeSale = sales[activeSaleIndex];

  useEffect(() => {
    loadProducts();
    loadCurrentRate(); // Charger le taux depuis l'API
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [loadProducts, loadCurrentRate]);

  // Auto-focus sur quantité quand un produit est sélectionné
  useEffect(() => {
    if (selectedProduct && selectedUnit && qtyInputRef.current) {
      setTimeout(() => {
        qtyInputRef.current?.focus();
        qtyInputRef.current?.select();
      }, 100);
    }
  }, [selectedProduct, selectedUnit]);

  // Réinitialiser les suggestions client quand on change de vente
  useEffect(() => {
    if (activeSale && activeSale.clientName) {
      setShowClientSuggestions(false);
    }
  }, [activeSaleIndex, activeSale]);

  // Réinitialiser la sélection quand on change de produit ou recherche
  useEffect(() => {
    if (searchQuery.trim()) {
      setSelectedProduct(null);
      setSelectedUnit(null);
      setQuickPrice(null);
      setQuickQty(1);
    }
  }, [searchQuery]);

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

  // Filtrer les produits selon la recherche
  const filteredProducts = useMemo(() => {
    if (!debouncedSearch.trim()) {
      setSelectedProductUnits([]);
      return [];
    }
    
    const query = debouncedSearch.toLowerCase();
    const filtered = productsWithUnits.filter(product => 
      product.name.toLowerCase().includes(query) ||
      product.code.toLowerCase().includes(query)
    );

    // Toujours réinitialiser les unités sélectionnées
    setSelectedProductUnits([]);

    return filtered;
  }, [productsWithUnits, debouncedSearch]);

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

  // Ajouter un item à la vente active
  const addItemToSale = useCallback((product, unit, qty, customPriceFC = null, customPriceUSD = null) => {
    const priceFC = customPriceFC !== null ? customPriceFC : unit.sale_price_fc;
    const priceUSD = customPriceUSD !== null ? customPriceUSD : unit.sale_price_usd;
    
    const newSales = [...sales];
    const sale = newSales[activeSaleIndex];
    
    const existingItemIndex = sale.items.findIndex(
      item => item.product_code === product.code &&
      item.unit_level === unit.unit_level &&
      item.unit_mark === (unit.unit_mark || '')
    );

    if (existingItemIndex >= 0) {
      // Mettre à jour la quantité si le produit existe déjà
      sale.items[existingItemIndex].qty += qty;
      sale.items[existingItemIndex].subtotal_fc = sale.items[existingItemIndex].unit_price_fc * sale.items[existingItemIndex].qty;
      sale.items[existingItemIndex].subtotal_usd = sale.items[existingItemIndex].unit_price_usd * sale.items[existingItemIndex].qty;
    } else {
      // Ajouter un nouvel item
      sale.items.push({
        product_id: product.id,
        product_code: product.code,
        product_name: product.name,
        unit_level: unit.unit_level,
        unit_mark: unit.unit_mark || '',
        qty,
        qty_label: qty.toString(),
        unit_price_fc: priceFC,
        unit_price_usd: priceUSD,
        subtotal_fc: priceFC * qty,
        subtotal_usd: priceUSD * qty,
        qty_step: unit.qty_step || 1,
      });
    }

    setSales(newSales);
    setSearchQuery('');
    setSelectedProductUnits([]);
    // Réinitialiser la sélection du produit après ajout
    setSelectedProduct(null);
    setSelectedUnit(null);
    setQuickPrice(null);
    setQuickQty(1);
    // Focus sur la recherche pour le prochain produit
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 100);
  }, [sales, activeSaleIndex]);

  // Retirer un item de la vente
  const removeItemFromSale = useCallback((itemIndex) => {
    const newSales = [...sales];
    newSales[activeSaleIndex].items.splice(itemIndex, 1);
    setSales(newSales);
  }, [activeSaleIndex]);

  // Mettre à jour la quantité d'un item
  const updateItemQty = useCallback((itemIndex, newQty) => {
    const newSales = [...sales];
    const item = newSales[activeSaleIndex].items[itemIndex];
    item.qty = Math.max(item.qty_step, newQty);
    item.subtotal_fc = item.unit_price_fc * item.qty;
    item.subtotal_usd = item.unit_price_usd * item.qty;
    setSales(newSales);
  }, [activeSaleIndex]);

  // Mettre à jour le prix d'un item
  const updateItemPrice = useCallback((itemIndex, newPrice, currency) => {
    const newSales = [...sales];
    const item = newSales[activeSaleIndex].items[itemIndex];
    if (currency === 'FC') {
      item.unit_price_fc = newPrice;
      item.unit_price_usd = newPrice / currentRate;
    } else {
      item.unit_price_usd = newPrice;
      item.unit_price_fc = newPrice * currentRate;
    }
    item.subtotal_fc = item.unit_price_fc * item.qty;
    item.subtotal_usd = item.unit_price_usd * item.qty;
    setSales(newSales);
  }, [activeSaleIndex, currentRate]);

  // Calculer les totaux de la vente active
  const activeSaleTotals = useMemo(() => {
    if (!activeSale || !activeSale.items || activeSale.items.length === 0) {
      return { fc: 0, usd: 0 };
    }
    const totalFC = activeSale.items.reduce((sum, item) => sum + (item.subtotal_fc || 0), 0);
    const totalUSD = activeSale.items.reduce((sum, item) => sum + (item.subtotal_usd || 0), 0);
    return { fc: totalFC, usd: totalUSD };
  }, [activeSale?.items]);

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
    const sale = sales[saleIndex];
    if (sale.items.length === 0) {
      alert('Le panier est vide');
      return;
    }

    // Vérifier le nom du client (obligatoire)
    if (!sale.clientName || sale.clientName.trim() === '') {
      alert('Le nom du client est obligatoire');
      if (clientNameInputRef.current) {
        clientNameInputRef.current.focus();
        clientNameInputRef.current.select();
      }
      return;
    }

    // Sauvegarder le nom dans l'historique
    saveClientName(sale.clientName);

    setProcessing(true);
    try {
      // Générer numéro de facture
      const { generateSequentialInvoiceNumber } = await import('../../core/invoice.js');
      const { getDb } = await import('../../db/sqlite.js');
      const db = getDb();
      const invoiceNumber = generateSequentialInvoiceNumber(db);

    const saleData = {
      invoice_number: invoiceNumber,
      sold_at: new Date().toISOString(),
        client_name: sale.clientName || null,
        client_phone: sale.clientPhone || null,
        client_address: sale.clientAddress || null,
        client_email: sale.clientEmail || null,
      seller_name: useStore.getState().user?.username || 'System',
        total_fc: activeSaleTotals.fc,
        total_usd: activeSaleTotals.usd,
      rate_fc_per_usd: currentRate,
        payment_mode: sale.isDebt ? 'dette' : 'cash',
        paid_fc: sale.isDebt ? 0 : activeSaleTotals.fc,
        paid_usd: sale.isDebt ? 0 : activeSaleTotals.usd,
        status: sale.isDebt ? 'unpaid' : 'paid',
        items: sale.items,
        printCurrency: sale.currency,
        autoDette: sale.isDebt,
      };

      const response = await axios.post(`${API_URL}/api/sales`, saleData);

      if (response.data.success) {
        // Impression automatique
        try {
          await axios.post(`${API_URL}/api/sales/${invoiceNumber}/print`, {
            template: 'receipt-80',
            currency: sale.currency,
            autoDette: sale.isDebt,
          });
        } catch (error) {
          console.error('Erreur impression:', error);
        }

        // Si dette, créer automatiquement
        if (sale.isDebt) {
          try {
            await axios.post(`${API_URL}/api/debts`, {
              invoice_number: invoiceNumber,
              client_name: sale.clientName || 'Client',
              client_phone: '',
              total_fc: activeSaleTotals.fc,
              total_usd: activeSaleTotals.usd,
              items: sale.items.map(item => ({
                product_code: item.product_code,
                product_name: item.product_name,
                qty: item.qty,
                unit_price_fc: item.unit_price_fc,
                total_fc: item.subtotal_fc,
              })),
            });
          } catch (error) {
            console.error('Erreur création dette:', error);
          }
        }

        // Réinitialiser la vente
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
        };
        setSales(newSales);
        if (saleIndex === activeSaleIndex) {
          setSearchQuery('');
          if (searchInputRef.current) {
            searchInputRef.current.focus();
          }
        }
      }
    } catch (error) {
      console.error('Erreur finalisation:', error);
      alert('Erreur lors de la finalisation de la vente');
    } finally {
      setProcessing(false);
    }
  };

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
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-1">Point de Vente</h1>
          <p className="text-gray-400">Ventes rapides et professionnelles</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="glass px-4 py-2 rounded-lg">
            <span className="text-sm text-gray-400">Taux: </span>
            <span className="font-semibold text-primary-400">{currentRate || 0} FC/USD</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Onglets des clients - En haut de la page */}
        <div className="card">
          <div className="flex gap-3 overflow-x-auto pb-2">
            {/* Bouton Nouveau client */}
            <motion.button
              whileHover={{ scale: 1.08, y: -2 }}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
              style={{ 
                willChange: 'transform',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'translateZ(0)'
              }}
              onClick={addNewSale}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2 glass text-gray-300 hover:bg-white/10 border border-white/10 relative z-10"
            >
              <User className="w-4 h-4" />
              <Plus className="w-3 h-3" />
              Nouveau client
            </motion.button>

            {/* Onglets des clients */}
            {sales.map((sale, index) => {
              // Calculer le total FC pour ce client
              const clientTotal = sale.items.reduce((sum, item) => sum + (item.subtotal_fc || 0), 0);
              // Nom du client ou "Client X" si vide
              const clientDisplayName = sale.clientName && sale.clientName.trim() 
                ? (sale.clientName.length > 20 ? sale.clientName.substring(0, 20) + '...' : sale.clientName)
                : `Client ${index + 1}`;
              
              return (
                <motion.button
                  key={sale.id}
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
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2 relative ${
                    index === activeSaleIndex
                      ? 'bg-primary-500 text-white shadow-lg border-2 border-cyan-400'
                      : 'glass text-gray-300 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  <span className="font-semibold">{clientDisplayName}</span>
                  <span className={`text-xs ${index === activeSaleIndex ? 'opacity-90' : 'opacity-70'}`}>
                    {clientTotal.toLocaleString()} FC
                  </span>
                  {sale.items.length > 0 && (
                    <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${
                      index === activeSaleIndex
                        ? 'bg-white/30'
                        : 'bg-white/20'
                    }`}>
                      {sale.items.length}
                    </span>
                  )}
                  {index !== activeSaleIndex && sales.length > 1 && (
                    <motion.button
                      whileHover={{ scale: 1.3, rotate: 90 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                      style={{ 
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden'
                      }}
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
                      <X className="w-3 h-3" />
                    </motion.button>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Recherche - Pleine largeur en haut avec animation inverse */}
        <motion.div 
          className="card"
          animate={{
            scale: focusedField === 'search' ? 1 : focusedField ? 0.95 : 1,
            opacity: focusedField === 'search' ? 1 : focusedField ? 0.7 : 1
          }}
          transition={{ duration: 0.1, ease: 'easeOut' }}
        >
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Rechercher :
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setFocusedField('search')}
              onBlur={() => setFocusedField(null)}
              placeholder="Code ou Nom..."
              className="input-field pl-10 w-full"
              autoFocus
            />
          </div>
        </motion.div>

        {/* Résultats de recherche avec unités directement affichées */}
        {debouncedSearch.trim() && (
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">
              Résultats de recherche
            </h3>
            
            {filteredProducts.length > 0 ? (
              // Afficher chaque produit avec ses unités directement sur une ligne
              <div className="space-y-3">
                {filteredProducts.map((product) => (
                  <ProductWithUnitsRow
                    key={product.code || product.id}
                    product={product}
                    onAdd={addItemToSale}
                    onSelect={(product, unit) => {
                      setSelectedProduct(product);
                      setSelectedUnit(unit);
                      setQuickPrice(null);
                      setQuickQty(unit.qty_step || 1);
                      setSearchQuery('');
                    }}
                    getUnitLabel={getUnitLabel}
                    currency={activeSale.currency}
                    currentRate={currentRate}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Aucun produit trouvé</p>
              </div>
            )}
          </div>
        )}

        {/* Layout côte à côte: Panier à gauche, Formulaire produit à droite */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Colonne gauche - Panier (2/3 de la largeur) */}
          <div className="lg:col-span-2">
            {/* Section client - Toujours visible au-dessus du panier */}
            <div className="card mb-4">
                {/* Informations client - Toujours visible au-dessus du panier avec animation inverse */}
                <motion.div 
                  className="mb-4 pb-4 border-b border-white/10"
                  animate={{
                    scale: focusedField === 'client' ? 1 : focusedField ? 0.95 : 1,
                    opacity: focusedField === 'client' ? 1 : focusedField ? 0.7 : 1
                  }}
                  transition={{ duration: 0.1, ease: 'easeOut' }}
                >
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-300 mb-2">
                        Nom du client :
                      </label>
                      <div className="relative">
                        <input
                          ref={clientNameInputRef}
                          type="text"
                          value={activeSale.clientName || ''}
                          onChange={(e) => {
                            const newSales = [...sales];
                            newSales[activeSaleIndex].clientName = e.target.value;
                            setSales(newSales);
                            setShowClientSuggestions(e.target.value.length > 0);
                          }}
                          onFocus={() => {
                            setFocusedField('client');
                            setShowClientSuggestions((activeSale.clientName && activeSale.clientName.length > 0) || clientNamesHistory.length > 0);
                          }}
                          onBlur={() => setFocusedField(null)}
                          placeholder="Nom du client"
                          className="input-field w-full text-sm"
                          list="client-names-list"
                        />
                        {showClientSuggestions && clientNamesHistory.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 glass rounded-lg border border-white/10 max-h-40 overflow-y-auto">
                            {clientNamesHistory
                              .filter(name => 
                                !activeSale.clientName || 
                                name.toLowerCase().includes(activeSale.clientName.toLowerCase())
                              )
                              .slice(0, 10)
                              .map((name, index) => (
                                <button
                                  key={index}
                                  onClick={() => {
                                    const newSales = [...sales];
                                    newSales[activeSaleIndex].clientName = name;
                                    setSales(newSales);
                                    setShowClientSuggestions(false);
                                  }}
                                  className="w-full text-left px-4 py-2 hover:bg-white/10 text-gray-200 text-sm"
                                >
                                  {name}
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-gray-300 mb-2">
                          Mode de paiement :
                        </label>
                        <div className="flex gap-2">
                      <motion.button
                        whileHover={{ scale: 1.1, y: -2 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                        style={{ 
                          willChange: 'transform',
                          backfaceVisibility: 'hidden',
                          WebkitBackfaceVisibility: 'hidden',
                          transform: 'translateZ(0)'
                        }}
                        onClick={() => {
                          const newSales = [...sales];
                          newSales[activeSaleIndex].isDebt = false;
                          setSales(newSales);
                        }}
                        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all relative z-10 ${
                          !activeSale.isDebt
                            ? 'bg-green-500/30 border-2 border-green-500/50 text-green-300 shadow-lg'
                            : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                        }`}
                      >
                        💵 Payant
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.1, y: -2 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                        style={{ 
                          willChange: 'transform',
                          backfaceVisibility: 'hidden',
                          WebkitBackfaceVisibility: 'hidden',
                          transform: 'translateZ(0)'
                        }}
                        onClick={() => {
                          const newSales = [...sales];
                          newSales[activeSaleIndex].isDebt = true;
                          setSales(newSales);
                        }}
                        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all relative z-10 ${
                          activeSale.isDebt
                            ? 'bg-orange-500/30 border-2 border-orange-500/50 text-orange-300 shadow-lg'
                            : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                        }`}
                      >
                        📋 Dette
                      </motion.button>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <label className="block text-xs font-semibold text-gray-300 mb-2">
                          Devise :
                        </label>
                        <div className="flex gap-2">
                      <motion.button
                        whileHover={{ scale: 1.15, y: -2 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                        style={{ 
                          willChange: 'transform',
                          backfaceVisibility: 'hidden',
                          WebkitBackfaceVisibility: 'hidden',
                          transform: 'translateZ(0)'
                        }}
                        onClick={() => {
                          const newSales = [...sales];
                          newSales[activeSaleIndex].currency = 'FC';
                          setSales(newSales);
                        }}
                        className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all relative z-10 ${
                          activeSale.currency === 'FC'
                            ? 'bg-blue-500/30 border-2 border-blue-500/50 text-blue-300 shadow-lg'
                            : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                        }`}
                      >
                        FC
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.15, y: -2 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                        style={{ 
                          willChange: 'transform',
                          backfaceVisibility: 'hidden',
                          WebkitBackfaceVisibility: 'hidden',
                          transform: 'translateZ(0)'
                        }}
                        onClick={() => {
                          const newSales = [...sales];
                          newSales[activeSaleIndex].currency = 'USD';
                          setSales(newSales);
                        }}
                        className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all relative z-10 ${
                          activeSale.currency === 'USD'
                            ? 'bg-green-500/30 border-2 border-green-500/50 text-green-300 shadow-lg'
                            : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                        }`}
                      >
                        USD
                      </motion.button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
            </div>

            <div className="card">
            {/* En-tête du panier avec bouton collapsible */}
            <div className="flex items-center justify-between mb-4">
              <motion.button
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ 
                  willChange: 'transform',
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'translateZ(0)',
                  zIndex: 10
                }}
                onClick={() => setIsCartExpanded(!isCartExpanded)}
                className="flex items-center gap-3 px-4 py-3 glass rounded-lg border-2 border-primary-500/30 hover:border-primary-500/50 transition-all flex-1 group shadow-md"
              >
                <div className="relative">
                  <ShoppingCart className="w-6 h-6 text-primary-400" />
                  {activeSale.items.length > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {activeSale.items.length}
                    </span>
                  )}
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-100">
                      Panier {activeSale && activeSale.items && activeSale.items.length > 0 ? `(${activeSale.items.length})` : ''}
                    </h3>
                    {isCartExpanded ? (
                      <ChevronUp className="w-5 h-5 text-gray-400 group-hover:text-primary-400 transition-colors" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-primary-400 transition-colors" />
                    )}
                  </div>
                  {activeSale && activeSale.items && activeSale.items.length > 0 && (
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-sm font-bold text-primary-400">
                        {activeSaleTotals.fc.toLocaleString()} FC
                      </span>
                      <span className="text-xs text-gray-400">•</span>
                      <span className="text-sm font-bold text-green-400">
                        ${activeSaleTotals.usd.toFixed(2)} USD
                      </span>
                    </div>
                  )}
                </div>
              </motion.button>
            </div>

            {/* Contenu du panier (collapsible) avec animation fluide et rapide */}
            <AnimatePresence>
              {isCartExpanded && (
                <motion.div
                  key="cart-content"
                  initial="collapsed"
                  animate="open"
                  exit="collapsed"
                  variants={{
                    open: { 
                      opacity: 1, 
                      height: 'auto',
                      transition: { 
                        duration: 0.2,
                        ease: [0.25, 0.1, 0.25, 1],
                        opacity: { duration: 0.15 }
                      }
                    },
                    collapsed: { 
                      opacity: 0, 
                      height: 0,
                      transition: { 
                        duration: 0.2,
                        ease: [0.25, 0.1, 0.25, 1],
                        opacity: { duration: 0.15 }
                      }
                    }
                  }}
                  style={{ overflow: 'hidden' }}
                  className="space-y-4"
                >
                {/* Panier de la vente active */}
                <div className="space-y-3">
                  {/* Items du panier - Design pro compact avec overflow corrigé */}
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 py-1" style={{ overflowX: 'visible' }}>
                    {!activeSale.items || activeSale.items.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <ShoppingCart className="w-16 h-16 mx-auto mb-3 opacity-30" />
                        <p className="text-lg font-medium">Panier vide</p>
                        <p className="text-sm mt-2">Sélectionnez un produit pour commencer</p>
                      </div>
                    ) : (
                      <>
                        {/* En-tête du tableau professionnel */}
                        <div className="grid grid-cols-12 gap-3 px-3 py-3 text-xs font-bold text-gray-300 border-b-2 border-primary-500/40 mb-3 bg-gradient-to-r from-primary-500/10 to-primary-600/5 rounded-t-lg">
                          <div className="col-span-4 flex items-center gap-2">
                            <Package className="w-4 h-4 text-primary-400" />
                            <span>Produit</span>
                          </div>
                          <div className="col-span-2 text-center">Quantité</div>
                          <div className="col-span-2 text-right">Prix unitaire</div>
                          <div className="col-span-3 text-right">Total</div>
                          <div className="col-span-1 text-center">Action</div>
                        </div>
                        
                        {/* Items compacts avec animation inverse */}
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
                      </>
                    )}
                  </div>

                </div>
              </motion.div>
              )}
            </AnimatePresence>

            {/* Bouton Finaliser - Toujours visible même quand le panier est fermé - Compact et pro */}
            {activeSale && activeSale.items && activeSale.items.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 p-3 glass rounded-lg border-2 border-primary-500/30 bg-gradient-to-br from-primary-500/10 to-primary-500/5"
              >
                {/* Résumé compact */}
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-primary-500/30">
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">Total à payer</p>
                    <p className="text-xl font-bold text-primary-400">
                      {activeSale.currency === 'USD'
                        ? `$${activeSaleTotals.usd.toFixed(2)}`
                        : `${activeSaleTotals.fc.toLocaleString()} FC`}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Équiv: {activeSale.currency === 'USD'
                        ? `${activeSaleTotals.fc.toLocaleString()} FC`
                        : `$${activeSaleTotals.usd.toFixed(2)} USD`}
                    </p>
                  </div>
                </div>

                {/* Bouton finalisation - Compact et pro avec animation fluide */}
                <motion.button
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                  style={{ 
                    willChange: 'transform',
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'translateZ(0)',
                    zIndex: 10
                  }}
                  onClick={() => finalizeSale(activeSaleIndex)}
                  disabled={processing}
                  className="w-full py-2.5 text-sm font-bold relative overflow-hidden shadow-lg hover:shadow-xl transition-all bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-lg group"
                >
                  {processing ? (
                    <span className="flex items-center justify-center gap-2 text-sm">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Check className="w-4 h-4" />
                      </motion.div>
                      Traitement...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2 relative z-10 text-sm">
                      <FileText className="w-4 h-4" />
                      Finaliser et imprimer
                    </span>
                  )}
                  {/* Effet de brillance animé */}
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                    animate={{
                      x: ['-100%', '100%'],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      repeatDelay: 1,
                    }}
                  />
                </motion.button>
              </motion.div>
            )}
          </div>
          </div>

          {/* Colonne droite - Formulaire de sélection du produit (1/3 de la largeur) */}
          <div className="lg:col-span-1">
            {/* Formulaire d'ajout rapide - Layout professionnel amélioré - Compact et pro */}
            <div className="card sticky top-4">
              <label className="block text-xs font-semibold text-gray-300 mb-2">
                Sélection du Produit
              </label>
              <select
                value={selectedProduct?.code || ''}
                onChange={(e) => {
                  const product = productsWithUnits.find(p => p.code === e.target.value);
                  setSelectedProduct(product || null);
                  if (product && product.units.length > 0) {
                    setSelectedUnit(product.units[0]);
                    setQuickPrice(null);
                    setQuickQty(product.units[0].qty_step || 1);
                  } else {
                    setSelectedUnit(null);
                  }
                }}
                className="input-field w-full text-xs mb-3"
              >
                <option value="">-- Rechercher et sélectionner --</option>
                {productsWithUnits.map((product) => (
                  <option key={product.code} value={product.code}>
                    {product.name} ({product.code})
                  </option>
                ))}
              </select>

              {selectedProduct && selectedUnit ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 glass rounded-lg border-2 border-primary-500/30 bg-gradient-to-br from-primary-500/5 to-transparent"
                >
                  {/* En-tête du produit sélectionné - Compact */}
                  <div className="mb-3 pb-2 border-b border-white/10">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-gray-100 mb-0.5 truncate">
                          {selectedProduct.name}
                        </h3>
                        <p className="text-xs text-gray-400">Code: {selectedProduct.code}</p>
                      </div>
                      <div className="text-right ml-2">
                        <p className="text-xs text-gray-400 mb-0.5">Stock</p>
                        <p className="text-xs font-bold text-primary-400">
                          {selectedUnit.stock_current.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Champs organisés verticalement pour espace compact */}
                  <div className="space-y-2.5">
                    {/* Unité */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 mb-2">
                        Unité de vente
                      </label>
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
                            setQuickQty(unit.qty_step || 1);
                          }
                        }}
                        className="input-field w-full text-sm"
                      >
                        {selectedProduct.units.map((unit, idx) => (
                          <option key={idx} value={`${unit.unit_level}-${unit.unit_mark || ''}`}>
                            {getUnitLabel(unit.unit_level)} {unit.unit_mark ? `[${unit.unit_mark}]` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Quantité */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 mb-2">
                        Quantité
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setQuickQty(Math.max(selectedUnit.qty_step || 1, quickQty - (selectedUnit.qty_step || 1)))}
                          className="p-2 glass rounded hover:bg-white/10 transition-colors"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          value={quickQty}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || (selectedUnit.qty_step || 1);
                            setQuickQty(Math.max(selectedUnit.qty_step || 1, val));
                          }}
                          step={selectedUnit.qty_step || 1}
                          min={selectedUnit.qty_step || 1}
                          className="input-field text-sm flex-1 text-center font-semibold"
                          ref={qtyInputRef}
                        />
                        <button
                          onClick={() => setQuickQty(quickQty + (selectedUnit.qty_step || 1))}
                          className="p-2 glass rounded hover:bg-white/10 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Prix unitaire */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 mb-2">
                        Prix unitaire ({activeSale.currency})
                        <span className="text-gray-500 text-xs ml-1">(dbl-clic)</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={quickPrice !== null ? quickPrice : (activeSale.currency === 'USD' ? selectedUnit.sale_price_usd : selectedUnit.sale_price_fc)}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setQuickPrice(isNaN(val) ? null : val);
                          }}
                          onDoubleClick={() => setQuickPrice(null)}
                          className="input-field text-sm flex-1 font-semibold"
                          placeholder={activeSale.currency === 'USD' ? selectedUnit.sale_price_usd.toFixed(2) : selectedUnit.sale_price_fc.toLocaleString()}
                        />
                        <button
                          onClick={() => setQuickPrice(null)}
                          className="px-3 py-2 glass rounded text-xs text-gray-300 hover:bg-white/10 transition-colors"
                          title="Réinitialiser"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Défaut: {activeSale.currency === 'USD' 
                          ? `$${selectedUnit.sale_price_usd.toFixed(2)}` 
                          : `${selectedUnit.sale_price_fc.toLocaleString()} FC`}
                      </p>
                    </div>

                    {/* Prix total - Compact */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                        Prix total ({activeSale.currency})
                      </label>
                      <div className="p-2 glass rounded-lg border border-primary-500/30 bg-primary-500/10">
                        <p className="text-lg font-bold text-primary-400 text-center">
                          {(() => {
                            const price = quickPrice !== null ? quickPrice : (activeSale.currency === 'USD' ? selectedUnit.sale_price_usd : selectedUnit.sale_price_fc);
                            const total = price * quickQty;
                            return activeSale.currency === 'USD' ? `$${total.toFixed(2)}` : `${total.toLocaleString()} FC`;
                          })()}
                        </p>
                        <p className="text-xs text-gray-400 text-center mt-0.5">
                          Équiv: {(() => {
                            const price = quickPrice !== null ? quickPrice : (activeSale.currency === 'USD' ? selectedUnit.sale_price_usd : selectedUnit.sale_price_fc);
                            const total = price * quickQty;
                            const equivalent = activeSale.currency === 'USD' 
                              ? total * currentRate 
                              : total / currentRate;
                            return activeSale.currency === 'USD' 
                              ? `${equivalent.toLocaleString()} FC` 
                              : `$${equivalent.toFixed(2)} USD`;
                          })()}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Vérifier si le produit est déjà dans le panier */}
                  {(() => {
                    const productInCart = isProductInCart(selectedProduct, selectedUnit);
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
                        {/* Bouton d'ajout compact avec animation fluide */}
                        <motion.button
                          whileHover={{ scale: 1.08, y: -2 }}
                          whileTap={{ scale: 0.95 }}
                          transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                          style={{ 
                            willChange: 'transform',
                            backfaceVisibility: 'hidden',
                            WebkitBackfaceVisibility: 'hidden',
                            transform: 'translateZ(0)',
                            zIndex: 10
                          }}
                          onClick={() => {
                            const priceFC = activeSale.currency === 'FC' 
                              ? (quickPrice !== null ? quickPrice : selectedUnit.sale_price_fc)
                              : (quickPrice !== null ? quickPrice * currentRate : selectedUnit.sale_price_fc);
                            const priceUSD = activeSale.currency === 'USD'
                              ? (quickPrice !== null ? quickPrice : selectedUnit.sale_price_usd)
                              : (quickPrice !== null ? quickPrice / currentRate : selectedUnit.sale_price_usd);
                            addItemToSale(selectedProduct, selectedUnit, quickQty, priceFC, priceUSD);
                            setQuickQty(selectedUnit.qty_step || 1);
                            setQuickPrice(null);
                          }}
                          disabled={productInCart}
                          className={`w-full py-2 text-sm font-bold flex items-center justify-center gap-2 shadow-lg transition-all mt-2.5 ${
                            productInCart
                              ? 'bg-gray-600/50 text-gray-400 cursor-not-allowed opacity-60'
                              : 'btn-primary hover:shadow-xl'
                          }`}
                        >
                          {productInCart ? (
                            <>
                              <X className="w-4 h-4" />
                              <span className="text-xs">Déjà au panier</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4" />
                              Ajouter au panier
                            </>
                          )}
                        </motion.button>
                      </>
                    );
                  })()}
                </motion.div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <Package className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Sélectionnez un produit</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Colonne droite - Résumé (en bas) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-3">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-100 mb-4">Résumé</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Ventes actives:</span>
                  <span className="text-sm font-semibold text-gray-200">{sales.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Total items:</span>
                  <span className="text-sm font-semibold text-gray-200">
                    {sales.reduce((sum, s) => sum + s.items.length, 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Total FC:</span>
                  <span className="text-sm font-semibold text-primary-400">
                    {sales.reduce((sum, s) => sum + s.items.reduce((itemSum, item) => itemSum + item.subtotal_fc, 0), 0).toLocaleString()} FC
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Total USD:</span>
                  <span className="text-sm font-semibold text-primary-400">
                    ${sales.reduce((sum, s) => sum + s.items.reduce((itemSum, item) => itemSum + item.subtotal_usd, 0), 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Composant pour sélectionner une unité (seulement pour Carton - design détaillé)
const UnitSelector = ({ product, unit, onAdd, getUnitLabel, currency, currentRate, onSelect }) => {
  const qtyInputRef = useRef(null);

  // Auto-focus sur qty quand le composant est monté
  useEffect(() => {
    if (qtyInputRef.current) {
      setTimeout(() => {
        qtyInputRef.current?.focus();
        qtyInputRef.current?.select();
      }, 100);
    }
  }, []);
  const [qty, setQty] = useState(unit.qty_step || 1);
  const [customPrice, setCustomPrice] = useState(null);

  const price = customPrice !== null ? customPrice : (currency === 'USD' ? unit.sale_price_usd : unit.sale_price_fc);
  const total = price * qty;

  return (
    <div className="p-4 glass rounded-lg border border-primary-500/30">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-gray-100 text-lg">
              {getUnitLabel(unit.unit_level)}
            </span>
            {unit.unit_mark && (
              <span className="px-2 py-1 bg-primary-500/20 text-primary-400 rounded text-xs font-medium">
                {unit.unit_mark}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span>Stock: <span className="text-gray-200 font-semibold">{unit.stock_current.toLocaleString()}</span></span>
            <span>Prix: <span className="text-gray-200 font-semibold">
              {currency === 'USD' 
                ? `$${unit.sale_price_usd.toFixed(2)}` 
                : `${unit.sale_price_fc.toLocaleString()} FC`}
            </span></span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Quantité</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQty(Math.max(unit.qty_step, qty - unit.qty_step))}
              className="p-1 glass rounded hover:bg-white/10"
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
              className="input-field text-center text-sm flex-1"
            />
            <button
              onClick={() => setQty(qty + unit.qty_step)}
              className="p-1 glass rounded hover:bg-white/10"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Prix ({currency})</label>
          <input
            type="number"
            value={customPrice !== null ? customPrice : (currency === 'USD' ? unit.sale_price_usd : unit.sale_price_fc)}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setCustomPrice(isNaN(val) ? null : val);
            }}
            className="input-field text-sm"
            placeholder={currency === 'USD' ? unit.sale_price_usd.toFixed(2) : unit.sale_price_fc.toLocaleString()}
          />
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 p-2 glass rounded">
        <span className="text-sm text-gray-400">Total:</span>
        <span className="font-bold text-lg text-primary-400">
          {currency === 'USD' ? `$${total.toFixed(2)}` : `${total.toLocaleString()} FC`}
        </span>
      </div>

      <button
        onClick={() => {
          const priceFC = currency === 'FC' ? (customPrice !== null ? customPrice : unit.sale_price_fc) : (customPrice !== null ? customPrice * currentRate : unit.sale_price_fc);
          const priceUSD = currency === 'USD' ? (customPrice !== null ? customPrice : unit.sale_price_usd) : (customPrice !== null ? customPrice / currentRate : unit.sale_price_usd);
          onAdd(product, unit, qty, priceFC, priceUSD);
          setQty(unit.qty_step || 1);
          setCustomPrice(null);
        }}
        className="btn-primary w-full text-sm py-2"
      >
        <Plus className="w-4 h-4 inline mr-2" />
        Ajouter au panier
      </button>
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
    <motion.div
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
      className={`group grid grid-cols-12 gap-3 px-3 py-3 glass rounded-lg border transition-all items-center bg-gradient-to-r from-white/5 to-transparent relative my-2.5 ${
        isHovered 
          ? 'border-primary-500/60 shadow-2xl' 
          : 'border-white/10 shadow-sm'
      }`}
    >
      {/* Produit - Design professionnel avec mark amélioré */}
      <div className="col-span-4 flex items-center gap-3 min-w-0">
        <motion.div 
          className="flex-shrink-0"
          whileHover={{ scale: 1.2, rotate: 8 }}
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
          <div className="w-10 h-10 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center group-hover:bg-primary-500/30 transition-colors shadow-md">
            <UnitIcon unitLevel={item.unit_level} unitMark={item.unit_mark} />
          </div>
        </motion.div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-semibold text-gray-100 text-sm truncate">
              {item.product_name}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-1 bg-blue-500/20 border border-blue-500/40 text-blue-300 rounded-md text-xs font-semibold">
              {getUnitLabel(item.unit_level)}
            </span>
            {item.unit_mark && (
              <motion.span 
                whileHover={{ scale: 1.12, y: -2 }}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ 
                  willChange: 'transform',
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'translateZ(0)',
                  zIndex: 10
                }}
                className="px-2.5 py-1 bg-gradient-to-r from-primary-500/25 to-primary-600/25 border border-primary-500/40 text-primary-200 rounded-md text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 shadow-md"
              >
                <span className="w-1.5 h-1.5 bg-primary-400 rounded-full" />
                <span className="font-bold text-primary-300">MARK:</span>
                <span className="text-primary-100 font-semibold">{item.unit_mark}</span>
              </motion.span>
            )}
          </div>
        </div>
      </div>

      {/* Quantité - Design amélioré avec animations fluides */}
      <div className="col-span-2 flex items-center justify-center gap-2">
        <motion.button
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
          onClick={() => onUpdateQty(itemIndex, Math.max(item.qty_step || 1, item.qty - (item.qty_step || 1)))}
          className="p-2 glass rounded-lg hover:bg-red-500/20 hover:border-red-500/50 border border-white/10 transition-all shadow-sm"
          title="Diminuer"
        >
          <Minus className="w-4 h-4 text-gray-300" />
        </motion.button>
        <motion.input
          whileFocus={{ scale: 1.05, borderColor: 'rgba(59, 130, 246, 0.5)' }}
          transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
          type="number"
          value={item.qty}
          onChange={(e) => {
            const val = parseFloat(e.target.value) || (item.qty_step || 1);
            onUpdateQty(itemIndex, Math.max(item.qty_step || 1, val));
          }}
          step={item.qty_step || 1}
          min={item.qty_step || 1}
          className="input-field text-center text-sm font-semibold w-20 bg-white/10 border-primary-500/30 focus:border-primary-500/50"
          style={{ 
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden'
          }}
        />
        <motion.button
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
          onClick={() => onUpdateQty(itemIndex, item.qty + (item.qty_step || 1))}
          className="p-2 glass rounded-lg hover:bg-green-500/20 hover:border-green-500/50 border border-white/10 transition-all shadow-sm"
          title="Augmenter"
        >
          <Plus className="w-4 h-4 text-gray-300" />
        </motion.button>
      </div>

      {/* Prix unitaire - Design amélioré */}
      <div className="col-span-2 text-right">
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
            className="input-field text-sm font-semibold w-full text-right bg-white/10 border-primary-500/30 focus:border-primary-500/50"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditingPrice(true)}
            className="text-sm font-bold text-gray-100 hover:text-primary-400 cursor-pointer px-2 py-1 rounded hover:bg-primary-500/10 transition-all"
            title="Cliquer pour modifier"
          >
            {currency === 'USD'
              ? `$${item.unit_price_usd.toFixed(2)}`
              : `${item.unit_price_fc.toLocaleString()} FC`}
          </button>
        )}
      </div>

      {/* Total - Design amélioré */}
      <div className="col-span-3 text-right">
        <div className="p-2 bg-primary-500/10 rounded-lg border border-primary-500/30">
          <p className="text-sm font-bold text-primary-300 mb-0.5">
            {currency === 'USD'
              ? `$${item.subtotal_usd.toFixed(2)}`
              : `${item.subtotal_fc.toLocaleString()} FC`}
          </p>
          <p className="text-xs text-gray-400 font-medium">
            {currency === 'USD'
              ? `≈ ${item.subtotal_fc.toLocaleString()} FC`
              : `≈ $${item.subtotal_usd.toFixed(2)} USD`}
          </p>
        </div>
      </div>

      {/* Action - Bouton supprimer amélioré avec animation fluide */}
      <div className="col-span-1 text-center">
        <motion.button
          whileHover={{ scale: 1.2, rotate: 12, y: -2 }}
          whileTap={{ scale: 0.85 }}
          transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ 
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'translateZ(0)',
            zIndex: 10
          }}
          onClick={() => onRemove(itemIndex)}
          className="p-2 glass rounded-lg hover:bg-red-500/20 hover:border-red-500/50 border border-white/10 transition-all group shadow-sm"
          title="Supprimer"
        >
          <Trash2 className="w-4 h-4 text-gray-400 group-hover:text-red-400 transition-colors" />
        </motion.button>
      </div>
    </motion.div>
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

  // Quand on sélectionne une unité, focus sur qty
  useEffect(() => {
    if (showForm && qtyInputRef.current) {
      setTimeout(() => {
        qtyInputRef.current?.focus();
        qtyInputRef.current?.select();
      }, 100);
    }
  }, [showForm]);

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

export default SalesPOS;
