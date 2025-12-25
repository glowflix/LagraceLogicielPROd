import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, DollarSign, RefreshCw, Save, CheckCircle2, XCircle } from 'lucide-react';
import axios from 'axios';
import { useStore } from '../store/useStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

const SettingsPage = () => {
  const { currentRate: storeRate, loadCurrentRate, updateCurrentRate } = useStore();
  const [currentRate, setCurrentRate] = useState(storeRate || 2800);
  const [newRate, setNewRate] = useState((storeRate || 2800).toString());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    // Charger le taux depuis l'API et mettre à jour le store
    loadCurrentRate().then((rate) => {
      if (rate) {
        setCurrentRate(rate);
        setNewRate(rate.toString());
      }
    });
  }, [loadCurrentRate]);

  // Synchroniser avec le store si le taux change ailleurs
  useEffect(() => {
    if (storeRate && storeRate !== currentRate) {
      setCurrentRate(storeRate);
      setNewRate(storeRate.toString());
    }
  }, [storeRate]);

  const handleUpdateRate = async () => {
    const rate = parseFloat(newRate);
    
    if (isNaN(rate) || rate <= 0) {
      setMessage({ type: 'error', text: 'Veuillez entrer un taux valide' });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const response = await axios.put(`${API_URL}/api/rates/current`, { rate });
      
      if (response.data.success) {
        const updatedRate = response.data.rate;
        setCurrentRate(updatedRate);
        setNewRate(updatedRate.toString());
        updateCurrentRate(updatedRate); // Mettre à jour le store pour que toutes les pages utilisent le même taux
        setMessage({ type: 'success', text: 'Taux mis à jour avec succès' });
        
        // Effacer le message après 3 secondes
        setTimeout(() => {
          setMessage({ type: '', text: '' });
        }, 3000);
      }
    } catch (error) {
      console.error('Erreur mise à jour taux:', error);
      setMessage({ type: 'error', text: error.response?.data?.error || 'Erreur lors de la mise à jour du taux' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Paramètres</h1>
        <p className="text-gray-400">Configuration de l'application</p>
      </div>

      {/* Taux de change */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-strong rounded-xl p-6"
      >
        <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-primary-400" />
          Taux de change FC/USD
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Taux actuel
            </label>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-primary-400">{currentRate}</span>
              <span className="text-gray-400">FC/USD</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Ce taux est utilisé pour convertir les montants entre FC et USD
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Nouveau taux
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                placeholder="2800"
                step="0.01"
                min="0"
                className="input-field flex-1"
                onKeyPress={(e) => e.key === 'Enter' && handleUpdateRate()}
              />
              <button
                onClick={handleUpdateRate}
                disabled={loading || !newRate}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    >
                      <RefreshCw className="w-5 h-5" />
                    </motion.div>
                    Mise à jour...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Mettre à jour
                  </>
                )}
              </button>
            </div>
          </div>

          {message.text && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-center gap-2 p-3 rounded-lg ${
                message.type === 'success'
                  ? 'bg-green-500/20 border border-green-500/30'
                  : 'bg-red-500/20 border border-red-500/30'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span
                className={`text-sm ${
                  message.type === 'success' ? 'text-green-300' : 'text-red-300'
                }`}
              >
                {message.text}
              </span>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Autres paramètres */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-strong rounded-xl p-6"
      >
        <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-primary-400" />
          Autres paramètres
        </h2>
        <p className="text-gray-400">Autres paramètres à venir...</p>
      </motion.div>
    </div>
  );
};

export default SettingsPage;
