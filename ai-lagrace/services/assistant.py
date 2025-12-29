"""
AI LaGrace Assistant
====================
Orchestrateur principal de l'assistant vocal intelligent
Version PRO - Parle français, annonce ventes et impressions
LOGS DÉTAILLÉS activés - Connexion persistante
"""

import time
import threading
import random
import sys
from datetime import datetime
from typing import Optional

# Colorama pour les couleurs Windows
try:
    from colorama import init, Fore, Style
    init()
except ImportError:
    class Fore:
        GREEN = YELLOW = RED = CYAN = MAGENTA = BLUE = WHITE = ""
    class Style:
        RESET_ALL = BRIGHT = ""

sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])
from config.settings import settings, VOICE_RESPONSES
from services.tts import TTSService
from services.stt import STTService
from services.wake_word import WakeWordDetector
from services.intent import IntentRecognizer, Intent
from services.socket_client import SocketClient
from services.database import DatabaseService


def log_debug(msg: str, service: str = "AI"):
    """Log de debug avec timestamp"""
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.WHITE}[{ts}] [{service}] {msg}{Style.RESET_ALL}")


def log_info(msg: str, service: str = "AI"):
    """Log d'info avec timestamp"""
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.CYAN}[{ts}] [{service}] {msg}{Style.RESET_ALL}")


def log_success(msg: str, service: str = "AI"):
    """Log de succès avec timestamp"""
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.GREEN}[{ts}] [{service}] ✅ {msg}{Style.RESET_ALL}")


def log_warn(msg: str, service: str = "AI"):
    """Log d'avertissement avec timestamp"""
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.YELLOW}[{ts}] [{service}] ⚠️  {msg}{Style.RESET_ALL}")


def log_error(msg: str, service: str = "AI"):
    """Log d'erreur avec timestamp"""
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.RED}[{ts}] [{service}] ❌ {msg}{Style.RESET_ALL}")


def log_speak(msg: str):
    """Log de parole avec timestamp"""
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"{Fore.MAGENTA}[{ts}] [PAROLE] 🔊 {msg}{Style.RESET_ALL}")


