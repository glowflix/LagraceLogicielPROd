import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { DollarSign, CreditCard, Calendar, User, AlertCircle, TrendingUp, RefreshCw, Plus, CheckCircle } from 'lucide-react';
import { useOfflineDebts } from '../hooks/useOfflineFirst';
import VirtualList from '../components/VirtualList';
import axios from 'axios';
import { format } from 'date-fns';
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
} from 'recharts';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

const COLORS = ['#ef4444', '#f59e0b', '#10b981'];

// Composant de ligne de dette memoizé pour performance
const DebtRow = memo(({ debt, index, onPay }) => (
  <div className="p-4 bg-gray-800 rounded-lg border-l-4 border-red-500 flex items-center justify-between hover:bg-gray-750 transition">
    <div className="flex-1">
      <p className="font-semibold text-gray-100">{debt.client_name}</p>
      <p className="text-sm text-gray-400">
        {debt.invoice_number ? `Facture: ${debt.invoice_number}` : 'N/A'}
      </p>
      <div className="flex gap-4 mt-2 text-xs">
        <span className="text-gray-500">Restant: <span className="text-red-400 font-bold">{debt.remaining_fc.toLocaleString()} FC</span></span>
        <span className="text-gray-500">Payé: <span className="text-green-400">{((debt.paid_fc / debt.total_fc) * 100 || 0).toFixed(0)}%</span></span>
      </div>
    </div>
    <button
      onClick={() => onPay(debt)}
      className="ml-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition text-sm whitespace-nowrap"
    >
      Payer
    </button>
  </div>
));

DebtRow.displayName = 'DebtRow';

