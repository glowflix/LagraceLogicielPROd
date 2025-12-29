import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { canAccessRoute, getUserRole } from '../utils/permissions';
import { decodeLocalToken } from '../utils/token';

/**
 * Composant de protection de route basé sur les permissions RBAC PRO
 * Le logiciel de ventes fonctionne toujours en mode offline-first
 */
const ProtectedRoute = ({ children, requiredPermission }) => {
  const location = useLocation();
  const { token, user, isLicensed, isAuthenticated } = useStore();

  // Si pas de licence et pas authentifié, rediriger vers license
  if (!isLicensed && !isAuthenticated) {
    return <Navigate to="/license" replace state={{ from: location }} />;
  }

  // Déterminer le rôle depuis le token ou depuis l'utilisateur
  const tokenData = decodeLocalToken(token);
  let role = tokenData?.role;
  
  // Si pas de rôle dans le token, déterminer depuis l'utilisateur avec la licence
  if (!role) {
    role = getUserRole(user, isLicensed);
  }
  
  role = role || 'LICENSE_ONLY';

  // Vérifier l'accès à la route
  const hasAccess = canAccessRoute(role, location.pathname);

  if (!hasAccess) {
    // Déterminer la route de redirection selon le rôle
    let redirectTo = '/unauthorized';
    
    // Si l'utilisateur a accès aux ventes, rediriger vers les ventes
    if (canAccessRoute(role, '/sales')) {
      redirectTo = '/sales';
    } else if (canAccessRoute(role, '/dashboard')) {
      redirectTo = '/dashboard';
    }
    
    return <Navigate to={redirectTo} replace state={{ from: location, reason: 'permission_denied' }} />;
  }

  return children;
};

export default ProtectedRoute;

