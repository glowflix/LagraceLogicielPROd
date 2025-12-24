import { logger } from '../../core/logger.js';

/**
 * Middleware de gestion des erreurs
 */
export function errorHandler(err, req, res, next) {
  logger.error('Erreur API:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Erreur serveur';

  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * Middleware 404
 */
export function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
  });
}

