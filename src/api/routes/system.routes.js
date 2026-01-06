/**
 * Routes système - Informations réseau et configuration
 * @module api/routes/system.routes
 */
import express from 'express';
import os from 'os';

const router = express.Router();

/**
 * GET /api/system/network-info
 * Retourne les adresses IP du serveur pour la connexion LAN
 */
router.get('/network-info', (req, res) => {
  try {
    const networkInterfaces = os.networkInterfaces();
    const ips = [];

    // Parcourir toutes les interfaces réseau
    Object.keys(networkInterfaces).forEach((interfaceName) => {
      networkInterfaces[interfaceName].forEach((iface) => {
        // Filtrer pour ne garder que les IPv4 non-internes
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
      });
    });

    // Trier les IPs (priorité aux 192.168.x.x)
    ips.sort((a, b) => {
      const aIs192 = a.startsWith('192.168.');
      const bIs192 = b.startsWith('192.168.');
      if (aIs192 && !bIs192) return -1;
      if (!aIs192 && bIs192) return 1;
      return 0;
    });

    res.json({
      success: true,
      ips,
      hostname: os.hostname(),
      port: process.env.PORT || 3030,
      platform: os.platform(),
    });
  } catch (error) {
    console.error('[System] Erreur récupération infos réseau:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération informations réseau',
    });
  }
});

/**
 * GET /api/system/health
 * Health check du serveur
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
