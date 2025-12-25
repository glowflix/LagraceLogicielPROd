import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Printer, XCircle } from 'lucide-react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

const SalesDetail = () => {
  const { invoice } = useParams();
  const navigate = useNavigate();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSale();
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
    return <div>Vente non trouvée</div>;
  }

  return (
    <div className="space-y-6">
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
            onClick={() => axios.post(`${API_URL}/api/sales/${invoice}/print`)}
            className="btn-secondary flex items-center gap-2"
          >
            <Printer className="w-5 h-5" />
            Réimprimer
          </button>
          {sale.status !== 'void' && (
            <button onClick={handleVoid} className="btn-secondary flex items-center gap-2">
              <XCircle className="w-5 h-5" />
              Annuler
            </button>
          )}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <h1 className="text-2xl font-bold text-gray-100 mb-6">
          Facture {sale.invoice_number}
        </h1>
        {/* Détails de la vente */}
      </motion.div>
    </div>
  );
};

export default SalesDetail;