const DebtsPage = () => {
  // Utiliser useOfflineDebts pour données locales instantanées
  const { data: debts = [], loading, refresh, isStale } = useOfflineDebts({
    refetchOnMount: true,
  });
  
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');

  // Calculer les stats avec useMemo pour éviter recalculs
  const stats = useMemo(() => {
    const isPaid = (d) => d.status === 'paid' || d.status === 'closed';
    return {
      totalDebts: debts.length,
      totalRemaining: debts.reduce((sum, d) => sum + (d.remaining_fc || 0), 0),
      openDebtsCount: debts.filter(d => d.status === 'open').length,
      partialDebtsCount: debts.filter(d => d.status === 'partial').length,
      closedDebtsCount: debts.filter(isPaid).length,
    };
  }, [debts]);

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
      const amount = parseFloat(paymentAmount);
      if (amount <= 0) {
        alert('Veuillez entrer un montant valide');
        return;
      }

      await axios.post(`${API_URL}/api/debts/${selectedDebt.id}/payments`, {
        amount_fc: amount,
        payment_date: new Date().toISOString(),
      });

      alert('Paiement enregistré avec succès');
      setShowPaymentModal(false);
      setPaymentAmount('');
      // Rafraîchir les données
      refresh();
    } catch (error) {
      console.error('Erreur enregistrement paiement:', error);
      alert('Erreur lors de l\'enregistrement du paiement');
    }
  }, [selectedDebt, paymentAmount, refresh]);

  const debtsByStatus = useMemo(() => [
    { name: 'Ouvertes', value: stats.openDebtsCount, color: '#ef4444' },
    { name: 'Partielles', value: stats.partialDebtsCount, color: '#f59e0b' },
    { name: 'Fermées', value: stats.closedDebtsCount, color: '#10b981' },
  ].filter(d => d.value > 0), [stats]);

  // Dettes actives filtrées et triées
  const activeDebts = useMemo(() => {
    const isPaid = (d) => d.status === 'paid' || d.status === 'closed';
    return debts
      .filter(d => !isPaid(d))
      .sort((a, b) => b.remaining_fc - a.remaining_fc);
  }, [debts]);

  const StatCard = memo(({ title, value, icon: Icon, color }) => (
    <div className="card p-4">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div>
          <p className="text-gray-400 text-sm">{title}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
        </div>
      </div>
    </div>
  ));

  StatCard.displayName = 'StatCard';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Dettes Clients</h1>
          <p className="text-gray-400">Gestion et suivi des dettes - Synchronisé avec Google Sheets</p>
        </div>
        <button
          onClick={handleRefresh}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          title="Rafraîchir"
        >
          <RefreshCw className={`w-5 h-5 text-primary-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total dettes"
          value={stats.totalDebts}
          icon={CreditCard}
          color="bg-blue-600"
        />
        <StatCard
          title="Montant restant"
          value={`${(stats.totalRemaining / 1000).toFixed(1)}k`}
          icon={DollarSign}
          color="bg-red-600"
        />
        <StatCard
          title="Ouvertes"
          value={stats.openDebtsCount}
          icon={AlertCircle}
          color="bg-orange-600"
        />
        <StatCard
          title="Partielles"
          value={stats.partialDebtsCount}
          icon={TrendingUp}
          color="bg-yellow-600"
        />
      </div>

      {loading && debts.length === 0 ? (
        <div className="flex items-center justify-center h-96 card">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : debts.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart */}
          {debtsByStatus.length > 0 && (
            <div className="card lg:col-span-1">
              <h3 className="text-lg font-bold text-gray-100 mb-4">Répartition des dettes</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={debtsByStatus}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {debtsByStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Liste des dettes avec virtualisation */}
          <div className="card lg:col-span-2">
            <h3 className="text-lg font-bold text-gray-100 mb-4">Dettes actives</h3>
            {activeDebts.length > 0 ? (
              <VirtualList
                items={activeDebts}
                itemHeight={100}
                containerHeight={400}
                renderItem={(debt, index) => (
                  <DebtRow key={debt.id} debt={debt} index={index} onPay={handlePayDebt} />
                )}
                keyExtractor={(debt) => debt.id}
                overscan={3}
              />
            ) : (
              <div className="text-center py-8 text-gray-400">
                <p>Aucune dette active</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card text-center py-12 text-gray-400">
          <CreditCard className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">Aucune dette</p>
          <p className="text-sm opacity-75 mb-6">
            Les dettes se synchronisent automatiquement depuis Google Sheets
          </p>
          <p className="text-xs opacity-50 mb-4">
            Vérifiez que la feuille Google Sheets nommée "Dettes" contient vos données avec les colonnes :
            Client, Produit, Argent, prix a payer, prix payer deja, reste, date, numero de facture
          </p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            🔄 Rafraîchir
          </button>
        </div>
      )}

      {/* Full list avec virtualisation */}
      {debts.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="text-lg font-bold text-gray-100 mb-4">Historique complet des dettes</h3>
          {/* Header de tableau */}
          <div className="grid grid-cols-7 gap-2 px-4 py-2 bg-gray-800 rounded-t-lg text-sm font-semibold text-gray-400 border-b border-gray-700">
            <div>Client</div>
            <div>Facture</div>
            <div className="text-right">Total</div>
            <div className="text-right">Payé</div>
            <div className="text-right">Restant</div>
            <div className="text-center">Statut</div>
            <div className="text-center">Action</div>
          </div>
          <VirtualList
            items={debts}
            itemHeight={60}
            containerHeight={600}
            renderItem={(debt, index) => {
              const isPaid = debt.status === 'paid' || debt.status === 'closed';

              return (
                <div key={debt.id} className="grid grid-cols-7 gap-2 items-center border-b border-gray-800 hover:bg-gray-800/50 px-4 py-3">
                  <div className="text-gray-200 truncate">{debt.client_name}</div>
                  <div className="text-gray-400 truncate">{debt.invoice_number || '-'}</div>
                  <div className="text-right text-gray-300">
                    {debt.total_fc.toLocaleString()} FC
                  </div>
                  <div className="text-right text-green-400">
                    {debt.paid_fc.toLocaleString()} FC
                  </div>
                  <div className="text-right text-red-400 font-semibold">
                    {debt.remaining_fc.toLocaleString()} FC
                  </div>
                  <div className="text-center">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                        isPaid
                          ? 'bg-green-500/20 text-green-400'
                          : debt.status === 'partial'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {isPaid
                        ? 'Payée'
                        : debt.status === 'partial'
                        ? 'Partielle'
                        : 'Ouverte'}
                    </span>
                  </div>
                  <div className="text-center">
                    {!isPaid && (
                      <button
                        onClick={() => handlePayDebt(debt)}
                        className="text-primary-400 hover:text-primary-300 transition text-sm font-semibold"
                      >
                        Payer
                      </button>
                    )}
                    {isPaid && (
                      <span className="text-green-400 text-sm flex items-center justify-center gap-1">
                        <CheckCircle className="w-4 h-4" />
                        Payée
                      </span>
                    )}
                  </div>
                </div>
              );
            }}
            keyExtractor={(debt) => debt.id}
            overscan={5}
            containerClassName="w-full"
          />
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedDebt && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowPaymentModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="card p-6 max-w-md w-full"
          >
            <h2 className="text-2xl font-bold text-gray-100 mb-4">Enregistrer un paiement</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Client</label>
                <p className="text-gray-200">{selectedDebt.client_name}</p>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Facture</label>
                <p className="text-gray-200">{selectedDebt.invoice_number}</p>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Montant restant</label>
                <p className="text-red-400 font-bold text-lg">{selectedDebt.remaining_fc.toLocaleString()} FC</p>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Montant à payer (FC)</label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  max={selectedDebt.remaining_fc}
                />
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  Annuler
                </button>
                <button
                  onClick={submitPayment}
                  className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition"
                >
                  Enregistrer
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

