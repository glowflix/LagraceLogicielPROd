/**
 * NewArrivagePage - Page de gestion des nouveaux arrivages
 * Affiche les modifications de stock récentes avec export A4
 */

import { useState, useEffect, useCallback } from 'react';
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
  XCircle
} from 'lucide-react';
import axios from 'axios';

const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

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

const NewArrivagePage = () => {
  const [modifications, setModifications] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState({
    unitLevel: '',
    showAllStock: false
  });

  // Charger les données
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      if (filter.unitLevel) params.append('unitLevel', filter.unitLevel);
      if (filter.showAllStock) params.append('showAllStock', 'true');
      
      const [modsRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/api/newarrivage?${params}`),
        axios.get(`${API_URL}/api/newarrivage/stats`)
      ]);
      
      setModifications(modsRes.data || []);
      setStats(statsRes.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
              Suivi des modifications de stock récentes
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              disabled={loading}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
            <button
              onClick={handleCleanDuplicates}
              className="btn-secondary flex items-center gap-2"
            >
              🧹 Nettoyer
            </button>
            <button
              onClick={handleExportCSV}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
            <button
              onClick={handlePrintA4}
              className="btn-primary flex items-center gap-2"
            >
              <Printer className="w-4 h-4" />
              Imprimer A4
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
              <div className="text-gray-400 text-xs uppercase mb-1">Carton</div>
              <div className="text-2xl font-bold text-purple-400">
                {formatNumber(stats.total_stock_carton)}
              </div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="text-gray-400 text-xs uppercase mb-1">Modifications</div>
              <div className="text-2xl font-bold text-pink-400">
                {formatNumber(stats.total_modifications)}
              </div>
            </div>
          </div>
        )}

        {/* Filtres */}
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
          
          <button
            onClick={handleDeleteAll}
            className="btn-danger flex items-center gap-2 text-sm"
          >
            <Trash2 className="w-4 h-4" />
            Vider Tout
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-300">{error}</span>
          </div>
        )}

        {/* Table */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-900/50 border-b border-gray-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Code</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Produit</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Unité</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase">Stock</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase">Delta</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase">Prix FC</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase">Total FC</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase">Actions</th>
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
                      <p className="text-sm text-gray-500">Les modifications apparaîtront ici lorsque vous modifierez le stock d'un produit</p>
                    </td>
                  </tr>
                ) : (
                  modifications.map((mod) => {
                    const delta = mod.delta || 0;
                    const totalFc = (mod.stock_after || 0) * (mod.sale_price_fc || 0);
                    
                    return (
                      <tr key={mod.id} className="hover:bg-gray-700/30 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {formatDate(mod.modified_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-primary-400">
                            {mod.product_code}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {mod.product_name || mod.current_product_name || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 bg-gray-700 rounded text-xs">
                            {mod.unit_level}
                          </span>
                          {mod.unit_mark && (
                            <span className="ml-1 text-gray-400 text-xs">
                              ({mod.unit_mark})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold">
                          {formatNumber(mod.stock_after)}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                          {delta > 0 ? '+' : ''}{formatNumber(delta)}
                        </td>
                        <td className="px-4 py-3 text-right text-pink-400">
                          {formatNumber(mod.sale_price_fc)} FC
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-primary-400">
                          {formatNumber(totalFc)} FC
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleDelete(mod.id)}
                            className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-red-400"
                            title="Supprimer"
                          >
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
      </div>
    </div>
  );
};

export default NewArrivagePage;