class LaGraceAssistant:
    """Assistant vocal intelligent LaGrace - Version PRO avec logs détaillés"""
    
    def __init__(self):
        log_info("=== INITIALISATION AI LaGrace ===")
        
        self.tts = TTSService()
        self.stt = STTService()
        self.wake_word: Optional[WakeWordDetector] = None
        self.intent = IntentRecognizer()
        self.socket = SocketClient()
        self.db = DatabaseService()
        
        self.running = False
        self.active = False  # True quand on écoute une commande
        self._command_text = ""
        self._command_event = threading.Event()
        self._last_greeting_hour = -1
        self._sales_count_today = 0
        self._current_user = None
        self._startup_time = None
        
        log_debug("Composants initialisés")
        
    def start(self) -> bool:
        """Démarrer l'assistant"""
        self._startup_time = datetime.now()
        
        print(f"\n{Fore.CYAN}{'='*60}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}🌟 AI LaGrace - DÉMARRAGE{Style.RESET_ALL}")
        print(f"{Fore.CYAN}{'='*60}{Style.RESET_ALL}")
        print(f"{Fore.WHITE}   Heure: {self._startup_time.strftime('%H:%M:%S')}{Style.RESET_ALL}")
        print(f"{Fore.WHITE}   Socket URL: {settings.socket_url}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}{'='*60}{Style.RESET_ALL}\n")
        
        # Démarrer les services
        services_status = {}
        
        # TTS (synthèse vocale)
        log_info("Démarrage TTS (synthèse vocale)...", "TTS")
        if self.tts.start():
            log_success("TTS prêt", "TTS")
            services_status['tts'] = True
        else:
            log_warn("TTS non disponible - mode silencieux", "TTS")
            services_status['tts'] = False
        
        # STT (reconnaissance vocale)
        log_info("Démarrage STT (reconnaissance vocale)...", "STT")
        if self.stt.start():
            log_success("STT prêt", "STT")
            services_status['stt'] = True
        else:
            log_warn("STT non disponible - écoute désactivée", "STT")
            services_status['stt'] = False
        
        # Wake Word Detector
        log_info("Initialisation Wake Word Detector...", "WAKE")
        self.wake_word = WakeWordDetector(self.stt)
        services_status['wake_word'] = True
        log_debug("Wake Word Detector initialisé", "WAKE")
        
        # Socket.IO - CRUCIAL pour les annonces
        log_info("Démarrage Socket.IO...", "SOCKET")
        if self.socket.start():
            log_success("Socket.IO démarré", "SOCKET")
            services_status['socket'] = True
            
            # Configurer les événements AVANT d'attendre la connexion
            self._setup_socket_events()
            
            # Attendre la connexion
            log_info("Attente de connexion au serveur Node.js...", "SOCKET")
            if self.socket.wait_connected(timeout=10):
                log_success("Connecté au serveur Node.js!", "SOCKET")
            else:
                log_warn("Pas encore connecté - reconnexion en arrière-plan", "SOCKET")
        else:
            log_warn("Socket.IO non disponible", "SOCKET")
            services_status['socket'] = False
        
        # Database
        log_info("Connexion à la base de données...", "DB")
        if self.db.start():
            log_success("Base de données connectée", "DB")
            services_status['db'] = True
        else:
            log_warn("Base de données non disponible", "DB")
            services_status['db'] = False
        
        self.running = True
        
        # Résumé du statut
        print(f"\n{Fore.CYAN}{'='*40}{Style.RESET_ALL}")
        print(f"{Fore.WHITE}   STATUT DES SERVICES:{Style.RESET_ALL}")
        for svc, status in services_status.items():
            icon = "✅" if status else "❌"
            color = Fore.GREEN if status else Fore.RED
            print(f"   {color}{icon} {svc.upper()}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}{'='*40}{Style.RESET_ALL}\n")
        
        # Salutation intelligente au démarrage
        log_info("Préparation du message de bienvenue...", "AI")
        self._greet_on_startup()
        
        # Démarrer la détection du wake word si STT disponible
        if self.stt.running:
            log_info("Démarrage de la détection du wake word...", "WAKE")
            self.wake_word.start(on_wake=self._on_wake_word)
            log_success("Détection 'LaGrace' active", "WAKE")
        else:
            log_warn("Détection du wake word désactivée (STT non disponible)", "WAKE")
        
        print(f"\n{Fore.GREEN}{'='*60}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}✅ AI LaGrace PRÊTE !{Style.RESET_ALL}")
        print(f"{Fore.CYAN}👂 Dites 'LaGrace' suivi de votre commande...{Style.RESET_ALL}")
        print(f"{Fore.GREEN}{'='*60}{Style.RESET_ALL}\n")
        
        return True
    
    def _get_time_greeting(self) -> str:
        """Obtenir le salut approprié selon l'heure"""
        hour = datetime.now().hour
        if 5 <= hour < 12:
            return "Bonjour"
        elif 12 <= hour < 18:
            return "Bon après-midi"
        else:
            return "Bonsoir"
    
    def _greet_on_startup(self):
        """Salutation intelligente au démarrage du logiciel"""
        greeting = self._get_time_greeting()
        hour = datetime.now().hour
        
        log_info(f"Salutation de démarrage ({greeting})...", "AI")
        
        # Message de bienvenue personnalisé
        messages = [
            f"{greeting} ! Je suis LaGrace, votre assistante vocale. "
            f"Le logiciel La Grâce est prêt. Dites LaGrace pour m'activer.",
            
            f"{greeting} et bienvenue ! LaGrace est à votre service. "
            f"Pour m'activer, dites simplement LaGrace suivi de votre demande.",
            
            f"{greeting} ! Système La Grâce opérationnel. "
            f"Je suis LaGrace, prête à vous aider. Appelez-moi quand vous voulez."
        ]
        
        message = random.choice(messages)
        log_speak(message)
        self.tts.speak(message)
        self._last_greeting_hour = hour
    
    def _setup_socket_events(self):
        """Configurer les événements Socket.IO pour les annonces"""
        log_info("Configuration des événements Socket.IO...", "SOCKET")
        
        # Événement: utilisateur connecté
        def on_user_login(data):
            log_info(f"📥 Utilisateur connecté: {data}", "SOCKET")
            username = data.get('username', data.get('name', 'utilisateur'))
            self._current_user = username
            greeting = self._get_time_greeting()
            
            messages = [
                f"{greeting} {username} ! Bienvenue sur La Grâce. Bonne journée de travail !",
                f"{greeting} {username} ! Content de vous revoir. Je suis à votre service.",
                f"Connexion réussie. {greeting} {username} ! Que puis-je faire pour vous ?"
            ]
            message = random.choice(messages)
            log_speak(message)
            self.tts.speak(message)
        
        # Événement: licence activée
        def on_license_activated(data):
            log_info(f"📥 Licence activée: {data}", "SOCKET")
            message = "Parfait ! La licence est maintenant activée. Le système est prêt à l'emploi."
            log_speak(message)
            self.tts.speak(message)
        
        # Événement: nouvelle vente créée/finalisée
        def on_sale_created(data):
            log_info(f"📥 Vente créée: {data}", "SOCKET")
            self._sales_count_today += 1
            
            invoice = data.get('invoice_number', data.get('factureNum', data.get('id', '')))
            client = data.get('client', data.get('customer', data.get('client_name', '')))
            total_usd = data.get('total_usd', data.get('totalUSD', data.get('total', 0)))
            total_cdf = data.get('total_cdf', data.get('totalFC', data.get('totalCDF', 0)))
            seller = data.get('seller_name', data.get('user', data.get('vendeur', '')))
            
            log_debug(f"Détails vente - Invoice: {invoice}, Client: {client}, USD: {total_usd}, CDF: {total_cdf}, Vendeur: {seller}", "SOCKET")
            
            # Construire les parties du message naturellement
            client_part = ""
            if client and str(client).strip() and str(client).strip() != '-':
                client_part = f"pour {client}"
            
            total_part = ""
            try:
                if total_usd and float(total_usd) > 0:
                    total_part = f"de {int(float(total_usd))} dollars"
                elif total_cdf and float(total_cdf) > 0:
                    total_part = f"de {int(float(total_cdf))} francs congolais"
            except (ValueError, TypeError):
                pass
            
            # Message naturel avec variations
            if seller and str(seller).strip():
                messages = [
                    f"La vente de {seller} est finalisée. {client_part} {total_part}. Facture numéro {invoice}.",
                    f"C'est fait ! {seller} a finalisé une vente {client_part}. {total_part}. Numéro {invoice}.",
                    f"Nouvelle vente de {seller} ! {total_part}. {client_part}. Facture {invoice}.",
                ]
            else:
                messages = [
                    f"La vente est finalisée. {client_part} {total_part}. Facture numéro {invoice}.",
                    f"Transaction validée ! {client_part} {total_part}. Numéro {invoice}.",
                    f"Nouvelle vente enregistrée. {total_part}. Facture {invoice}.",
                ]
            
            message = random.choice(messages)
            # Nettoyer les espaces multiples
            message = ' '.join(message.split())
            
            log_speak(message)
            self.tts.speak(message)
        
        # Événement: impression démarrée
        def on_print_started(data):
            log_info(f"📥 Impression démarrée: {data}", "SOCKET")
            facture = data.get('factureNum', data.get('facture', data.get('invoice_number', '')))
            seller = data.get('seller_name', data.get('user', ''))
            
            if seller and facture:
                message = f"Impression lancée de {seller}. Facture {facture}."
            elif facture:
                message = f"Impression lancée pour la facture {facture}."
            else:
                message = "Impression en cours..."
            
            log_speak(message)
            self.tts.speak(message)
        
        # Événement: impression terminée
        def on_print_done(data):
            log_info(f"📥 Impression terminée: {data}", "SOCKET")
            facture = data.get('factureNum', data.get('facture', data.get('invoice_number', '')))
            
            if facture:
                message = f"Impression de la facture {facture} terminée."
            else:
                message = "Impression terminée avec succès."
            
            log_speak(message)
            self.tts.speak(message)
        
        # Événement: erreur d'impression
        def on_print_error(data):
            log_warn(f"📥 Erreur impression: {data}", "SOCKET")
            code = data.get('code', 'E_UNKNOWN')
            hint = data.get('hint', '')
            
            if 'PRINTER' in str(code).upper():
                message = "Attention ! Problème d'imprimante détecté. Vérifiez que l'imprimante est allumée et connectée."
            elif 'SPOOLER' in str(code).upper():
                message = "Le service d'impression Windows semble bloqué. Essayez de redémarrer le spouleur."
            else:
                message = f"Erreur d'impression. {hint}" if hint else "Une erreur d'impression s'est produite."
            
            log_speak(message)
            self.tts.speak(message)
        
        # Événement: stock bas
        def on_stock_low(data):
            log_warn(f"📥 Stock bas: {data}", "SOCKET")
            product = data.get('product', data.get('nom', data.get('label', 'un produit')))
            qty = data.get('quantity', data.get('qty', data.get('stock', 0)))
            
            message = f"Attention ! Stock bas pour {product}. Il ne reste que {qty} unités."
            log_speak(message)
            self.tts.speak(message)
        
        # Événement: synchronisation terminée
        def on_sync_completed(data):
            log_info(f"📥 Sync terminée: {data}", "SOCKET")
            success = data.get('success', True)
            if success:
                message = "Synchronisation avec Google Sheets terminée avec succès."
            else:
                message = "La synchronisation a rencontré des problèmes. Vérifiez la connexion."
            log_speak(message)
            self.tts.speak(message)
        
        # Événement: dette créée
        def on_debt_created(data):
            log_info(f"📥 Dette créée: {data}", "SOCKET")
            client = data.get('client_name', data.get('client', ''))
            if client:
                message = f"Nouvelle dette enregistrée pour {client}."
                log_speak(message)
                self.tts.speak(message)
        
        # Événement: dette payée
        def on_debt_paid(data):
            log_info(f"📥 Dette payée: {data}", "SOCKET")
            client = data.get('client_name', data.get('client', ''))
            if client:
                message = f"Parfait ! {client} a réglé sa dette. Merci !"
                log_speak(message)
                self.tts.speak(message)
        
        # Enregistrer tous les événements
        log_debug("Enregistrement des callbacks Socket.IO...", "SOCKET")
        
        self.socket.on('user:login', on_user_login)
        self.socket.on('user:connected', on_user_login)
        self.socket.on('license:activated', on_license_activated)
        self.socket.on('sale:created', on_sale_created)
        self.socket.on('sale:finalized', on_sale_created)
        self.socket.on('print:started', on_print_started)
        self.socket.on('print:progress', on_print_started)
        self.socket.on('print:done', on_print_done)
        self.socket.on('print:completed', on_print_done)
        self.socket.on('print:error', on_print_error)
        self.socket.on('stock:low', on_stock_low)
        self.socket.on('sync:completed', on_sync_completed)
        self.socket.on('debt:created', on_debt_created)
        self.socket.on('debt:paid', on_debt_paid)
        
        log_success("Événements Socket.IO configurés (14 événements)", "SOCKET")
    
    def _on_wake_word(self):
        """Appelé quand le wake word est détecté"""
        if self.active:
            log_debug("Wake word ignoré - déjà actif", "WAKE")
            return
        
        self.active = True
        log_info("🎤 WAKE WORD DÉTECTÉ - LaGrace activée", "WAKE")
        
        print(f"\n{Fore.MAGENTA}{'='*40}{Style.RESET_ALL}")
        print(f"{Fore.MAGENTA}🎤 LaGrace activée - En écoute...{Style.RESET_ALL}")
        print(f"{Fore.MAGENTA}{'='*40}{Style.RESET_ALL}\n")
        
        # Répondre de manière variée
        responses = [
            "Oui, je vous écoute.",
            "Je suis là, que puis-je faire ?",
            "À votre service !",
            "Oui ?",
            "Je vous écoute."
        ]
        response = random.choice(responses)
        log_speak(response)
        self.tts.speak(response)
        self.tts.wait_until_done()
        
        # Écouter la commande
        self._listen_for_command()
    
    def _listen_for_command(self):
        """Écouter et traiter une commande"""
        log_info("Écoute de la commande...", "STT")
        
        self._command_text = ""
        self._command_event.clear()
        
        # Écouter pendant le timeout
        start_time = time.time()
        timeout = settings.wake_word_timeout
        
        def on_text(text):
            log_debug(f"Texte reçu: {text}", "STT")
            self._command_text = text
            self._command_event.set()
        
        # Arrêter le wake word et écouter la commande
        self.stt.stop_listening()
        time.sleep(0.2)
        self.stt.start_listening(on_text=on_text)
        
        # Attendre la commande
        got_command = self._command_event.wait(timeout=timeout)
        
        # Obtenir le résultat final
        final_text = self.stt.get_final_result()
        if final_text:
            self._command_text = final_text
        
        self.stt.stop_listening()
        
        if self._command_text:
            log_success(f"Commande reçue: {self._command_text}", "STT")
            self._process_command(self._command_text)
        else:
            log_warn("Aucune commande reçue", "STT")
            self.tts.speak("Je n'ai pas compris. Pouvez-vous répéter ?")
        
        # Reprendre la détection du wake word
        time.sleep(0.5)
        self.active = False
        if self.wake_word:
            self.wake_word.resume()
            log_debug("Détection wake word reprise", "WAKE")
    
    def _process_command(self, text: str):
        """Traiter une commande vocale"""
        log_info(f"Traitement de la commande: {text}", "AI")
        
        # Indiquer le traitement
        processing_msgs = [
            "Un instant...",
            "Je vérifie...",
            "Laissez-moi regarder..."
        ]
        self.tts.speak(random.choice(processing_msgs))
        
        # Reconnaître l'intention
        intent = self.intent.recognize(text)
        log_info(f"Intention reconnue: {intent.name} (confiance: {intent.confidence:.2f})", "AI")
        
        # Exécuter l'action correspondante
        self._execute_intent(intent)
    
    def _execute_intent(self, intent: Intent):
        """Exécuter une intention reconnue"""
        log_debug(f"Exécution de l'intention: {intent.name}", "AI")
        
        if intent.name == "greeting":
            self._handle_greeting()
            
        elif intent.name == "help":
            self._handle_help()
            
        elif intent.name == "stock_check":
            self._handle_stock_check(intent)
            
        elif intent.name == "product_price":
            self._handle_price_check(intent)
            
        elif intent.name == "sales_today":
            self._handle_sales_today()
            
        elif intent.name == "sales_summary":
            self._handle_sales_summary(intent)
            
        elif intent.name == "debt_check":
            self._handle_debt_check()
            
        elif intent.name == "print_invoice":
            self._handle_print_invoice()
            
        elif intent.name == "thanks":
            self._handle_thanks()
            
        elif intent.name == "goodbye":
            self._handle_goodbye()
            
        else:
            self._handle_not_understood()
    
    def _handle_greeting(self):
        """Gérer les salutations"""
        greeting = self._get_time_greeting()
        user = self._current_user or ""
        
        responses = [
            f"{greeting} ! Comment puis-je vous aider ?",
            f"{greeting} ! Je suis là pour vous aider.",
            f"{greeting} ! Que souhaitez-vous faire ?",
        ]
        
        if user:
            responses.append(f"{greeting} {user} ! Que puis-je faire pour vous ?")
        
        message = random.choice(responses)
        log_speak(message)
        self.tts.speak(message)
    
    def _handle_thanks(self):
        """Gérer les remerciements"""
        responses = VOICE_RESPONSES.get("thanks", ["De rien !"])
        message = random.choice(responses)
        log_speak(message)
        self.tts.speak(message)
    
    def _handle_goodbye(self):
        """Gérer les au revoir"""
        responses = VOICE_RESPONSES.get("goodbye", ["Au revoir !"])
        message = random.choice(responses)
        log_speak(message)
        self.tts.speak(message)
    
    def _handle_help(self):
        """Expliquer les capacités"""
        help_text = (
            "Je peux vous aider avec plusieurs choses. "
            "Demandez-moi le stock d'un produit, les ventes du jour, "
            "les dettes en cours, ou le prix d'un article. "
            "Je peux aussi lancer une impression. "
            "Dites simplement LaGrace suivi de votre demande."
        )
        log_speak(help_text)
        self.tts.speak(help_text)
    
    def _handle_not_understood(self):
        """Quand on ne comprend pas"""
        responses = VOICE_RESPONSES.get("not_understood", [
            "Désolé, je n'ai pas compris votre demande. Pouvez-vous reformuler ?"
        ])
        message = random.choice(responses)
        log_speak(message)
        self.tts.speak(message)
    
    def _handle_stock_check(self, intent: Intent):
        """Gérer une demande de vérification de stock"""
        product_name = intent.entities.get('product')
        log_debug(f"Vérification stock pour: {product_name}", "DB")
        
        if not product_name:
            messages = [
                "Pour quel produit voulez-vous vérifier le stock ?",
                "Quel produit vous intéresse ?",
                "Dites-moi le nom du produit à vérifier.",
            ]
            self.tts.speak(random.choice(messages))
            return
        
        # Chercher dans la DB
        product = self.db.get_product_stock(product_name)
        
        if product:
            qty = product.get('quantity', 0) or 0
            label = product.get('label', product_name)
            
            if qty <= 0:
                messages = [
                    f"Attention ! {label} est en rupture de stock. Il faut commander, urgentement.",
                    f"Alerte ! Plus de {label} en stock. Commande urgente nécessaire.",
                    f"Rupture de stock pour {label} ! C'est critique.",
                ]
            elif qty <= 5:
                messages = [
                    f"Stock critique pour {label}. Il ne reste que {int(qty)} unités. Pensez à réapprovisionner.",
                    f"Attention au stock de {label} ! Seulement {int(qty)} en réserve.",
                    f"Alerte stock. {label} n'a plus que {int(qty)} unités.",
                ]
            elif qty <= 10:
                messages = [
                    f"Stock un peu bas pour {label}. Il reste {int(qty)} unités.",
                    f"{label}, il reste {int(qty)} unités. Ça va, mais surveillez.",
                ]
            else:
                messages = [
                    f"Le stock de {label} est de {int(qty)} unités. Tout va bien.",
                    f"{label}, on a {int(qty)} unités en stock. C'est correct.",
                    f"Pas de souci ! {int(qty)} unités de {label} en réserve.",
                ]
            
            message = random.choice(messages)
            log_speak(message)
            self.tts.speak(message)
        else:
            messages = [
                f"Hmm, je n'ai pas trouvé le produit {product_name}. Vérifiez le nom ou le code.",
                f"Désolée, {product_name} n'est pas dans la base. C'est bien le bon nom ?",
                f"Je ne trouve pas {product_name}. Essayez avec un autre mot.",
            ]
            message = random.choice(messages)
            log_speak(message)
            self.tts.speak(message)
    
    def _handle_price_check(self, intent: Intent):
        """Gérer une demande de prix"""
        product_name = intent.entities.get('product')
        log_debug(f"Vérification prix pour: {product_name}", "DB")
        
        if not product_name:
            self.tts.speak("Pour quel produit voulez-vous le prix ?")
            return
        
        product = self.db.get_product_price(product_name)
        
        if product:
            label = product.get('label', product_name)
            price = product.get('sell_price', 0)
            message = f"Le prix de {label} est de {int(price)} francs congolais."
            log_speak(message)
            self.tts.speak(message)
        else:
            self.tts.speak(f"Je n'ai pas trouvé le produit {product_name}.")
    
    def _handle_sales_today(self):
        """Gérer les ventes du jour"""
        log_debug("Récupération des ventes du jour...", "DB")
        sales = self.db.get_today_sales()
        
        count = sales.get('count', 0)
        total_cdf = sales.get('total_cdf', 0)
        total_usd = sales.get('total_usd', 0)
        
        if count == 0:
            messages = [
                "Aucune vente enregistrée aujourd'hui, pour le moment.",
                "Pas encore de ventes aujourd'hui. On attend les clients !",
                "Zéro vente pour l'instant. Mais ça va venir !",
            ]
            message = random.choice(messages)
        else:
            if count == 1:
                ventes_text = "une seule vente"
            else:
                ventes_text = f"{count} ventes"
            
            # Construire le total naturellement
            if total_usd > 0 and total_cdf > 0:
                total_text = f"{int(total_usd)} dollars et {int(total_cdf)} francs"
            elif total_usd > 0:
                total_text = f"{int(total_usd)} dollars"
            elif total_cdf > 0:
                total_text = f"{int(total_cdf)} francs congolais"
            else:
                total_text = ""
            
            if total_text:
                messages = [
                    f"Aujourd'hui, nous avons {ventes_text}, pour un total de {total_text}.",
                    f"Bilan du jour. {ventes_text}. Total, {total_text}.",
                    f"Les ventes d'aujourd'hui. {ventes_text} pour {total_text}. Pas mal !",
                ]
            else:
                messages = [
                    f"Aujourd'hui, nous avons {ventes_text}.",
                    f"On a fait {ventes_text} aujourd'hui.",
                ]
            
            message = random.choice(messages)
        
        log_speak(message)
        self.tts.speak(message)
    
    def _handle_sales_summary(self, intent: Intent):
        """Gérer le résumé des ventes"""
        period = intent.entities.get('period', 'today')
        log_debug(f"Récupération des ventes pour: {period}", "DB")
        
        sales = self.db.get_sales_period(period)
        
        count = sales.get('count', 0)
        total_usd = sales.get('total_usd', 0)
        total_cdf = sales.get('total_cdf', 0)
        
        period_names = {
            'today': "aujourd'hui",
            'yesterday': 'hier',
            'week': 'cette semaine',
            'month': 'ce mois-ci'
        }
        period_name = period_names.get(period, period)
        
        if count == 0:
            message = f"Aucune vente enregistrée {period_name}."
        else:
            if total_usd > 0:
                message = f"{period_name.capitalize()}, nous avons réalisé {count} ventes pour {int(total_usd)} dollars."
            elif total_cdf > 0:
                message = f"{period_name.capitalize()}, nous avons réalisé {count} ventes pour {int(total_cdf)} francs."
            else:
                message = f"{period_name.capitalize()}, nous avons réalisé {count} ventes."
        
        log_speak(message)
        self.tts.speak(message)
    
    def _handle_debt_check(self):
        """Gérer les dettes"""
        log_debug("Récupération des dettes...", "DB")
        total = self.db.get_total_debts()
        debts = self.db.get_debts(limit=5)
        
        count = total.get('count', 0)
        total_usd = total.get('total_usd', 0)
        total_cdf = total.get('total_cdf', 0)
        
        if count == 0:
            messages = [
                "Excellente nouvelle ! Aucune dette en cours. Tous les clients ont payé.",
                "Parfait ! Pas de dettes. Tout le monde a réglé.",
                "Zéro dette ! Tous les comptes sont en règle. Bravo !",
            ]
            message = random.choice(messages)
        else:
            if count == 1:
                dette_text = "une dette impayée"
            else:
                dette_text = f"{count} dettes impayées"
            
            # Construire le total
            if total_usd > 0:
                total_text = f"{int(total_usd)} dollars"
            elif total_cdf > 0:
                total_text = f"{int(total_cdf)} francs"
            else:
                total_text = ""
            
            if total_text:
                messages = [
                    f"Alors, il y a {dette_text}, pour un total de {total_text}.",
                    f"{count} clients nous doivent de l'argent. Total, {total_text}.",
                    f"Dettes en cours. {dette_text} pour {total_text}.",
                ]
            else:
                messages = [
                    f"Il y a {dette_text}.",
                    f"On a {dette_text} en cours.",
                ]
            
            message = random.choice(messages)
            
            # Ajouter les noms des débiteurs principaux
            if debts and len(debts) > 0:
                names = [d.get('client_name', 'Inconnu') for d in debts[:3] if d.get('client_name')]
                if names:
                    if len(names) == 1:
                        message += f" Le débiteur principal est {names[0]}."
                    else:
                        message += f" Les principaux débiteurs sont, {', '.join(names[:-1])}, et {names[-1]}."
        
        log_speak(message)
        self.tts.speak(message)
    
    def _handle_print_invoice(self):
        """Gérer l'impression de facture"""
        log_debug("Demande d'impression de la dernière facture...", "AI")
        last_sale = self.db.get_last_sale()
        
        if last_sale:
            invoice = last_sale.get('invoice_number', 'N/A')
            message = f"Lancement de l'impression pour la facture {invoice}."
            log_speak(message)
            self.tts.speak(message)
            
            # Demander l'impression via Socket.IO
            log_info(f"Émission ai:print_request pour facture {invoice}", "SOCKET")
            self.socket.emit('ai:print_request', {
                'sale_id': last_sale.get('id'),
                'invoice_number': invoice
            })
        else:
            self.tts.speak("Aucune facture récente à imprimer.")
    
    def announce(self, message: str):
        """Faire une annonce vocale (appelable de l'extérieur)"""
        if self.tts and self.running:
            log_speak(message)
            self.tts.speak(message)
    
    def get_status(self) -> dict:
        """Obtenir le statut de l'assistant"""
        uptime = None
        if self._startup_time:
            uptime = (datetime.now() - self._startup_time).total_seconds()
        
        return {
            'running': self.running,
            'active': self.active,
            'uptime_seconds': uptime,
            'current_user': self._current_user,
            'sales_count_today': self._sales_count_today,
            'socket_connected': self.socket.is_connected() if self.socket else False,
            'tts_running': self.tts.running if self.tts else False,
            'stt_running': self.stt.running if self.stt else False
        }
    
    def run(self):
        """Boucle principale de l'assistant"""
        log_info("=== BOUCLE PRINCIPALE DÉMARRÉE ===", "AI")
        log_info("En attente d'événements... (Ctrl+C pour arrêter)", "AI")
        
        try:
            status_interval = 60  # Afficher le statut toutes les 60 secondes
            last_status = time.time()
            
            while self.running:
                time.sleep(1)
                
                # Afficher un statut périodique
                if time.time() - last_status > status_interval:
                    status = self.get_status()
                    uptime_min = int(status['uptime_seconds'] / 60) if status['uptime_seconds'] else 0
                    socket_status = "✅" if status['socket_connected'] else "❌"
                    log_debug(f"Statut - Uptime: {uptime_min}min, Socket: {socket_status}, Ventes annoncées: {status['sales_count_today']}", "AI")
                    last_status = time.time()
                    
        except KeyboardInterrupt:
            log_warn("Interruption utilisateur (Ctrl+C)", "AI")
        finally:
            self.stop()
    
    def stop(self):
        """Arrêter l'assistant"""
        log_info("=== ARRÊT DE AI LaGrace ===", "AI")
        
        self.running = False
        self.active = False
        
        # Dire au revoir
        if self.tts and self.tts.running:
            goodbyes = [
                "Au revoir et à bientôt !",
                "À la prochaine !",
                "Bonne continuation !",
            ]
            message = random.choice(goodbyes)
            log_speak(message)
            self.tts.speak(message)
            self.tts.wait_until_done()
        
        # Arrêter les services
        log_debug("Arrêt des services...", "AI")
        
        if self.wake_word:
            self.wake_word.stop()
            log_debug("Wake Word arrêté", "AI")
            
        if self.stt:
            self.stt.stop()
            log_debug("STT arrêté", "AI")
            
        if self.tts:
            self.tts.stop()
            log_debug("TTS arrêté", "AI")
            
        if self.socket:
            self.socket.stop()
            log_debug("Socket.IO arrêté", "AI")
            
        if self.db:
            self.db.stop()
            log_debug("Database arrêtée", "AI")
        
        log_success("AI LaGrace arrêtée proprement", "AI")


# Instance globale
_assistant_instance: Optional[LaGraceAssistant] = None

def get_assistant() -> LaGraceAssistant:
    """Obtenir l'instance de l'assistant"""
    global _assistant_instance
    if _assistant_instance is None:
        _assistant_instance = LaGraceAssistant()
    return _assistant_instance
