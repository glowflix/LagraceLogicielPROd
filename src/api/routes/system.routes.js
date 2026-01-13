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

    // Helper: vérifier si c'est une vraie adresse IPv4
    const isIPv4 = (iface) => {
      // Node.js peut retourner 'IPv4' (string) ou 4 (number) selon la version
      return iface.family === 'IPv4' || iface.family === 4;
    };

    // Helper: vérifier si c'est une vraie adresse IP (pas un hostname)
    const isValidIPv4Address = (addr) => {
      return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
    };

    // Parcourir toutes les interfaces réseau
    Object.keys(networkInterfaces).forEach((interfaceName) => {
      networkInterfaces[interfaceName].forEach((iface) => {
        // Filtrer pour ne garder que les IPv4 non-internes avec une vraie adresse IP
        if (isIPv4(iface) && !iface.internal && isValidIPv4Address(iface.address)) {
          ips.push(iface.address);
        }
      });
    });

    // Trier les IPs (priorité aux réseaux privés communs)
    ips.sort((a, b) => {
      // Priorité: 192.168.x.x > 10.x.x.x > 172.16-31.x.x > autres
      const getPriority = (ip) => {
        if (ip.startsWith('192.168.')) return 1;
        if (ip.startsWith('10.')) return 2;
        if (ip.startsWith('172.')) return 3;
        return 4;
      };
      return getPriority(a) - getPriority(b);
    });

    console.log('[System] Adresses IP détectées:', ips);

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
