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
  Printer,
  Layers,
  Circle,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';
import { normalizeUnit, normalizeMark, getQtyPolicy, validateAndCorrectQty } from '../../core/qty-rules.js';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

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
  const [quickQty, setQuickQty] = useState(0); // Commencer à 0 pour permettre saisie manuelle
  const [quickQtyRaw, setQuickQtyRaw] = useState(''); // Valeur brute pour permettre saisie libre
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
    }
  }, [selectedUnit?.unit_level, selectedUnit?.unit_mark]);

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
      setQuickQty(0);
      setQuickQtyRaw('');
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
    const unitNorm = normalizeUnit(unit.unit_level);
    const markNorm = normalizeMark(unit.unit_mark || '');
    const policy = getQtyPolicy(unitNorm, markNorm);
    const correctedQty = validateAndCorrectQty(qty, policy);
    
    // S'assurer que les prix sont toujours des nombres valides
    const priceFC = customPriceFC !== null && !isNaN(customPriceFC) 
      ? Number(customPriceFC) 
      : (unit.sale_price_fc && !isNaN(unit.sale_price_fc) ? Number(unit.sale_price_fc) : 0);
    const priceUSD = customPriceUSD !== null && !isNaN(customPriceUSD)
      ? Number(customPriceUSD)
      : (unit.sale_price_usd && !isNaN(unit.sale_price_usd) ? Number(unit.sale_price_usd) : 0);
    
    const newSales = [...sales];
    const sale = newSales[activeSaleIndex];
    
    const existingItemIndex = sale.items.findIndex(
      item => item.product_code === product.code &&
      item.unit_level === unit.unit_level &&
      item.unit_mark === (unit.unit_mark || '')
    );

    if (existingItemIndex >= 0) {
      // Mettre à jour la quantité si le produit existe déjà (avec règles)
      const newQty = sale.items[existingItemIndex].qty + correctedQty;
      const finalQty = validateAndCorrectQty(newQty, policy);
      const unitPriceFC = sale.items[existingItemIndex].unit_price_fc || priceFC;
      const unitPriceUSD = sale.items[existingItemIndex].unit_price_usd || priceUSD;
      sale.items[existingItemIndex].qty = finalQty;
      sale.items[existingItemIndex].unit_price_fc = unitPriceFC;
      sale.items[existingItemIndex].unit_price_usd = unitPriceUSD;
      sale.items[existingItemIndex].subtotal_fc = unitPriceFC * finalQty;
      sale.items[existingItemIndex].subtotal_usd = unitPriceUSD * finalQty;
    } else {
      // Ajouter un nouvel item
      sale.items.push({
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

    setSales(newSales);
    setSearchQuery('');
    setSelectedProductUnits([]);
    // Réinitialiser la sélection du produit après ajout
    setSelectedProduct(null);
    setSelectedUnit(null);
    setQuickPrice(null);
    setQuickQty(0);
    setQuickQtyRaw('');
    // Focus sur la recherche pour le prochain produit
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 100);
  }, [sales, activeSaleIndex]);

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
      
      const unitNorm = normalizeUnit(item.unit_level);
      const markNorm = normalizeMark(item.unit_mark || '');
      const policy = getQtyPolicy(unitNorm, markNorm) || SAFE_POLICY;
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
    const saleData = {
        // invoice_number sera généré côté backend si non fourni
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
        items: sale.items.map(item => ({
          ...item,
          // Normaliser les unités et marks pour le backend
          unit_level: item.unit_level, // Déjà normalisé côté UI
          unit_mark: item.unit_mark || '',
        })),
        printCurrency: sale.currency,
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

        // Si dette, créer automatiquement
        if (sale.isDebt) {
          console.log('💳 [SalesPOS] Création de la dette...');
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
            console.log('✅ [SalesPOS] Dette créée avec succès');
          } catch (error) {
            console.error('❌ [SalesPOS] Erreur création dette:', error);
          }
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
        };
        setSales(newSales);
        if (saleIndex === activeSaleIndex) {
          setSearchQuery('');
          if (searchInputRef.current) {
            searchInputRef.current.focus();
          }
        }
        console.log('✅ [SalesPOS] Panier réinitialisé');
        
        // CRITIQUE: Recharger les produits pour afficher le nouveau stock
        console.log('🔄 [SalesPOS] Rechargement des produits pour mettre à jour le stock...');
        try {
          await loadProducts();
          console.log('✅ [SalesPOS] Produits rechargés avec succès (stock mis à jour)');
        } catch (error) {
          console.error('❌ [SalesPOS] Erreur lors du rechargement des produits:', error);
          // Ne pas bloquer l'utilisateur si le rechargement échoue
        }
        
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
      alert('Erreur lors de la finalisation de la vente');
    } finally {
      setProcessing(false);
      console.log('🏁 [SalesPOS] Finalisation terminée, processing = false');
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
        {/* Onglets des clients - En haut de la page (compact) */}
        <div className="card p-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {/* Bouton Nouveau client - Compact */}
            <motion.button
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
                <motion.div
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
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Nom client à gauche, Recherche + Produit dans même modal à droite */}
        <div className="grid grid-cols-1 md:grid-cols-[60%_40%] gap-4 items-stretch">
          {/* Colonne gauche: Nom du client + DEVISE + PANIER (60% de la largeur) */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Nom du client */}
            <motion.div 
              className="card p-2.5 flex-shrink-0 relative z-50"
              animate={{
                scale: focusedField === 'client' ? 1 : focusedField ? 0.95 : 1,
                opacity: focusedField === 'client' ? 1 : focusedField ? 0.7 : 1
              }}
              transition={{ duration: 0.1, ease: 'easeOut' }}
            >
              <label className="block text-xs font-medium text-gray-300 mb-2">
                Nom du client :
              </label>
              <div className="relative z-[200]">
                <input
                  ref={clientNameInputRef}
                  type="text"
                  value={activeSale.clientName || ''}
                  onChange={(e) => {
                    const newSales = [...sales];
                    newSales[activeSaleIndex].clientName = e.target.value;
                    setSales(newSales);
                    const hasValue = e.target.value.length > 0;
                    const hasMatches = clientNamesHistory.some(name => 
                      name.toLowerCase().includes(e.target.value.toLowerCase())
                    );
                    setShowClientSuggestions(hasValue && hasMatches && clientNamesHistory.length > 0);
                  }}
                  onFocus={() => {
                    setFocusedField('client');
                    const hasMatches = clientNamesHistory.some(name => 
                      !activeSale.clientName || 
                      name.toLowerCase().includes(activeSale.clientName.toLowerCase())
                    );
                    setShowClientSuggestions(hasMatches && clientNamesHistory.length > 0);
                  }}
                  onBlur={(e) => {
                    setFocusedField(null);
                    // Délai pour permettre le clic sur les suggestions
                    setTimeout(() => {
                      setShowClientSuggestions(false);
                    }, 300);
                  }}
                  placeholder="Nom du client"
                  className="input-field w-full text-sm py-2 pr-2 relative z-[200]"
                  list="client-names-list"
                />
                <AnimatePresence>
                  {showClientSuggestions && clientNamesHistory.length > 0 && (() => {
                    const filteredNames = clientNamesHistory
                      .filter(name => 
                        !activeSale.clientName || 
                        name.toLowerCase().includes(activeSale.clientName.toLowerCase())
                      )
                      .slice(0, 8);
                    
                    if (filteredNames.length === 0) return null;
                    
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: -5, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -5, scale: 0.95 }}
                        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                        className="absolute z-[300] w-full mt-1.5 bg-gradient-to-br from-green-900/98 via-green-800/98 to-teal-900/98 backdrop-blur-lg rounded-xl border-2 border-green-500/50 shadow-2xl overflow-hidden"
                        style={{
                          boxShadow: '0 15px 50px rgba(0, 0, 0, 0.7), 0 0 0 2px rgba(34, 197, 94, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                          top: '100%',
                          left: 0,
                          right: 0,
                          position: 'absolute'
                        }}
                      >
                        <div 
                          className="max-h-48 overflow-y-auto"
                          style={{
                            scrollbarWidth: 'thin',
                            scrollbarColor: 'rgba(34, 197, 94, 0.5) rgba(20, 83, 45, 0.3)'
                          }}
                        >
                        {filteredNames.map((name, index) => {
                          const isExactMatch = activeSale.clientName && 
                            name.toLowerCase() === activeSale.clientName.toLowerCase();
                          const isPartialMatch = activeSale.clientName && 
                            name.toLowerCase().includes(activeSale.clientName.toLowerCase());
                          
                          return (
                            <motion.button
                              key={`${name}-${index}`}
                              whileHover={{ scale: 1.02, x: 2 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const newSales = [...sales];
                                newSales[activeSaleIndex].clientName = name;
                                setSales(newSales);
                                setShowClientSuggestions(false);
                                if (clientNameInputRef.current) {
                                  clientNameInputRef.current.blur();
                                }
                              }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                              }}
                              className={`w-full text-left px-4 py-3 text-sm font-medium transition-all border-b border-green-700/40 last:border-b-0 ${
                                isExactMatch 
                                  ? 'bg-green-600/50 text-green-50 shadow-inner' 
                                  : isPartialMatch
                                  ? 'bg-green-700/40 text-green-50 hover:bg-green-600/50 hover:shadow-md'
                                  : 'text-green-100 hover:bg-green-700/50 hover:shadow-md'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 shadow-md ${
                                  isExactMatch 
                                    ? 'bg-green-500/50' 
                                    : 'bg-green-500/30'
                                }`}>
                                  <User className={`w-5 h-5 ${
                                    isExactMatch ? 'text-green-50' : 'text-green-200'
                                  }`} />
                                </div>
                                <span className="flex-1 truncate font-semibold">{name}</span>
                                {isExactMatch && (
                                  <div className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-green-300 shadow-lg animate-pulse"></div>
                                )}
                              </div>
                            </motion.button>
                          );
                        })}
                        </div>
                      </motion.div>
                    );
                  })()}
                </AnimatePresence>
              </div>
            </motion.div>

            {/* DEVISE - Horizontal, prend toute la largeur */}
            <div className="card flex-shrink-0 p-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-semibold text-gray-300 mb-2 whitespace-nowrap">
                    Mode de paiement :
                  </label>
                  <div className="flex gap-2">
                    <motion.button
                      whileHover={{ scale: 1.05, y: -1 }}
                      whileTap={{ scale: 0.98 }}
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
                      className={`flex-1 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all relative z-10 whitespace-nowrap ${
                        !activeSale.isDebt
                          ? 'bg-green-500/30 border-2 border-green-500/50 text-green-300 shadow-lg'
                          : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      💵 Payant
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05, y: -1 }}
                      whileTap={{ scale: 0.98 }}
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
                      className={`flex-1 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all relative z-10 whitespace-nowrap ${
                        activeSale.isDebt
                          ? 'bg-orange-500/30 border-2 border-orange-500/50 text-orange-300 shadow-lg'
                          : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      📋 Dette
                    </motion.button>
                  </div>
                </div>
                <div className="flex-shrink-0 min-w-0">
                  <label className="block text-xs font-semibold text-gray-300 mb-2 whitespace-nowrap">
                    Devise :
                  </label>
                  <div className="flex gap-2">
                    <motion.button
                      whileHover={{ scale: 1.1, y: -1 }}
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
                        newSales[activeSaleIndex].currency = 'FC';
                        setSales(newSales);
                      }}
                      className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all relative z-10 whitespace-nowrap ${
                        activeSale.currency === 'FC'
                          ? 'bg-blue-500/30 border-2 border-blue-500/50 text-blue-300 shadow-lg'
                          : 'glass border-2 border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      FC
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1, y: -1 }}
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
                        newSales[activeSaleIndex].currency = 'USD';
                        setSales(newSales);
                      }}
                      className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all relative z-10 whitespace-nowrap ${
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

            {/* PANIER - Horizontal, prend toute la largeur, flex-1 pour prendre l'espace restant */}
            <div className="card flex flex-col flex-1 min-h-0 overflow-hidden">
              <motion.button
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.99 }}
                transition={{ duration: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ 
                  willChange: 'transform',
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'translateZ(0)',
                  zIndex: 10
                }}
                onClick={() => setIsCartExpanded(!isCartExpanded)}
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
              </motion.button>

              {/* Contenu du panier (collapsible) */}
              <AnimatePresence>
                {isCartExpanded && (
                  <motion.div
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
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Bouton Finaliser */}
              {activeSale && activeSale.items && activeSale.items.length > 0 && (
                <motion.div
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
                    <motion.button
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => finalizeSale(activeSaleIndex)}
                      disabled={processing || activeSale.items.length === 0}
                      className="px-4 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-primary-500 to-primary-600 text-white text-sm sm:text-base font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                      <Printer className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span className="hidden sm:inline">Finaliser et imprimer</span>
                      <span className="sm:hidden">Finaliser</span>
                    </motion.button>
                  </div>
                </motion.div>
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
              <motion.div 
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
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setFocusedField('search')}
                    onBlur={() => {
                      setTimeout(() => {
                        setFocusedField(null);
                      }, 200);
                    }}
                    placeholder="Code ou Nom..."
                    className="input-field pl-9 w-full text-sm py-2 pr-2 relative z-20"
                    autoFocus
                  />
                  
                  {/* Résultats de recherche directement sous le champ */}
                  {/* ✅ Afficher seulement si searchQuery non vide (pas debouncedSearch) pour éviter overlay qui bloque */}
                  <AnimatePresence>
                    {searchQuery.trim().length > 0 && debouncedSearch.trim() && groupedFilteredProducts.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -5, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -5, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
                        className="absolute z-[100] w-full mt-1.5 bg-gradient-to-br from-dark-800/98 via-dark-700/98 to-dark-800/98 backdrop-blur-lg rounded-xl border-2 border-primary-500/40 shadow-2xl overflow-hidden"
                        style={{
                          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(59, 130, 246, 0.3)',
                          top: '100%',
                          left: 0,
                          maxHeight: '400px',
                          overflowY: 'auto'
                        }}
                      >
                        <div className="hide-scrollbar max-h-[400px] overflow-y-auto">
                          <div className="p-1 space-y-1.5">
                            {groupedFilteredProducts.slice(0, 8).map((group, groupIdx) => {
                              if (!group.product) return null;
                              
                              return (
                                <motion.div 
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
                                      
                                      return (
                                        <motion.button
                                          key={`${group.code}-${unit.unit_level}-${unit.unit_mark || ''}-${unitIdx}`}
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
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            // Utiliser le produit original stocké dans l'unité
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
                                                if (searchInputRef.current) {
                                                  searchInputRef.current.blur();
                                                }
                                              }
                                            }
                                          }}
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                          }}
                                          className={`flex-1 text-left px-2.5 py-2 text-[10px] font-medium transition-all duration-200 rounded-lg border ${borderColor} ${hoverBg} ${bgGradient} backdrop-blur-sm relative overflow-hidden group`}
                                          style={{
                                            boxShadow: `0 2px 8px ${shadowColor}, 0 0 0 0px ${shadowColor}`
                                          }}
                                        >
                                          {/* Effet de brillance au survol */}
                                          <motion.div
                                            className="absolute inset-0 opacity-0 group-hover:opacity-10"
                                            style={{
                                              background: `linear-gradient(135deg, ${shadowColor} 0%, transparent 100%)`
                                            }}
                                            transition={{ duration: 0.3 }}
                                          />
                                          
                                          {/* Badge avec nom du produit en haut - Taille améliorée et plus claire */}
                                          <motion.div 
                                            className={`absolute top-0 left-0 right-0 px-2 py-1 ${bgGradient} border-b ${borderColor} text-xs font-bold ${textColor} truncate`}
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ delay: unitIdx * 0.05 + 0.1 }}
                                          >
                                            <span className="drop-shadow-sm">{group.baseName}</span>
                                          </motion.div>
                                          
                                          {/* Contenu principal avec padding-top pour le badge */}
                                          <div className="pt-4 flex items-start gap-1.5">
                                            {/* Icône avec couleur et animation */}
                                            <motion.div 
                                              className={`p-1.5 rounded-md ${bgGradient} border ${borderColor} flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform duration-200`}
                                              whileHover={{ rotate: [0, -5, 5, 0] }}
                                              transition={{ duration: 0.3 }}
                                            >
                                              <UnitIcon className={`w-3.5 h-3.5 ${iconColor}`} />
                                            </motion.div>
                                            
                                            {/* Contenu principal */}
                                            <div className="flex-1 min-w-0">
                                              <motion.div 
                                                className={`text-[10px] font-bold ${textColor} mb-0.5 truncate`}
                                                initial={{ opacity: 0, x: -5 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: unitIdx * 0.05 + 0.15 }}
                                              >
                                                {fullLabel}
                                              </motion.div>
                                              
                                              {/* Format : "— Stock: X • PU: Y FC" */}
                                              <motion.div 
                                                className="text-[9px] text-gray-300 leading-tight"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ delay: unitIdx * 0.05 + 0.2 }}
                                              >
                                                <span className="text-gray-400">—</span> Stock: <span className="font-semibold text-gray-200">{unit.stock_current.toLocaleString()}</span>
                                                <span className="text-gray-500 mx-0.5">•</span>
                                                <span className={`font-semibold ${textColor}`}>{priceLabel}</span>
                                              </motion.div>
                                            </div>
                                          </div>
                                        </motion.button>
                                      );
                                    })}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                    
                    {/* Message "Aucun résultat" */}
                    {/* ✅ Afficher seulement si searchQuery non vide pour éviter overlay qui bloque */}
                    {searchQuery.trim().length > 0 && debouncedSearch.trim() && groupedFilteredProducts.length === 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="absolute z-[100] w-full mt-1.5 bg-dark-800/95 backdrop-blur-lg rounded-xl border-2 border-gray-600/40 shadow-xl p-4"
                        style={{
                          top: '100%',
                          left: 0
                        }}
                      >
                        <div className="text-center text-gray-400 text-sm">
                          <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
                          <p>Aucun produit trouvé</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>

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
                  className="flex-1 overflow-y-auto overflow-x-hidden min-h-[400px] hide-scrollbar" 
                  style={{ 
                    maxHeight: 'calc(100vh - 500px)',
                    minHeight: '400px',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch'
                  }}
                >
                  {selectedProduct && selectedUnit ? (
                    <div className="p-2 sm:p-3 glass rounded-lg border-2 border-primary-500/30 bg-gradient-to-br from-primary-500/5 to-transparent w-full max-w-full overflow-x-hidden"
                    >
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

              <div className="space-y-2.5 w-full max-w-full overflow-x-hidden">
                <div className="w-full max-w-full overflow-x-hidden">
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
                        setQuickQty(0);
                        setQuickQtyRaw('');
                      }
                    }}
                    className="input-field w-full max-w-full text-sm"
                  >
                    {selectedProduct.units.map((unit, idx) => (
                      <option key={idx} value={`${unit.unit_level}-${unit.unit_mark || ''}`}>
                        {getUnitLabel(unit.unit_level)} {unit.unit_mark ? `[${unit.unit_mark}]` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quantité avec règles strictes */}
                {(() => {
                  const unitNorm = selectedUnit ? normalizeUnit(selectedUnit.unit_level) : null;
                  const markNorm = selectedUnit ? normalizeMark(selectedUnit.unit_mark || '') : '';
                  const policy = unitNorm ? getQtyPolicy(unitNorm, markNorm) : null;
                  
                  return (
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 mb-2">
                        Quantité
                        {policy && !policy.allowDecimal && (
                          <span className="text-gray-500 text-xs ml-1">(entier uniquement)</span>
                        )}
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (!policy) return;
                            const newQty = Math.max(0, quickQty - policy.step);
                            setQuickQty(newQty);
                            setQuickQtyRaw(newQty === 0 ? '' : newQty.toString());
                          }}
                          className="p-2 glass rounded hover:bg-white/10 transition-colors"
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
                          onBlur={(e) => {
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
                          placeholder="0"
                          className="input-field text-sm flex-1 text-center font-semibold"
                          ref={qtyInputRef}
                        />
                        <button
                          onClick={() => {
                            if (!policy) return;
                            const newQty = (quickQty || 0) + policy.step;
                            setQuickQty(newQty);
                            setQuickQtyRaw(newQty.toString());
                          }}
                          className="p-2 glass rounded hover:bg-white/10 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Prix unitaire */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-2">
                    Prix unitaire ({activeSale.currency})
                    <span className="text-gray-500 text-xs ml-1">(dbl-clic)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={quickPrice !== null ? quickPrice : (activeSale.currency === 'USD' ? selectedUnit.sale_price_usd : (selectedUnit.sale_price_usd * currentRate))}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setQuickPrice(isNaN(val) ? null : val);
                      }}
                      onDoubleClick={() => setQuickPrice(null)}
                      className="input-field text-sm flex-1 font-semibold"
                      placeholder={activeSale.currency === 'USD' ? selectedUnit.sale_price_usd.toFixed(2) : (selectedUnit.sale_price_usd * currentRate).toLocaleString()}
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
                    {quickPrice === null ? (
                      <span className="text-primary-400">Prix par défaut chargé automatiquement depuis USD</span>
                    ) : (
                      <span>Défaut: {activeSale.currency === 'USD' 
                      ? `$${selectedUnit.sale_price_usd.toFixed(2)}` 
                        : `${(selectedUnit.sale_price_usd * currentRate).toLocaleString()} FC`} (dbl-clic pour réinitialiser)</span>
                    )}
                  </p>
                </div>

                {/* Prix total */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                    Prix total ({activeSale.currency})
                  </label>
                  <div className="p-2 glass rounded-lg border border-primary-500/30 bg-primary-500/10">
                    <p className="text-lg font-bold text-primary-400 text-center">
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
                    </p>
                    <p className="text-xs text-gray-400 text-center mt-0.5">
                      {(() => {
                        const qty = quickQty || 0;
                        if (qty <= 0) return 'Entrez une quantité';
                        const priceUSD = quickPrice !== null 
                          ? (activeSale.currency === 'USD' ? quickPrice : quickPrice / currentRate)
                          : selectedUnit.sale_price_usd;
                        const priceFC = priceUSD * currentRate;
                        const price = activeSale.currency === 'USD' ? priceUSD : priceFC;
                        const total = price * qty;
                        const equivalent = activeSale.currency === 'USD' 
                          ? total * currentRate 
                          : total / currentRate;
                        return activeSale.currency === 'USD' 
                          ? `Équiv: ${equivalent.toLocaleString()} FC` 
                          : `Équiv: $${equivalent.toFixed(2)} USD`;
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
                    {/* Bouton d'ajout */}
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
                        const unitNorm = normalizeUnit(selectedUnit.unit_level);
                        const markNorm = normalizeMark(selectedUnit.unit_mark || '');
                        const policy = getQtyPolicy(unitNorm, markNorm);
                        
                        if (quickQty <= 0) return;
                        
                        let finalQty = quickQty;
                        
                        if (policy.integerOnly) {
                          if (!Number.isInteger(finalQty) || finalQty < 1) return;
                        } else {
                          if (finalQty <= 0) return;
                        }
                        
                        finalQty = validateAndCorrectQty(finalQty, policy);
                        
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
                      }}
                      disabled={(() => {
                        if (productInCart) return true;
                        if (quickQty <= 0) return true;
                        const unitNorm = normalizeUnit(selectedUnit.unit_level);
                        const markNorm = normalizeMark(selectedUnit.unit_mark || '');
                        const policy = getQtyPolicy(unitNorm, markNorm);
                        if (policy.integerOnly) {
                          if (!Number.isInteger(quickQty) || quickQty < 1) return true;
                        }
                        return false;
                      })()}
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
                      ) : (quickQty <= 0 || (() => {
                        const unitNorm = normalizeUnit(selectedUnit.unit_level);
                        const markNorm = normalizeMark(selectedUnit.unit_mark || '');
                        const policy = getQtyPolicy(unitNorm, markNorm);
                        return policy.integerOnly && (!Number.isInteger(quickQty) || quickQty < 1);
                      })() ? (
                        <>
                          <X className="w-4 h-4" />
                          <span className="text-xs">Quantité invalide</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          Ajouter au panier
                        </>
                      ))}
                    </motion.button>
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
      className={`group grid grid-cols-12 gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 glass rounded-lg border transition-all items-center bg-gradient-to-r from-white/5 to-transparent relative my-1 sm:my-1.5 ${
        isHovered 
          ? 'border-primary-500/60 shadow-xl' 
          : 'border-white/10 shadow-sm'
      }`}
    >
      {/* Produit - Design professionnel compact */}
      <div className="col-span-4 flex items-center gap-1.5 sm:gap-2 min-w-0">
        <motion.div 
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
        </motion.div>
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
              <motion.span 
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
              </motion.span>
            )}
          </div>
        </div>
      </div>

      {/* Quantité - Design amélioré avec animations fluides */}
      {(() => {
        const unitNorm = normalizeUnit(item.unit_level);
        const markNorm = normalizeMark(item.unit_mark || '');
        const policy = getQtyPolicy(unitNorm, markNorm);
        
        return (
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
              onClick={() => {
                const newQty = Math.max(0, item.qty - policy.step);
                onUpdateQty(itemIndex, newQty);
              }}
          className="p-2 glass rounded-lg hover:bg-red-500/20 hover:border-red-500/50 border border-white/10 transition-all shadow-sm"
          title="Diminuer"
        >
          <Minus className="w-4 h-4 text-gray-300" />
        </motion.button>
        <motion.input
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
        <motion.button
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
        </motion.button>
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
        <motion.button
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


