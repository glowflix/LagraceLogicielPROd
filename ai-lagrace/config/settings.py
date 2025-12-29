"""
Configuration AI LaGrace - Version ULTRA PRO
=============================================
Paramètres centralisés pour l'assistant vocal
Langue: Français avec prononciation naturelle et humaine
100% OFFLINE
"""

import os
from pathlib import Path

# Chemins
BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models"
DB_PATH = BASE_DIR.parent / "data" / "lagrace.db"

# Configuration Socket.IO
SOCKET_URL = os.getenv("SOCKET_URL", "http://localhost:3030")
SOCKET_RECONNECT_DELAY = 3  # secondes (plus rapide pour meilleure réactivité)

# Configuration Audio
SAMPLE_RATE = 16000  # Hz (requis par Vosk)
CHANNELS = 1  # Mono
CHUNK_SIZE = 4000  # Taille du buffer audio

# Configuration Wake Word
WAKE_WORD = "lagrace"
WAKE_WORD_VARIATIONS = [
    "lagrace", "la grace", "la grâce", "lagrâce",
    "la grass", "lagras", "la gras",
    "hey lagrace", "ok lagrace", "bonjour lagrace",
    "salut lagrace", "dis lagrace", "hé lagrace"
]
WAKE_WORD_TIMEOUT = 12  # secondes d'écoute après activation

# Configuration TTS (Text-to-Speech) - ULTRA PRO
TTS_RATE = 155           # Vitesse de parole optimisée (plus lent = plus clair)
TTS_VOLUME = 0.95        # Volume
TTS_VOICE_LANG = "french"
TTS_HUMAN_MODE = True    # Mode prononciation humaine
TTS_PAUSE_ENABLED = True # Pauses naturelles entre phrases

# Configuration Vosk (STT)
VOSK_MODEL_PATH = str(MODELS_DIR / "vosk-model-small-fr-0.22")

