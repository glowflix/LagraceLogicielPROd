import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  Receipt,
  TrendingUp,
  AlertTriangle,
  ShoppingCart,
  Package,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

const Dashboard = () => {
  const { loadSales, loadProducts } = useStore();
  const [stats, setStats] = useState({
    todaySalesFC: 0,
    todaySalesUSD: 0,
    todayInvoices: 0,
    todayCollected: 0,
    openDebts: 0,
    openDebtsCount: 0,
    lowStock: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
    // Charger aussi les ventes et produits pour avoir les données à jour
    loadSales().catch(err => console.error('Erreur chargement ventes:', err));
    loadProducts().catch(err => console.error('Erreur chargement produits:', err));
  }, [loadSales, loadProducts]);

  const loadDashboardData = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/analytics/today`);
      if (response.data) {
        setStats(response.data);
      }
    } catch (error) {
      console.error('Erreur chargement dashboard:', error);
      // Mode offline: utiliser données locales
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: 'Ventes du jour (FC)',
      value: stats.todaySalesFC.toLocaleString(),
      unit: 'FC',
      icon: DollarSign,
      color: 'from-green-500 to-emerald-600',
      link: '/sales/history',
    },
    {
      title: 'Ventes du jour (USD)',
      value: stats.todaySalesUSD.toFixed(2),
      unit: 'USD',
      icon: DollarSign,
      color: 'from-blue-500 to-cyan-600',
      link: '/sales/history',
    },
    {
      title: 'Factures du jour',
      value: stats.todayInvoices,
      unit: 'factures',
      icon: Receipt,
      color: 'from-purple-500 to-pink-600',
      link: '/sales/history',
    },
    {
      title: 'Total encaissé',
      value: stats.todayCollected.toLocaleString(),
      unit: 'FC',
      icon: TrendingUp,
      color: 'from-orange-500 to-red-600',
      link: '/analytics',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header avec animation */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-100 to-gray-300 bg-clip-text text-transparent mb-3">
          Tableau de bord
        </h1>
        <p className="text-gray-400 text-lg">Vue d'ensemble de votre activité</p>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Link key={index} to={card.link}>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ scale: 1.05, y: -5 }}
                className="card relative overflow-hidden group cursor-pointer"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${card.color} opacity-10 group-hover:opacity-20 transition-opacity`} />
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`p-3 rounded-lg bg-gradient-to-br ${card.color}`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-primary-400 transition-colors" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-400 mb-1">{card.title}</h3>
                  <p className="text-3xl font-bold text-gray-100">
                    {card.value}
                    <span className="text-lg text-gray-400 ml-2">{card.unit}</span>
                  </p>
                </div>
              </motion.div>
            </Link>
          );
        })}
      </div>

      {/* Dettes & Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dettes ouvertes */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-100">Dettes ouvertes</h2>
            <Link
              to="/debts"
              className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1"
            >
              Voir tout <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 glass rounded-lg">
              <div>
                <p className="text-sm text-gray-400">Montant total</p>
                <p className="text-2xl font-bold text-gray-100">
                  {stats.openDebts.toLocaleString()} FC
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-400">Nombre</p>
                <p className="text-2xl font-bold text-primary-400">
                  {stats.openDebtsCount}
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Stock faible */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              Stock faible
            </h2>
            <Link
              to="/products"
              className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1"
            >
              Voir tout <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {stats.lowStock.length > 0 ? (
              stats.lowStock.map((item, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="p-3 glass rounded-lg flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-200">{item.name}</p>
                    <p className="text-xs text-gray-400">{item.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-yellow-400">
                      {item.stock_current} {item.unit_mark}
                    </p>
                  </div>
                </motion.div>
              ))
            ) : (
              <p className="text-center text-gray-400 py-4">Aucun stock faible</p>
            )}
          </div>
        </motion.div>
      </div>

      {/* Actions rapides */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <h2 className="text-xl font-bold text-gray-100 mb-4">Actions rapides</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/sales">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-4 glass rounded-lg text-center cursor-pointer hover:bg-white/10 transition-all"
            >
              <ShoppingCart className="w-8 h-8 mx-auto mb-2 text-primary-400" />
              <p className="text-sm font-medium text-gray-200">Nouvelle vente</p>
            </motion.div>
          </Link>
          <Link to="/products">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-4 glass rounded-lg text-center cursor-pointer hover:bg-white/10 transition-all"
            >
              <Package className="w-8 h-8 mx-auto mb-2 text-primary-400" />
              <p className="text-sm font-medium text-gray-200">Produits</p>
            </motion.div>
          </Link>
          <Link to="/analytics">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-4 glass rounded-lg text-center cursor-pointer hover:bg-white/10 transition-all"
            >
              <TrendingUp className="w-8 h-8 mx-auto mb-2 text-primary-400" />
              <p className="text-sm font-medium text-gray-200">Statistiques</p>
            </motion.div>
          </Link>
          <Link to="/sync">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-4 glass rounded-lg text-center cursor-pointer hover:bg-white/10 transition-all"
            >
              <RefreshCw className="w-8 h-8 mx-auto mb-2 text-primary-400" />
              <p className="text-sm font-medium text-gray-200">Synchronisation</p>
            </motion.div>
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default Dashboard;

