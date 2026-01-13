import { useState, useCallback } from 'react';

/**
 * Hook pour gérer les notifications Toast de manière centralisée
 * Utilisé par toutes les pages critiques pour afficher les erreurs
 */
export const useToastNotifications = () => {
  const [toasts, setToasts] = useState([]);

  // Ajouter un toast
  const addToast = useCallback((message, type = 'info', autoClose = true) => {
    const id = Date.now() + Math.random();
    
    console.log(`[Toast] ${type.toUpperCase()}: ${message}`);
    
    setToasts(prev => [...prev, {
      id,
      message,
      type,
      autoClose
    }]);

    return id;
  }, []);

  // Fermer un toast
  const closeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Shortcuts
  const error = useCallback((message) => addToast(message, 'error'), [addToast]);
  const success = useCallback((message) => addToast(message, 'success'), [addToast]);
  const info = useCallback((message) => addToast(message, 'info'), [addToast]);
  const warning = useCallback((message) => addToast(message, 'warning'), [addToast]);

  return {
    toasts,
    addToast,
    closeToast,
    error,
    success,
    info,
    warning
  };
};

export default useToastNotifications;
