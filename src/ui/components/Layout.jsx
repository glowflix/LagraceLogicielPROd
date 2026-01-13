import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, memo, useCallback, useMemo, useRef } from 'react';
import { m } from 'framer-motion';
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
  Terminal,
  TrendingUp,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useConnectionState, useIsLicensed, useToken, useUser } from '../store/selectors';
import { decodeLocalToken } from '../utils/token';
import { canAccessRoute, getUserRole, PERMISSIONS } from '../utils/permissions';
import AILaGrace from './AILaGrace';
// SyncStatusDashboard désactivé - Synchronisation complètement en arrière-plan, pas d'interface visible
// import SyncStatusDashboard from './SyncStatusDashboard';

const menuItems = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Accueil' },
  { path: '/sales', icon: ShoppingCart, label: 'Ventes' },
  { path: '/sales/history', icon: FileText, label: 'Historique' },
  { path: '/products', icon: Package, label: 'Produits' },
  { path: '/newarrivage', icon: TrendingUp, label: 'Arrivages' },
  { path: '/debts', icon: FileText, label: 'Dettes' },
  { path: '/users', icon: Users, label: 'Compte Utilisateur' },
  { path: '/analytics', icon: BarChart3, label: 'Statistiques' },
  // Synchronisation complètement en arrière-plan - pas d'interface visible
  // { path: '/sync', icon: RefreshCw, label: 'Synchronisation' },
  { path: '/settings', icon: Settings, label: 'Paramètres' },
  { path: '/logs', icon: Terminal, label: 'Logs', admin: true },
];

const Layout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ Sélecteurs atomiques: évite que le menu re-render sur chaque changement du store
  const user = useUser();
  const token = useToken();
  const isLicensed = useIsLicensed();
  const { isOnline, socketConnected } = useConnectionState();
  const logout = useStore((s) => s.logout);
  const checkConnection = useStore((s) => s.checkConnection);

  const checkConnectionRef = useRef(checkConnection);
  useEffect(() => {
    checkConnectionRef.current = checkConnection;
  }, [checkConnection]);
  
  // Vérifier la connexion au montage du composant et périodiquement
  // NOTE: Le statut de connexion est informatif seulement, n'affecte pas l'accès aux fonctionnalités
  useEffect(() => {
    // Vérifier la connexion après un court délai au démarrage
    const initialTimer = setTimeout(() => {
      checkConnectionRef.current?.();
    }, 1000);
    
    // Vérifier périodiquement la connexion (toutes les 30 secondes)
    const interval = setInterval(() => {
      if (navigator.onLine) {
        checkConnectionRef.current?.();
      }
    }, 30000);
    
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [checkConnection]);
  
  // Obtenir le rôle actuel depuis le token ou depuis l'utilisateur (memo)
  const currentRole = useMemo(() => {
    const tokenData = decodeLocalToken(token);
    let role = tokenData?.role;
    if (!role) {
      role = getUserRole(user, isLicensed);
    }
    return role || 'LICENSE_ONLY';
  }, [token, user, isLicensed]);

  // Filtrer les menus selon les permissions (memo)
  const visibleMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      // Vérifier si l'item nécessite le rôle admin
      if (item.admin && currentRole !== 'ADMIN') {
        return false;
      }
      return canAccessRoute(currentRole, item.path);
    });
  }, [currentRole]);
  
  const handleLogout = useCallback(() => {
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
  }, [logout, navigate]);
  
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
    <div className="min-h-screen flex relative isolate">
      {/* Sidebar */}
      <m.aside
        initial={{ x: -100 }}
        animate={{ x: 0 }}
        className="w-64 glass-strong border-r border-white/10 flex flex-col z-30 shrink-0"
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

        {/* Menu - Simplifié pour éviter les blocages de navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link 
                key={item.path} 
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 relative overflow-hidden ${
                  isActive
                    ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 hover:translate-x-1'
                }`}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-primary-500/10 rounded-lg pointer-events-none" />
                )}
                <Icon className={`w-5 h-5 relative z-10 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`} />
                <span className="font-medium relative z-10">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Status & User */}
        <div className="p-4 border-t border-white/10 space-y-4">
          {/* Status connexion PRO LOCAL-FIRST */}
          {/* Priorité: Backend Local (SQL) > WebSocket > Sheets */}
          <div className="flex items-center justify-between p-3 glass rounded-lg">
            <div className="flex items-center gap-2">
              {isOnline ? (
                <>
                  <Wifi className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-gray-300">
                    {socketConnected ? 'LAN connecté' : 'Backend OK'}
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs text-gray-300">Connexion...</span>
                </>
              )}
            </div>
            {/* Indicateur visuel de latence (si disponible) */}
            <button
              onClick={() => {
                useStore.getState().checkConnection();
              }}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
              title="Vérifier la connexion au backend local"
            >
              {socketConnected && <span className="text-green-400">●</span>}
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
      </m.aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto relative z-10 pointer-events-auto">
        <div className="p-6">{children}</div>
      </main>

      {/* AI LaGrace - Assistant vocal */}
      <AILaGrace />
      
      {/* Dashboard de synchronisation désactivé - Synchronisation complètement en arrière-plan */}
      {/* <SyncStatusDashboard position="top-right" mini={true} /> */}
    </div>
  );
};

export default memo(Layout);

