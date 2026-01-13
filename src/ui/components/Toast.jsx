import { m, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

/**
 * Snackbar/Toast global pour afficher les notifications
 * Utilisé par le hook useErrorNotification
 */
const Toast = ({ id, type = 'info', message, autoClose = true, onClose }) => {
  // Couleurs par type
  const colorMap = {
    error: {
      bg: 'bg-red-900/80 border-red-500/50',
      text: 'text-red-200',
      icon: <AlertCircle className="w-5 h-5" />
    },
    success: {
      bg: 'bg-green-900/80 border-green-500/50',
      text: 'text-green-200',
      icon: <CheckCircle className="w-5 h-5" />
    },
    info: {
      bg: 'bg-blue-900/80 border-blue-500/50',
      text: 'text-blue-200',
      icon: <Info className="w-5 h-5" />
    },
    warning: {
      bg: 'bg-amber-900/80 border-amber-500/50',
      text: 'text-amber-200',
      icon: <AlertCircle className="w-5 h-5" />
    }
  };

  const colors = colorMap[type] || colorMap.info;

  return (
    <m.div
      initial={{ opacity: 0, x: 400, y: 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: 400, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`${colors.bg} border rounded-lg p-4 flex items-start gap-3 min-w-80 max-w-md shadow-2xl`}
    >
      {/* Icône */}
      <div className="flex-shrink-0 mt-0.5">
        {colors.icon}
      </div>

      {/* Message */}
      <div className={`flex-1 ${colors.text} text-sm`}>
        {message}
      </div>

      {/* Bouton fermer */}
      <button
        onClick={() => onClose(id)}
        className={`flex-shrink-0 ${colors.text} hover:opacity-70 transition-opacity`}
      >
        <X className="w-4 h-4" />
      </button>

      {/* Auto-close progress bar */}
      {autoClose && (
        <m.div
          initial={{ width: '100%' }}
          animate={{ width: 0 }}
          transition={{ duration: 4 }}
          onAnimationComplete={() => onClose(id)}
          className={`absolute bottom-0 left-0 h-1 ${
            type === 'error' ? 'bg-red-500' :
            type === 'success' ? 'bg-green-500' :
            type === 'warning' ? 'bg-amber-500' :
            'bg-blue-500'
          }`}
        />
      )}
    </m.div>
  );
};

/**
 * Conteneur pour tous les toasts
 */
export const ToastContainer = ({ toasts, onCloseToast }) => {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-auto">
      <AnimatePresence>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            type={toast.type}
            message={toast.message}
            autoClose={toast.autoClose !== false}
            onClose={onCloseToast}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default Toast;
