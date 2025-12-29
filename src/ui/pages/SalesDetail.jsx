import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Printer, XCircle, Package, Calendar, User, Phone, DollarSign, CheckCircle, Cloud, CloudOff, AlertCircle } from 'lucide-react';
import axios from 'axios';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

const SalesDetail = () => {
  const { invoice } = useParams();
  const navigate = useNavigate();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState(null);
  const [printStatus, setPrintStatus] = useState(null);

  useEffect(() => {
    loadSale();
    loadStatuses();
  }, [invoice]);

  const loadSale = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/sales/${invoice}`);
      setSale(response.data);
    } catch (error) {
      console.error('Erreur chargement vente:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStatuses = async () => {
    try {
      // Charger le statut de sync depuis sync_outbox
      const syncResponse = await axios.get(`${API_URL}/api/sync/status`);
      const syncData = syncResponse.data?.pending || [];
      const saleSync = syncData.find(s => s.entity_id === invoice);
      setSyncStatus(saleSync ? { status: saleSync.status || 'pending' } : { status: sale?.synced_at ? 'synced' : 'none' });

      // Charger le statut d'impression depuis print_jobs
      try {
        const printResponse = await axios.get(`${API_URL}/api/print/status/${invoice}`);
        setPrintStatus(printResponse.data || { status: 'none' });
      } catch {
        // Si l'endpoint n'existe pas encore, utiliser le statut par défaut
        setPrintStatus({ status: 'none' });
      }
    } catch (error) {
      console.error('Erreur chargement statuts:', error);
    }
  };

  const handleVoid = async () => {
    if (window.confirm('Êtes-vous sûr de vouloir annuler cette vente ?')) {
      try {
        await axios.post(`${API_URL}/api/sales/${invoice}/void`);
        navigate('/sales/history');
      } catch (error) {
        console.error('Erreur annulation:', error);
      }
    }
  };

  const handlePrint = async () => {
    try {
      await axios.post(`${API_URL}/api/sales/${invoice}/print`);
    } catch (error) {
      console.error('Erreur impression:', error);
    }
  };

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

  if (!sale) {
    return (
      <div className="text-center py-12">
        <p className="text-xl text-gray-400">Vente non trouvée</p>
        <button
          onClick={() => navigate('/sales/history')}
          className="btn btn-primary mt-4"
        >
          Retour à l'historique
        </button>
      </div>
    );
  }

  const items = sale.items || [];

  return (
    <div className="space-y-6">
      {/* Header avec actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/sales/history')}
          className="btn-secondary flex items-center gap-2"
        >
          <ArrowLeft className="w-5 h-5" />
          Retour
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="btn-secondary flex items-center gap-2"
          >
            <Printer className="w-5 h-5" />
            Réimprimer
          </button>
          {sale.status !== 'void' && (
            <button onClick={handleVoid} className="btn-secondary flex items-center gap-2 text-red-400 hover:text-red-300">
              <XCircle className="w-5 h-5" />
              Annuler
            </button>
          )}
        </div>
      </div>

      {/* Informations de la facture */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-700">
          <div>
            <h1 className="text-3xl font-bold text-gray-100 mb-2">
              Facture {sale.invoice_number}
            </h1>
            {sale.origin === 'SHEETS' && (
              <span className="badge badge-info">Synchronisée depuis Google Sheets</span>
            )}
          </div>
          <div className="text-right">
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
        </div>

        {/* Informations client et vente */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
              <User className="w-5 h-5 text-primary-400" />
              Informations client
            </h3>
            <div className="space-y-2 text-gray-400">
              <p>
                <span className="font-medium text-gray-300">Nom:</span>{' '}
                {sale.client_name || 'Non renseigné'}
              </p>
              {sale.client_phone && (
                <p className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <span className="font-medium text-gray-300">Téléphone:</span> {sale.client_phone}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary-400" />
              Informations vente
            </h3>
            <div className="space-y-2 text-gray-400">
              <p className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span className="font-medium text-gray-300">Date:</span>{' '}
                {format(new Date(sale.sold_at), 'dd MMMM yyyy à HH:mm', { locale: fr })}
              </p>
              <p>
                <span className="font-medium text-gray-300">Vendeur:</span> {sale.seller_name || 'Non renseigné'}
              </p>
              <p>
                <span className="font-medium text-gray-300">Mode de paiement:</span>{' '}
                {sale.payment_mode === 'cash' ? 'Cash' : 'Dette'}
              </p>
              <p>
                <span className="font-medium text-gray-300">Taux:</span>{' '}
                {sale.rate_fc_per_usd?.toLocaleString() || 0} FC/USD
              </p>
            </div>
          </div>
        </div>

        {/* Statuts Sync et Print */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Statut Sync */}
          <div className="p-4 glass rounded-lg border border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              {syncStatus?.status === 'synced' || sale?.synced_at ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : syncStatus?.status === 'error' ? (
                <AlertCircle className="w-5 h-5 text-red-400" />
              ) : (
                <CloudOff className="w-5 h-5 text-yellow-400" />
              )}
              <h3 className="text-sm font-semibold text-gray-300">Synchronisation Google Sheets</h3>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-400">
                Statut: <span className={`font-semibold ${
                  syncStatus?.status === 'synced' || sale?.synced_at ? 'text-green-400' :
                  syncStatus?.status === 'error' ? 'text-red-400' :
                  'text-yellow-400'
                }`}>
                  {syncStatus?.status === 'synced' || sale?.synced_at ? 'Synchronisé' :
                   syncStatus?.status === 'error' ? 'Erreur' :
                   syncStatus?.status === 'pending' ? 'En attente' : 'Non synchronisé'}
                </span>
              </p>
              {sale?.synced_at && (
                <p className="text-xs text-gray-500">
                  Le {format(new Date(sale.synced_at), 'dd/MM/yyyy à HH:mm', { locale: fr })}
                </p>
              )}
            </div>
          </div>

          {/* Statut Print */}
          <div className="p-4 glass rounded-lg border border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              {printStatus?.status === 'printed' ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : printStatus?.status === 'error' ? (
                <AlertCircle className="w-5 h-5 text-red-400" />
              ) : printStatus?.status === 'processing' ? (
                <Printer className="w-5 h-5 text-blue-400 animate-pulse" />
              ) : (
                <Printer className="w-5 h-5 text-yellow-400" />
              )}
              <h3 className="text-sm font-semibold text-gray-300">Impression</h3>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-400">
                Statut: <span className={`font-semibold ${
                  printStatus?.status === 'printed' ? 'text-green-400' :
                  printStatus?.status === 'error' ? 'text-red-400' :
                  printStatus?.status === 'processing' ? 'text-blue-400' :
                  'text-yellow-400'
                }`}>
                  {printStatus?.status === 'printed' ? 'Imprimé' :
                   printStatus?.status === 'error' ? 'Erreur' :
                   printStatus?.status === 'processing' ? 'En cours...' :
                   printStatus?.status === 'pending' ? 'En attente' : 'Non imprimé'}
                </span>
              </p>
              {printStatus?.printed_at && (
                <p className="text-xs text-gray-500">
                  Le {format(new Date(printStatus.printed_at), 'dd/MM/yyyy à HH:mm', { locale: fr })}
                </p>
              )}
              {printStatus?.last_error && (
                <p className="text-xs text-red-400">
                  Erreur: {printStatus.last_error}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Liste des articles */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-primary-400" />
            Articles de la facture ({items.length} article{items.length > 1 ? 's' : ''})
          </h3>
          
          {items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">Produit</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">Code</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Quantité</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Prix unitaire</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <motion.tr
                      key={item.id || index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="border-b border-gray-800 hover:bg-white/5 transition-colors"
                    >
                      <td className="py-3 px-4 text-gray-200 font-medium">
                        {item.product_name || 'Produit inconnu'}
                      </td>
                      <td className="py-3 px-4 text-gray-400 text-sm">
                        {item.product_code || 'N/A'}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-300">
                        {item.qty || 0} {item.qty_label || ''}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-300">
                        {item.unit_price_fc?.toLocaleString() || 0} FC
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-primary-400">
                        {((item.qty || 0) * (item.unit_price_fc || 0)).toLocaleString()} FC
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Aucun article trouvé pour cette facture</p>
            </div>
          )}
        </div>

        {/* Totaux */}
        <div className="mt-6 pt-6 border-t border-gray-700">
          <div className="flex justify-end">
            <div className="w-full md:w-1/2 space-y-3">
              <div className="flex justify-between text-gray-400">
                <span>Sous-total:</span>
                <span className="font-semibold text-gray-200">
                  {sale.total_fc?.toLocaleString() || 0} FC
                </span>
              </div>
              {sale.total_usd && (
                <div className="flex justify-between text-gray-400">
                  <span>Total USD:</span>
                  <span className="font-semibold text-gray-200">
                    ${sale.total_usd?.toFixed(2) || 0}
                  </span>
                </div>
              )}
              {sale.paid_fc > 0 && (
                <div className="flex justify-between text-gray-400">
                  <span>Payé:</span>
                  <span className="font-semibold text-green-400">
                    {sale.paid_fc?.toLocaleString() || 0} FC
                  </span>
                </div>
              )}
              {sale.payment_mode === 'debt' && sale.paid_fc < sale.total_fc && (
                <div className="flex justify-between text-gray-400 pt-2 border-t border-gray-700">
                  <span>Reste à payer:</span>
                  <span className="font-semibold text-yellow-400">
                    {(sale.total_fc - (sale.paid_fc || 0)).toLocaleString()} FC
                  </span>
                </div>
              )}
              <div className="flex justify-between text-xl font-bold text-primary-400 pt-2 border-t border-gray-700">
                <span>Total:</span>
                <span>{sale.total_fc?.toLocaleString() || 0} FC</span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default SalesDetail;
