// Configuration dynamique de l'URL API pour LAN et clients réseau
// IMPORTANT: En mode proxy Vite, on utilise des chemins relatifs (/api/...)
// Le proxy Vite redirige automatiquement vers le backend

/**
 * Récupère l'URL API configurée
 * En mode développement avec proxy Vite: retourne '' (chemin relatif)
 * En mode production/Electron: retourne l'URL du serveur
 */
export function getApiUrl() {
  // 1. Mode développement avec proxy Vite (recommandé pour LAN)
  // Les requêtes /api/* sont proxyfiées automatiquement vers le backend
  // Cela évite les problèmes CORS et localhost sur PC clients
  if (import.meta.env.DEV) {
    // En dev, le proxy Vite gère tout - utiliser des chemins relatifs
    // Sauf si VITE_API_URL est explicitement défini (cas rare)
    const envUrl = import.meta.env.VITE_API_URL;
    if (envUrl && envUrl !== '' && envUrl !== 'proxy') {
      return envUrl;
    }
    // Retourne '' pour utiliser les chemins relatifs via proxy
    return '';
  }

  // 2. Vérifier si une URL est stockée dans localStorage (pour Android/mobile)
  const storedUrl = localStorage.getItem('lagrace-api-url');
  if (storedUrl) {
    return storedUrl;
  }

  // 3. Utiliser la variable d'environnement Vite (mode production)
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl !== '' && envUrl !== 'proxy') {
    return envUrl;
  }

  // 4. Détecter automatiquement depuis l'URL actuelle (pour navigateur en prod)
  // Utile quand le build est servi par le backend Express
  if (typeof window !== 'undefined') {
    const currentHost = window.location.hostname;
    const currentPort = window.location.port;
    const protocol = window.location.protocol;
    
    // Si on est servi par le backend (port 3030), utiliser la même origine
    if (currentPort === '3030') {
      return ''; // Même origine, chemins relatifs
    }
    
    // Si on est sur localhost sans port spécifique, essayer le backend
    if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
      return 'http://localhost:3030';
    }
    
    // En LAN, utiliser l'IP du serveur avec le port backend
    return `${protocol}//${currentHost}:3030`;
  }

  // 5. Par défaut (fallback)
  return '';
}

/**
 * Retourne l'URL de base pour Socket.IO
 * En mode proxy: utilise l'URL relative (le proxy gère)
 * En mode direct: utilise l'URL complète du serveur
 */
export function getSocketUrl() {
  // En mode développement avec proxy Vite
  if (import.meta.env.DEV) {
    // Le proxy Vite gère /socket.io - on peut utiliser undefined
    // Socket.IO utilisera automatiquement l'origine actuelle
    return undefined;
  }

  // En production, utiliser la même logique que getApiUrl
  const apiUrl = getApiUrl();
  if (apiUrl === '') {
    return undefined; // Socket.IO utilisera l'origine actuelle
  }
  return apiUrl;
}

/**
 * Configure l'URL API (pour Android/mobile)
 */
export function setApiUrl(url) {
  try {
    // Valider l'URL si ce n'est pas vide
    if (url && url !== '') {
      new URL(url);
    }
    localStorage.setItem('lagrace-api-url', url);
    console.log(`✅ URL API configurée: ${url || '(chemins relatifs)'}`);
    return true;
  } catch (error) {
    console.error('❌ URL invalide:', error);
    return false;
  }
}

/**
 * Efface l'URL API stockée (revient au mode auto-détection)
 */
export function clearApiUrl() {
  localStorage.removeItem('lagrace-api-url');
  console.log('✅ URL API effacée, retour au mode auto-détection');
}

/**
 * Teste la connexion à l'API
 */
export async function testApiConnection(url = null) {
  try {
    const baseUrl = url || getApiUrl();
    const testUrl = baseUrl ? `${baseUrl}/api/health` : '/api/health';
    
    const response = await fetch(testUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (error) {
    console.warn('Test connexion API échoué:', error.message);
    return false;
  }
}
