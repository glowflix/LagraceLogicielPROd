"""
Socket.IO Client Service
========================
Communication bidirectionnelle avec le serveur Node.js
Version PRO - Connexion persistante avec reconnexion automatique
LOGS MINIMALISTES - Seulement les événements importants
"""

import asyncio
import threading
import time
import sys
from datetime import datetime
from typing import Optional, Callable, Dict, Any, List

# Colorama pour les couleurs Windows
try:
    from colorama import init, Fore, Style
    init()
except ImportError:
    class Fore:
        GREEN = YELLOW = RED = CYAN = MAGENTA = BLUE = WHITE = ""
    class Style:
        RESET_ALL = BRIGHT = ""

# Import Socket.IO client
try:
    import socketio
    SOCKETIO_AVAILABLE = True
except ImportError:
    SOCKETIO_AVAILABLE = False
    print(f"{Fore.RED}❌ python-socketio non installé - pip install python-socketio{Style.RESET_ALL}")

sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])
from config.settings import settings

# Mode silencieux pour les logs répétitifs
VERBOSE_LOGS = False


def log_debug(msg: str):
    """Log de debug - DÉSACTIVÉ en mode pro"""
    if VERBOSE_LOGS:
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"{Fore.CYAN}[{ts}] [SOCKET] {msg}{Style.RESET_ALL}")


def log_info(msg: str):
    """Log d'info - Seulement messages importants"""
    # Filtrer les messages répétitifs
    if any(x in msg for x in ['Tentative', 'Prochaine', 'tentative', 'Boucle', 'keepalive', 'Ping', 'Pong']):
        if VERBOSE_LOGS:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"{Fore.CYAN}[{ts}] [SOCKET] {msg}{Style.RESET_ALL}")
        return
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{Fore.CYAN}[{ts}] [SOCKET] {msg}{Style.RESET_ALL}")


def log_success(msg: str):
    """Log de succès avec timestamp"""
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{Fore.GREEN}[{ts}] [SOCKET] ✅ {msg}{Style.RESET_ALL}")


def log_warn(msg: str):
    """Log d'avertissement - filtré"""
    # Filtrer les avertissements répétitifs de connexion
    if any(x in msg for x in ['Connexion refusée', 'tentative', 'Timeout', 'Pas de pong']):
        if VERBOSE_LOGS:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"{Fore.YELLOW}[{ts}] [SOCKET] ⚠️  {msg}{Style.RESET_ALL}")
        return
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{Fore.YELLOW}[{ts}] [SOCKET] ⚠️  {msg}{Style.RESET_ALL}")


def log_error(msg: str):
    """Log d'erreur - filtré"""
    # Filtrer les erreurs répétitives de connexion
    if any(x in msg for x in ['Erreur connexion', 'Connection error']):
        if VERBOSE_LOGS:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"{Fore.RED}[{ts}] [SOCKET] ❌ {msg}{Style.RESET_ALL}")
        return
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{Fore.RED}[{ts}] [SOCKET] ❌ {msg}{Style.RESET_ALL}")


