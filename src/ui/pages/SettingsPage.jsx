import { useState, useEffect, useCallback } from 'react';
import { m } from 'framer-motion';
import { Settings as SettingsIcon, DollarSign, RefreshCw, Save, CheckCircle2, XCircle, Wifi, Server, Smartphone, QrCode, Copy, Check, Download, Monitor } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import axios from 'axios';
import { useStore } from '../store/useStore';
import { getApiUrl, setApiUrl, testApiConnection } from '../utils/apiConfig';
import { updateApiUrl } from '../store/useStore';

const API_URL = getApiUrl();

const SettingsPage = () => {
  const { currentRate: storeRate, loadCurrentRate, updateCurrentRate } = useStore();
  const [currentRate, setCurrentRate] = useState(storeRate || 2800);
  const [newRate, setNewRate] = useState((storeRate || 2800).toString());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    // Charger le taux depuis l'API et mettre à jour le store
    loadCurrentRate().then((rate) => {
      if (rate) {
        setCurrentRate(rate);
        setNewRate(rate.toString());
      }
    });
  }, [loadCurrentRate]);

  // Synchroniser avec le store si le taux change ailleurs
  useEffect(() => {
    if (storeRate && storeRate !== currentRate) {
      setCurrentRate(storeRate);
      setNewRate(storeRate.toString());
    }
  }, [storeRate]);

  const handleUpdateRate = async () => {
    const rate = parseFloat(newRate);
    
    if (isNaN(rate) || rate <= 0) {
      setMessage({ type: 'error', text: 'Veuillez entrer un taux valide' });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const response = await axios.put(`${API_URL}/api/rates/current`, { rate });
      
      if (response.data.success) {
        const updatedRate = response.data.rate;
        setCurrentRate(updatedRate);
        setNewRate(updatedRate.toString());
        updateCurrentRate(updatedRate); // Mettre à jour le store pour que toutes les pages utilisent le même taux
        setMessage({ type: 'success', text: 'Taux mis à jour avec succès' });
        
        // Effacer le message après 3 secondes
        setTimeout(() => {
          setMessage({ type: '', text: '' });
        }, 3000);
      }
    } catch (error) {
      console.error('Erreur mise à jour taux:', error);
      setMessage({ type: 'error', text: error.response?.data?.error || 'Erreur lors de la mise à jour du taux' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Paramètres</h1>
        <p className="text-gray-400">Configuration de l'application</p>
      </div>

      {/* Taux de change */}
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-strong rounded-xl p-6"
      >
        <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-primary-400" />
          Taux de change FC/USD
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Taux actuel
            </label>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-primary-400">{currentRate}</span>
              <span className="text-gray-400">FC/USD</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Ce taux est utilisé pour convertir les montants entre FC et USD
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Nouveau taux
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                placeholder="2800"
                step="0.01"
                min="0"
                className="input-field flex-1"
                onKeyPress={(e) => e.key === 'Enter' && handleUpdateRate()}
              />
              <button
                onClick={handleUpdateRate}
                disabled={loading || !newRate}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <m.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    >
                      <RefreshCw className="w-5 h-5" />
                    </m.div>
                    Mise à jour...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Mettre à jour
                  </>
                )}
              </button>
            </div>
          </div>

          {message.text && (
            <m.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-center gap-2 p-3 rounded-lg ${
                message.type === 'success'
                  ? 'bg-green-500/20 border border-green-500/30'
                  : 'bg-red-500/20 border border-red-500/30'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span
                className={`text-sm ${
                  message.type === 'success' ? 'text-green-300' : 'text-red-300'
                }`}
              >
                {message.text}
              </span>
            </m.div>
          )}
        </div>
      </m.div>

      {/* Configuration serveur (pour Android) */}
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-strong rounded-xl p-6"
      >
        <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
          <Server className="w-6 h-6 text-primary-400" />
          Configuration serveur
        </h2>
        
        <ServerConfigSection />
      </m.div>

      {/* QR Code Mobile - Connexion smartphone */}
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-strong rounded-xl p-6"
      >
        <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
          <Smartphone className="w-6 h-6 text-primary-400" />
          Connexion Mobile (QR Code)
        </h2>
        
        <MobileQRSection />
      </m.div>
    </div>
  );
};

// Composant pour la configuration du serveur
const ServerConfigSection = () => {
  const [serverUrl, setServerUrl] = useState(getApiUrl());
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleTestConnection = async () => {
    setTesting(true);
    setMessage({ type: '', text: '' });
    
    const isValid = await testApiConnection(serverUrl);
    setConnectionStatus(isValid);
    
    if (isValid) {
      setMessage({ type: 'success', text: 'Connexion réussie !' });
    } else {
      setMessage({ type: 'error', text: 'Impossible de se connecter au serveur' });
    }
    
    setTesting(false);
  };

  const handleSaveServerUrl = () => {
    if (setApiUrl(serverUrl)) {
      updateApiUrl(serverUrl);
      setMessage({ type: 'success', text: 'URL serveur sauvegardée. Rechargez la page pour appliquer les changements.' });
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } else {
      setMessage({ type: 'error', text: 'URL invalide. Format attendu: http://IP:PORT' });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          URL du serveur
        </label>
        <p className="text-xs text-gray-500 mb-3">
          Pour Android, entrez l'adresse IP du serveur (ex: http://192.168.1.100:3030)
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => {
              setServerUrl(e.target.value);
              setConnectionStatus(null);
              setMessage({ type: '', text: '' });
            }}
            placeholder="http://192.168.1.100:3030"
            className="input-field flex-1"
          />
          <button
            onClick={handleTestConnection}
            disabled={testing || !serverUrl}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            {testing ? (
              <m.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <RefreshCw className="w-5 h-5" />
              </m.div>
            ) : (
              <Wifi className="w-5 h-5" />
            )}
            Tester
          </button>
        </div>
        
        {connectionStatus !== null && (
          <div className={`mt-2 flex items-center gap-2 text-sm ${
            connectionStatus ? 'text-green-400' : 'text-red-400'
          }`}>
            {connectionStatus ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            {connectionStatus ? 'Serveur accessible' : 'Serveur inaccessible'}
          </div>
        )}
      </div>

      <button
        onClick={handleSaveServerUrl}
        disabled={!serverUrl || connectionStatus === false}
        className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Save className="w-5 h-5" />
        Sauvegarder et recharger
      </button>

      {message.text && (
        <m.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 p-3 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-500/20 border border-green-500/30'
              : 'bg-red-500/20 border border-red-500/30'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400" />
          )}
          <span
            className={`text-sm ${
              message.type === 'success' ? 'text-green-300' : 'text-red-300'
            }`}
          >
            {message.text}
          </span>
        </m.div>
      )}
    </div>
  );
};