# Patterns d'intention (Intent Recognition) - FRANÇAIS
INTENT_PATTERNS = {
    "stock_check": {
        "patterns": [
            r"(?:quel|combien|c'est quoi).*(stock|quantité|reste).*(?:de|du|des|pour)?\s*(.+)",
            r"stock\s+(?:de|du|des|pour)?\s*(.+)",
            r"(?:il reste|on a|y a t-il).*(combien|quoi).*(?:de|du)?\s*(.+)",
            r"(?:vérifi|check|regarde|vérifie).*(stock|quantité).*(?:de|du)?\s*(.+)",
            r"(?:combien|reste).*(reste|stock|disponible).*(?:de|du)?\s*(.+)",
            r"(.+)\s+(?:en stock|disponible|reste)"
        ],
        "response": "stock"
    },
    "sales_today": {
        "patterns": [
            r"(?:ventes?|chiffre|recette).*(aujourd'?hui|ce jour|du jour)",
            r"(?:combien|quel).*(vendu|ventes?).*(aujourd'?hui|ce jour)",
            r"(?:résumé|bilan|total).*(ventes?|journée)",
            r"(?:comment|combien).*(ventes?|affaires?).*(aujourd'?hui)",
            r"(?:on a|avons).*(vendu|fait).*(aujourd'?hui|combien)"
        ],
        "response": "sales_today"
    },
    "sales_summary": {
        "patterns": [
            r"(?:ventes?|chiffre|recette).*(semaine|mois|hier|cette|ce)",
            r"(?:résumé|bilan).*(ventes?|période)",
            r"(?:combien|total).*(vendu|ventes?).*(semaine|mois|hier)"
        ],
        "response": "sales_summary"
    },
    "print_invoice": {
        "patterns": [
            r"(?:imprime|imprimer|print|lance).*(facture|ticket|reçu)",
            r"(?:dernière?|last).*(facture|impression)",
            r"(?:reimprimer|réimprimer|réimprime).*(facture|ticket)",
            r"(?:impression|imprime).*(?:dernière|nouvelle)",
            r"(?:lance|démarre).*(impression|print)"
        ],
        "response": "print"
    },
    "debt_check": {
        "patterns": [
            r"(?:qui|quels?|liste).*(doit|doivent|dettes?|crédit)",
            r"(?:dettes?|crédit|impayé).*(client|qui)",
            r"(?:argent|somme).*(dû|due|doit)",
            r"(?:clients?).*(doivent|crédit|dettes?)",
            r"(?:état|liste).*(dettes?|créances?|impayés?)"
        ],
        "response": "debts"
    },
    "product_price": {
        "patterns": [
            r"(?:quel|combien|c'est quoi).*(prix|coût|coûte).*(?:de|du|des|pour)?\s*(.+)",
            r"prix\s+(?:de|du|des|pour)?\s*(.+)",
            r"(?:combien|quel).*(coûte|vend|prix).*(?:le|la|les|un|une)?\s*(.+)",
            r"(.+)\s+(?:coûte|vaut|prix).*(combien)"
        ],
        "response": "price"
    },
    "help": {
        "patterns": [
            r"(?:aide|help|comment|qu'?est-ce que tu).*(faire|peux|sais)",
            r"(?:commandes?|fonctions?|possibilités?|capacités?)",
            r"(?:que sais-tu faire|tes capacités|tu peux faire quoi)",
            r"(?:quoi|comment).*(t'?utiliser|demander)",
            r"(?:aide|aidez?)-?moi"
        ],
        "response": "help"
    },
    "greeting": {
        "patterns": [
            r"(?:bonjour|salut|hello|bonsoir|coucou)",
            r"(?:comment|ça)\s*va",
            r"(?:hey|yo|wesh)",
            r"(?:bonne|bon).*(journée|soir|matin)",
            r"(?:enchanté|ravi)"
        ],
        "response": "greeting"
    },
    "thanks": {
        "patterns": [
            r"(?:merci|thanks|thank you)",
            r"(?:c'est gentil|sympa)",
            r"(?:je te remercie|remercie)"
        ],
        "response": "thanks"
    },
    "goodbye": {
        "patterns": [
            r"(?:au revoir|bye|à bientôt|à plus)",
            r"(?:bonne|bon).*(nuit|soirée|journée)",
            r"(?:salut|ciao|tchao)"
        ],
        "response": "goodbye"
    }
}

# ============================================================================
# RÉPONSES VOCALES EN FRANÇAIS - ULTRA NATURELLES
# ============================================================================
# Conseils de rédaction pour prononciation naturelle:
# - Utiliser des virgules pour les pauses naturelles
# - Éviter les phrases trop longues (max 15 mots)
# - Utiliser des contractions naturelles
# - Ajouter des mots de liaison ("alors", "donc", "et")
# ============================================================================

