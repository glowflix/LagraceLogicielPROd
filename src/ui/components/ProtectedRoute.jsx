import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { canAccessRoute, getUserRole, getDefaultRouteForRole, isUserActive } from '../utils/permissions';
import { decodeLocalToken } from '../utils/token';

/**
 * Composant de protection de route basé sur les permissions RBAC PRO
 * Le logiciel de ventes fonctionne toujours en mode offline-first
 * 
 * RÈGLES D'ACCÈS:
 * - Admin : Accès à TOUT
 * - Licences (sans login) : Même accès qu'Admin
 * - Vendeur seulement : Accès uniquement à la page Ventes
 * - Gérant Stock : Accès à Ventes + Produits
 * - Compte bloqué : Rediriger vers /blocked
 */
const ProtectedRoute = ({ children, requiredPermission }) => {
  const location = useLocation();
  const { token, user, isLicensed, isAuthenticated } = useStore();

  // Si pas de licence et pas authentifié, rediriger vers license
  if (!isLicensed && !isAuthenticated) {
    return <Navigate to="/license" replace state={{ from: location }} />;
  }

  // Vérifier si l'utilisateur est bloqué (is_active = false)
  if (user && !isUserActive(user)) {
    return <Navigate to="/blocked" replace state={{ reason: 'account_blocked' }} />;
  }

  // Déterminer le rôle depuis le token ou depuis l'utilisateur
  const tokenData = decodeLocalToken(token);
  let role = tokenData?.role;
  
  // Si pas de rôle dans le token, déterminer depuis l'utilisateur avec la licence
  if (!role) {
    role = getUserRole(user, isLicensed);
  }
  
  role = role || 'LICENSE_ONLY';

  // Si le rôle est BLOCKED, rediriger vers la page bloqué
  if (role === 'BLOCKED') {
    return <Navigate to="/blocked" replace state={{ reason: 'account_blocked' }} />;
  }

  // Vérifier l'accès à la route
  const hasAccess = canAccessRoute(role, location.pathname);

  if (!hasAccess) {
    // Déterminer la route de redirection selon le rôle
    const redirectTo = getDefaultRouteForRole(role);
    
    // Éviter une boucle de redirection
    if (redirectTo !== location.pathname) {
      return <Navigate to={redirectTo} replace state={{ from: location, reason: 'permission_denied' }} />;
    }
    
    // Fallback si la route par défaut est la même que la route actuelle
    return <Navigate to="/unauthorized" replace state={{ from: location, reason: 'permission_denied' }} />;
  }

  return children;
};

export default ProtectedRoute;

