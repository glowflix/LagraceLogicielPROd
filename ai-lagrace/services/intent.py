"""
Intent Recognition Service
==========================
Comprend les commandes vocales et détermine l'action à effectuer
"""

import re
import sys
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass

# Colorama pour les couleurs Windows
try:
    from colorama import init, Fore, Style
    init()
except ImportError:
    class Fore:
        GREEN = YELLOW = RED = CYAN = MAGENTA = ""
    class Style:
        RESET_ALL = ""

sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])
from config.settings import INTENT_PATTERNS


@dataclass
class Intent:
    """Résultat de la reconnaissance d'intention"""
    name: str
    confidence: float
    entities: Dict[str, Any]
    original_text: str
    response_type: str


class IntentRecognizer:
    """Service de reconnaissance d'intention"""
    
    def __init__(self):
        self.patterns = INTENT_PATTERNS
        self._compile_patterns()
    
    def _compile_patterns(self):
        """Compiler les patterns regex"""
        self._compiled = {}
        for intent_name, intent_data in self.patterns.items():
            self._compiled[intent_name] = {
                'patterns': [re.compile(p, re.IGNORECASE) for p in intent_data['patterns']],
                'response': intent_data['response']
            }
    
    def _normalize_text(self, text: str) -> str:
        """Normaliser le texte"""
        text = text.lower().strip()
        # Supprimer le wake word s'il est présent
        for wake in ['lagrace', 'la grace', 'la grâce', 'lagrâce']:
            text = text.replace(wake, '').strip()
        # Supprimer les ponctuations excessives
        text = re.sub(r'[,;:!?]+', ' ', text)
        text = re.sub(r'\s+', ' ', text)
        return text.strip()
    
    def _extract_entities(self, text: str, intent_name: str, match: re.Match) -> Dict[str, Any]:
        """Extraire les entités du texte"""
        entities = {}
        
        # Extraire les groupes de capture
        groups = match.groups()
        
        if intent_name == "stock_check":
            # Chercher le nom du produit
            product = self._extract_product_name(text, groups)
            if product:
                entities['product'] = product
                
        elif intent_name == "product_price":
            product = self._extract_product_name(text, groups)
            if product:
                entities['product'] = product
                
        elif intent_name == "sales_summary":
            # Extraire la période
            period = self._extract_period(text)
            if period:
                entities['period'] = period
        
        return entities
    
    def _extract_product_name(self, text: str, groups: Tuple) -> Optional[str]:
        """Extraire le nom d'un produit du texte"""
        # Essayer les groupes de capture
        for group in groups:
            if group and len(group) > 1:
                # Nettoyer le nom du produit
                product = group.strip()
                # Supprimer les articles et prépositions
                product = re.sub(r'^(le|la|les|un|une|des|de|du|d\')\s*', '', product, flags=re.IGNORECASE)
                if product:
                    return product.upper()
        
        # Patterns alternatifs pour trouver le produit
        alt_patterns = [
            r'(?:stock|quantité|prix|combien)\s+(?:de|du|des|pour|d\')\s*[\"\']*([A-Za-z0-9\s\-]+)[\"\']*',
            r'([A-Z0-9]+(?:\s+[A-Z0-9]+)*)',  # Mots en majuscules
            r'(?:mosquito|raid|mortein|baygon|insecticide)[\w\s]*',  # Produits connus
        ]
        
        for pattern in alt_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1).upper().strip() if match.lastindex else match.group().upper().strip()
        
        return None
    
    def _extract_period(self, text: str) -> Optional[str]:
        """Extraire la période temporelle"""
        periods = {
            "aujourd'hui": "today",
            "aujourd hui": "today",
            "ce jour": "today",
            "du jour": "today",
            "hier": "yesterday",
            "cette semaine": "week",
            "la semaine": "week",
            "semaine": "week",
            "ce mois": "month",
            "mois": "month",
            "cette année": "year",
            "année": "year"
        }
        
        text_lower = text.lower()
        for fr_period, en_period in periods.items():
            if fr_period in text_lower:
                return en_period
        
        return None
    
    def recognize(self, text: str) -> Intent:
        """Reconnaître l'intention d'un texte"""
        normalized = self._normalize_text(text)
        print(f"{Fore.CYAN}🔍 Analyse: '{normalized}'{Style.RESET_ALL}")
        
        best_match = None
        best_confidence = 0.0
        best_entities = {}
        
        for intent_name, intent_data in self._compiled.items():
            for pattern in intent_data['patterns']:
                match = pattern.search(normalized)
                if match:
                    # Calculer un score de confiance basé sur la longueur du match
                    match_len = len(match.group())
                    text_len = len(normalized)
                    confidence = match_len / text_len if text_len > 0 else 0.5
                    confidence = min(confidence + 0.3, 1.0)  # Bonus de base
                    
                    if confidence > best_confidence:
                        best_confidence = confidence
                        best_match = (intent_name, intent_data['response'])
                        best_entities = self._extract_entities(normalized, intent_name, match)
        
        if best_match:
            intent_name, response_type = best_match
            print(f"{Fore.GREEN}✅ Intent: {intent_name} (confiance: {best_confidence:.2f}){Style.RESET_ALL}")
            if best_entities:
                print(f"{Fore.CYAN}   Entités: {best_entities}{Style.RESET_ALL}")
            
            return Intent(
                name=intent_name,
                confidence=best_confidence,
                entities=best_entities,
                original_text=text,
                response_type=response_type
            )
        
        # Aucune intention reconnue
        print(f"{Fore.YELLOW}❓ Intent non reconnu{Style.RESET_ALL}")
        return Intent(
            name="unknown",
            confidence=0.0,
            entities={},
            original_text=text,
            response_type="not_understood"
        )
    
    def get_available_intents(self) -> List[str]:
        """Obtenir la liste des intentions disponibles"""
        return list(self.patterns.keys())


# Instance globale
_intent_instance: Optional[IntentRecognizer] = None

def get_intent_recognizer() -> IntentRecognizer:
    """Obtenir l'instance du reconnaisseur"""
    global _intent_instance
    if _intent_instance is None:
        _intent_instance = IntentRecognizer()
    return _intent_instance