VOICE_RESPONSES = {
    # Salutations - variées et chaleureuses
    "greeting": [
        "Bonjour ! Comment puis-je vous aider, aujourd'hui ?",
        "Salut ! Que puis-je faire pour vous ?",
        "Bonjour, je suis à votre service !",
        "Bonjour ! Je suis LaGrace, votre assistante. Dites-moi, que souhaitez-vous ?",
        "Bonjour ! Alors, prête à vous aider.",
        "Hey ! Je vous écoute, que voulez-vous savoir ?",
    ],
    
    # Remerciements - chaleureux
    "thanks": [
        "De rien, c'est un plaisir !",
        "Je vous en prie !",
        "Avec plaisir !",
        "C'est tout naturel, voyons.",
        "À votre service, toujours !",
        "Pas de quoi, c'est normal !",
    ],
    
    # Au revoir - professionnels
    "goodbye": [
        "Au revoir, et bonne continuation !",
        "À bientôt ! Bonne journée.",
        "Au revoir, à votre service si besoin !",
        "Bonne journée à vous ! À la prochaine.",
        "À la prochaine ! Travaillez bien.",
        "Au revoir. N'hésitez pas à m'appeler.",
    ],
    
    # Aide - explicatif et clair
    "help": [
        "Alors, je peux vous aider avec plusieurs choses ! "
        "Demandez-moi le stock d'un produit, les ventes du jour, "
        "les dettes en cours, ou le prix d'un article. "
        "Je peux aussi lancer une impression. "
        "Dites simplement, LaGrace, suivi de votre demande.",
        
        "Voici ce que je sais faire. "
        "Vérifier le stock, consulter les ventes, "
        "voir les dettes impayées, donner le prix d'un produit, "
        "et lancer des impressions. "
        "Appelez-moi en disant LaGrace, puis posez votre question.",
        
        "Je suis là pour vous aider ! "
        "Stock, ventes, prix, dettes, impressions... "
        "Dites LaGrace suivi de ce que vous voulez savoir.",
    ],
    
    # Non compris - patients et bienveillants
    "not_understood": [
        "Pardon, je n'ai pas bien compris. Pouvez-vous reformuler ?",
        "Désolée, je n'ai pas saisi votre demande. Essayez autrement ?",
        "Hmm, je ne suis pas sûre de comprendre. Pouvez-vous préciser ?",
        "Excusez-moi, je n'ai pas compris. Répétez, s'il vous plaît.",
        "Hmm, je n'ai pas compris. Dites-le d'une autre façon, peut-être ?",
        "Pardon ? Je n'ai pas bien entendu. Pouvez-vous répéter ?",
    ],
    
    # Écoute active - naturel
    "listening": [
        "Oui, je vous écoute.",
        "Je suis là, que puis-je faire ?",
        "À votre service !",
        "Oui ?",
        "Je vous écoute attentivement.",
        "Dites-moi.",
        "Hmm hmm, je vous écoute.",
    ],
    
    # Traitement en cours - naturel avec hésitation
    "processing": [
        "Un instant...",
        "Je vérifie...",
        "Alors, laissez-moi regarder...",
        "Un moment, s'il vous plaît...",
        "Je cherche...",
        "Voyons voir...",
        "Attendez, je regarde ça...",
    ],
    
    # Erreurs - rassurants
    "error": [
        "Désolée, une erreur s'est produite. Réessayez dans un moment.",
        "Il y a eu un petit problème technique. Essayez à nouveau.",
        "Oups, quelque chose n'a pas fonctionné. Réessayez.",
        "Hmm, il y a un souci. Patientez un instant.",
    ],
    
    # Démarrage - accueillant et chaleureux
    "startup": [
        "Bonjour ! Je suis LaGrace, votre assistante vocale. "
        "Le logiciel La Grâce est prêt. "
        "Dites LaGrace pour m'activer.",
        
        "Bonjour, et bienvenue ! LaGrace est à votre service. "
        "Pour m'activer, dites simplement LaGrace, suivi de votre demande.",
        
        "Bonjour ! Système La Grâce opérationnel. "
        "Je suis LaGrace, prête à vous aider. "
        "Appelez-moi quand vous voulez.",
        
        "Bonjour à tous ! Le système est prêt. "
        "Je suis LaGrace. Dites mon nom pour commencer.",
    ],
    
    # Vente créée - professionnel et clair
    "sale_created": [
        "La vente est finalisée. Facture numéro {invoice}. {client} {total}.",
        "Nouvelle vente enregistrée. {total}. Numéro {invoice}.",
        "Transaction validée ! {client} {total}. Facture {invoice}.",
        "C'est fait ! Vente numéro {invoice} enregistrée. {total}.",
    ],
    
    # Impression - informatif
    "print_started": [
        "Impression lancée pour la facture {invoice}.",
        "C'est parti ! Impression en cours pour {invoice}.",
        "Lancement de l'impression, facture {invoice}.",
        "J'imprime la facture {invoice}.",
    ],
    
    # Impression terminée
    "print_done": [
        "Impression de la facture {invoice} terminée.",
        "Facture {invoice} imprimée avec succès.",
        "C'est imprimé ! Facture {invoice} prête.",
        "Impression terminée pour {invoice}.",
    ],
    
    # Stock bas - alerte claire
    "stock_low": [
        "Attention ! Stock bas pour {product}. Il ne reste que {qty} unités.",
        "Alerte stock. {product} n'a plus que {qty} unités. Pensez à commander.",
        "Le stock de {product} est critique. Seulement {qty} restants.",
        "Attention au stock de {product} ! Plus que {qty} en réserve.",
    ],
    
    # Connexion utilisateur - chaleureux
    "user_login": [
        "{greeting} {username} ! Bienvenue sur La Grâce. Bonne journée de travail !",
        "{greeting} {username} ! Content de vous revoir. Je suis à votre service.",
        "Connexion réussie. {greeting} {username} ! Que puis-je faire pour vous ?",
        "{greeting} {username} ! Ravi de vous voir. Au travail !",
    ],
    
    # Stock OK
    "stock_ok": [
        "Le stock de {product} est de {qty} unités. Tout va bien.",
        "{product}, il reste {qty} unités en stock. C'est correct.",
        "On a {qty} unités de {product}. Le stock est bon.",
    ],
    
    # Stock critique
    "stock_critical": [
        "Attention ! {product} est en rupture de stock. Il faut commander.",
        "Alerte ! Plus de {product} en stock. Commande urgente nécessaire.",
        "Rupture de stock pour {product} ! C'est urgent.",
    ],
    
    # Ventes du jour
    "sales_report": [
        "Aujourd'hui, nous avons {count} ventes pour un total de {total}.",
        "Bilan du jour, {count} ventes. Total, {total}.",
        "Les ventes d'aujourd'hui, {count} transactions pour {total}.",
    ],
    
    # Pas de ventes
    "no_sales": [
        "Aucune vente enregistrée aujourd'hui pour le moment.",
        "Pas encore de ventes aujourd'hui. On attend les clients !",
        "Zéro vente pour l'instant. Ça va venir !",
    ],
    
    # Dettes - informatif
    "debts_info": [
        "Il y a {count} dettes impayées pour un total de {total}.",
        "{count} clients nous doivent de l'argent. Total, {total}.",
        "Dettes en cours, {count} pour {total}.",
    ],
    
    # Pas de dettes
    "no_debts": [
        "Excellente nouvelle ! Aucune dette en cours. Tous les clients ont payé.",
        "Pas de dettes ! Tout le monde a réglé. Parfait !",
        "Zéro dette. Tous les comptes sont en règle.",
    ],
    
    # Synchronisation
    "sync_success": [
        "Synchronisation terminée avec succès.",
        "Les données sont synchronisées. Tout est à jour.",
        "Sync effectuée ! Données actualisées.",
    ],
    
    "sync_error": [
        "La synchronisation a rencontré des problèmes. Vérifiez la connexion.",
        "Erreur de synchronisation. Réessayez plus tard.",
        "Problème de sync. Vérifiez votre connexion internet.",
    ],
}


class Settings:
    """Classe de configuration centralisée"""
    
    def __init__(self):
        self.base_dir = BASE_DIR
        self.models_dir = MODELS_DIR
        self.db_path = DB_PATH
        self.socket_url = SOCKET_URL
        self.sample_rate = SAMPLE_RATE
        self.channels = CHANNELS
        self.chunk_size = CHUNK_SIZE
        self.wake_word = WAKE_WORD
        self.wake_word_variations = WAKE_WORD_VARIATIONS
        self.wake_word_timeout = WAKE_WORD_TIMEOUT
        self.tts_rate = TTS_RATE
        self.tts_volume = TTS_VOLUME
        self.tts_human_mode = TTS_HUMAN_MODE
        self.vosk_model_path = VOSK_MODEL_PATH
        
    def ensure_dirs(self):
        """Créer les dossiers nécessaires"""
        self.models_dir.mkdir(parents=True, exist_ok=True)


# Instance globale
settings = Settings()
