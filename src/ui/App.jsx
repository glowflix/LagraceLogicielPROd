import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useStore } from './store/useStore';
import SplashScreen from './pages/SplashScreen';
import LicensePage from './pages/LicensePage';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import SalesPOS from './pages/SalesPOS';
import SalesHistory from './pages/SalesHistory';
import SalesDetail from './pages/SalesDetail';
import ProductsPage from './pages/ProductsPage';
import DebtsPage from './pages/DebtsPage';
import UsersPage from './pages/UsersPage';
import ProfilePage from './pages/ProfilePage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import SyncPage from './pages/SyncPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import Layout from './components/Layout';
import PageTransition from './components/PageTransition';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  const { isLicensed, isAuthenticated, isLoading } = useStore();
  const location = useLocation();

  // Afficher le splash screen pendant le chargement initial
  // Le splash screen gère lui-même l'appel à checkLicense
  if (isLoading === undefined || isLoading) {
    return <SplashScreen />;
  }

  // Routes publiques toujours accessibles (licence et login)
  // Ces routes doivent être disponibles même après déconnexion
  if (location.pathname === '/login' || location.pathname === '/license') {
    return (
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/license" element={<LicensePage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </AnimatePresence>
    );
  }

  // Si pas de licence et pas authentifié, rediriger vers la page de licence
  if (!isLicensed && !isAuthenticated) {
    return <Navigate to="/license" replace />;
  }

  return (
    <Layout>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <Dashboard />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/sales" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <SalesPOS />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/sales/history" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <SalesHistory />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/sales/:invoice" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <SalesDetail />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/products" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <ProductsPage />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/debts" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <DebtsPage />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/users" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <UsersPage />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/profile" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <ProfilePage />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/analytics" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <AnalyticsPage />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <SettingsPage />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/sync" 
            element={
              <ProtectedRoute>
                <PageTransition>
                  <SyncPage />
                </PageTransition>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/unauthorized" 
            element={
              <PageTransition>
                <UnauthorizedPage />
              </PageTransition>
            } 
          />
        </Routes>
      </AnimatePresence>
    </Layout>
  );
}

export default App;

