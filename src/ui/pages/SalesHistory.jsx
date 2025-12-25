import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Search, Receipt, Printer, Eye, Calendar } from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

const SalesHistory = () => {
  const { sales, loadSales } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSalesData();
  }, [dateFrom, dateTo]);

  const loadSalesData = async () => {
    setLoading(true);
    try {
      await loadSales({ from: dateFrom, to: dateTo });
    } catch (error) {
      console.error('Erreur chargement ventes:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredSales = sales.filter(
    (sale) =>
      sale.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (sale.client_name &&
        sale.client_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handlePrint = async (invoiceNumber) => {
    try {
      await axios.post(`${API_URL}/api/sales/${invoiceNumber}/print`);
    } catch (error) {
      console.error('Erreur impression:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Historique des ventes</h1>
        <p className="text-gray-400">Consultez toutes vos factures</p>
      </div>

      {/* Filtres */}
      <div className="card space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Rechercher
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Numéro facture ou client..."
                className="input-field pl-10"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Du
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Au
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input-field"
            />
          </div>
        </div>
      </div>

      {/* Liste des ventes */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"
            />
          </div>
        ) : filteredSales.length > 0 ? (
          <div className="space-y-2">
            {filteredSales.map((sale, index) => (
              <motion.div
                key={sale.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="p-4 glass rounded-lg hover:bg-white/5 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Receipt className="w-5 h-5 text-primary-400" />
                      <span className="font-semibold text-gray-200">
                        {sale.invoice_number}
                      </span>
                      <span
                        className={`badge ${
                          sale.status === 'paid'
                            ? 'badge-success'
                            : sale.status === 'void'
                            ? 'badge-error'
                            : 'badge-warning'
                        }`}
                      >
                        {sale.status === 'paid'
                          ? 'Payé'
                          : sale.status === 'void'
                          ? 'Annulé'
                          : 'En attente'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {format(new Date(sale.sold_at), 'dd MMM yyyy HH:mm', {
                          locale: fr,
                        })}
                      </span>
                      {sale.client_name && (
                        <span>Client: {sale.client_name}</span>
                      )}
                      <span>Vendeur: {sale.seller_name}</span>
                    </div>
                  </div>
                  <div className="text-right mr-4">
                    <p className="text-xl font-bold text-primary-400">
                      {sale.total_fc.toLocaleString()} FC
                    </p>
                    <p className="text-sm text-gray-400">
                      {sale.payment_mode === 'cash' ? 'Cash' : 'Dette'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/sales/${sale.invoice_number}`}
                      className="p-2 glass rounded-lg hover:bg-white/10"
                    >
                      <Eye className="w-5 h-5 text-gray-400" />
                    </Link>
                    <button
                      onClick={() => handlePrint(sale.invoice_number)}
                      className="p-2 glass rounded-lg hover:bg-white/10"
                    >
                      <Printer className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <Receipt className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p>Aucune vente trouvée</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SalesHistory;

