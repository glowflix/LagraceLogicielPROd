import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { 
  TrendingUp, 
  BarChart3, 
  DollarSign,
  ShoppingCart,
  TrendingDown,
  RefreshCw,
  Wallet,
  CreditCard,
  Users,
  PiggyBank,
  AlertCircle,
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
const DEBT_COLORS = ['#ef4444', '#f59e0b', '#10b981'];

const AnalyticsPage = () => {
  const [summary, setSummary] = useState({
    todaySalesFC: 0,
    todaySalesUSD: 0,
    todayInvoices: 0,
    todayCollected: 0,
    todayCollectedFromSales: 0,
    todayDebtPaymentsFC: 0,
    conversionRate: 0,
    averageCart: 0,
  });
  const [debtStats, setDebtStats] = useState({
    totalDebts: 0,
    openDebtsCount: 0,
    partialDebtsCount: 0,
    paidDebtsCount: 0,
    totalRemainingFC: 0,
    totalRemainingUSD: 0,
    totalPaidFC: 0,
    recoveryRate: 0,
    paymentsToday: { fc: 0, usd: 0 },
    topDebtors: [],
    last7Days: [],
  });
  const [hourlyData, setHourlyData] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('ventes'); // 'ventes' ou 'dettes'

  useEffect(() => {
    loadAnalyticsData();
  }, []);

  // ✅ PRO ULTRA-RAPIDE: Un seul appel, timeout court, pas de retry
  const loadAnalyticsData = async () => {
    try {
      setLoading(true);
      setError(null);

      // ✅ TIMEOUT COURT: 2 secondes - pas d'attente
      const timeout = 2000;
      
      const [summaryRes, hourlyRes, productsRes, debtsRes] = await Promise.all([
        axios.get(`${API_URL}/api/analytics/summary`, { timeout }).catch(() => ({ data: summary })),
        axios.get(`${API_URL}/api/analytics/hourly`, { timeout }).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/analytics/top-products`, { timeout }).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/analytics/debts`, { timeout }).catch(() => ({ data: debtStats })),
      ]);

      setSummary(summaryRes.data);
      setHourlyData(hourlyRes.data);
      setTopProducts(productsRes.data);
      setDebtStats(debtsRes.data);
    } catch (err) {
      console.error('Erreur chargement analytics:', err);
      setError('Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ title, value, unit, icon: Icon, color, subtext, trend }) => (
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
        {trend !== undefined && (
          <div className={`flex items-center gap-1 mt-2 text-xs ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{Math.abs(trend).toFixed(1)}%</span>
          </div>
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

  // Données pour le graphique de répartition des dettes
  const debtStatusData = [
    { name: 'Ouvertes', value: debtStats.openDebtsCount || 0, color: '#ef4444' },
    { name: 'Partielles', value: debtStats.partialDebtsCount || 0, color: '#f59e0b' },
    { name: 'Payées', value: debtStats.paidDebtsCount || 0, color: '#10b981' },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <m.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-between flex-wrap gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2 flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-primary-400" />
            Statistiques & Analytics
          </h1>
          <p className="text-gray-400">Tableau de bord temps réel • Ventes & Dettes</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Onglets */}
          <div className="flex bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('ventes')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'ventes' 
                  ? 'bg-primary-600 text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              📊 Ventes
            </button>
            <button
              onClick={() => setActiveTab('dettes')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'dettes' 
                  ? 'bg-red-600 text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              💰 Dettes
            </button>
          </div>
          <m.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={loadAnalyticsData}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-5 h-5 text-primary-400 ${loading ? 'animate-spin' : ''}`} />
          </m.button>
        </div>
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

      {/* ========== ONGLET VENTES ========== */}
      {activeTab === 'ventes' && (
        <>
          {/* KPI Cards - Ventes */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Ventes du jour (FC)"
              value={summary.todaySalesFC}
              unit="FC"
              icon={DollarSign}
              color="from-green-500 to-emerald-600"
              subtext={`USD: $${(summary.todaySalesUSD || 0).toFixed(2)}`}
            />
            <StatCard
              title="Nombre de factures"
              value={summary.todayInvoices}
              unit="factures"
              icon={ShoppingCart}
              color="from-blue-500 to-cyan-600"
              subtext={`Panier moyen: ${(summary.averageCart || 0).toLocaleString('fr-FR')} FC`}
            />
            <StatCard
              title="Total encaissé"
              value={summary.todayCollected}
              unit="FC"
              icon={TrendingUp}
              color="from-orange-500 to-red-600"
              subtext={`Dont dettes: ${(summary.todayDebtPaymentsFC || 0).toLocaleString()} FC`}
            />
            <StatCard
              title="Taux de conversion"
              value={(summary.conversionRate || 0).toFixed(1)}
              unit="%"
              icon={TrendingDown}
              color="from-purple-500 to-pink-600"
              subtext="Factures payées / total"
            />
          </div>

          {/* Charts Grid - Ventes */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Ventes Horaires */}
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
                Collecte du jour
              </h2>
              <div className="h-80">
                {summary.todaySalesFC > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={totalRevenuePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={5}
                        label={({ name, value, percent }) =>
                          `${name}: ${(percent * 100).toFixed(0)}%`
                        }
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
                        formatter={(value) => value.toLocaleString('fr-FR') + ' FC'}
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
              Top 10 produits vendus aujourd'hui
            </h2>
            <div className="h-80">
              {topProducts.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProducts} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis type="number" stroke="#9ca3af" tick={{ fontSize: 12 }} />
                    <YAxis 
                      dataKey="name" 
                      type="category"
                      stroke="#9ca3af"
                      tick={{ fontSize: 11 }}
                      width={120}
                    />
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
                    <Bar dataKey="totalFC" fill="#3b82f6" name="Ventes (FC)" radius={[0, 4, 4, 0]} />
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
              <h3 className="text-lg font-bold text-gray-100 mb-4">Détail des ventes par produit</h3>
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
        </>
      )}

      {/* ========== ONGLET DETTES ========== */}
      {activeTab === 'dettes' && (
        <>
          {/* KPI Cards - Dettes */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Dettes"
              value={debtStats.totalDebts || 0}
              unit="dettes"
              icon={CreditCard}
              color="from-blue-500 to-blue-600"
              subtext={`${(debtStats.openDebtsCount || 0) + (debtStats.partialDebtsCount || 0)} actives`}
            />
            <StatCard
              title="Montant Restant"
              value={debtStats.totalRemainingFC || 0}
              unit="FC"
              icon={AlertCircle}
              color="from-red-500 to-red-600"
              subtext={`$${(debtStats.totalRemainingUSD || 0).toFixed(2)} USD`}
            />
            <StatCard
              title="Récupéré Aujourd'hui"
              value={debtStats.paymentsToday?.fc || 0}
              unit="FC"
              icon={PiggyBank}
              color="from-green-500 to-emerald-600"
              subtext={`$${(debtStats.paymentsToday?.usd || 0).toFixed(2)} USD`}
            />
            <StatCard
              title="Taux Recouvrement"
              value={debtStats.recoveryRate || 0}
              unit="%"
              icon={TrendingUp}
              color="from-purple-500 to-pink-600"
              subtext={`${debtStats.paidDebtsCount || 0} dettes payées`}
            />
          </div>

          {/* Charts Grid - Dettes */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Répartition par statut */}
            <m.div
              variants={cardVariants}
              initial="initial"
              animate="animate"
              className="card"
            >
              <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
                <Wallet className="w-6 h-6 text-primary-400" />
                Répartition par statut
              </h2>
              <div className="h-80">
                {debtStatusData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={debtStatusData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={5}
                        label={({ name, value, percent }) =>
                          `${name}: ${value} (${(percent * 100).toFixed(0)}%)`
                        }
                        dataKey="value"
                      >
                        {debtStatusData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: '1px solid #374151',
                          borderRadius: '0.5rem',
                          color: '#f3f4f6',
                        }}
                        formatter={(value) => `${value} dette(s)`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400">
                    Aucune dette
                  </div>
                )}
              </div>
            </m.div>

            {/* Évolution sur 7 jours */}
            <m.div
              variants={cardVariants}
              initial="initial"
              animate="animate"
              transition={{ delay: 0.1 }}
              className="card lg:col-span-2"
            >
              <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-primary-400" />
                Nouvelles dettes (7 derniers jours)
              </h2>
              <div className="h-80">
                {(debtStats.last7Days || []).length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={debtStats.last7Days}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis 
                        dataKey="label" 
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
                        formatter={(value, name) => {
                          if (name === 'newDebts') return [value.toLocaleString('fr-FR') + ' FC', 'Montant'];
                          return [value, 'Nombre'];
                        }}
                      />
                      <Legend />
                      <Bar dataKey="newDebts" fill="#ef4444" name="Montant (FC)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400">
                    Aucune donnée disponible
                  </div>
                )}
              </div>
            </m.div>
          </div>

          {/* Top Clients Endettés */}
          <m.div
            variants={cardVariants}
            initial="initial"
            animate="animate"
            transition={{ delay: 0.2 }}
            className="card"
          >
            <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
              <Users className="w-6 h-6 text-primary-400" />
              Top 10 Clients Endettés
            </h2>
            {(debtStats.topDebtors || []).length > 0 ? (
              <div className="space-y-4">
                {debtStats.topDebtors.map((client, idx) => {
                  const maxRemaining = debtStats.topDebtors[0]?.remaining_fc || 1;
                  const barWidth = ((client.remaining_fc || 0) / maxRemaining) * 100;
                  
                  return (
                    <m.div 
                      key={client.client_name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="relative"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            idx === 0 ? 'bg-red-500' : idx === 1 ? 'bg-orange-500' : idx === 2 ? 'bg-yellow-500' : 'bg-gray-600'
                          }`}>
                            {idx + 1}
                          </span>
                          <div>
                            <span className="text-gray-200 font-medium">{client.client_name}</span>
                            <span className="text-gray-500 text-xs ml-2">({client.count} dette{client.count > 1 ? 's' : ''})</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-red-400 font-bold text-lg">{(client.remaining_fc || 0).toLocaleString()} FC</span>
                        </div>
                      </div>
                      <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                        <m.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${barWidth}%` }}
                          transition={{ duration: 0.8, delay: idx * 0.1 }}
                          className="h-full bg-gradient-to-r from-red-500 to-orange-500 rounded-full"
                        />
                      </div>
                    </m.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Aucune dette active</p>
              </div>
            )}
          </m.div>

          {/* Résumé des dettes */}
          <m.div
            variants={cardVariants}
            initial="initial"
            animate="animate"
            transition={{ delay: 0.3 }}
            className="card"
          >
            <h3 className="text-lg font-bold text-gray-100 mb-4">Résumé des Dettes</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-center">
                <p className="text-red-400 text-3xl font-bold">{debtStats.openDebtsCount || 0}</p>
                <p className="text-gray-400 text-sm mt-1">Dettes Ouvertes</p>
              </div>
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-center">
                <p className="text-yellow-400 text-3xl font-bold">{debtStats.partialDebtsCount || 0}</p>
                <p className="text-gray-400 text-sm mt-1">Dettes Partielles</p>
              </div>
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl text-center">
                <p className="text-green-400 text-3xl font-bold">{debtStats.paidDebtsCount || 0}</p>
                <p className="text-gray-400 text-sm mt-1">Dettes Payées</p>
              </div>
              <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl text-center">
                <p className="text-blue-400 text-3xl font-bold">{(debtStats.totalPaidFC / 1000).toFixed(1)}k</p>
                <p className="text-gray-400 text-sm mt-1">Total Récupéré (FC)</p>
              </div>
            </div>
          </m.div>
        </>
      )}
    </div>
  );
};

export default AnalyticsPage;