class SocketClient:
    """Client Socket.IO pour communiquer avec Node.js - Version PRO persistante"""
    
    def __init__(self):
        self.sio: Optional[socketio.Client] = None
        self.connected = False
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self._callbacks: Dict[str, List[Callable]] = {}
        self._reconnect_delay = getattr(settings, 'SOCKET_RECONNECT_DELAY', 3)
        self._connection_attempts = 0
        self._max_reconnect_delay = 30  # Max 30 secondes entre tentatives
        self._last_ping = None
        self._keepalive_thread: Optional[threading.Thread] = None
        
        log_debug(f"SocketClient initialisé - URL cible: {settings.socket_url}")
        
    def start(self) -> bool:
        """Démarrer le client Socket.IO"""
        log_info("=== DÉMARRAGE CLIENT SOCKET.IO ===")
        
        if not SOCKETIO_AVAILABLE:
            log_error("Socket.IO non disponible - python-socketio non installé")
            return False
        
        try:
            self.sio = socketio.Client(
                reconnection=True,
                reconnection_attempts=0,  # Infini - NE JAMAIS abandonner
                reconnection_delay=self._reconnect_delay,
                reconnection_delay_max=self._max_reconnect_delay,
                logger=False,
                engineio_logger=False
            )
            log_debug("Client socketio.Client créé avec reconnexion infinie")
            
            # Configurer les événements
            self._setup_events()
            log_debug("Événements Socket.IO configurés")
            
            # Démarrer le thread de connexion
            self.running = True
            self._thread = threading.Thread(target=self._connection_loop, daemon=True, name="SocketIO-Connection")
            self._thread.start()
            log_debug(f"Thread de connexion démarré: {self._thread.name}")
            
            # Démarrer le keepalive
            self._keepalive_thread = threading.Thread(target=self._keepalive_loop, daemon=True, name="SocketIO-Keepalive")
            self._keepalive_thread.start()
            log_debug(f"Thread keepalive démarré: {self._keepalive_thread.name}")
            
            log_success("Client Socket.IO démarré")
            return True
            
        except Exception as e:
            log_error(f"Erreur démarrage Socket.IO: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def _setup_events(self):
        """Configurer les événements Socket.IO"""
        if not self.sio:
            return
        
        @self.sio.event
        def connect():
            self.connected = True
            self._connection_attempts = 0
            self._last_ping = time.time()
            log_success(f"Connecté au serveur Node.js: {settings.socket_url}")
            log_info("📡 Envoi ai:connected au serveur...")
            
            # Notifier le serveur que l'AI est connectée
            self.emit('ai:connected', {
                'name': 'LaGrace',
                'version': '1.0.0',
                'timestamp': datetime.now().isoformat(),
                'capabilities': ['voice', 'stock', 'sales', 'print', 'debts']
            })
            log_success("Notification ai:connected envoyée")
        
        @self.sio.event
        def disconnect():
            self.connected = False
            log_warn(f"Déconnecté du serveur - Tentatives: {self._connection_attempts}")
            log_info("🔄 Reconnexion automatique en cours...")
        
        @self.sio.event
        def connect_error(data):
            self._connection_attempts += 1
            log_error(f"Erreur connexion (tentative {self._connection_attempts}): {data}")
        
        # === ÉVÉNEMENTS MÉTIER ===
        
        @self.sio.on('sale:created')
        def on_sale_created(data):
            log_info(f"📦 Événement reçu: sale:created - {data}")
            self._trigger_callback('sale:created', data)
        
        @self.sio.on('sale:finalized')
        def on_sale_finalized(data):
            log_info(f"📦 Événement reçu: sale:finalized - {data}")
            self._trigger_callback('sale:finalized', data)
        
        @self.sio.on('print:started')
        def on_print_started(data):
            log_info(f"🖨️ Événement reçu: print:started - {data}")
            self._trigger_callback('print:started', data)
        
        @self.sio.on('print:progress')
        def on_print_progress(data):
            log_debug(f"🖨️ Événement reçu: print:progress - {data}")
            self._trigger_callback('print:progress', data)
        
        @self.sio.on('print:done')
        def on_print_done(data):
            log_info(f"🖨️ Événement reçu: print:done - {data}")
            self._trigger_callback('print:done', data)
        
        @self.sio.on('print:completed')
        def on_print_completed(data):
            log_info(f"🖨️ Événement reçu: print:completed - {data}")
            self._trigger_callback('print:completed', data)
            self._trigger_callback('print:done', data)  # Fallback
        
        @self.sio.on('print:error')
        def on_print_error(data):
            log_warn(f"🖨️ Événement reçu: print:error - {data}")
            self._trigger_callback('print:error', data)
        
        @self.sio.on('stock:low')
        def on_stock_low(data):
            log_warn(f"📉 Événement reçu: stock:low - {data}")
            self._trigger_callback('stock:low', data)
        
        @self.sio.on('stock:updated')
        def on_stock_updated(data):
            log_debug(f"📊 Événement reçu: stock:updated - {data}")
            self._trigger_callback('stock:updated', data)
        
        @self.sio.on('user:login')
        def on_user_login(data):
            log_info(f"👤 Événement reçu: user:login - {data}")
            self._trigger_callback('user:login', data)
        
        @self.sio.on('user:connected')
        def on_user_connected(data):
            log_info(f"👤 Événement reçu: user:connected - {data}")
            self._trigger_callback('user:connected', data)
        
        @self.sio.on('license:activated')
        def on_license_activated(data):
            log_success(f"🔑 Événement reçu: license:activated - {data}")
            self._trigger_callback('license:activated', data)
        
        @self.sio.on('sync:completed')
        def on_sync_completed(data):
            log_info(f"🔄 Événement reçu: sync:completed - {data}")
            self._trigger_callback('sync:completed', data)
        
        @self.sio.on('debt:created')
        def on_debt_created(data):
            log_info(f"💰 Événement reçu: debt:created - {data}")
            self._trigger_callback('debt:created', data)
        
        @self.sio.on('debt:paid')
        def on_debt_paid(data):
            log_success(f"💰 Événement reçu: debt:paid - {data}")
            self._trigger_callback('debt:paid', data)
        
        @self.sio.on('ai:response')
        def on_ai_response(data):
            log_info(f"🤖 Événement reçu: ai:response - {data}")
            self._trigger_callback('ai:response', data)
        
        @self.sio.on('ai:status')
        def on_ai_status(data):
            log_debug(f"🤖 Événement reçu: ai:status - {data}")
            self._trigger_callback('ai:status', data)
        
        # Événement pong pour keepalive
        @self.sio.on('pong')
        def on_pong(data=None):
            self._last_ping = time.time()
            log_debug("❤️ Pong reçu - Connexion active")
        
        log_debug("Tous les événements Socket.IO configurés")
    
    def _connection_loop(self):
        """Boucle de connexion avec reconnexion automatique - NE JAMAIS abandonner"""
        log_info(f"🔄 Boucle de connexion démarrée - URL: {settings.socket_url}")
        
        while self.running:
            if not self.connected and self.sio:
                try:
                    url = settings.socket_url
                    self._connection_attempts += 1
                    
                    # Calcul du délai exponentiel avec maximum
                    delay = min(self._reconnect_delay * (1.5 ** min(self._connection_attempts - 1, 5)), self._max_reconnect_delay)
                    
                    log_info(f"🔄 Tentative de connexion #{self._connection_attempts} à {url}...")
                    self.sio.connect(url, wait_timeout=15, transports=['websocket', 'polling'])
                    log_success(f"Connexion établie après {self._connection_attempts} tentative(s)")
                    
                except socketio.exceptions.ConnectionError as e:
                    log_warn(f"Connexion refusée (tentative {self._connection_attempts}): {e}")
                    log_info(f"⏳ Prochaine tentative dans {delay:.1f}s...")
                    time.sleep(delay)
                    
                except Exception as e:
                    log_error(f"Erreur connexion (tentative {self._connection_attempts}): {e}")
                    log_info(f"⏳ Prochaine tentative dans {delay:.1f}s...")
                    time.sleep(delay)
            else:
                # Connecté, vérifier la santé de la connexion
                time.sleep(1)
        
        log_warn("Boucle de connexion arrêtée")
    
    def _keepalive_loop(self):
        """Boucle de keepalive pour maintenir la connexion active"""
        log_debug("❤️ Boucle keepalive démarrée")
        
        while self.running:
            try:
                if self.connected and self.sio:
                    # Envoyer un ping toutes les 30 secondes
                    self.emit('ping', {'timestamp': datetime.now().isoformat()})
                    log_debug("❤️ Ping envoyé")
                    
                    # Vérifier si on a reçu un pong récemment (60s)
                    if self._last_ping and time.time() - self._last_ping > 60:
                        log_warn("❤️ Pas de pong depuis 60s - Connexion peut-être morte")
                
                time.sleep(30)  # Ping toutes les 30 secondes
                
            except Exception as e:
                log_error(f"Erreur keepalive: {e}")
                time.sleep(5)
        
        log_debug("❤️ Boucle keepalive arrêtée")
    
    def _trigger_callback(self, event: str, data: Any):
        """Déclencher tous les callbacks enregistrés pour un événement"""
        if event in self._callbacks:
            log_debug(f"Déclenchement de {len(self._callbacks[event])} callback(s) pour '{event}'")
            for callback in self._callbacks[event]:
                try:
                    callback(data)
                except Exception as e:
                    log_error(f"Erreur callback {event}: {e}")
                    import traceback
                    traceback.print_exc()
    
    def on(self, event: str, callback: Callable):
        """Enregistrer un callback pour un événement"""
        if event not in self._callbacks:
            self._callbacks[event] = []
        self._callbacks[event].append(callback)
        log_debug(f"Callback enregistré pour '{event}' (total: {len(self._callbacks[event])})")
    
    def off(self, event: str, callback: Callable = None):
        """Supprimer un callback"""
        if event in self._callbacks:
            if callback:
                self._callbacks[event] = [cb for cb in self._callbacks[event] if cb != callback]
            else:
                del self._callbacks[event]
    
    def emit(self, event: str, data: Any = None) -> bool:
        """Émettre un événement vers le serveur"""
        if self.sio and self.connected:
            try:
                self.sio.emit(event, data)
                log_debug(f"📤 Émission: {event} -> {str(data)[:100]}...")
                return True
            except Exception as e:
                log_error(f"Erreur emit {event}: {e}")
        else:
            log_warn(f"Impossible d'émettre '{event}' - Non connecté")
        return False
    
    def request(self, event: str, data: Any = None, timeout: float = 10.0) -> Optional[Any]:
        """Faire une requête et attendre la réponse"""
        if not self.sio or not self.connected:
            log_warn(f"Requête '{event}' impossible - Non connecté")
            return None
        
        response = None
        response_event = threading.Event()
        
        def on_response(resp):
            nonlocal response
            response = resp
            response_event.set()
        
        # Écouter la réponse
        response_event_name = f"{event}:response"
        self.sio.on(response_event_name, on_response)
        
        try:
            log_debug(f"📤 Requête: {event}")
            self.sio.emit(event, data)
            got_response = response_event.wait(timeout=timeout)
            if got_response:
                log_debug(f"📥 Réponse reçue pour {event}")
            else:
                log_warn(f"⏱️ Timeout pour {event} ({timeout}s)")
        finally:
            # Nettoyer le listener
            try:
                self.sio.off(response_event_name)
            except:
                pass
        
        return response
    
    def wait_connected(self, timeout: float = 30.0) -> bool:
        """Attendre la connexion"""
        start = time.time()
        log_info(f"⏳ Attente de connexion (max {timeout}s)...")
        
        while time.time() - start < timeout:
            if self.connected:
                log_success(f"Connecté après {time.time() - start:.1f}s")
                return True
            time.sleep(0.5)
        
        log_warn(f"Timeout connexion après {timeout}s")
        return False
    
    def is_connected(self) -> bool:
        """Vérifier si connecté"""
        return self.connected and self.sio is not None
    
    def get_status(self) -> dict:
        """Obtenir le statut de la connexion"""
        return {
            'connected': self.connected,
            'running': self.running,
            'connection_attempts': self._connection_attempts,
            'last_ping': self._last_ping,
            'url': settings.socket_url
        }
    
    def stop(self):
        """Arrêter le client Socket.IO"""
        log_info("🛑 Arrêt du client Socket.IO...")
        self.running = False
        
        if self.sio:
            try:
                if self.connected:
                    log_debug("Envoi ai:disconnecting...")
                    self.emit('ai:disconnecting', {'name': 'LaGrace', 'reason': 'shutdown'})
                    time.sleep(0.5)  # Laisser le temps d'envoyer
                self.sio.disconnect()
            except Exception as e:
                log_warn(f"Erreur déconnexion: {e}")
            self.sio = None
        
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        
        if self._keepalive_thread and self._keepalive_thread.is_alive():
            self._keepalive_thread.join(timeout=2)
        
        self.connected = False
        log_success("Socket.IO arrêté proprement")


# Instance globale
_socket_instance: Optional[SocketClient] = None

def get_socket_client() -> SocketClient:
    """Obtenir l'instance du client Socket.IO"""
    global _socket_instance
    if _socket_instance is None:
        _socket_instance = SocketClient()
    return _socket_instance