// Composant QR Code pour connexion mobile
const MobileQRSection = () => {
  const [serverUrl, setServerUrl] = useState('');
  const [ipAddresses, setIpAddresses] = useState([]);
  const [selectedIp, setSelectedIp] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const PORT = 3030;

  // Détecter automatiquement les adresses IP
  const detectIpAddresses = useCallback(async () => {
    setLoading(true);
    const ips = new Set();
    
    try {
      // Méthode 1: Via l'API système
      const response = await axios.get(`${getApiUrl()}/api/system/network-info`);
      if (response.data?.addresses) {
        response.data.addresses.forEach(ip => ips.add(ip));
      }
    } catch (e) {
      console.log('API network-info non disponible');
    }

    // Méthode 2: WebRTC (fallback navigateur)
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      await new Promise((resolve) => {
        pc.onicecandidate = (e) => {
          if (!e.candidate) {
            resolve();
            return;
          }
          const parts = e.candidate.candidate.split(' ');
          const ip = parts[4];
          if (ip && !ip.includes(':') && ip !== '0.0.0.0' && !ip.startsWith('127.')) {
            ips.add(ip);
          }
        };
        setTimeout(resolve, 1000);
      });
      
      pc.close();
    } catch (e) {
      console.log('WebRTC non disponible');
    }

    // Méthode 3: IPs communes par défaut
    if (ips.size === 0) {
      ips.add('192.168.1.100');
      ips.add('192.168.0.100');
    }

    const ipArray = Array.from(ips);
    setIpAddresses(ipArray);
    
    // Sélectionner automatiquement la première IP
    if (ipArray.length > 0 && !selectedIp) {
      setSelectedIp(ipArray[0]);
      setServerUrl(`http://${ipArray[0]}:${PORT}/mobile`);
    }
    
    setLoading(false);
  }, [selectedIp]);

  useEffect(() => {
    detectIpAddresses();
  }, [detectIpAddresses]);

  // Mettre à jour l'URL quand l'IP change
  useEffect(() => {
    if (selectedIp) {
      setServerUrl(`http://${selectedIp}:${PORT}/mobile`);
    }
  }, [selectedIp]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Erreur copie:', err);
    }
  };

  // Générer raccourci Mobile (.url) - pour téléphone
  const exportMobileShortcut = () => {
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

  // Générer raccourci POS Desktop (.url) - pour autres PC
  const exportPOSShortcut = () => {
    const posUrl = `http://${selectedIp}:${PORT}`;
    const shortcutContent = `[InternetShortcut]
URL=${posUrl}
IconIndex=0
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
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        Scannez ce QR code avec l'appareil photo de votre téléphone ou Google Chrome pour ouvrir la page de ventes mobile.
      </p>

      {/* Sélection IP */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Adresse IP du serveur
        </label>
        <select
          value={selectedIp}
          onChange={(e) => setSelectedIp(e.target.value)}
          className="input-field w-full"
        >
          {ipAddresses.map((ip) => (
            <option key={ip} value={ip}>
              {ip}
            </option>
          ))}
        </select>
      </div>

      {/* QR Code */}
      <div className="flex flex-col items-center py-4">
        {loading ? (
          <div className="w-[200px] h-[200px] bg-dark-700 rounded-xl flex items-center justify-center">
            <RefreshCw className="w-8 h-8 text-primary-400 animate-spin" />
          </div>
        ) : serverUrl ? (
          <m.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white p-4 rounded-xl"
          >
            <QRCodeSVG 
              value={serverUrl}
              size={200}
              bgColor="#ffffff"
              fgColor="#000000"
              level="H"
              includeMargin={true}
            />
          </m.div>
        ) : (
          <div className="w-[200px] h-[200px] bg-dark-700 rounded-xl flex items-center justify-center">
            <QrCode className="w-16 h-16 text-gray-600" />
          </div>
        )}
      </div>

      {/* URL avec copie */}
      <div className="flex gap-2">
        <input
          type="text"
          value={serverUrl}
          readOnly
          className="input-field flex-1 text-sm font-mono"
        />
        <button
          onClick={handleCopy}
          className="btn-secondary flex items-center gap-2"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-green-400" />
              Copié!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copier
            </>
          )}
        </button>
      </div>

      {/* Boutons Export */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={exportMobileShortcut}
          disabled={!serverUrl}
          className="btn-primary flex items-center justify-center gap-2 py-3"
        >
          <Smartphone className="w-4 h-4" />
          <span className="text-sm">Export Mobile</span>
        </button>
        <button
          onClick={exportPOSShortcut}
          disabled={!selectedIp}
          className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
        >
          <Monitor className="w-4 h-4" />
          <span className="text-sm">Export POS</span>
        </button>
      </div>

      {/* Instructions */}
      <div className="bg-dark-700/50 rounded-lg p-4 space-y-2">
        <h4 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-primary-400" />
          Comment utiliser:
        </h4>
        <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
          <li>Connectez votre téléphone au <strong>même réseau Wi-Fi</strong> que ce PC</li>
          <li>Ouvrez <strong>l'appareil photo</strong> ou <strong>Google Chrome</strong></li>
          <li>Scannez le QR code ci-dessus</li>
          <li>La page de ventes mobile s'ouvrira automatiquement</li>
        </ol>
      </div>

      {/* Bouton actualiser */}
      <button
        onClick={detectIpAddresses}
        disabled={loading}
        className="btn-secondary w-full flex items-center justify-center gap-2"
      >
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        Actualiser les adresses IP
      </button>
    </div>
  );
};

export default SettingsPage;