import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useEffect, Suspense, lazy, memo } from 'react';
import { useStore } from './store/useStore';
import { preloadCriticalData } from './hooks/useLocalData';
import { startPeriodicSync, onSyncEvent } from './services/BackgroundSync';

// ═══════════════════════════════════════════════════════════════════════════
// PAGES CRITIQUES (chargées immédiatement)
// ═══════════════════════════════════════════════════════════════════════════
import SplashScreen from './pages/SplashScreen';
import LicensePage from './pages/LicensePage';
import LoginPage from './pages/LoginPage';
import BlockedPage from './pages/BlockedPage';
import Layout from './components/Layout';
import PageTransition from './components/PageTransition';
import ProtectedRoute from './components/ProtectedRoute';

// ═══════════════════════════════════════════════════════════════════════════
// PAGES LAZY-LOADED (chargées à la demande)
// ═══════════════════════════════════════════════════════════════════════════
const Dashboard = lazy(() => import('./pages/Dashboard'));
const SalesPOS = lazy(() => import('./pages/SalesPOS'));
const SalesHistory = lazy(() => import('./pages/SalesHistory'));
const SalesDetail = lazy(() => import('./pages/SalesDetail'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const DebtsPage = lazy(() => import('./pages/DebtsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
// SyncPage désactivée - Synchronisation complètement en arrière-plan, pas d'interface visible
// const SyncPage = lazy(() => import('./pages/SyncPage'));
const NewArrivagePage = lazy(() => import('./pages/NewArrivagePage'));
const UnauthorizedPage = lazy(() => import('./pages/UnauthorizedPage'));
const MobileConnectPage = lazy(() => import('./pages/MobileConnectPage'));
const SalesPOSPhone = lazy(() => import('./pages/SalesPOSPhone'));
const LogsPage = lazy(() => import('./pages/LogsPage'));

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK DE CHARGEMENT (ultra-léger)
// ═══════════════════════════════════════════════════════════════════════════
const PageLoader = memo(() => (
  <div className="flex items-center justify-center h-64">
    <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
  </div>
));

PageLoader.displayName = 'PageLoader';

// ═══════════════════════════════════════════════════════════════════════════
// WRAPPER POUR ROUTES PROTÉGÉES LAZY
// ═══════════════════════════════════════════════════════════════════════════
// NOTE: PageTransition est maintenant géré au niveau App.jsx avec AnimatePresence
// pour éviter les doubles transitions et les problèmes de clics bloqués
const LazyRoute = memo(({ children }) => (
  <ProtectedRoute>
    <Suspense fallback={<PageLoader />}>
      {children}
    </Suspense>
  </ProtectedRoute>
));

LazyRoute.displayName = 'LazyRoute';

// ═══════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
function App() {
  const { isLicensed, isAuthenticated, isLoading } = useStore();
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ Précharger en idle les pages lourdes (évite les freezes lors des clics rapides)
  useEffect(() => {
    if (!isAuthenticated || !isLicensed) return;

    const preload = () => {
      // Pages souvent visitées + volumineuses
      import('./pages/ProductsPage');
      import('./pages/SalesHistory');
      import('./pages/DebtsPage');
      import('./pages/UsersPage');
      import('./pages/AnalyticsPage');
      import('./pages/SettingsPage');
    };

    // requestIdleCallback si dispo (Electron/Chromium), sinon fallback
    const w = typeof window !== 'undefined' ? window : undefined;
    if (w?.requestIdleCallback) {
      const id = w.requestIdleCallback(preload, { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }

    const t = setTimeout(preload, 800);
    return () => clearTimeout(t);
  }, [isAuthenticated, isLicensed]);

  // ✅ Précharger les données critiques dès que l'utilisateur est authentifié
  useEffect(() => {
    if (isAuthenticated && isLicensed) {
      preloadCriticalData();
    }
  }, [isAuthenticated, isLicensed]);

  // ✅ Démarrer la synchronisation en arrière-plan (non-bloquante)
  useEffect(() => {
    if (isAuthenticated && isLicensed) {
      // Démarrer la synchronisation périodique (toutes les 60 secondes)
      const stopSync = startPeriodicSync(60000);
      
      // Écouter les événements de sync pour logs (optionnel)
      const unsubscribe = onSyncEvent((event, data) => {
        if (event === 'sync:error') {
          console.warn('[BackgroundSync]', event, data);
        }
      });
      
      return () => {
        stopSync();
        unsubscribe();
      };
    }
  }, [isAuthenticated, isLicensed]);

  // ✅ Écouter les événements de navigation depuis le menu Electron
  useEffect(() => {
    if (window.electronAPI?.menu?.onNavigate) {
      const unsubscribe = window.electronAPI.menu.onNavigate((route) => {
        const routeMap = {
          '/': '/dashboard',
          '/pos': '/sales',
          '/products': '/products',
          '/debts': '/debts',
          '/analytics': '/analytics',
          '/settings': '/settings',
          '/sync': '/sync',
          '/users': '/users',
          '/newarrivage': '/newarrivage',
        };
        const targetRoute = routeMap[route] || route;
        navigate(targetRoute);
      });
      return unsubscribe;
    }
  }, [navigate]);

  // Afficher le splash screen pendant le chargement initial
  if (isLoading === undefined || isLoading) {
    return <SplashScreen />;
  }

  // Routes publiques toujours accessibles
  const publicPaths = ['/login', '/license', '/blocked', '/mobile-connect', '/mobile'];
  if (publicPaths.includes(location.pathname)) {
    return (
      <AnimatePresence 
        mode="wait" 
        initial={false}
        // ✅ Optimisations pour fluidité maximale
        presenceAffectsLayout={false}
      >
        <PageTransition key={location.pathname}>
          <Routes location={location}>
            <Route path="/license" element={<LicensePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/blocked" element={<BlockedPage />} />
            <Route 
              path="/mobile-connect" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <MobileConnectPage />
                </Suspense>
              } 
            />
            <Route 
              path="/mobile" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <SalesPOSPhone />
                </Suspense>
              } 
            />
          </Routes>
        </PageTransition>
      </AnimatePresence>
    );
  }

  // Si pas de licence et pas authentifié, rediriger vers la page de licence
  if (!isLicensed && !isAuthenticated) {
    return <Navigate to="/license" replace />;
  }

  return (
    <Layout>
      <AnimatePresence mode="wait" initial={false}>
        <PageTransition key={location.pathname}>
          <Routes location={location}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            
            <Route 
              path="/dashboard" 
              element={
                <LazyRoute>
                  <Dashboard />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/sales" 
              element={
                <LazyRoute>
                  <SalesPOS />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/sales/history" 
              element={
                <LazyRoute>
                  <SalesHistory />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/sales/:invoice" 
              element={
                <LazyRoute>
                  <SalesDetail />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/products" 
              element={
                <LazyRoute>
                  <ProductsPage />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/debts" 
              element={
                <LazyRoute>
                  <DebtsPage />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/users" 
              element={
                <LazyRoute>
                  <UsersPage />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/profile" 
              element={
                <LazyRoute>
                  <ProfilePage />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/analytics" 
              element={
                <LazyRoute>
                  <AnalyticsPage />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/settings" 
              element={
                <LazyRoute>
                  <SettingsPage />
                </LazyRoute>
              } 
            />
            
            {/* Route SyncPage désactivée - Synchronisation complètement en arrière-plan */}
            {/* <Route 
              path="/sync" 
              element={
                <LazyRoute>
                  <SyncPage />
                </LazyRoute>
              } 
            /> */}
            
            <Route 
              path="/newarrivage" 
              element={
                <LazyRoute>
                  <NewArrivagePage />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/logs" 
              element={
                <LazyRoute>
                  <LogsPage />
                </LazyRoute>
              } 
            />
            
            <Route 
              path="/unauthorized" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <UnauthorizedPage />
                </Suspense>
              } 
            />
          </Routes>
        </PageTransition>
      </AnimatePresence>
    </Layout>
  );
}

export default App;
