import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldX, ArrowLeft, Home } from 'lucide-react';
import { useStore } from '../store/useStore';
import { canAccessRoute, getUserRole } from '../utils/permissions';
import { decodeLocalToken } from '../utils/token';

const UnauthorizedPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, user } = useStore();
  
  // Déterminer la route de redirection selon les permissions
  const tokenData = decodeLocalToken(token);
  let role = tokenData?.role;
  
  if (!role && user) {
    role = getUserRole(user);
  }
  
  role = role || 'LICENSE_ONLY';
  
  // Déterminer où rediriger selon les permissions
  let redirectTo = '/license';
  let redirectLabel = 'Retourner à la licence';
  
  if (canAccessRoute(role, '/sales')) {
    redirectTo = '/sales';
    redirectLabel = 'Retourner aux Ventes';
  } else if (canAccessRoute(role, '/dashboard')) {
    redirectTo = '/dashboard';
    redirectLabel = 'Retourner à l\'accueil';
  } else if (canAccessRoute(role, '/products')) {
    redirectTo = '/products';
    redirectLabel = 'Retourner aux Produits';
  }

  const from = location.state?.from?.pathname || redirectTo;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="glass-strong rounded-2xl p-8 max-w-md w-full text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
          className="mb-6 flex justify-center"
        >
          <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
            <ShieldX className="w-10 h-10 text-red-400" />
          </div>
        </motion.div>

        <h1 className="text-3xl font-bold text-gray-100 mb-4">
          Accès refusé
        </h1>

        <p className="text-gray-400 mb-6">
          Votre compte n'a pas les autorisations pour accéder à cette section.
        </p>

        <p className="text-sm text-gray-500 mb-6">
          Si vous pensez qu'il s'agit d'une erreur, contactez un administrateur.
        </p>

        <div className="flex flex-col gap-3">
          <motion.button
            onClick={() => navigate(redirectTo)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Home className="w-5 h-5" />
            {redirectLabel}
          </motion.button>
          
          {from !== redirectTo && (
            <motion.button
              onClick={() => navigate(from)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-secondary w-full flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-5 h-5" />
              Retour à la page précédente
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default UnauthorizedPage;

