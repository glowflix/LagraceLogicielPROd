import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { 
  TrendingUp, 
  BarChart3, 
  DollarSign,
  ShoppingCart,
  TrendingDown,
  RefreshCw,
} from 'lucide-react';
import axios from 'axios';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';

const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

const cardVariants = {
  initial: { opacity: 0, y: 20, scale: 0.95 },
  animate: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.22, 1, 0.36, 1],
    }
  },
  hover: {
    y: -5,
    scale: 1.02,
    transition: {
      duration: 0.2,
      ease: 'easeOut',
    }
  }
};

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const AnalyticsPage = () => {
  const [summary, setSummary] = useState({
    todaySalesFC: 0,
    todaySalesUSD: 0,
    todayInvoices: 0,
    todayCollected: 0,
    todayCollectedFromSales: 0,
    conversionRate: 0,
    averageCart: 0,
  });
  const [hourlyData, setHourlyData] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAnalyticsData();
  }, []);

  const loadAnalyticsData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [summaryRes, hourlyRes, productsRes] = await Promise.all([
        axios.get(`${API_URL}/api/analytics/summary`).catch(() => ({ data: summary })),
        axios.get(`${API_URL}/api/analytics/hourly`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/analytics/top-products`).catch(() => ({ data: [] })),
      ]);

      setSummary(summaryRes.data);
      setHourlyData(hourlyRes.data);
      setTopProducts(productsRes.data);
    } catch (err) {
      console.error('Erreur chargement analytics:', err);
      setError('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ title, value, unit, icon: Icon, color, subtext }) => (
    <m.div
      variants={cardVariants}
      initial="initial"
      animate="animate"
      whileHover="hover"
      className="card relative overflow-hidden"
    >
      <div className="absolute inset-0 opacity-5">
        <Icon className="w-24 h-24 text-white absolute -bottom-4 -right-4" />
      </div>
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-400 font-medium text-sm">{title}</h3>
          <div className={`p-2 rounded-lg bg-gradient-to-br ${color}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <p className="text-3xl font-bold text-white">
            {typeof value === 'number' && value > 1000
              ? (value / 1000).toFixed(1) + 'k'
              : typeof value === 'number'
              ? value.toLocaleString('fr-FR')
              : value}
          </p>
          <p className="text-gray-400 text-sm">{unit}</p>
        </div>
        {subtext && (
          <p className="text-gray-500 text-xs mt-2">{subtext}</p>
        )}
      </div>
    </m.div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <m.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  const collectedForTodaySales = Number(summary.todayCollectedFromSales || 0);
  const pendingForTodaySales = Math.max(0, Number(summary.todaySalesFC || 0) - collectedForTodaySales);

  const totalRevenuePieData = [
    { name: 'Collecté', value: collectedForTodaySales },
    { name: 'En attente', value: pendingForTodaySales },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <m.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Statistiques</h1>
          <p className="text-gray-400">Données d'aujourd'hui - Analyses en temps réel</p>
        </div>
        <m.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={loadAnalyticsData}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
        >
          <RefreshCw className="w-5 h-5 text-primary-400" />
        </m.button>
      </m.div>

      {error && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-400"
        >
          {error}
        </m.div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Ventes du jour (FC)"
          value={summary.todaySalesFC}
          unit="FC"
          icon={DollarSign}
          color="from-green-500 to-emerald-600"
          subtext={`USD: $${summary.todaySalesUSD.toFixed(2)}`}
        />
        <StatCard
          title="Nombre de factures"
          value={summary.todayInvoices}
          unit="factures"
          icon={ShoppingCart}
          color="from-blue-500 to-cyan-600"
          subtext={`Panier moyen: ${summary.averageCart.toLocaleString('fr-FR')} FC`}
        />
        <StatCard
          title="Total encaissé"
          value={summary.todayCollected}
          unit="FC"
          icon={TrendingUp}
          color="from-orange-500 to-red-600"
          subtext={`Taux: ${summary.conversionRate.toFixed(1)}%`}
        />
        <StatCard
          title="Taux de conversion"
          value={summary.conversionRate.toFixed(1)}
          unit="%"
          icon={TrendingDown}
          color="from-purple-500 to-pink-600"
          subtext="Factures payées / total"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ventes Horaires - Grande zone */}
        <m.div
          variants={cardVariants}
          initial="initial"
          animate="animate"
          className="card lg:col-span-2"
        >
          <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary-400" />
            Ventes par heure
          </h2>
          <div className="h-80">
            {hourlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourlyData}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis 
                    dataKey="hourLabel" 
                    stroke="#9ca3af"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '0.5rem',
                      color: '#f3f4f6',
                    }}
                    formatter={(value) => [value.toLocaleString('fr-FR'), 'Ventes FC']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="salesFC" 
                    stroke="#3b82f6" 
                    fillOpacity={1} 
                    fill="url(#colorSales)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                Aucune donnée disponible
              </div>
            )}
          </div>
        </m.div>

        {/* Collecte vs Total */}
        <m.div
          variants={cardVariants}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.1 }}
          className="card"
        >
          <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary-400" />
            Collecte
          </h2>
          <div className="h-80">
            {summary.todaySalesFC > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={totalRevenuePieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value, percent }) =>
                      `${name}: ${(percent * 100).toFixed(0)}%`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {totalRevenuePieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '0.5rem',
                      color: '#f3f4f6',
                    }}
                    formatter={(value) => value.toLocaleString('fr-FR')}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                Aucune vente
              </div>
            )}
          </div>
        </m.div>
      </div>

      {/* Top Produits */}
      <m.div
        variants={cardVariants}
        initial="initial"
        animate="animate"
        transition={{ delay: 0.2 }}
        className="card"
      >
        <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
          <ShoppingCart className="w-6 h-6 text-primary-400" />
          Top 10 produits
        </h2>
        <div className="h-80">
          {topProducts.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="name" 
                  stroke="#9ca3af"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '0.5rem',
                    color: '#f3f4f6',
                  }}
                  formatter={(value) => value.toLocaleString('fr-FR')}
                />
                <Legend />
                <Bar dataKey="totalFC" fill="#3b82f6" name="Ventes (FC)" />
                <Bar dataKey="totalQty" fill="#10b981" name="Quantité" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              Aucun produit vendu aujourd'hui
            </div>
          )}
        </div>
      </m.div>

      {/* Table produits */}
      {topProducts.length > 0 && (
        <m.div
          variants={cardVariants}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.3 }}
          className="card overflow-x-auto"
        >
          <h3 className="text-lg font-bold text-gray-100 mb-4">Détail des ventes</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Produit</th>
                <th className="text-center py-3 px-4 text-gray-400 font-semibold">Quantité</th>
                <th className="text-right py-3 px-4 text-gray-400 font-semibold">Montant FC</th>
                <th className="text-right py-3 px-4 text-gray-400 font-semibold">Montant USD</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((product, index) => (
                <m.tr
                  key={product.code}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
                >
                  <td className="py-3 px-4 text-gray-200">{product.name}</td>
                  <td className="text-center py-3 px-4 text-gray-300">{product.totalQty.toFixed(2)}</td>
                  <td className="text-right py-3 px-4 text-green-400 font-semibold">
                    {product.totalFC.toLocaleString('fr-FR')} FC
                  </td>
                  <td className="text-right py-3 px-4 text-blue-400 font-semibold">
                    ${product.totalUSD.toFixed(2)}
                  </td>
                </m.tr>
              ))}
            </tbody>
          </table>
        </m.div>
      )}
    </div>
  );
};

export default AnalyticsPage;

