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
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import SyncPage from './pages/SyncPage';
import Layout from './components/Layout';
import PageTransition from './components/PageTransition';

function App() {
  const { isLicensed, isAuthenticated, isLoading } = useStore();
  const location = useLocation();

  // Afficher le splash screen pendant le chargement initial
  // Le splash screen gère lui-même l'appel à checkLicense
  if (isLoading === undefined || isLoading) {
    return <SplashScreen />;
  }

  // Si pas de licence et pas authentifié, rediriger vers la page de licence ou login
  if (!isLicensed && !isAuthenticated) {
    return (
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/license" element={<LicensePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/license" replace />} />
        </Routes>
      </AnimatePresence>
    );
  }

  return (
    <Layout>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route 
            path="/dashboard" 
            element={
              <PageTransition>
                <Dashboard />
              </PageTransition>
            } 
          />
          <Route 
            path="/sales" 
            element={
              <PageTransition>
                <SalesPOS />
              </PageTransition>
            } 
          />
          <Route 
            path="/sales/history" 
            element={
              <PageTransition>
                <SalesHistory />
              </PageTransition>
            } 
          />
          <Route 
            path="/sales/:invoice" 
            element={
              <PageTransition>
                <SalesDetail />
              </PageTransition>
            } 
          />
          <Route 
            path="/products" 
            element={
              <PageTransition>
                <ProductsPage />
              </PageTransition>
            } 
          />
          <Route 
            path="/debts" 
            element={
              <PageTransition>
                <DebtsPage />
              </PageTransition>
            } 
          />
          <Route 
            path="/users" 
            element={
              <PageTransition>
                <UsersPage />
              </PageTransition>
            } 
          />
          <Route 
            path="/analytics" 
            element={
              <PageTransition>
                <AnalyticsPage />
              </PageTransition>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <PageTransition>
                <SettingsPage />
              </PageTransition>
            } 
          />
          <Route 
            path="/sync" 
            element={
              <PageTransition>
                <SyncPage />
              </PageTransition>
            } 
          />
        </Routes>
      </AnimatePresence>
    </Layout>
  );
}

export default App;

