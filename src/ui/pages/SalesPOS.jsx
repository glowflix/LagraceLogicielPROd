import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  DollarSign,
  CreditCard,
  Printer,
  X,
  Check,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

const SalesPOS = () => {
  const {
    products,
    cart,
    saleCurrency,
    currentRate,
    addToCart,
    removeFromCart,
    updateCartItem,
    clearCart,
    createSale,
    loadProducts,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [qty, setQty] = useState(1);
  const [clientName, setClientName] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    loadProducts();
    // Focus sur la recherche au chargement
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [loadProducts]);

  // Filtrer les produits
  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculer le total
  const totalFC = cart.reduce((sum, item) => sum + item.subtotal_fc, 0);
  const totalUSD = cart.reduce((sum, item) => sum + item.subtotal_usd, 0);

  const handleAddToCart = () => {
    if (selectedProduct && selectedUnit && qty > 0) {
      addToCart(selectedProduct, selectedUnit, qty);
      setSelectedProduct(null);
      setSelectedUnit(null);
      setQty(1);
      setSearchQuery('');
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }
  };

  const handleQtyChange = (index, delta) => {
    const item = cart[index];
    const newQty = Math.max(0.25, item.qty + delta);
    if (newQty % item.qty_step < 0.01 || newQty % item.qty_step > item.qty_step - 0.01) {
      updateCartItem(index, { qty: newQty, qty_label: newQty.toString() });
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    setProcessing(true);

    const invoiceNumber = `INV-${Date.now()}`;
    const saleData = {
      invoice_number: invoiceNumber,
      sold_at: new Date().toISOString(),
      client_name: clientName || null,
      seller_name: useStore.getState().user?.username || 'System',
      total_fc: totalFC,
      total_usd: totalUSD,
      rate_fc_per_usd: currentRate,
      payment_mode: paymentMode,
      paid_fc: paymentMode === 'cash' ? totalFC : 0,
      paid_usd: paymentMode === 'cash' ? totalUSD : 0,
      status: paymentMode === 'cash' ? 'paid' : 'unpaid',
      items: cart,
    };

    const result = await createSale(saleData);

    if (result.success) {
      // Imprimer si demandé
      if (paymentMode === 'cash') {
        try {
          await axios.post(`${API_URL}/api/sales/${result.sale.invoice_number}/print`, {
            template: 'receipt-80',
          });
        } catch (error) {
          console.error('Erreur impression:', error);
        }
      }

      setShowPaymentModal(false);
      clearCart();
      setClientName('');
      setPaymentMode('cash');
    }

    setProcessing(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Point de Vente</h1>
          <p className="text-gray-400">Enregistrez vos ventes rapidement</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="glass px-4 py-2 rounded-lg">
            <span className="text-sm text-gray-400">Taux: </span>
            <span className="font-semibold text-primary-400">{currentRate} FC/USD</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne gauche - Recherche produits */}
        <div className="lg:col-span-2 space-y-4">
          {/* Recherche */}
          <div className="card">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un produit par nom ou code..."
                className="input-field pl-10"
              />
            </div>
          </div>

          {/* Liste produits */}
          <div className="card max-h-[600px] overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <AnimatePresence>
                {filteredProducts.map((product) => (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      setSelectedProduct(product);
                      // Prendre la première unité disponible
                      const units = products.filter((p) => p.product_id === product.id);
                      if (units.length > 0) {
                        setSelectedUnit(units[0]);
                      }
                    }}
                    className="p-4 glass rounded-lg cursor-pointer hover:bg-white/10 transition-all"
                  >
                    <p className="font-semibold text-gray-200">{product.name}</p>
                    <p className="text-sm text-gray-400">{product.code}</p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Colonne droite - Panier */}
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                <ShoppingCart className="w-6 h-6" />
                Panier
              </h2>
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="text-sm text-red-400 hover:text-red-300"
                >
                  Vider
                </button>
              )}
            </div>

            {/* Items du panier */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              <AnimatePresence>
                {cart.map((item, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="p-3 glass rounded-lg"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-gray-200 text-sm">
                          {item.product_name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {item.unit_mark} - {item.unit_level}
                        </p>
                      </div>
                      <button
                        onClick={() => removeFromCart(index)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleQtyChange(index, -0.25)}
                          className="p-1 glass rounded hover:bg-white/10"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-sm font-semibold text-gray-200 w-12 text-center">
                          {item.qty}
                        </span>
                        <button
                          onClick={() => handleQtyChange(index, 0.25)}
                          className="p-1 glass rounded hover:bg-white/10"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-primary-400">
                          {item.subtotal_fc.toLocaleString()} FC
                        </p>
                        <p className="text-xs text-gray-400">
                          {item.unit_price_fc.toLocaleString()} FC/u
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {cart.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <ShoppingCart className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Panier vide</p>
                </div>
              )}
            </div>

            {/* Total */}
            {cart.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 pt-4 border-t border-white/10"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Total FC:</span>
                  <span className="text-xl font-bold text-primary-400">
                    {totalFC.toLocaleString()} FC
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Total USD:</span>
                  <span className="text-lg font-semibold text-gray-300">
                    ${totalUSD.toFixed(2)}
                  </span>
                </div>
                <button
                  onClick={() => setShowPaymentModal(true)}
                  className="btn-primary w-full mt-4"
                >
                  <DollarSign className="w-5 h-5 inline mr-2" />
                  Payer
                </button>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Paiement */}
      <AnimatePresence>
        {showPaymentModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => !processing && setShowPaymentModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-strong rounded-2xl p-6 max-w-md w-full"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-100">Paiement</h2>
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="text-gray-400 hover:text-gray-200"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Client (optionnel)
                  </label>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Nom du client"
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Mode de paiement
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setPaymentMode('cash')}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        paymentMode === 'cash'
                          ? 'border-primary-500 bg-primary-500/20'
                          : 'border-dark-600 glass'
                      }`}
                    >
                      <DollarSign className="w-6 h-6 mx-auto mb-2 text-primary-400" />
                      <span className="text-sm font-medium">Cash</span>
                    </button>
                    <button
                      onClick={() => setPaymentMode('dette')}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        paymentMode === 'dette'
                          ? 'border-primary-500 bg-primary-500/20'
                          : 'border-dark-600 glass'
                      }`}
                    >
                      <CreditCard className="w-6 h-6 mx-auto mb-2 text-primary-400" />
                      <span className="text-sm font-medium">Dette</span>
                    </button>
                  </div>
                </div>

                <div className="glass p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-400">Total à payer:</span>
                    <span className="text-2xl font-bold text-primary-400">
                      {totalFC.toLocaleString()} FC
                    </span>
                  </div>
                  <div className="text-sm text-gray-400 text-right">
                    ≈ ${totalUSD.toFixed(2)} USD
                  </div>
                </div>

                <button
                  onClick={handleCheckout}
                  disabled={processing}
                  className="btn-primary w-full"
                >
                  {processing ? (
                    <span className="flex items-center justify-center gap-2">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Check className="w-5 h-5" />
                      </motion.div>
                      Traitement...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Check className="w-5 h-5" />
                      Valider la vente
                    </span>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SalesPOS;

