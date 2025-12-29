import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  FileText,
  Users,
  UserCircle,
  BarChart3,
  Settings,
  RefreshCw,
  LogOut,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { decodeLocalToken } from '../utils/token';
import { canAccessRoute, getUserRole, PERMISSIONS } from '../utils/permissions';
import AILaGrace from './AILaGrace';

const menuItems = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Accueil' },
  { path: '/sales', icon: ShoppingCart, label: 'Ventes' },
  { path: '/sales/history', icon: FileText, label: 'Historique' },
  { path: '/products', icon: Package, label: 'Produits' },
  { path: '/debts', icon: FileText, label: 'Dettes' },
  { path: '/users', icon: Users, label: 'Compte Utilisateur' },
  { path: '/analytics', icon: BarChart3, label: 'Statistiques' },
  { path: '/sync', icon: RefreshCw, label: 'Synchronisation' },
  { path: '/settings', icon: Settings, label: 'Paramètres' },
];

const Layout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user, isOnline, socketConnected, token, checkConnection, isLicensed } = useStore();
  
  // Vérifier la connexion au montage du composant et périodiquement
  // NOTE: Le statut de connexion est informatif seulement, n'affecte pas l'accès aux fonctionnalités
  useEffect(() => {
    // Vérifier la connexion après un court délai au démarrage
    const initialTimer = setTimeout(() => {
      checkConnection();
    }, 1000);
    
    // Vérifier périodiquement la connexion (toutes les 30 secondes)
    const interval = setInterval(() => {
      if (navigator.onLine) {
        checkConnection();
      }
    }, 30000);
    
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [checkConnection]);
  
  // Obtenir le rôle actuel depuis le token ou depuis l'utilisateur
  const tokenData = decodeLocalToken(token);
  let currentRole = tokenData?.role;
  
  // Si pas de rôle dans le token, déterminer depuis l'utilisateur avec la licence
  if (!currentRole) {
    currentRole = getUserRole(user, isLicensed);
  }
  
  currentRole = currentRole || 'LICENSE_ONLY';
  
  // Filtrer les menus selon les permissions
  const visibleMenuItems = menuItems.filter(item => {
    return canAccessRoute(currentRole, item.path);
  });
  
  const handleLogout = () => {
    logout();
    // Nettoyer complètement localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('glowflix-store');
    localStorage.removeItem('glowflix-license');
    localStorage.removeItem('glowflix-device-id');
    // Rediriger vers la page de licence (qui permettra de réactiver ou se connecter)
    navigate('/license', { replace: true });
    // Recharger la page pour réinitialiser complètement l'état
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };
  
  // Obtenir le label du rôle pour l'affichage
  const getRoleLabel = () => {
    switch (currentRole) {
      case 'ADMIN':
        return 'Administrateur';
      case 'VENDEUR_PRODUITS':
        return 'Vendeur + Produits';
      case 'VENDEUR_STOCK':
        return 'Vendeur + Stock';
      case 'VENDEUR_SEULEMENT':
        return 'Vendeur';
      case 'GERANT_STOCK':
        return 'Gérant Stock';
      case 'PRODUITS_SEULEMENT':
        return 'Produits';
      case 'LICENSE_ONLY':
        return 'Licence';
      default:
        return 'Utilisateur';
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <motion.aside
        initial={{ x: -100 }}
        animate={{ x: 0 }}
        className="w-64 glass-strong border-r border-white/10 flex flex-col"
      >
        {/* Logo */}
        <div className="p-6 border-b border-white/10 flex items-center gap-3">
          <img 
            src="/asset/image/icon/photo.png" 
            alt="Logo" 
            className="w-10 h-10 object-contain"
          />
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
              LA GRACE
            </h1>
            <p className="text-xs text-gray-400 mt-1">Alimentation - POS</p>
          </div>
        </div>

        {/* Menu */}
        <nav className="flex-1 p-4 space-y-2">
          {visibleMenuItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path}>
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.3 }}
                  whileHover={{ 
                    x: 4,
                    scale: 1.02,
                    transition: { duration: 0.2 }
                  }}
                  whileTap={{ scale: 0.98 }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all relative overflow-hidden ${
                    isActive
                      ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 bg-primary-500/10 rounded-lg"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                  <motion.div
                    animate={isActive ? { scale: 1.1 } : { scale: 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Icon className="w-5 h-5 relative z-10" />
                  </motion.div>
                  <span className="font-medium relative z-10">{item.label}</span>
                </motion.div>
              </Link>
            );
          })}
        </nav>

        {/* Status & User */}
        <div className="p-4 border-t border-white/10 space-y-4">
          {/* Status connexion backend - Uniquement pour synchronisation automatique en arrière-plan */}
          {/* Le logiciel de ventes fonctionne toujours en mode offline-first */}
          <div className="flex items-center justify-between p-3 glass rounded-lg">
            <div className="flex items-center gap-2">
              {isOnline ? (
                <>
                  <Wifi className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-gray-300">
                    {socketConnected ? 'Sync auto active' : 'Sync...'}
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs text-gray-300">Sync auto en pause</span>
                </>
              )}
            </div>
            {/* Bouton pour forcer la vérification de connexion backend */}
            <button
              onClick={() => {
                useStore.getState().checkConnection();
              }}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
              title="Vérifier la connexion backend pour synchronisation automatique"
            >
              🔄
            </button>
          </div>

          {/* User */}
          <Link to="/profile">
            <div className="p-3 glass rounded-lg hover:bg-white/5 transition-all cursor-pointer">
              <p className="text-sm font-medium text-gray-200 flex items-center gap-2">
                <UserCircle className="w-4 h-4" />
                {user?.username || 'Utilisateur'}
              </p>
              <p className="text-xs text-gray-400">
                {getRoleLabel()}
              </p>
            </div>
          </Link>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full btn-secondary flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </div>
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>

      {/* AI LaGrace - Assistant vocal */}
      <AILaGrace />
    </div>
  );
};

export default Layout;

