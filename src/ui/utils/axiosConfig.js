import axios from 'axios';
import { useStore } from '../store/useStore';

/**
 * Configure axios pour ajouter automatiquement le token dans toutes les requêtes
 */
export function setupAxiosInterceptors() {
  // Intercepteur de requête : ajouter le token automatiquement
  axios.interceptors.request.use(
    (config) => {
      // Récupérer le token depuis le store
      const token = useStore.getState().token;
      
      // Si un token existe, l'ajouter dans les headers
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Intercepteur de réponse : gérer les erreurs d'authentification
  axios.interceptors.response.use(
    (response) => {
      return response;
    },
    (error) => {
      // Si erreur 401 (non autorisé), déconnecter l'utilisateur
      if (error.response?.status === 401) {
        // Ne pas déconnecter si c'est juste un token offline (normal en mode offline)
        const token = useStore.getState().token;
        if (token && !token.startsWith('local.') && token !== 'offline-token') {
          console.warn('Token invalide, déconnexion...');
          useStore.getState().logout();
        }
      }
      return Promise.reject(error);
    }
  );
}

