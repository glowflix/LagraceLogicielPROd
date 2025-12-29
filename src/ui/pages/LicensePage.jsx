import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Key, CheckCircle2, XCircle, WifiOff, LogIn, FileText } from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

const LicensePage = () => {
  const navigate = useNavigate();
  const { activateLicense } = useStore();
  const [key, setKey] = useState(''); // Clé vide par défaut, sera remplie depuis le fichier
  const [maskedKey, setMaskedKey] = useState(''); // Clé masquée pour l'affichage
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingFile, setCheckingFile] = useState(true);
  const [fileFound, setFileFound] = useState(false);

  // Lire automatiquement le fichier linkcodeelagrace.Jeariss au chargement
  useEffect(() => {
    const checkLicenseFile = async () => {
      try {
        setCheckingFile(true);
        const response = await axios.get(`${API_URL}/api/license/check-file`);
        
        if (response.data.success && response.data.valid) {
          // Licence valide trouvée dans le fichier
          setKey(response.data.licenseKey);
          setMaskedKey('•'.repeat(response.data.licenseKey.length)); // Masquer avec des points
          setFileFound(true);
          
          // Activer automatiquement la licence
          const success = activateLicense(response.data.licenseKey);
          if (success) {
            setTimeout(() => {
              navigate('/dashboard');
            }, 1000);
          }
        } else if (response.data.found && !response.data.valid) {
          // Fichier trouvé mais licence invalide
          setError('Licence non valide');
          setFileFound(true);
        } else {
          // Fichier non trouvé
          setError('Fichier de licence non trouvé');
          setFileFound(false);
        }
      } catch (error) {
        console.error('Erreur lors de la lecture du fichier de licence:', error);
        setError('Impossible de lire le fichier de licence');
        setFileFound(false);
      } finally {
        setCheckingFile(false);
      }
    };

    checkLicenseFile();
  }, [activateLicense, navigate]);

  const handleActivate = async () => {
    setError('');
    setLoading(true);

    // Simuler un délai
    await new Promise((resolve) => setTimeout(resolve, 500));

    const success = activateLicense(key.trim());

    if (success) {
      // Le token est généré automatiquement dans activateLicense
      // Rediriger vers le dashboard après activation
      setTimeout(() => {
        navigate('/dashboard');
      }, 500);
    } else {
      setError('Clé de licence invalide');
      setLoading(false);
    }
  };

  // Fonction pour masquer la clé avec des points
  const maskKey = (value) => {
    return '•'.repeat(value.length);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 p-4 relative overflow-hidden">
      {/* Effet de particules en arrière-plan */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-primary-400/30 rounded-full"
            initial={{
              x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1920),
              y: Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 1080),
              opacity: 0,
            }}
            animate={{
              y: [null, Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 1080)],
              opacity: [0, 0.6, 0],
              scale: [0, 1, 0],
            }}
            transition={{
              duration: Math.random() * 4 + 3,
              repeat: Infinity,
              delay: Math.random() * 2,
            }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="glass-strong rounded-2xl p-8 max-w-md w-full relative z-10 shadow-2xl"
      >
        {/* Header */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-8"
        >
          <motion.img
            src="/asset/image/icon/photo.png"
            alt="Logo LA GRACE"
            className="w-20 h-20 mx-auto mb-4 object-contain"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3 }}
          />
          <h1 className="text-3xl font-bold text-gray-100 mb-2">
            Activation hors connexion
          </h1>
          <p className="text-gray-400">
            Entrez votre clé de licence pour activer l'application
          </p>
        </motion.div>

        {/* Info badge */}
        <motion.div
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-2 p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg mb-6"
        >
          <WifiOff className="w-5 h-5 text-blue-400" />
          <span className="text-sm text-blue-300">
            Aucune connexion Internet requise
          </span>
        </motion.div>

        {/* Formulaire */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Clé de licence
            </label>
            {checkingFile ? (
              <div className="input-field text-center text-lg tracking-widest font-mono flex items-center justify-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <FileText className="w-5 h-5 text-primary-400" />
                </motion.div>
                <span className="text-gray-400">Lecture du fichier...</span>
              </div>
            ) : (
              <>
                <input
                  type={fileFound && key ? 'password' : 'text'}
                  value={fileFound && key ? maskedKey : key}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setKey(newValue);
                    if (fileFound && key) {
                      // Si le fichier a été trouvé et qu'on a déjà une clé, masquer
                      setMaskedKey(maskKey(newValue));
                    } else {
                      // Sinon, permettre la saisie normale
                      setMaskedKey('');
                    }
                  }}
                  onKeyPress={(e) => e.key === 'Enter' && !fileFound && handleActivate()}
                  placeholder="Entrez votre clé de licence"
                  className="input-field text-center text-lg tracking-widest font-mono"
                  autoFocus={!fileFound}
                  disabled={fileFound && key}
                  readOnly={fileFound && key}
                />
                {fileFound && key && (
                  <p className="text-xs text-green-400 mt-2 text-center flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Licence détectée depuis linkcodeelagrace.Jeariss
                  </p>
                )}
                {!fileFound && (
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Fichier linkcodeelagrace.Jeariss non trouvé. Entrez manuellement la clé.
                  </p>
                )}
              </>
            )}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 bg-red-500/20 border border-red-500/30 rounded-lg"
            >
              <XCircle className="w-5 h-5 text-red-400" />
              <span className="text-sm text-red-300">{error}</span>
            </motion.div>
          )}

          <button
            onClick={handleActivate}
            disabled={loading || !key.trim()}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <Key className="w-5 h-5" />
                </motion.div>
                Activation...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                Activer la licence
              </span>
            )}
          </button>

          {/* Séparateur */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-dark-800 text-gray-400">ou</span>
            </div>
          </div>

          {/* Bouton Se connecter */}
          <button
            onClick={() => navigate('/login')}
            className="btn-secondary w-full border-gray-600 hover:bg-gray-700/50"
          >
            <span className="flex items-center justify-center gap-2">
              <LogIn className="w-5 h-5" />
              Se connecter à un compte
            </span>
          </button>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center text-xs text-gray-500 mt-6"
        >
          Glowflixprojet v1.0.0
        </motion.p>
      </motion.div>
    </div>
  );
};

export default LicensePage;

