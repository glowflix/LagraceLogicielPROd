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
  }, []);

  const loadDebts = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/debts`);
      setDebts(response.data || []);
    } catch (error) {
      console.error('Erreur chargement dettes:', error);
    } finally {
      setLoading(false);
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
            <p>Aucune dette</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DebtsPage;

