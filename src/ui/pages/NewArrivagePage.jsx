/**
 * NewArrivagePage - Page de gestion des nouveaux arrivages
 * ✅ PRO: Affiche les modifications de stock + impression produits
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Package,
  RefreshCw,
  Printer,
  Download,
  Trash2,
  Filter,
  Calendar,
  TrendingUp,
  DollarSign,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  PackageX,
  Boxes
} from 'lucide-react';
import axios from 'axios';
import { useStore } from '../store/useStore';

const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');
const PRINT_API_URL = `${API_URL}/api/print`;

// Formatage des nombres
const formatNumber = (num) => {
  if (num === null || num === undefined) return '0';
  return new Intl.NumberFormat('fr-FR').format(Math.round(num));
};

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Label d'unité
const getUnitLabel = (unitLevel) => {
  const level = String(unitLevel || '').toUpperCase().trim();
  if (level === 'CARTON' || level === 'CTN') return 'Carton';
  if (level === 'MILLIER' || level === 'MILLIERS' || level === 'DETAIL') return 'Détail';
  if (level === 'PIECE' || level === 'PCE') return 'Pièce';
  return unitLevel || '-';
};

const NewArrivagePage = () => {
  const { products: storeProducts, loadProducts, token: storeToken } = useStore();
  
  const [modifications, setModifications] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState({
    unitLevel: '',
    showAllStock: false
  });
  
  // ✅ PRO: États pour les produits et impression
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [printProgress, setPrintProgress] = useState({ current: 0, total: 0, isActive: false });
  const [printMessage, setPrintMessage] = useState({ type: '', text: '' });
  const [activeTab, setActiveTab] = useState('arrivage'); // 'arrivage' | 'products' | 'empty'
  const printAbortRef = useRef(false);

  // Headers d'authentification
  const getAuthHeaders = useCallback(() => {
    const token = storeToken || localStorage.getItem('token');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  }, [storeToken]);

  // ✅ PRO: Charger les produits comme ProductsPage
  const loadAllProducts = useCallback(async () => {
    try {
      setProductsLoading(true);
      
      // Charger via le store
      await loadProducts();
      
      // Récupérer les produits du store
      const currentProducts = useStore.getState().products || [];
      setProducts(currentProducts);
      
    } catch (err) {
      console.error('Erreur chargement produits:', err);
    } finally {
      setProductsLoading(false);
    }
  }, [loadProducts]);

  // ✅ PRO: Charger les données avec timeout court
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      if (filter.unitLevel) params.append('unitLevel', filter.unitLevel);
      if (filter.showAllStock) params.append('showAllStock', 'true');
      
      const [modsRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/api/newarrivage?${params}`, { timeout: 2000 }),
        axios.get(`${API_URL}/api/newarrivage/stats`, { timeout: 2000 })
      ]);
      
      setModifications(modsRes.data || []);
      setStats(statsRes.data);
    } catch (err) {
      // Silencieux - afficher ce qu'on a
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadData();
    loadAllProducts();
  }, [loadData, loadAllProducts]);

  // Sync avec store
  useEffect(() => {
    if (storeProducts && storeProducts.length > 0) {
      setProducts(storeProducts);
    }
  }, [storeProducts]);

  // ✅ PRO: Produits avec stock vide (stock = 0)
  const emptyStockProducts = products.flatMap(product => {
    if (!product || !product.units) return [];
    return product.units
      .filter(unit => (unit.stock_current || 0) <= 0)
      .map(unit => ({
        ...product,
        unit,
        product_code: product.code,
        product_name: product.name,
        unit_level: unit.unit_level,
        unit_mark: unit.unit_mark || '',
        stock_current: unit.stock_current || 0,
        sale_price_fc: unit.sale_price_fc || 0
      }));
  });

  // ✅ PRO: Produits AVEC stock (stock > 0)
  const withStockProducts = products.flatMap(product => {
    if (!product || !product.units) return [];
    return product.units
      .filter(unit => (unit.stock_current || 0) > 0)
      .map(unit => ({
        ...product,
        unit,
        product_code: product.code,
        product_name: product.name,
        unit_level: unit.unit_level,
        unit_mark: unit.unit_mark || '',
        stock_current: unit.stock_current || 0,
        sale_price_fc: unit.sale_price_fc || 0
      }));
  });

  // ✅ PRO: Tous les produits aplatis
  const allProductsFlat = products.flatMap(product => {
    if (!product || !product.units) return [];
    return product.units.map(unit => ({
      ...product,
      unit,
      product_code: product.code,
      product_name: product.name,
      unit_level: unit.unit_level,
      unit_mark: unit.unit_mark || '',
      stock_current: unit.stock_current || 0,
      sale_price_fc: unit.sale_price_fc || 0
    }));
  });

  // Supprimer une modification
  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette modification ?')) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/api/newarrivage/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadData();
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
  };

  // Vider tout
  const handleDeleteAll = async () => {
    if (!confirm('Supprimer TOUTES les modifications ? Cette action est irréversible.')) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/api/newarrivage`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadData();
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
  };

  // Nettoyer les doublons
  const handleCleanDuplicates = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_URL}/api/newarrivage/clean-duplicates`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert(res.data.message);
      loadData();
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
  };

  // Export CSV
  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams();
      params.append('format', 'csv');
      if (filter.unitLevel) params.append('unitLevel', filter.unitLevel);
      
      const res = await axios.get(`${API_URL}/api/newarrivage/export?${params}`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `new-arrivage-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (err) {
      alert('Erreur export: ' + err.message);
    }
  };

  // Ouvrir export A4
  const handlePrintA4 = () => {
    const type = filter.unitLevel ? filter.unitLevel.toLowerCase() : 'newarrivage';
    window.open(`/export-a4.html?type=${type}&title=New Arrivage`, '_blank');
  };

  // ✅ PRO: Imprimer les produits (tickets verticaux)
  const handlePrintProducts = async (productsList, title = 'Produits') => {
    if (!productsList || productsList.length === 0) {
      setPrintMessage({ type: 'error', text: 'Aucun produit à imprimer' });
      setTimeout(() => setPrintMessage({ type: '', text: '' }), 2000);
      return;
    }

    try {
      printAbortRef.current = false;
      setPrintProgress({ current: 0, total: productsList.length, isActive: true });
      setPrintMessage({ type: 'info', text: `🖨️ Impression de ${productsList.length} produits...` });

      const BATCH_SIZE = 5;
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < productsList.length; i += BATCH_SIZE) {
        if (printAbortRef.current) {
          setPrintMessage({ type: 'error', text: 'Impression annulée' });
          break;
        }

        const batch = productsList.slice(i, i + BATCH_SIZE);
        
        const promises = batch.map(async (item, idx) => {
          const job = {
            template: 'receipt-produit-80mm',
            copies: 1,
            data: {
              nom: item.product_name || item.name || '-',
              prixFc: formatNumber(item.sale_price_fc || item.unit?.sale_price_fc || 0) + ' FC',
              unite: getUnitLabel(item.unit_level || item.unit?.unit_level),
              mark: item.unit_mark || item.unit?.unit_mark || '',
              stock: item.stock_current || item.unit?.stock_current || 0
            }
          };

          try {
            await axios.post(`${PRINT_API_URL}/jobs`, job, getAuthHeaders());
            return { success: true };
          } catch (error) {
            console.error(`❌ Erreur impression:`, error?.message);
            return { success: false };
          }
        });

        const results = await Promise.all(promises);
        results.forEach(r => r.success ? successCount++ : errorCount++);
        
        setPrintProgress(prev => ({ ...prev, current: Math.min(i + BATCH_SIZE, productsList.length) }));
      }

      if (!printAbortRef.current) {
        if (errorCount === 0) {
          setPrintMessage({ type: 'success', text: `✅ ${successCount} produits imprimés !` });
        } else {
          setPrintMessage({ type: 'warning', text: `⚠️ ${successCount} OK, ${errorCount} erreurs` });
        }
      }
    } catch (err) {
      setPrintMessage({ type: 'error', text: `❌ Erreur: ${err.message}` });
    } finally {
      setPrintProgress({ current: 0, total: 0, isActive: false });
      setTimeout(() => setPrintMessage({ type: '', text: '' }), 3000);
    }
  };

  // Annuler l'impression
  const handleCancelPrint = () => {
    printAbortRef.current = true;
    setPrintMessage({ type: 'info', text: 'Annulation...' });
  };

  // ✅ PRO: Impression A4 directe - ouvre et imprime automatiquement
  const handlePrintA4Direct = (productsList, title = 'Produits') => {
    if (!productsList || productsList.length === 0) {
      setPrintMessage({ type: 'error', text: 'Aucun produit à imprimer' });
      setTimeout(() => setPrintMessage({ type: '', text: '' }), 2000);
      return;
    }

    // Calculer les totaux
    const totalStock = productsList.reduce((acc, p) => acc + (p.stock_current || 0), 0);
    const totalValueFC = productsList.reduce((acc, p) => acc + ((p.stock_current || 0) * (p.sale_price_fc || 0)), 0);

    // Générer les lignes du tableau
    const tableRows = productsList.map((item, idx) => `
      <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f9f9f9'};">
        <td style="border: 1px solid #000; padding: 4px 8px; font-family: monospace; font-weight: bold;">${item.product_code || '-'}</td>
        <td style="border: 1px solid #000; padding: 4px 8px;">${item.product_name || '-'}</td>
        <td style="border: 1px solid #000; padding: 4px 8px; text-align: center;">${getUnitLabel(item.unit_level)}</td>
        <td style="border: 1px solid #000; padding: 4px 8px; text-align: center;">${item.unit_mark || '-'}</td>
        <td style="border: 1px solid #000; padding: 4px 8px; text-align: right; font-weight: bold; color: ${(item.stock_current || 0) > 0 ? '#16a34a' : '#dc2626'};">${formatNumber(item.stock_current || 0)}</td>
        <td style="border: 1px solid #000; padding: 4px 8px; text-align: right;">${formatNumber(item.sale_price_fc || 0)} FC</td>
        <td style="border: 1px solid #000; padding: 4px 8px; text-align: right; font-weight: bold;">${formatNumber((item.stock_current || 0) * (item.sale_price_fc || 0))} FC</td>
      </tr>
    `).join('');

    // HTML complet pour impression A4
    const printHTML = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>${title} - LA GRÂCE PRO</title>
        <style>
          @page { size: A4; margin: 10mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; background: #fff; }
          .header { text-align: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #000; }
          .header h1 { font-size: 18pt; margin-bottom: 5px; }
          .header .subtitle { font-size: 12pt; font-weight: bold; margin-bottom: 3px; }
          .header .date { font-size: 9pt; color: #666; }
          .stats { display: flex; justify-content: space-around; margin-bottom: 15px; padding: 10px; background: #f0f0f0; border: 1px solid #000; }
          .stat { text-align: center; }
          .stat-label { font-size: 8pt; color: #666; text-transform: uppercase; }
          .stat-value { font-size: 14pt; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; }
          th { background: #000; color: #fff; padding: 8px; text-align: left; font-size: 9pt; text-transform: uppercase; }
          th:nth-child(5), th:nth-child(6), th:nth-child(7) { text-align: right; }
          .footer { margin-top: 15px; text-align: center; font-size: 8pt; color: #666; border-top: 1px solid #ccc; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>LA GRÂCE PRO</h1>
          <div class="subtitle">${title}</div>
          <div class="date">Imprimé le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</div>
        </div>
        
        <div class="stats">
          <div class="stat">
            <div class="stat-label">Total Produits</div>
            <div class="stat-value">${formatNumber(productsList.length)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Stock Total</div>
            <div class="stat-value">${formatNumber(totalStock)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Valeur Totale</div>
            <div class="stat-value">${formatNumber(totalValueFC)} FC</div>
          </div>
        </div>
        
        <table>
          <thead>
            <tr>
              <th style="width: 10%;">Code</th>
              <th style="width: 30%;">Produit</th>
              <th style="width: 10%;">Unité</th>
              <th style="width: 10%;">Mark</th>
              <th style="width: 12%;">Stock</th>
              <th style="width: 14%;">Prix FC</th>
              <th style="width: 14%;">Total FC</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        
        <div class="footer">
          <strong>ALIMENTATION LA GRÂCE</strong> - Liste générée automatiquement
        </div>
        
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    // Ouvrir une nouvelle fenêtre et imprimer
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (printWindow) {
      printWindow.document.write(printHTML);
      printWindow.document.close();
    } else {
      setPrintMessage({ type: 'error', text: 'Popup bloqué - autorisez les popups' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Package className="w-8 h-8 text-primary-400" />
              New Arrivage
              <span className="ml-2 px-3 py-1 bg-primary-500/20 text-primary-400 rounded-full text-sm">
                {modifications.length}
              </span>
            </h1>
            <p className="text-gray-400 mt-1">
              Suivi des modifications de stock + Impression produits
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => { loadData(); loadAllProducts(); }}
              disabled={loading || productsLoading}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading || productsLoading ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="text-gray-400 text-xs uppercase mb-1">Produits</div>
              <div className="text-2xl font-bold text-primary-400">
                {formatNumber(stats.total_products)}
              </div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="text-gray-400 text-xs uppercase mb-1">Stock Total</div>
              <div className="text-2xl font-bold text-emerald-400">
                {formatNumber(stats.total_stock)}
              </div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="text-gray-400 text-xs uppercase mb-1">Valeur FC</div>
              <div className="text-2xl font-bold text-blue-400">
                {formatNumber(stats.total_value_fc)} FC
              </div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="text-gray-400 text-xs uppercase mb-1">Valeur USD</div>
              <div className="text-2xl font-bold text-yellow-400">
                {formatNumber(stats.total_value_usd)} $
              </div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="text-gray-400 text-xs uppercase mb-1">Stock Vide</div>
              <div className="text-2xl font-bold text-red-400">
                {formatNumber(emptyStockProducts.length)}
              </div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="text-gray-400 text-xs uppercase mb-1">Total Unités</div>
              <div className="text-2xl font-bold text-purple-400">
                {formatNumber(allProductsFlat.length)}
              </div>
            </div>
          </div>
        )}

        {/* Message d'impression */}
        {printMessage.text && (
          <div className={`mb-4 p-4 rounded-xl border flex items-center gap-3 ${
            printMessage.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
            printMessage.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
            printMessage.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' :
            'bg-blue-500/10 border-blue-500/30 text-blue-400'
          }`}>
            {printMessage.type === 'success' && <CheckCircle2 className="w-5 h-5" />}
            {printMessage.type === 'error' && <XCircle className="w-5 h-5" />}
            {printMessage.type === 'warning' && <AlertTriangle className="w-5 h-5" />}
            {printMessage.type === 'info' && <Loader2 className="w-5 h-5 animate-spin" />}
            <span>{printMessage.text}</span>
            
            {printProgress.isActive && (
              <div className="flex-1 flex items-center gap-3">
                <div className="flex-1 bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-primary-500 h-2 rounded-full transition-all"
                    style={{ width: `${(printProgress.current / printProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-sm">{printProgress.current}/{printProgress.total}</span>
                <button onClick={handleCancelPrint} className="text-red-400 hover:text-red-300">
                  Annuler
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6 bg-gray-800 p-2 rounded-xl border border-gray-700">
          <button
            onClick={() => setActiveTab('arrivage')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'arrivage' 
                ? 'bg-primary-500 text-white shadow-lg' 
                : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            <TrendingUp className="w-5 h-5" />
            New Arrivage
            <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs">{modifications.length}</span>
          </button>
          <button
            onClick={() => setActiveTab('products')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'products' 
                ? 'bg-blue-500 text-white shadow-lg' 
                : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            <Boxes className="w-5 h-5" />
            Tous
            <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs">{allProductsFlat.length}</span>
          </button>
          <button
            onClick={() => setActiveTab('withstock')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'withstock' 
                ? 'bg-emerald-500 text-white shadow-lg' 
                : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            <Package className="w-5 h-5" />
            Avec Stock
            <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs">{withStockProducts.length}</span>
          </button>
          <button
            onClick={() => setActiveTab('empty')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'empty' 
                ? 'bg-red-500 text-white shadow-lg' 
                : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            <PackageX className="w-5 h-5" />
            Stock Vide
            <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs">{emptyStockProducts.length}</span>
          </button>
        </div>

        {/* Tab Content: Arrivage */}
        {activeTab === 'arrivage' && (
          <>
            {/* Filtres Arrivage */}
            <div className="flex items-center gap-4 mb-6 bg-gray-800 p-4 rounded-xl border border-gray-700">
              <Filter className="w-5 h-5 text-gray-400" />
              <select
                value={filter.unitLevel}
                onChange={(e) => setFilter(f => ({ ...f, unitLevel: e.target.value }))}
                className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Toutes les unités</option>
                <option value="CARTON">Carton</option>
                <option value="MILLIER">Milliers</option>
                <option value="PIECE">Pièce</option>
              </select>
              
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filter.showAllStock}
                  onChange={(e) => setFilter(f => ({ ...f, showAllStock: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-300">Afficher tout le stock</span>
              </label>
              
              <div className="flex-1" />
              
              <button onClick={handleCleanDuplicates} className="btn-secondary flex items-center gap-2 text-sm">
                🧹 Nettoyer
              </button>
              <button onClick={handleExportCSV} className="btn-secondary flex items-center gap-2 text-sm">
                <Download className="w-4 h-4" /> CSV
              </button>
              <button onClick={handlePrintA4} className="btn-primary flex items-center gap-2 text-sm">
                <Printer className="w-4 h-4" /> Imprimer A4
              </button>
              <button onClick={handleDeleteAll} className="btn-danger flex items-center gap-2 text-sm">
                <Trash2 className="w-4 h-4" /> Vider
              </button>
            </div>

            {/* Table Arrivage */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-black border-b-2 border-gray-600">
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Code</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Produit</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Unité</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Stock</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Delta</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Prix FC</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Total FC</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-white uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center">
                          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-400" />
                          <p className="mt-2 text-gray-400">Chargement...</p>
                        </td>
                      </tr>
                    ) : modifications.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center">
                          <Package className="w-12 h-12 mx-auto text-gray-600" />
                          <p className="mt-2 text-gray-400">Aucune modification de stock</p>
                        </td>
                      </tr>
                    ) : (
                      modifications.map((mod, idx) => {
                        const delta = mod.delta || 0;
                        const totalFc = (mod.stock_after || 0) * (mod.sale_price_fc || 0);
                        
                        return (
                          <tr key={mod.id} className={`hover:bg-gray-700/30 transition-colors ${idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-850'}`}>
                            <td className="px-4 py-3 text-sm text-gray-300">{formatDate(mod.modified_at)}</td>
                            <td className="px-4 py-3">
                              <span className="font-mono font-bold text-primary-400">{mod.product_code}</span>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium">{mod.product_name || mod.current_product_name || '-'}</td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 bg-gray-700 rounded text-xs font-semibold">{mod.unit_level}</span>
                              {mod.unit_mark && <span className="ml-1 text-gray-400 text-xs">({mod.unit_mark})</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-bold">{formatNumber(mod.stock_after)}</td>
                            <td className={`px-4 py-3 text-right font-bold ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                              {delta > 0 ? '+' : ''}{formatNumber(delta)}
                            </td>
                            <td className="px-4 py-3 text-right text-pink-400">{formatNumber(mod.sale_price_fc)} FC</td>
                            <td className="px-4 py-3 text-right font-bold text-primary-400">{formatNumber(totalFc)} FC</td>
                            <td className="px-4 py-3 text-center">
                              <button onClick={() => handleDelete(mod.id)} className="p-2 hover:bg-red-500/20 rounded-lg text-red-400" title="Supprimer">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Tab Content: Tous les Produits */}
        {activeTab === 'products' && (
          <>
            {/* Actions Produits */}
            <div className="flex items-center gap-4 mb-6 bg-gray-800 p-4 rounded-xl border border-gray-700">
              <Boxes className="w-5 h-5 text-blue-400" />
              <span className="text-gray-300 font-medium">
                {allProductsFlat.length} produits au total
              </span>
              <div className="flex-1" />
              <button
                onClick={() => handlePrintA4Direct(allProductsFlat, 'Tous les Produits')}
                className="btn-secondary flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Imprimer A4
              </button>
              <button
                onClick={() => handlePrintProducts(allProductsFlat, 'Tous les produits')}
                disabled={printProgress.isActive || allProductsFlat.length === 0}
                className="btn-primary flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Imprimer Tickets ({allProductsFlat.length})
              </button>
            </div>

            {/* Table Produits */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-black border-b-2 border-blue-500">
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Code</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Produit</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Unité</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Mark</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Stock</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Prix FC</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-white uppercase tracking-wider">Imprimer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {productsLoading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center">
                          <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-400" />
                          <p className="mt-2 text-gray-400">Chargement des produits...</p>
                        </td>
                      </tr>
                    ) : allProductsFlat.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center">
                          <Boxes className="w-12 h-12 mx-auto text-gray-600" />
                          <p className="mt-2 text-gray-400">Aucun produit</p>
                        </td>
                      </tr>
                    ) : (
                      allProductsFlat.map((item, idx) => (
                        <tr key={`${item.product_code}-${item.unit_level}-${item.unit_mark}-${idx}`} 
                            className={`hover:bg-blue-500/10 transition-colors ${idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900'}`}>
                          <td className="px-4 py-3">
                            <span className="font-mono font-bold text-blue-400">{item.product_code}</span>
                          </td>
                          <td className="px-4 py-3 font-medium">{item.product_name}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded text-xs font-semibold">
                              {getUnitLabel(item.unit_level)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400">{item.unit_mark || '-'}</td>
                          <td className={`px-4 py-3 text-right font-bold ${item.stock_current > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatNumber(item.stock_current)}
                          </td>
                          <td className="px-4 py-3 text-right text-pink-400">{formatNumber(item.sale_price_fc)} FC</td>
                          <td className="px-4 py-3 text-center">
                            <button 
                              onClick={() => handlePrintProducts([item], item.product_name)}
                              className="p-2 hover:bg-blue-500/20 rounded-lg text-blue-400 transition-colors"
                              title="Imprimer ce produit"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Tab Content: Avec Stock */}
        {activeTab === 'withstock' && (
          <>
            {/* Actions Produits Avec Stock */}
            <div className="flex items-center gap-4 mb-6 bg-gray-800 p-4 rounded-xl border border-emerald-500/30">
              <Package className="w-5 h-5 text-emerald-400" />
              <span className="text-gray-300 font-medium">
                {withStockProducts.length} produits avec stock &gt; 0
              </span>
              <div className="flex-1" />
              <button
                onClick={() => handlePrintA4Direct(withStockProducts, 'Produits avec Stock')}
                className="btn-secondary flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Imprimer A4
              </button>
              <button
                onClick={() => handlePrintProducts(withStockProducts, 'Produits avec Stock')}
                disabled={printProgress.isActive || withStockProducts.length === 0}
                className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-semibold transition-colors"
              >
                <Printer className="w-4 h-4" />
                Imprimer Tickets ({withStockProducts.length})
              </button>
            </div>

            {/* Table Produits Avec Stock */}
            <div className="bg-gray-800 border border-emerald-500/30 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-emerald-900/50 border-b-2 border-emerald-500">
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Code</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Produit</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Unité</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Mark</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Stock</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Prix FC</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-white uppercase tracking-wider">Imprimer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {productsLoading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center">
                          <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-400" />
                          <p className="mt-2 text-gray-400">Chargement...</p>
                        </td>
                      </tr>
                    ) : withStockProducts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center">
                          <PackageX className="w-12 h-12 mx-auto text-gray-600" />
                          <p className="mt-2 text-gray-400">Aucun produit avec stock</p>
                        </td>
                      </tr>
                    ) : (
                      withStockProducts.map((item, idx) => (
                        <tr key={`withstock-${item.product_code}-${item.unit_level}-${item.unit_mark}-${idx}`} 
                            className={`hover:bg-emerald-500/10 transition-colors ${idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900'}`}>
                          <td className="px-4 py-3">
                            <span className="font-mono font-bold text-emerald-400">{item.product_code}</span>
                          </td>
                          <td className="px-4 py-3 font-medium">{item.product_name}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded text-xs font-semibold">
                              {getUnitLabel(item.unit_level)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400">{item.unit_mark || '-'}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="px-2 py-1 bg-emerald-500/30 text-emerald-400 rounded font-bold">
                              {formatNumber(item.stock_current)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-pink-400">{formatNumber(item.sale_price_fc)} FC</td>
                          <td className="px-4 py-3 text-center">
                            <button 
                              onClick={() => handlePrintProducts([item], item.product_name)}
                              className="p-2 hover:bg-emerald-500/20 rounded-lg text-emerald-400 transition-colors"
                              title="Imprimer ce produit"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Tab Content: Stock Vide */}
        {activeTab === 'empty' && (
          <>
            {/* Actions Stock Vide */}
            <div className="flex items-center gap-4 mb-6 bg-gray-800 p-4 rounded-xl border border-red-500/30">
              <PackageX className="w-5 h-5 text-red-400" />
              <span className="text-gray-300 font-medium">
                {emptyStockProducts.length} produits avec stock = 0
              </span>
              <div className="flex-1" />
              <button
                onClick={() => handlePrintA4Direct(emptyStockProducts, 'Stock Vide')}
                className="btn-secondary flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Imprimer A4
              </button>
              <button
                onClick={() => handlePrintProducts(emptyStockProducts, 'Stock Vide')}
                disabled={printProgress.isActive || emptyStockProducts.length === 0}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-semibold transition-colors"
              >
                <Printer className="w-4 h-4" />
                Imprimer Tickets ({emptyStockProducts.length})
              </button>
            </div>

            {/* Table Stock Vide */}
            <div className="bg-gray-800 border border-red-500/30 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-red-900/50 border-b-2 border-red-500">
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Code</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Produit</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Unité</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-white uppercase tracking-wider">Mark</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Stock</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-white uppercase tracking-wider">Prix FC</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-white uppercase tracking-wider">Imprimer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {productsLoading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center">
                          <Loader2 className="w-8 h-8 animate-spin mx-auto text-red-400" />
                          <p className="mt-2 text-gray-400">Chargement...</p>
                        </td>
                      </tr>
                    ) : emptyStockProducts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center">
                          <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
                          <p className="mt-2 text-emerald-400 font-semibold">Aucun produit avec stock vide !</p>
                          <p className="text-sm text-gray-500">Tous les produits ont du stock</p>
                        </td>
                      </tr>
                    ) : (
                      emptyStockProducts.map((item, idx) => (
                        <tr key={`empty-${item.product_code}-${item.unit_level}-${item.unit_mark}-${idx}`} 
                            className={`hover:bg-red-500/10 transition-colors ${idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900'}`}>
                          <td className="px-4 py-3">
                            <span className="font-mono font-bold text-red-400">{item.product_code}</span>
                          </td>
                          <td className="px-4 py-3 font-medium">{item.product_name}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-1 bg-red-500/20 text-red-300 rounded text-xs font-semibold">
                              {getUnitLabel(item.unit_level)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400">{item.unit_mark || '-'}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="px-2 py-1 bg-red-500/30 text-red-400 rounded font-bold">0</span>
                          </td>
                          <td className="px-4 py-3 text-right text-pink-400">{formatNumber(item.sale_price_fc)} FC</td>
                          <td className="px-4 py-3 text-center">
                            <button 
                              onClick={() => handlePrintProducts([item], item.product_name)}
                              className="p-2 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors"
                              title="Imprimer ce produit"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NewArrivagePage;
