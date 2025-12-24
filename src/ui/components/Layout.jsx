import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  FileText,
  BarChart3,
  Settings,
  RefreshCw,
  LogOut,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useStore } from '../store/useStore';

const menuItems = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Accueil' },
  { path: '/sales', icon: ShoppingCart, label: 'Ventes' },
  { path: '/sales/history', icon: FileText, label: 'Historique' },
  { path: '/products', icon: Package, label: 'Produits' },
  { path: '/debts', icon: FileText, label: 'Dettes' },
  { path: '/analytics', icon: BarChart3, label: 'Statistiques' },
  { path: '/sync', icon: RefreshCw, label: 'Synchronisation' },
  { path: '/settings', icon: Settings, label: 'Paramètres' },
];

const Layout = ({ children }) => {
  const location = useLocation();
  const { logout, user, isOnline, socketConnected } = useStore();

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
          {menuItems.map((item, index) => {
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
          {/* Status connexion */}
          <div className="flex items-center justify-between p-3 glass rounded-lg">
            <div className="flex items-center gap-2">
              {isOnline && socketConnected ? (
                <>
                  <Wifi className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-gray-300">En ligne</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs text-gray-300">Hors ligne</span>
                </>
              )}
            </div>
          </div>

          {/* User */}
          <div className="p-3 glass rounded-lg">
            <p className="text-sm font-medium text-gray-200">
              {user?.username || 'Utilisateur'}
            </p>
            <p className="text-xs text-gray-400">
              {user?.is_admin ? 'Administrateur' : 'Vendeur'}
            </p>
          </div>

          {/* Logout */}
          <button
            onClick={logout}
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
    </div>
  );
};

export default Layout;

