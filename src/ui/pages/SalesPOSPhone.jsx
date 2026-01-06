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
  ChevronDown,
  ChevronUp,
  Printer,
  Layers,
  Circle,
  AlertCircle,
  CreditCard,
  Banknote,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { getSellerName } from '../utils/permissions';
import axios from 'axios';
import { normalizeUnit, normalizeMark, getQtyPolicy, validateAndCorrectQty } from '../../core/qty-rules.js';

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

// Debounce hook pour performance
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    if (!value) {
      setDebouncedValue('');
      return;
    }
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

/**
 * SalesPOSPhone - Version mobile optimisée du POS
 * Design adapté aux smartphones avec interface tactile
 */
const SalesPOSPhone = () => {
  const {
    products,
    currentRate,
    loadProducts,
    loadCurrentRate,
    user,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [cart, setCart] = useState([]);
  const [currency, setCurrency] = useState('FC');
  const [clientName, setClientName] = useState('');
  const [isDebt, setIsDebt] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastInvoice, setLastInvoice] = useState(null);
  const [uiError, setUiError] = useState(null);
  const searchInputRef = useRef(null);

  // Charger les données au montage
  useEffect(() => {
    loadProducts();
    loadCurrentRate();
  }, [loadProducts, loadCurrentRate]);

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

  // Filtrer les produits
  const filteredProducts = useMemo(() => {
    if (!debouncedSearch.trim()) return productsWithUnits.slice(0, 20);
    
    const query = debouncedSearch.toLowerCase();
    return productsWithUnits.filter(product => {
      const name = product.name.toLowerCase();
      const code = product.code.toLowerCase();
      return name.includes(query) || code.includes(query);
    }).slice(0, 20);
  }, [debouncedSearch, productsWithUnits]);

  // Obtenir l'icône et la couleur selon l'unité
  const getUnitStyle = (unitLevel) => {
    const normalized = normalizeUnit(unitLevel);
    if (normalized === 'carton') {
      return { icon: Package, color: 'text-blue-400', bg: 'bg-blue-500/20' };
    }
    if (normalized === 'milliers' || unitLevel === 'MILLIER' || unitLevel === 'DETAIL') {
      return { icon: Layers, color: 'text-purple-400', bg: 'bg-purple-500/20' };
    }
    if (normalized === 'piece') {
      return { icon: Circle, color: 'text-emerald-400', bg: 'bg-emerald-500/20' };
    }
    return { icon: Package, color: 'text-gray-400', bg: 'bg-gray-500/20' };
  };

  // Ajouter au panier
  const addToCart = (product, unit) => {
    const existingIndex = cart.findIndex(
      item => item.product_code === product.code && 
              item.unit_level === unit.unit_level &&
              item.unit_mark === (unit.unit_mark || '')
    );

    if (existingIndex >= 0) {
      // Incrémenter la quantité
      const newCart = [...cart];
      newCart[existingIndex].qty += 1;
      newCart[existingIndex].subtotal_fc = newCart[existingIndex].qty * newCart[existingIndex].unit_price_fc;
      newCart[existingIndex].subtotal_usd = newCart[existingIndex].qty * newCart[existingIndex].unit_price_usd;
      setCart(newCart);
    } else {
      // Ajouter nouvel item
      const newItem = {
        product_id: product.id,
        product_code: product.code,
        product_name: product.name,
        unit_level: unit.unit_level,
        unit_mark: unit.unit_mark || '',
        qty: 1,
        unit_price_fc: unit.sale_price_fc,
        unit_price_usd: unit.sale_price_usd,
        subtotal_fc: unit.sale_price_fc,
        subtotal_usd: unit.sale_price_usd,
      };
      setCart([...cart, newItem]);
    }
  };

  // Modifier la quantité
  const updateQty = (index, delta) => {
    const newCart = [...cart];
    const newQty = newCart[index].qty + delta;
    
    if (newQty <= 0) {
      newCart.splice(index, 1);
    } else {
      newCart[index].qty = newQty;
      newCart[index].subtotal_fc = newQty * newCart[index].unit_price_fc;
      newCart[index].subtotal_usd = newQty * newCart[index].unit_price_usd;
    }
    setCart(newCart);
  };

  // Supprimer du panier
  const removeFromCart = (index) => {
    const newCart = [...cart];
    newCart.splice(index, 1);
    setCart(newCart);
  };

  // Calculer les totaux
  const totals = useMemo(() => {
    return cart.reduce((acc, item) => ({
      fc: acc.fc + item.subtotal_fc,
      usd: acc.usd + item.subtotal_usd,
      items: acc.items + item.qty
    }), { fc: 0, usd: 0, items: 0 });
  }, [cart]);

  // Formater le prix
  const formatPrice = (amount, curr) => {
    if (curr === 'USD') {
      return `$${amount.toFixed(2)}`;
    }
    return `${amount.toLocaleString()} FC`;
  };

  // Finaliser la vente
  const finalizeSale = async () => {
    if (cart.length === 0) {
      setUiError('Le panier est vide');
      return;
    }

    setProcessing(true);
    try {
      const saleData = {
        sold_at: new Date().toISOString(),
        client_name: clientName || null,
        seller_name: getSellerName(user),
        total_fc: totals.fc,
        total_usd: totals.usd,
        rate_fc_per_usd: currentRate,
        payment_mode: isDebt ? 'dette' : 'cash',
        paid_fc: isDebt ? 0 : totals.fc,
        paid_usd: isDebt ? 0 : totals.usd,
        status: isDebt ? 'unpaid' : 'paid',
        items: cart,
        printCurrency: currency,
        autoDette: isDebt,
      };

      const response = await axios.post(`${API_URL}/api/sales`, saleData);

      if (response.data.success) {
        setLastInvoice(response.data.sale?.invoice_number);
        setShowSuccess(true);
        setCart([]);
        setClientName('');
        setIsDebt(false);
        setShowCart(false);
        
        // Auto-hide success
        setTimeout(() => setShowSuccess(false), 3000);
      }
    } catch (error) {
      console.error('Erreur vente:', error);
      setUiError('Erreur lors de la vente');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col">
      {/* Header fixe */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-dark-800/95 backdrop-blur-sm border-b border-white/10 px-3 py-2 safe-area-top">
        <div className="flex items-center gap-2">
          {/* Logo */}
          <img 
            src="/asset/image/icon/photo.png" 
            alt="Logo" 
            className="w-8 h-8 object-contain"
          />
          <div className="flex-1">
            <h1 className="text-sm font-bold text-primary-400">LA GRACE</h1>
            <p className="text-[10px] text-gray-500">POS Mobile</p>
          </div>
          
          {/* Bouton Panier */}
          <m.button
            onClick={() => setShowCart(true)}
            whileTap={{ scale: 0.95 }}
            className="relative bg-primary-500/20 text-primary-400 px-3 py-2 rounded-lg flex items-center gap-2"
          >
            <ShoppingCart className="w-5 h-5" />
            {cart.length > 0 && (
              <m.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold"
              >
                {cart.length}
              </m.span>
            )}
          </m.button>
        </div>
      </header>

      {/* Barre de recherche */}
      <div className="fixed top-14 left-0 right-0 z-40 bg-dark-900 px-3 py-2 border-b border-white/5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un produit..."
            className="w-full bg-dark-700 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-primary-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Contenu principal - Liste produits */}
      <main className="flex-1 pt-28 pb-20 px-3 overflow-y-auto">
        {/* Message d'erreur */}
        <AnimatePresence>
          {uiError && (
            <m.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-3 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-xs text-red-300">{uiError}</span>
              <button onClick={() => setUiError(null)} className="ml-auto">
                <X className="w-4 h-4 text-red-400" />
              </button>
            </m.div>
          )}
        </AnimatePresence>

        {/* Succès vente */}
        <AnimatePresence>
          {showSuccess && (
            <m.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="mb-3 p-4 bg-green-500/20 border border-green-500/30 rounded-lg text-center"
            >
              <Check className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className="text-green-300 font-medium">Vente réussie!</p>
              {lastInvoice && (
                <p className="text-xs text-green-400/70">N° {lastInvoice}</p>
              )}
            </m.div>
          )}
        </AnimatePresence>

        {/* Grille de produits */}
        <div className="space-y-2">
          {filteredProducts.map((product) => (
            <m.div
              key={product.code}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-dark-800 rounded-xl border border-white/5 overflow-hidden"
            >
              {/* Nom du produit */}
              <div className="px-3 py-2 border-b border-white/5">
                <h3 className="text-sm font-medium text-white truncate">
                  {product.name}
                </h3>
                <p className="text-[10px] text-gray-500">{product.code}</p>
              </div>
              
              {/* Unités */}
              <div className="p-2 flex flex-wrap gap-1.5">
                {product.units.map((unit, idx) => {
                  const style = getUnitStyle(unit.unit_level);
                  const UnitIcon = style.icon;
                  const price = currency === 'USD' ? unit.sale_price_usd : unit.sale_price_fc;
                  
                  return (
                    <m.button
                      key={idx}
                      onClick={() => addToCart(product, unit)}
                      whileTap={{ scale: 0.95 }}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${style.bg} border border-white/10 active:border-primary-500`}
                    >
                      <UnitIcon className={`w-3.5 h-3.5 ${style.color}`} />
                      <div className="text-left">
                        <span className="text-[10px] text-gray-400 block">
                          {unit.unit_level}
                          {unit.unit_mark && ` - ${unit.unit_mark}`}
                        </span>
                        <span className="text-xs font-semibold text-white">
                          {formatPrice(price, currency)}
                        </span>
                      </div>
                      <Plus className="w-4 h-4 text-primary-400 ml-1" />
                    </m.button>
                  );
                })}
              </div>
            </m.div>
          ))}
          
          {filteredProducts.length === 0 && (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Aucun produit trouvé</p>
            </div>
          )}
        </div>
      </main>

      {/* Barre de total fixe en bas */}
      {cart.length > 0 && !showCart && (
        <m.div
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          className="fixed bottom-0 left-0 right-0 z-40 bg-dark-800/95 backdrop-blur-sm border-t border-white/10 px-3 py-3 safe-area-bottom"
        >
          <button
            onClick={() => setShowCart(true)}
            className="w-full bg-primary-500 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-3"
          >
            <ShoppingCart className="w-5 h-5" />
            <span>Voir Panier ({totals.items} articles)</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-sm">
              {formatPrice(currency === 'USD' ? totals.usd : totals.fc, currency)}
            </span>
          </button>
        </m.div>
      )}

      {/* Modal Panier */}
      <AnimatePresence>
        {showCart && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80"
            onClick={() => setShowCart(false)}
          >
            <m.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-0 left-0 right-0 bg-dark-800 rounded-t-2xl max-h-[85vh] flex flex-col"
            >
              {/* Header du panier */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-primary-400" />
                  Panier ({cart.length})
                </h2>
                <button onClick={() => setShowCart(false)}>
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              {/* Liste des articles */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {cart.map((item, index) => (
                  <div
                    key={index}
                    className="bg-dark-700 rounded-lg p-3 flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {item.product_name}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {item.unit_level} {item.unit_mark && `- ${item.unit_mark}`}
                      </p>
                      <p className="text-xs text-primary-400">
                        {formatPrice(currency === 'USD' ? item.subtotal_usd : item.subtotal_fc, currency)}
                      </p>
                    </div>
                    
                    {/* Contrôles quantité */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQty(index, -1)}
                        className="w-8 h-8 rounded-full bg-dark-600 flex items-center justify-center text-gray-400"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center text-white font-medium">
                        {item.qty}
                      </span>
                      <button
                        onClick={() => updateQty(index, 1)}
                        className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeFromCart(index)}
                        className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 ml-2"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Options de vente */}
              <div className="p-3 border-t border-white/10 space-y-3">
                {/* Nom client */}
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Nom du client (optionnel)"
                    className="w-full bg-dark-700 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-primary-500 focus:outline-none"
                  />
                </div>

                {/* Devise et Dette */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrency(currency === 'FC' ? 'USD' : 'FC')}
                    className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm font-medium ${
                      currency === 'FC' 
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-green-500/20 text-green-400 border border-green-500/30'
                    }`}
                  >
                    {currency === 'FC' ? <Banknote className="w-4 h-4" /> : <DollarSign className="w-4 h-4" />}
                    {currency}
                  </button>
                  <button
                    onClick={() => setIsDebt(!isDebt)}
                    className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm font-medium ${
                      isDebt 
                        ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                        : 'bg-dark-700 text-gray-400 border border-gray-600'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    {isDebt ? 'Dette' : 'Cash'}
                  </button>
                </div>

                {/* Total et Finaliser */}
                <div className="bg-dark-700 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-gray-400">Total</span>
                    <span className="text-xl font-bold text-white">
                      {formatPrice(currency === 'USD' ? totals.usd : totals.fc, currency)}
                    </span>
                  </div>
                  <button
                    onClick={finalizeSale}
                    disabled={processing || cart.length === 0}
                    className="w-full bg-green-500 disabled:bg-gray-600 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2"
                  >
                    {processing ? (
                      <>
                        <m.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        >
                          <Check className="w-5 h-5" />
                        </m.div>
                        Traitement...
                      </>
                    ) : (
                      <>
                        <Printer className="w-5 h-5" />
                        Finaliser la vente
                      </>
                    )}
                  </button>
                </div>
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>

      {/* Style pour safe-area */}
      <style>{`
        .safe-area-top { padding-top: env(safe-area-inset-top, 0); }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }
      `}</style>
    </div>
  );
};

export default SalesPOSPhone;
