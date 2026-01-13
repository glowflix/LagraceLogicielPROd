import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { 
  DollarSign, 
  CreditCard, 
  Calendar, 
  User, 
  AlertCircle, 
  TrendingUp, 
  RefreshCw, 
  Plus, 
  CheckCircle,
  Wallet,
  PiggyBank,
  Clock,
  ChevronDown,
  ChevronUp,
  Search,
  Filter
} from 'lucide-react';
import { useOfflineDebts } from '../hooks/useOfflineFirst';
import VirtualList from '../components/VirtualList';
import axios from 'axios';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6'];

// Taux de change par défaut si non récupéré
const DEFAULT_RATE = 2800;

// Composant de ligne de dette memoizé pour performance
const DebtRow = memo(({ debt, index, onPay, exchangeRate }) => {
  const isPaid = debt.status === 'paid' || debt.status === 'closed';
  const progressPercent = debt.total_fc > 0 ? ((debt.paid_fc / debt.total_fc) * 100) : 0;
  
  // Calculer USD
  const rate = exchangeRate || DEFAULT_RATE;
  const remainingUSD = debt.remaining_fc / rate;
  const totalUSD = debt.total_usd || (debt.total_fc / rate);
  
  return (
    <div className={`p-4 bg-gray-800/70 backdrop-blur rounded-xl border-l-4 ${
      isPaid ? 'border-green-500' : debt.status === 'partial' ? 'border-yellow-500' : 'border-red-500'
    } hover:bg-gray-800 transition-all duration-200`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-gray-400" />
            <p className="font-bold text-gray-100 truncate">{debt.client_name}</p>
          </div>
          
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
            {debt.invoice_number && (
              <span className="flex items-center gap-1">
                <CreditCard className="w-3 h-3" />
                {debt.invoice_number}
              </span>
            )}
            {debt.product_description && (
              <span className="truncate max-w-[200px]">{debt.product_description}</span>
            )}
            {debt.created_at && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {format(new Date(debt.created_at), 'dd MMM yyyy', { locale: fr })}
              </span>
            )}
          </div>
          
          {/* Barre de progression */}
          <div className="mb-2">
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${
                  isPaid ? 'bg-green-500' : progressPercent > 50 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
          </div>
          
          {/* Montants FC et USD */}
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Total</p>
              <p className="text-gray-300 font-semibold">{debt.total_fc.toLocaleString()} FC</p>
              <p className="text-blue-400 text-xs">${totalUSD.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Payé</p>
              <p className="text-green-400 font-semibold">{debt.paid_fc.toLocaleString()} FC</p>
              <p className="text-green-400/70 text-xs">{progressPercent.toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Restant</p>
              <p className="text-red-400 font-bold">{debt.remaining_fc.toLocaleString()} FC</p>
              <p className="text-red-400/80 text-xs font-medium">${remainingUSD.toFixed(2)}</p>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2">
          <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
            isPaid 
              ? 'bg-green-500/20 text-green-400' 
              : debt.status === 'partial' 
                ? 'bg-yellow-500/20 text-yellow-400' 
                : 'bg-red-500/20 text-red-400'
          }`}>
            {isPaid ? '✅ Payée' : debt.status === 'partial' ? '⏳ Partielle' : '🔴 Ouverte'}
          </span>
          
          {!isPaid && (
            <button
              onClick={() => onPay(debt)}
              className="px-4 py-2 bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-500 hover:to-primary-600 text-white rounded-lg transition-all duration-200 text-sm font-semibold shadow-lg shadow-primary-500/20 hover:shadow-primary-500/40"
            >
              💳 Payer
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

DebtRow.displayName = 'DebtRow';

const DebtsPage = () => {
  // Utiliser useOfflineDebts pour données locales instantanées
  const { data: debts = [], loading, refresh, isStale } = useOfflineDebts({
    refetchOnMount: true,
  });
  
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_RATE);

  // Récupérer le taux de change
  useEffect(() => {
    const fetchRate = async () => {
      try {
        // ✅ PRO: Timeout court de 2s
        const res = await axios.get(`${API_URL}/api/rates/current`, { timeout: 2000 });
        if (res.data?.rate_fc_per_usd) {
          setExchangeRate(res.data.rate_fc_per_usd);
        }
      } catch (e) {
        console.log('Utilisation du taux par défaut:', DEFAULT_RATE);
      }
    };
    fetchRate();
  }, []);

  // Calculer les stats avec useMemo pour éviter recalculs
  const stats = useMemo(() => {
    const isPaid = (d) => d.status === 'paid' || d.status === 'closed';
    
    const totalRemaining = debts.reduce((sum, d) => sum + (d.remaining_fc || 0), 0);
    const totalDebt = debts.reduce((sum, d) => sum + (d.total_fc || 0), 0);
    const totalPaid = debts.reduce((sum, d) => sum + (d.paid_fc || 0), 0);
    
    return {
      totalDebts: debts.length,
      totalRemaining,
      totalDebt,
      totalPaid,
      totalRemainingUSD: totalRemaining / exchangeRate,
      totalDebtUSD: totalDebt / exchangeRate,
      openDebtsCount: debts.filter(d => d.status === 'open').length,
      partialDebtsCount: debts.filter(d => d.status === 'partial').length,
      closedDebtsCount: debts.filter(isPaid).length,
      recoveryRate: totalDebt > 0 ? ((totalPaid / totalDebt) * 100).toFixed(1) : 0,
    };
  }, [debts, exchangeRate]);

  // Rafraîchir périodiquement seulement si online (réduit de 5s à 30s)
  useEffect(() => {
    if (!navigator.onLine) return;
    
    const interval = setInterval(() => {
      if (isStale) {
        refresh();
      }
    }, 30000); // 30 secondes au lieu de 5
    
    return () => clearInterval(interval);
  }, [isStale, refresh]);

  // Fonction de refresh manuel
  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const handlePayDebt = useCallback((debt) => {
    setSelectedDebt(debt);
    setPaymentAmount(debt.remaining_fc.toString());
    setShowPaymentModal(true);
  }, []);

  const submitPayment = useCallback(async () => {
    if (!selectedDebt || !paymentAmount) return;

    try {
      setPaymentLoading(true);
      const amount = parseFloat(paymentAmount);
      if (amount <= 0) {
        alert('Veuillez entrer un montant valide');
        return;
      }
      if (amount > selectedDebt.remaining_fc) {
        alert(`Le montant ne peut pas dépasser ${selectedDebt.remaining_fc.toLocaleString()} FC`);
        return;
      }

      const res = await axios.post(`${API_URL}/api/debts/${selectedDebt.id}/payments`, {
        amount_fc: amount,
        payment_date: new Date().toISOString(),
      });

      if (res.data.success) {
        const message = res.data.message || 'Paiement enregistré avec succès';
        alert(`✅ ${message}`);
        setShowPaymentModal(false);
        setPaymentAmount('');
        setSelectedDebt(null);
        // Rafraîchir les données
        refresh();
      } else {
        throw new Error(res.data.error || 'Erreur inconnue');
      }
    } catch (error) {
      console.error('Erreur enregistrement paiement:', error);
      alert(`❌ Erreur: ${error.response?.data?.error || error.message}`);
    } finally {
      setPaymentLoading(false);
    }
  }, [selectedDebt, paymentAmount, refresh]);

  // Dettes filtrées et triées
  const filteredDebts = useMemo(() => {
    let result = [...debts];
    
    // Filtre par statut
    if (statusFilter !== 'all') {
      if (statusFilter === 'paid') {
        result = result.filter(d => d.status === 'paid' || d.status === 'closed');
      } else {
        result = result.filter(d => d.status === statusFilter);
      }
    }
    
    // Filtre par recherche
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(d => 
        (d.client_name || '').toLowerCase().includes(query) ||
        (d.invoice_number || '').toLowerCase().includes(query) ||
        (d.product_description || '').toLowerCase().includes(query)
      );
    }
    
    // Trier par restant décroissant
    return result.sort((a, b) => b.remaining_fc - a.remaining_fc);
  }, [debts, statusFilter, searchQuery]);

  const debtsByStatus = useMemo(() => [
    { name: 'Ouvertes', value: stats.openDebtsCount, color: '#ef4444' },
    { name: 'Partielles', value: stats.partialDebtsCount, color: '#f59e0b' },
    { name: 'Payées', value: stats.closedDebtsCount, color: '#10b981' },
  ].filter(d => d.value > 0), [stats]);

  // Dettes actives filtrées et triées
  const activeDebts = useMemo(() => {
    const isPaid = (d) => d.status === 'paid' || d.status === 'closed';
    return debts
      .filter(d => !isPaid(d))
      .sort((a, b) => b.remaining_fc - a.remaining_fc);
  }, [debts]);

  // Top 5 clients endettés
  const topDebtors = useMemo(() => {
    const byClient = {};
    debts.forEach(d => {
      if (d.status !== 'paid' && d.status !== 'closed') {
        const client = d.client_name || 'Inconnu';
        if (!byClient[client]) {
          byClient[client] = { name: client, remaining: 0, count: 0 };
        }
        byClient[client].remaining += d.remaining_fc || 0;
        byClient[client].count += 1;
      }
    });
    return Object.values(byClient)
      .sort((a, b) => b.remaining - a.remaining)
      .slice(0, 5);
  }, [debts]);

  const StatCard = memo(({ title, value, subtitle, icon: Icon, color, gradient }) => (
    <div className={`card relative overflow-hidden ${gradient || ''}`}>
      <div className="absolute inset-0 opacity-10">
        <Icon className="w-20 h-20 text-white absolute -bottom-4 -right-4" />
      </div>
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-gray-400 font-medium text-sm">{title}</h3>
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
        <p className="text-2xl font-bold text-white mb-1">{value}</p>
        {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
      </div>
    </div>
  ));

  StatCard.displayName = 'StatCard';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2 flex items-center gap-3">
            <Wallet className="w-8 h-8 text-primary-400" />
            Gestion des Dettes
          </h1>
          <p className="text-gray-400">
            Suivi et recouvrement des dettes clients • Taux: <span className="text-blue-400 font-semibold">{exchangeRate.toLocaleString()} FC/$</span>
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors border border-gray-700"
        >
          <RefreshCw className={`w-5 h-5 text-primary-400 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-gray-300">Actualiser</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Dettes"
          value={stats.totalDebts}
          subtitle={`${stats.openDebtsCount + stats.partialDebtsCount} actives`}
          icon={CreditCard}
          color="bg-blue-600"
        />
        <StatCard
          title="Montant Restant"
          value={`${(stats.totalRemaining / 1000).toFixed(1)}k FC`}
          subtitle={`$${stats.totalRemainingUSD.toFixed(2)} USD`}
          icon={AlertCircle}
          color="bg-red-600"
        />
        <StatCard
          title="Déjà Récupéré"
          value={`${(stats.totalPaid / 1000).toFixed(1)}k FC`}
          subtitle={`${stats.recoveryRate}% du total`}
          icon={PiggyBank}
          color="bg-green-600"
        />
        <StatCard
          title="Taux Recouvrement"
          value={`${stats.recoveryRate}%`}
          subtitle={`${stats.closedDebtsCount} dettes payées`}
          icon={TrendingUp}
          color="bg-purple-600"
        />
      </div>

      {loading && debts.length === 0 ? (
        <div className="flex items-center justify-center h-96 card">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : debts.length > 0 ? (
        <>
          {/* Graphiques et Top Clients */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Répartition par statut */}
            {debtsByStatus.length > 0 && (
              <div className="card">
                <h3 className="text-lg font-bold text-gray-100 mb-4 flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-primary-400" />
                  Répartition des dettes
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={debtsByStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={true}
                    >
                      {debtsByStatus.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                      itemStyle={{ color: '#f3f4f6' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top Clients Endettés */}
            <div className="card lg:col-span-2">
              <h3 className="text-lg font-bold text-gray-100 mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-primary-400" />
                Top 5 Clients Endettés
              </h3>
              {topDebtors.length > 0 ? (
                <div className="space-y-3">
                  {topDebtors.map((client, idx) => {
                    const usd = client.remaining / exchangeRate;
                    const maxRemaining = topDebtors[0].remaining;
                    const barWidth = (client.remaining / maxRemaining) * 100;
                    
                    return (
                      <div key={client.name} className="relative">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              idx === 0 ? 'bg-red-500' : idx === 1 ? 'bg-orange-500' : 'bg-gray-600'
                            }`}>
                              {idx + 1}
                            </span>
                            <span className="text-gray-200 font-medium">{client.name}</span>
                            <span className="text-gray-500 text-xs">({client.count} dette{client.count > 1 ? 's' : ''})</span>
                          </div>
                          <div className="text-right">
                            <span className="text-red-400 font-bold">{client.remaining.toLocaleString()} FC</span>
                            <span className="text-blue-400 text-xs ml-2">${usd.toFixed(2)}</span>
                          </div>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-red-500 to-orange-500 rounded-full transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-gray-400 text-center py-8">Aucune dette active</p>
              )}
            </div>
          </div>

          {/* Filtres et recherche */}
          <div className="card">
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Rechercher client, facture, produit..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-gray-800 text-white rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 border border-gray-700"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-gray-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-gray-800 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 border border-gray-700"
                >
                  <option value="all">Tous les statuts</option>
                  <option value="open">🔴 Ouvertes</option>
                  <option value="partial">⏳ Partielles</option>
                  <option value="paid">✅ Payées</option>
                </select>
              </div>
              <span className="text-gray-400 text-sm">
                {filteredDebts.length} résultat{filteredDebts.length > 1 ? 's' : ''}
              </span>
            </div>

            {/* Liste des dettes avec virtualisation */}
            <h3 className="text-lg font-bold text-gray-100 mb-4">
              {statusFilter === 'all' ? 'Toutes les dettes' : 
               statusFilter === 'open' ? 'Dettes ouvertes' : 
               statusFilter === 'partial' ? 'Dettes partielles' : 'Dettes payées'}
            </h3>
            {filteredDebts.length > 0 ? (
              <VirtualList
                items={filteredDebts}
                itemHeight={180}
                containerHeight={600}
                renderItem={(debt, index) => (
                  <DebtRow 
                    key={debt.id} 
                    debt={debt} 
                    index={index} 
                    onPay={handlePayDebt}
                    exchangeRate={exchangeRate}
                  />
                )}
                keyExtractor={(debt) => debt.id}
                overscan={3}
                itemClassName="mb-3"
              />
            ) : (
              <div className="text-center py-12 text-gray-400">
                <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Aucune dette trouvée avec ces critères</p>
              </div>
            )}
          </div>

          {/* Tableau récapitulatif */}
          <div className="card overflow-x-auto">
            <h3 className="text-lg font-bold text-gray-100 mb-4 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary-400" />
              Récapitulatif Complet
            </h3>
            {/* Header de tableau */}
            <div className="grid grid-cols-8 gap-2 px-4 py-3 bg-gray-800/80 rounded-t-lg text-sm font-semibold text-gray-400 border-b border-gray-700">
              <div>Client</div>
              <div>Facture</div>
              <div>Produit</div>
              <div className="text-right">Total FC</div>
              <div className="text-right">Total USD</div>
              <div className="text-right">Payé FC</div>
              <div className="text-right">Reste</div>
              <div className="text-center">Statut</div>
            </div>
            <VirtualList
              items={debts}
              itemHeight={60}
              containerHeight={500}
              renderItem={(debt, index) => {
                const isPaid = debt.status === 'paid' || debt.status === 'closed';
                const totalUSD = debt.total_usd || (debt.total_fc / exchangeRate);
                const remainingUSD = debt.remaining_fc / exchangeRate;

                return (
                  <div 
                    key={debt.id} 
                    className={`grid grid-cols-8 gap-2 items-center border-b border-gray-800 hover:bg-gray-800/50 px-4 py-3 transition-colors ${
                      isPaid ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="text-gray-200 truncate font-medium">{debt.client_name}</div>
                    <div className="text-gray-400 truncate text-sm">{debt.invoice_number || '-'}</div>
                    <div className="text-gray-400 truncate text-sm">{debt.product_description || '-'}</div>
                    <div className="text-right text-gray-300">
                      {debt.total_fc.toLocaleString()} FC
                    </div>
                    <div className="text-right text-blue-400 font-medium">
                      ${totalUSD.toFixed(2)}
                    </div>
                    <div className="text-right text-green-400">
                      {debt.paid_fc.toLocaleString()} FC
                    </div>
                    <div className="text-right">
                      <span className="text-red-400 font-bold">{debt.remaining_fc.toLocaleString()} FC</span>
                      <br />
                      <span className="text-blue-400 text-xs">${remainingUSD.toFixed(2)}</span>
                    </div>
                    <div className="text-center">
                      <span
                        className={`inline-block px-2 py-1 rounded-lg text-xs font-bold ${
                          isPaid
                            ? 'bg-green-500/20 text-green-400'
                            : debt.status === 'partial'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {isPaid ? '✅ Payée' : debt.status === 'partial' ? '⏳' : '🔴'}
                      </span>
                    </div>
                  </div>
                );
              }}
              keyExtractor={(debt) => debt.id}
              overscan={5}
              containerClassName="w-full"
            />
          </div>
        </>
      ) : (
        <div className="card text-center py-12 text-gray-400">
          <Wallet className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">Aucune dette enregistrée</p>
          <p className="text-sm opacity-75 mb-6">
            Les dettes se synchronisent automatiquement depuis Google Sheets
          </p>
          <p className="text-xs opacity-50 mb-4 max-w-lg mx-auto">
            Vérifiez que la feuille Google Sheets nommée "Dettes" contient vos données avec les colonnes :
            Client, Produit, Argent, prix a payer, prix payer deja, reste, date, numero de facture, Dollars
          </p>
          <button
            onClick={handleRefresh}
            className="px-6 py-3 bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-500 hover:to-primary-600 text-white rounded-lg transition-all font-semibold"
          >
            🔄 Rafraîchir les données
          </button>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedDebt && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => !paymentLoading && setShowPaymentModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="card p-6 max-w-md w-full border border-gray-700 shadow-2xl"
          >
            <h2 className="text-2xl font-bold text-gray-100 mb-6 flex items-center gap-2">
              <Wallet className="w-6 h-6 text-primary-400" />
              Enregistrer un paiement
            </h2>
            
            <div className="space-y-4">
              <div className="p-4 bg-gray-800 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Client</label>
                    <p className="text-gray-100 font-semibold">{selectedDebt.client_name}</p>
                  </div>
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Facture</label>
                    <p className="text-gray-300">{selectedDebt.invoice_number || 'N/A'}</p>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-800 rounded-lg text-center">
                  <p className="text-gray-500 text-xs mb-1">Total</p>
                  <p className="text-gray-100 font-bold">{selectedDebt.total_fc.toLocaleString()} FC</p>
                  <p className="text-blue-400 text-xs">${(selectedDebt.total_fc / exchangeRate).toFixed(2)}</p>
                </div>
                <div className="p-4 bg-red-900/30 rounded-lg text-center border border-red-500/30">
                  <p className="text-gray-400 text-xs mb-1">Reste à payer</p>
                  <p className="text-red-400 font-bold text-lg">{selectedDebt.remaining_fc.toLocaleString()} FC</p>
                  <p className="text-red-400/70 text-xs">${(selectedDebt.remaining_fc / exchangeRate).toFixed(2)}</p>
                </div>
              </div>
              
              <div>
                <label className="block text-gray-400 text-sm mb-2">Montant du paiement (FC)</label>
                <div className="relative">
                  <DollarSign className="w-5 h-5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full bg-gray-700 text-white rounded-lg pl-10 pr-16 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 text-lg font-semibold"
                    max={selectedDebt.remaining_fc}
                    disabled={paymentLoading}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">FC</span>
                </div>
                {paymentAmount && (
                  <p className="text-sm text-blue-400 mt-1">
                    ≈ ${(parseFloat(paymentAmount) / exchangeRate).toFixed(2)} USD
                  </p>
                )}
              </div>
              
              {/* Boutons de montants rapides */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setPaymentAmount((selectedDebt.remaining_fc * 0.25).toFixed(0))}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
                  disabled={paymentLoading}
                >
                  25%
                </button>
                <button
                  onClick={() => setPaymentAmount((selectedDebt.remaining_fc * 0.5).toFixed(0))}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
                  disabled={paymentLoading}
                >
                  50%
                </button>
                <button
                  onClick={() => setPaymentAmount((selectedDebt.remaining_fc * 0.75).toFixed(0))}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
                  disabled={paymentLoading}
                >
                  75%
                </button>
                <button
                  onClick={() => setPaymentAmount(selectedDebt.remaining_fc.toString())}
                  className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm text-white font-semibold"
                  disabled={paymentLoading}
                >
                  100% (Tout payer)
                </button>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition font-medium"
                  disabled={paymentLoading}
                >
                  Annuler
                </button>
                <button
                  onClick={submitPayment}
                  disabled={paymentLoading || !paymentAmount || parseFloat(paymentAmount) <= 0}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-500 hover:to-primary-600 text-white rounded-lg transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {paymentLoading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Traitement...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Enregistrer
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DebtsPage;
