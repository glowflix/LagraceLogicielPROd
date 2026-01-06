import { useNavigate } from 'react-router-dom';
import { m } from 'framer-motion';
import { Ban, Phone, LogOut, RefreshCw } from 'lucide-react';
import { useStore } from '../store/useStore';

/**
 * Page affichée quand un compte utilisateur est bloqué (is_active = false)
 * Message: "Compte bloqué - Contactez La Grâce"
 */
const BlockedPage = () => {
  const navigate = useNavigate();
  const { logout, user } = useStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleRetry = () => {
    // Recharger la page pour réessayer
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 p-4">
      {/* Particules d'arrière-plan */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <m.div
            key={i}
            className="absolute w-2 h-2 bg-red-500/20 rounded-full"
            initial={{
              x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1920),
              y: Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 1080),
              opacity: 0,
            }}
            animate={{
              y: [null, Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 1080)],
              opacity: [0, 0.4, 0],
              scale: [0, 1.5, 0],
            }}
            transition={{
              duration: Math.random() * 5 + 4,
              repeat: Infinity,
              delay: Math.random() * 3,
            }}
          />
        ))}
      </div>

      <m.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, type: 'spring' }}
        className="glass-strong rounded-2xl p-8 max-w-md w-full text-center relative z-10"
      >
        {/* Icône animée */}
        <m.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', bounce: 0.5 }}
          className="mb-6"
        >
          <m.div
            animate={{ 
              boxShadow: ['0 0 0 0 rgba(239, 68, 68, 0.4)', '0 0 0 20px rgba(239, 68, 68, 0)', '0 0 0 0 rgba(239, 68, 68, 0)']
            }}
            transition={{ duration: 2, repeat: Infinity }}
            className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-red-500/20 border-2 border-red-500/50"
          >
            <Ban className="w-12 h-12 text-red-400" />
          </m.div>
        </m.div>

        {/* Titre */}
        <m.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-3xl font-bold text-red-400 mb-3"
        >
          Compte Bloqué
        </m.h1>

        {/* Message principal */}
        <m.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mb-6 space-y-2"
        >
          <p className="text-gray-300">
            Votre compte <span className="font-semibold text-white">{user?.username || 'utilisateur'}</span> a été désactivé.
          </p>
          <p className="text-gray-400 text-sm">
            Veuillez contacter l'administrateur pour réactiver votre accès.
          </p>
        </m.div>

        {/* Contact La Grâce */}
        <m.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="bg-dark-700/50 rounded-xl p-4 mb-6 border border-red-500/20"
        >
          <p className="text-sm text-gray-400 mb-2">Contactez-nous :</p>
          <div className="flex items-center justify-center gap-2 text-primary-400">
            <Phone className="w-4 h-4" />
            <span className="font-semibold">+243 89 231 0803</span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            La Grâce - Service Client
          </p>
        </m.div>

        {/* Boutons d'action */}
        <m.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <button
            onClick={handleRetry}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-dark-600 hover:bg-dark-500 text-gray-300 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Réessayer
          </button>
          <button
            onClick={handleLogout}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </m.div>

        {/* Logo en bas */}
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-8 pt-4 border-t border-dark-600"
        >
          <img
            src="/asset/image/icon/photo.png"
            alt="Logo LA GRACE"
            className="w-8 h-8 mx-auto opacity-50"
          />
          <p className="text-xs text-gray-500 mt-2">
            LA GRACE PRO v1.0
          </p>
        </m.div>
      </m.div>
    </div>
  );
};

export default BlockedPage;
