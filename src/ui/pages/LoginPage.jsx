import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { m } from 'framer-motion';
import { LogIn, User, Lock, AlertCircle, WifiOff, Ban } from 'lucide-react';
import { useStore } from '../store/useStore';
import { getUserRole, getDefaultRouteForRole, isUserActive } from '../utils/permissions';

const LoginPage = () => {
  const navigate = useNavigate();
  const { login, isOnline } = useStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isBlocked, setIsBlocked] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsBlocked(false);
    setLoading(true);

    const result = await login(username, password);

    if (result.success) {
      // Récupérer l'utilisateur connecté depuis le store
      const user = useStore.getState().user;
      
      // Vérifier si le compte est actif
      if (user && !isUserActive(user)) {
        setIsBlocked(true);
        setError('');
        setLoading(false);
        // Déconnecter l'utilisateur bloqué
        useStore.getState().logout();
        return;
      }
      
      // Déterminer le rôle et la route de redirection
      const role = getUserRole(user);
      const defaultRoute = getDefaultRouteForRole(role);
      
      console.log('🔐 [LOGIN] Connexion réussie:', {
        username: user?.username,
        role,
        redirectTo: defaultRoute
      });
      
      navigate(defaultRoute);
    } else {
      // Vérifier si c'est une erreur de compte bloqué
      if (result.blocked || result.error?.toLowerCase().includes('bloqué')) {
        setIsBlocked(true);
        setError('');
      } else {
        setError(result.error || 'Erreur de connexion');
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 p-4">
      <m.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="glass-strong rounded-2xl p-8 max-w-md w-full"
      >
        {/* Header */}
        <m.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-8"
        >
          <m.img
            src="/asset/image/icon/photo.png"
            alt="Logo LA GRACE"
            className="w-16 h-16 mx-auto mb-4 object-contain"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3 }}
          />
          <h1 className="text-3xl font-bold text-gray-100 mb-2">
            Connexion
          </h1>
          <p className="text-gray-400">Accédez à votre espace</p>
        </m.div>

        {/* Status offline */}
        {!isOnline && (
          <m.div
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="flex items-center gap-2 p-3 bg-yellow-500/20 border border-yellow-500/30 rounded-lg mb-6"
          >
            <WifiOff className="w-5 h-5 text-yellow-400" />
            <span className="text-sm text-yellow-300">
              Mode hors ligne - Connexion locale uniquement
            </span>
          </m.div>
        )}

        {/* Message compte bloqué */}
        {isBlocked && (
          <m.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-center"
          >
            <Ban className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-red-300 mb-2">
              Compte Bloqué
            </h3>
            <p className="text-sm text-red-200">
              Votre compte a été désactivé.
            </p>
            <p className="text-sm text-red-200 mt-1">
              Contactez <span className="font-bold text-red-100">La Grâce</span> pour plus d'informations.
            </p>
            <p className="text-xs text-red-300/70 mt-3">
              Tél: +243 89 231 0803
            </p>
          </m.div>
        )}

        {/* Formulaire */}
        {!isBlocked && (
          <form onSubmit={handleLogin} className="space-y-4">
          <m.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Numéro de téléphone
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Entrez votre numéro (ex: 243892310803)"
                className="input-field pl-10"
                required
                autoFocus
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Vous pouvez aussi utiliser votre nom d'utilisateur
            </p>
          </m.div>

          <m.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Entrez votre mot de passe"
                className="input-field pl-10"
                required
              />
            </div>
          </m.div>

          {error && (
            <m.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 bg-red-500/20 border border-red-500/30 rounded-lg"
            >
              <AlertCircle className="w-5 h-5 text-red-400" />
              <span className="text-sm text-red-300">{error}</span>
            </m.div>
          )}

          <m.button
            type="submit"
            disabled={loading}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="btn-primary w-full disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <m.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <LogIn className="w-5 h-5" />
                </m.div>
                Connexion...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <LogIn className="w-5 h-5" />
                Se connecter
              </span>
            )}
          </m.button>
        </form>
        )}

        {/* Lien vers activation de licence - visible seulement si pas bloqué */}
        {!isBlocked && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-6 text-center"
        >
          <button
            onClick={() => navigate('/license')}
            className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            Ou activer une licence
          </button>
        </m.div>
        )}

        {/* Bouton réessayer si bloqué */}
        {isBlocked && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-6 text-center"
          >
            <button
              onClick={() => {
                setIsBlocked(false);
                setUsername('');
                setPassword('');
              }}
              className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
            >
              Essayer avec un autre compte
            </button>
          </m.div>
        )}
      </m.div>
    </div>
  );
};

export default LoginPage;

