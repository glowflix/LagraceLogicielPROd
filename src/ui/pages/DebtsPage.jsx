import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, CreditCard, Calendar, User } from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';
import { format } from 'date-fns';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

const DebtsPage = () => {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDebts();
    
    // Rafraîchir automatiquement toutes les 5 secondes pour voir les nouvelles dettes synchronisées
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
      } else {
        console.error('   ❌ Données invalides reçues:', response.data);
      }
      
      setDebts(response.data || []);
    } catch (error) {
      console.error('❌ [DebtsPage] Erreur chargement dettes:', error);
      console.error(`   Message: ${error.message}`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data: ${JSON.stringify(error.response.data)}`);
      }
      setDebts([]); // S'assurer que debts est un tableau vide en cas d'erreur
    } finally {
      setLoading(false);
      console.log('🏁 [DebtsPage] Chargement terminé');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Dettes</h1>
        <p className="text-gray-400">Gestion des dettes clients</p>
      </div>

      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"
            />
          </div>
        ) : debts.length > 0 ? (
          <div className="space-y-4">
            {debts.map((debt, index) => (
              <motion.div
                key={debt.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="p-4 glass rounded-lg"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <User className="w-5 h-5 text-primary-400" />
                      <span className="font-semibold text-gray-200">{debt.client_name}</span>
                      <span
                        className={`badge ${
                          debt.status === 'closed'
                            ? 'badge-success'
                            : debt.status === 'partial'
                            ? 'badge-warning'
                            : 'badge-error'
                        }`}
                      >
                        {debt.status === 'closed'
                          ? 'Fermée'
                          : debt.status === 'partial'
                          ? 'Partielle'
                          : 'Ouverte'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {format(new Date(debt.created_at), 'dd MMM yyyy')}
                      </span>
                      {debt.invoice_number && (
                        <span>Facture: {debt.invoice_number}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-primary-400">
                      {debt.remaining_fc.toLocaleString()} FC
                    </p>
                    <p className="text-sm text-gray-400">
                      Total: {debt.total_fc.toLocaleString()} FC
                    </p>
                    <p className="text-sm text-gray-400">
                      Payé: {debt.paid_fc.toLocaleString()} FC
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <CreditCard className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg mb-2">Aucune dette</p>
            <p className="text-sm opacity-75">
              Les dettes se synchronisent automatiquement depuis Google Sheets
            </p>
            <button
              onClick={loadDebts}
              className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              🔄 Rafraîchir
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DebtsPage;

