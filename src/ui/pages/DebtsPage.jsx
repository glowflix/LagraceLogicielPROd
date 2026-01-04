import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, CreditCard, Calendar, User, AlertCircle, TrendingUp, RefreshCw, Plus, CheckCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
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

const DebtsPage = () => {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [stats, setStats] = useState({
    totalDebts: 0,
    totalRemaining: 0,
    openDebtsCount: 0,
    partialDebtsCount: 0,
    closedDebtsCount: 0,
  });

  useEffect(() => {
    loadDebts();
    
    // Rafraîchir automatiquement toutes les 5 secondes
    const interval = setInterval(() => {
      console.log('🔄 [DebtsPage] Rafraîchissement automatique des dettes...');
      loadDebts();
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const loadDebts = async () => {
    try {
      console.log('🔄 [DebtsPage] Chargement des dettes depuis l\'API...');
      console.log(`   📡 URL: ${API_URL}/api/debts`);
      
      const response = await axios.get(`${API_URL}/api/debts`);
      
      console.log('✅ [DebtsPage] Réponse reçue de l\'API');
      console.log(`   📦 Type de données: ${typeof response.data}`);
      console.log(`   📊 Nombre d'éléments: ${Array.isArray(response.data) ? response.data.length : 'N/A'}`);
      
      if (response.data && Array.isArray(response.data)) {
        if (response.data.length > 0) {
          console.log(`   ✅ ${response.data.length} dette(s) reçue(s)`);
          console.log(`   🔍 Première dette:`, response.data[0]);
        } else {
          console.warn('   ⚠️  Tableau vide reçu de l\'API');
        }
        
        setDebts(response.data);
        
        // Calculer les statistiques
        const stats = {
          totalDebts: response.data.length,
          totalRemaining: response.data.reduce((sum, d) => sum + (d.remaining_fc || 0), 0),
          openDebtsCount: response.data.filter(d => d.status === 'open').length,
          partialDebtsCount: response.data.filter(d => d.status === 'partial').length,
          closedDebtsCount: response.data.filter(d => d.status === 'closed').length,
        };
        setStats(stats);
      } else {
        console.error('   ❌ Données invalides reçues:', response.data);
        setDebts([]);
      }
    } catch (error) {
      console.error('❌ [DebtsPage] Erreur chargement dettes:', error);
      console.error(`   Message: ${error.message}`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data: ${JSON.stringify(error.response.data)}`);
      }
      setDebts([]);
    } finally {
      setLoading(false);
      console.log('🏁 [DebtsPage] Chargement terminé');
    }
  };

  const handlePayDebt = async (debt) => {
    setSelectedDebt(debt);
    setPaymentAmount(debt.remaining_fc.toString());
    setShowPaymentModal(true);
  };

  const submitPayment = async () => {
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
      await loadDebts();
    } catch (error) {
      console.error('Erreur enregistrement paiement:', error);
      alert('Erreur lors de l\'enregistrement du paiement');
    }
  };

  const debtsByStatus = [
    { name: 'Ouvertes', value: stats.openDebtsCount, color: '#ef4444' },
    { name: 'Partielles', value: stats.partialDebtsCount, color: '#f59e0b' },
    { name: 'Fermées', value: stats.closedDebtsCount, color: '#10b981' },
  ].filter(d => d.value > 0);

  const StatCard = ({ title, value, icon: Icon, color }) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5 }}
      className="card p-4"
    >
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div>
          <p className="text-gray-400 text-sm">{title}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Dettes Clients</h1>
          <p className="text-gray-400">Gestion et suivi des dettes - Synchronisé avec Google Sheets</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={loadDebts}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
        >
          <RefreshCw className="w-5 h-5 text-primary-400" />
        </motion.button>
      </motion.div>

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

      {loading ? (
        <div className="flex items-center justify-center h-96 card">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full"
          />
        </div>
      ) : debts.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart */}
          {debtsByStatus.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="card lg:col-span-1"
            >
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
            </motion.div>
          )}

          {/* Liste des dettes */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="card lg:col-span-2 overflow-auto max-h-96"
          >
            <h3 className="text-lg font-bold text-gray-100 mb-4">Dettes actives</h3>
            <div className="space-y-3">
              {debts
                .filter(d => d.status !== 'closed')
                .sort((a, b) => b.remaining_fc - a.remaining_fc)
                .map((debt, index) => (
                  <motion.div
                    key={debt.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="p-4 bg-gray-800 rounded-lg border-l-4 border-red-500 flex items-center justify-between hover:bg-gray-750 transition"
                  >
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
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handlePayDebt(debt)}
                      className="ml-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition text-sm whitespace-nowrap"
                    >
                      Payer
                    </motion.button>
                  </motion.div>
                ))}
            </div>
          </motion.div>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="card text-center py-12 text-gray-400"
        >
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
            onClick={loadDebts}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            🔄 Rafraîchir
          </button>
        </motion.div>
      )}

      {/* Full list */}
      {debts.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="card overflow-x-auto"
        >
          <h3 className="text-lg font-bold text-gray-100 mb-4">Historique complet des dettes</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-400">Client</th>
                <th className="text-left py-3 px-4 text-gray-400">Facture</th>
                <th className="text-right py-3 px-4 text-gray-400">Total</th>
                <th className="text-right py-3 px-4 text-gray-400">Payé</th>
                <th className="text-right py-3 px-4 text-gray-400">Restant</th>
                <th className="text-center py-3 px-4 text-gray-400">Statut</th>
                <th className="text-center py-3 px-4 text-gray-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {debts.map((debt, index) => (
                <motion.tr
                  key={debt.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.02 }}
                  className="border-b border-gray-800 hover:bg-gray-800/50"
                >
                  <td className="py-3 px-4 text-gray-200">{debt.client_name}</td>
                  <td className="py-3 px-4 text-gray-400">{debt.invoice_number || '-'}</td>
                  <td className="py-3 px-4 text-right text-gray-300">
                    {debt.total_fc.toLocaleString()} FC
                  </td>
                  <td className="py-3 px-4 text-right text-green-400">
                    {debt.paid_fc.toLocaleString()} FC
                  </td>
                  <td className="py-3 px-4 text-right text-red-400 font-semibold">
                    {debt.remaining_fc.toLocaleString()} FC
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                        debt.status === 'closed'
                          ? 'bg-green-500/20 text-green-400'
                          : debt.status === 'partial'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {debt.status === 'closed'
                        ? 'Fermée'
                        : debt.status === 'partial'
                        ? 'Partielle'
                        : 'Ouverte'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    {debt.status !== 'closed' && (
                      <button
                        onClick={() => handlePayDebt(debt)}
                        className="text-primary-400 hover:text-primary-300 transition text-sm font-semibold"
                      >
                        Payer
                      </button>
                    )}
                    {debt.status === 'closed' && (
                      <span className="text-green-400 text-sm flex items-center justify-center gap-1">
                        <CheckCircle className="w-4 h-4" />
                        Fermée
                      </span>
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedDebt && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowPaymentModal(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
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
          </motion.div>
        </motion.div>
      )}
    </div>
  );
};

export default DebtsPage;

