import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { m } from 'framer-motion';

/**
 * ErrorBoundary: Capture les erreurs React et affiche un UI gracieux
 * Évite que l'app complète crash si une page échoue
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('❌ [ErrorBoundary] Erreur attrapée:', error);
    console.error('   Info:', errorInfo);
    
    this.setState(prevState => ({
      error,
      errorInfo,
      errorCount: prevState.errorCount + 1
    }));
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, errorCount } = this.state;
      const errorMsg = error?.message || 'Erreur inconnue';
      
      return (
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="min-h-screen bg-gradient-to-br from-dark-900 to-dark-800 flex items-center justify-center p-4"
        >
          <div className="bg-dark-800 border border-red-500/30 rounded-2xl p-8 max-w-lg shadow-2xl">
            {/* Icône d'erreur animée */}
            <m.div
              animate={{ rotate: [0, -5, 5, 0] }}
              transition={{ repeat: Infinity, duration: 3 }}
              className="flex justify-center mb-6"
            >
              <AlertCircle className="w-16 h-16 text-red-500" />
            </m.div>

            {/* Titre */}
            <h2 className="text-2xl font-bold text-white text-center mb-4">
              Oups! Une erreur est survenue
            </h2>

            {/* Message d'erreur */}
            <p className="text-gray-300 text-center mb-6">
              {errorMsg}
            </p>

            {/* Détails (développement seulement) */}
            {import.meta.env.DEV && errorInfo && (
              <details className="mb-6 bg-dark-700 p-4 rounded text-xs text-gray-400 cursor-pointer hover:bg-dark-600 transition-colors">
                <summary className="font-semibold text-gray-300 mb-2">Détails techniques</summary>
                <pre className="whitespace-pre-wrap break-words overflow-auto max-h-32">
                  {errorInfo.componentStack}
                </pre>
              </details>
            )}

            {/* Compteur d'erreurs */}
            {errorCount > 2 && (
              <div className="mb-6 p-4 bg-amber-900/20 border border-amber-500/30 rounded">
                <p className="text-amber-400 text-sm">
                  ⚠️ Plusieurs erreurs détectées ({errorCount}). Veuillez recharger la page.
                </p>
              </div>
            )}

            {/* Boutons d'action */}
            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                Réessayer
              </button>
              <button
                onClick={() => window.location.href = '/'}
                className="flex-1 px-4 py-3 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors font-medium"
              >
                Accueil
              </button>
            </div>

            {/* Info */}
            <p className="text-xs text-gray-500 text-center mt-6">
              Si le problème persiste, veuillez contacter le support ou recharger l'application.
            </p>
          </div>
        </m.div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
