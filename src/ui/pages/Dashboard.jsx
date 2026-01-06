import { memo, useMemo } from 'react';
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
  Wifi,
  WifiOff,
} from 'lucide-react';

// ✅ Imports optimisés
import { useLocalAnalytics } from '../hooks/useLocalData';
import { useIsOnline, useDataActions } from '../store/selectors';
import { SkeletonDashboard, WithSkeleton } from '../components/Skeleton';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DASHBOARD OPTIMISÉ - Chargement local-first instantané
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Optimisations:
 * - useLocalAnalytics: données en cache affichées immédiatement
 * - Skeleton pendant le premier chargement uniquement
 * - Memo sur tous les composants
 * - Pas d'animations lourdes au chargement
 * - Refresh en arrière-plan (pas de loading visible)
 */

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSANTS MEMOIZÉS
// ═══════════════════════════════════════════════════════════════════════════

const StatCard = memo(({ title, value, unit, icon: Icon, color, link }) => (
  <Link to={link}>
    <div className="card relative overflow-hidden group cursor-pointer transition-transform duration-200 hover:scale-[1.02] hover:-translate-y-1">
      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-10 group-hover:opacity-20 transition-opacity`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div className={`p-3 rounded-lg bg-gradient-to-br ${color}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-primary-400 transition-colors" />
        </div>
        <h3 className="text-sm font-medium text-gray-400 mb-1">{title}</h3>
        <p className="text-3xl font-bold text-gray-100">
          {value}
          <span className="text-lg text-gray-400 ml-2">{unit}</span>
        </p>
      </div>
    </div>
  </Link>
));

StatCard.displayName = 'StatCard';

const QuickActionButton = memo(({ to, icon: Icon, label }) => (
  <Link to={to}>
    <div className="p-4 glass rounded-lg text-center cursor-pointer hover:bg-white/10 transition-all duration-200 hover:scale-105">
      <Icon className="w-8 h-8 mx-auto mb-2 text-primary-400" />
      <p className="text-sm font-medium text-gray-200">{label}</p>
    </div>
  </Link>
));

QuickActionButton.displayName = 'QuickActionButton';

const LowStockItem = memo(({ item }) => (
  <div className="p-3 glass rounded-lg flex items-center justify-between">
    <div>
      <p className="font-medium text-gray-200">{item.name}</p>
      <p className="text-xs text-gray-400">{item.code}</p>
    </div>
    <div className="text-right">
      <p className="text-sm font-bold text-yellow-400">
        {item.stock_current} {item.unit_mark}
      </p>
    </div>
  </div>
));

LowStockItem.displayName = 'LowStockItem';

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

const Dashboard = () => {
  // ✅ LOCAL-FIRST: Données en cache affichées immédiatement
  const { data: stats, loading, isStale, refresh } = useLocalAnalytics();
  const isOnline = useIsOnline();
  const { loadProducts, loadSales } = useDataActions();
  
  // Charger les données en arrière-plan au montage
  // (le hook useLocalAnalytics gère déjà le fetch)
  
  // ✅ Memoized stat cards configuration
  const statCards = useMemo(() => [
    {
      title: 'Ventes du jour (FC)',
      value: (stats?.todaySalesFC || 0).toLocaleString(),
      unit: 'FC',
      icon: DollarSign,
      color: 'from-green-500 to-emerald-600',
      link: '/sales/history',
    },
    {
      title: 'Ventes du jour (USD)',
      value: (stats?.todaySalesUSD || 0).toFixed(2),
      unit: 'USD',
      icon: DollarSign,
      color: 'from-blue-500 to-cyan-600',
      link: '/sales/history',
    },
    {
      title: 'Factures du jour',
      value: stats?.todayInvoices || 0,
      unit: 'factures',
      icon: Receipt,
      color: 'from-purple-500 to-pink-600',
      link: '/sales/history',
    },
    {
      title: 'Total encaissé',
      value: (stats?.todayCollected || 0).toLocaleString(),
      unit: 'FC',
      icon: TrendingUp,
      color: 'from-orange-500 to-red-600',
      link: '/analytics',
    },
  ], [stats]);
  
  // Afficher le skeleton uniquement au premier chargement (pas de données)
  const showSkeleton = loading && !stats?.todayInvoices && stats?.todayInvoices !== 0;
  
  if (showSkeleton) {
    return <SkeletonDashboard />;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-100 to-gray-300 bg-clip-text text-transparent mb-3">
            Tableau de bord
          </h1>
          <div className="flex items-center gap-3">
            <p className="text-gray-400 text-lg">Vue d'ensemble de votre activité</p>
            {/* Indicateur de statut */}
            <div className="flex items-center gap-1.5">
              {isOnline ? (
                <Wifi size={14} className="text-green-500" />
              ) : (
                <WifiOff size={14} className="text-red-500" />
              )}
              {isStale && (
                <span className="text-xs text-yellow-500">(données en cache)</span>
              )}
            </div>
          </div>
        </div>
        
        {/* Bouton refresh discret */}
        <button
          onClick={refresh}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors group"
          title="Actualiser les données"
        >
          <RefreshCw 
            size={20} 
            className={`text-gray-400 group-hover:text-primary-400 transition-colors ${loading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* Stats Cards - Affichées immédiatement avec les données en cache */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, index) => (
          <StatCard key={index} {...card} />
        ))}
      </div>

      {/* Dettes & Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dettes ouvertes */}
        <div className="card">
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
                  {(stats?.openDebts || 0).toLocaleString()} FC
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-400">Nombre</p>
                <p className="text-2xl font-bold text-primary-400">
                  {stats?.openDebtsCount || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Stock faible */}
        <div className="card">
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
            {stats?.lowStock?.length > 0 ? (
              stats.lowStock.map((item, index) => (
                <LowStockItem key={item.code || index} item={item} />
              ))
            ) : (
              <p className="text-center text-gray-400 py-4">Aucun stock faible</p>
            )}
          </div>
        </div>
      </div>

      {/* Actions rapides */}
      <div className="card">
        <h2 className="text-xl font-bold text-gray-100 mb-4">Actions rapides</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickActionButton to="/sales" icon={ShoppingCart} label="Nouvelle vente" />
          <QuickActionButton to="/products" icon={Package} label="Produits" />
          <QuickActionButton to="/analytics" icon={TrendingUp} label="Statistiques" />
          <QuickActionButton to="/sync" icon={RefreshCw} label="Synchronisation" />
        </div>
      </div>
    </div>
  );
};

export default memo(Dashboard);
