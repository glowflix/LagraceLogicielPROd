import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { m } from 'framer-motion';
import { 
  QrCode, 
  Smartphone, 
  Wifi, 
  Copy, 
  Check, 
  RefreshCw,
  ExternalLink,
  Monitor,
  ArrowLeft,
  Zap
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * Page de connexion mobile avec QR Code
 * Permet aux smartphones de se connecter au serveur via QR code
 */
const MobileConnectPage = () => {
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ipAddresses, setIpAddresses] = useState([]);
  const [selectedIp, setSelectedIp] = useState('');
  const PORT = 3030;

  // Détecter les adresses IP du serveur
  const detectIpAddresses = useCallback(async () => {
    setLoading(true);
    // Helper pour vérifier si c'est une vraie adresse IPv4
    const isValidIPv4 = (ip) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
    
    try {
      // Essayer de récupérer les IPs via l'API
      const response = await fetch('/api/system/network-info');
      if (response.ok) {
        const data = await response.json();
        if (data.ips && data.ips.length > 0) {
          // Filtrer pour ne garder que les vraies adresses IPv4
          const validIps = data.ips.filter(ip => isValidIPv4(ip));
          if (validIps.length > 0) {
            setIpAddresses(validIps);
            setSelectedIp(validIps[0]);
            return;
          }
        }
      }
    } catch (e) {
      console.log('API network-info non disponible, utilisation de fallback');
    }

    // Fallback: Utiliser l'URL actuelle (seulement si c'est une vraie IP)
    const currentHost = window.location.hostname;
    if (currentHost && isValidIPv4(currentHost) && currentHost !== '127.0.0.1') {
      setIpAddresses([currentHost]);
      setSelectedIp(currentHost);
    } else {
      // Essayer de détecter via WebRTC (méthode client-side)
      try {
        const ips = await detectLocalIPs();
        if (ips.length > 0) {
          setIpAddresses(ips);
          setSelectedIp(ips[0]);
        } else {
          // Fallback final
          setIpAddresses(['192.168.1.100']);
          setSelectedIp('192.168.1.100');
        }
      } catch (e) {
        setIpAddresses(['192.168.1.100']);
        setSelectedIp('192.168.1.100');
      }
    }
    setLoading(false);
  }, []);

  // Détecter les IPs locales via WebRTC
  const detectLocalIPs = () => {
    return new Promise((resolve) => {
      const ips = [];
      const RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
      
      if (!RTCPeerConnection) {
        resolve(ips);
        return;
      }

      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          pc.close();
          resolve([...new Set(ips)]);
          return;
        }
        const candidate = e.candidate.candidate;
        const ipMatch = candidate.match(/(\d{1,3}\.){3}\d{1,3}/);
        if (ipMatch) {
          const ip = ipMatch[0];
          // Filtrer les IPs privées (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
          if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) {
            ips.push(ip);
          }
        }
      };

      pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => resolve(ips));

      // Timeout après 3 secondes
      setTimeout(() => {
        pc.close();
        resolve([...new Set(ips)]);
      }, 3000);
    });
  };

  // Mettre à jour l'URL quand l'IP change
  useEffect(() => {
    if (selectedIp) {
      const url = `http://${selectedIp}:${PORT}/mobile`;
      setServerUrl(url);
      setLoading(false);
    }
  }, [selectedIp]);

  // Charger les IPs au montage
  useEffect(() => {
    detectIpAddresses();
  }, [detectIpAddresses]);

  // Copier l'URL
  const copyUrl = () => {
    navigator.clipboard.writeText(serverUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Générer le raccourci mobile (pour téléphone)
  const generateShortcut = () => {
    const shortcutContent = `[InternetShortcut]
URL=${serverUrl}
IconIndex=0
`;
    const blob = new Blob([shortcutContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LA-GRACE-Mobile.url`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Générer le raccourci POS Desktop (pour autres PC)
  const generatePOSShortcut = () => {
    const posUrl = `http://${selectedIp}:${PORT}`;
    const shortcutContent = `[InternetShortcut]
URL=${posUrl}
IconIndex=0
IconFile=https://www.google.com/favicon.ico
`;
    const blob = new Blob([shortcutContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LA-GRACE-POS.url`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 p-4 flex items-center justify-center">
      {/* Particules d'arrière-plan */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <m.div
            key={i}
            className="absolute w-1 h-1 bg-primary-400/30 rounded-full"
            initial={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
              opacity: 0,
            }}
            animate={{
              y: [null, Math.random() * window.innerHeight],
              opacity: [0, 0.5, 0],
            }}
            transition={{
              duration: Math.random() * 5 + 3,
              repeat: Infinity,
              delay: Math.random() * 2,
            }}
          />
        ))}
      </div>

      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-lg w-full relative z-10"
      >
        {/* Bouton retour */}
        <m.button
          onClick={() => navigate('/license')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="mb-6 flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Retour
        </m.button>

        {/* Carte principale */}
        <div className="glass-strong rounded-2xl p-6 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-500/20 mb-4">
              <Smartphone className="w-8 h-8 text-primary-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Connexion Mobile
            </h1>
            <p className="text-gray-400 text-sm">
              Scannez le QR code avec votre smartphone pour accéder au POS mobile
            </p>
          </div>

          {/* QR Code */}
          <div className="flex justify-center mb-6">
            <m.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="relative"
            >
              {loading ? (
                <div className="w-[280px] h-[280px] bg-dark-700 rounded-xl flex items-center justify-center">
                  <RefreshCw className="w-10 h-10 text-primary-400 animate-spin" />
                </div>
              ) : (
                <div className="bg-dark-700 p-4 rounded-xl border border-primary-500/30">
                  {serverUrl && (
                    <QRCodeSVG 
                      value={serverUrl}
                      size={250}
                      bgColor="transparent"
                      fgColor="#ffffff"
                      level="H"
                    />
                  )}
                </div>
              )}
              
              {/* Badge d'état */}
              <m.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.5 }}
                className="absolute -top-3 -right-3 bg-green-500 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1"
              >
                <Wifi className="w-3 h-3" />
                En ligne
              </m.div>
            </m.div>
          </div>

          {/* Sélecteur d'IP */}
          {ipAddresses.length > 1 && (
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                Adresse IP du serveur
              </label>
              <select
                value={selectedIp}
                onChange={(e) => setSelectedIp(e.target.value)}
                className="w-full bg-dark-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                {ipAddresses.map((ip) => (
                  <option key={ip} value={ip}>{ip}</option>
                ))}
              </select>
            </div>
          )}

          {/* URL et copie */}
          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-2">
              URL de connexion
            </label>
            <div className="flex gap-2">
              <div className="flex-1 bg-dark-700 border border-gray-600 rounded-lg px-4 py-3 text-primary-400 font-mono text-sm truncate">
                {serverUrl}
              </div>
              <m.button
                onClick={copyUrl}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`px-4 py-3 rounded-lg transition-colors ${
                  copied 
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                    : 'bg-dark-700 text-gray-400 hover:text-white border border-gray-600'
                }`}
              >
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </m.button>
            </div>
          </div>

          {/* Boutons d'action */}
          <div className="space-y-3">
            {/* Export raccourci pour téléphone (mobile) */}
            <m.button
              onClick={generateShortcut}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              <Smartphone className="w-5 h-5" />
              Exporter raccourci Mobile (.url)
            </m.button>

            {/* Export raccourci POS Desktop pour autres PC */}
            <m.button
              onClick={generatePOSShortcut}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-3 rounded-lg transition-colors flex items-center justify-center gap-2 font-semibold"
            >
              <Monitor className="w-5 h-5" />
              Exporter raccourci POS Desktop (.url)
            </m.button>

            <m.button
              onClick={() => window.open(serverUrl, '_blank')}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full btn-secondary flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-5 h-5" />
              Ouvrir dans le navigateur
            </m.button>

            <m.button
              onClick={detectIpAddresses}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full bg-dark-700 hover:bg-dark-600 text-gray-400 hover:text-white py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Actualiser les adresses IP
            </m.button>
          </div>

          {/* Instructions */}
          <div className="mt-6 pt-6 border-t border-gray-700">
            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              Instructions
            </h3>
            <ol className="text-xs text-gray-400 space-y-2">
              <li className="flex items-start gap-2">
                <span className="bg-primary-500/20 text-primary-400 w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0">1</span>
                <span>Assurez-vous que votre smartphone est connecté au même réseau WiFi</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-primary-500/20 text-primary-400 w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0">2</span>
                <span>Scannez le QR code avec l'appareil photo de votre smartphone</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-primary-500/20 text-primary-400 w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0">3</span>
                <span>Ouvrez le lien pour accéder au POS mobile optimisé</span>
              </li>
            </ol>
          </div>

          {/* Info réseau */}
          <div className="mt-4 p-3 bg-dark-700/50 rounded-lg flex items-center gap-3">
            <Monitor className="w-5 h-5 text-gray-500" />
            <div className="text-xs text-gray-500">
              <span className="text-gray-400">Port:</span> {PORT} • 
              <span className="text-gray-400 ml-2">Protocole:</span> HTTP
            </div>
          </div>
        </div>

        {/* Logo en bas */}
        <div className="text-center mt-6">
          <img
            src="/asset/image/icon/photo.png"
            alt="Logo LA GRACE"
            className="w-8 h-8 mx-auto opacity-50"
          />
          <p className="text-xs text-gray-500 mt-2">
            LA GRACE PRO - POS Mobile
          </p>
        </div>
      </m.div>
    </div>
  );
};

export default MobileConnectPage;
