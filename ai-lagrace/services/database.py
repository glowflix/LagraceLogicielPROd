"""
Database Service
================
Accès direct à la base SQLite (même DB que Node.js)
Permet des requêtes rapides sans passer par Socket.IO
"""

import sqlite3
import sys
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

# Colorama pour les couleurs Windows
try:
    from colorama import init, Fore, Style
    init()
except ImportError:
    class Fore:
        GREEN = YELLOW = RED = CYAN = ""
    class Style:
        RESET_ALL = ""

sys.path.insert(0, str(__file__).replace('\\', '/').rsplit('/', 2)[0])
from config.settings import settings


class DatabaseService:
    """Service d'accès à la base de données SQLite"""
    
    def __init__(self):
        self.db_path: Optional[Path] = None
        self.connection: Optional[sqlite3.Connection] = None
    
    def start(self) -> bool:
        """Démarrer le service de base de données"""
        import os
        
        # En mode EXE, chercher dans AppData (LAGRACE_DATA_DIR)
        app_data_dir = os.environ.get('LAGRACE_DATA_DIR', '')
        
        # Chercher la base de données
        possible_paths = [
            # 1. Chemin prioritaire: AppData de l'application Electron
            Path(app_data_dir) / "data" / "app.db" if app_data_dir else None,
            Path(app_data_dir) / "app.db" if app_data_dir else None,
            # 2. Chemin settings (peut être dev ou prod)
            settings.db_path,
            # 3. Chemins relatifs (mode dev)
            settings.base_dir.parent / "app.db",
            settings.base_dir.parent / "data" / "app.db",
            settings.base_dir.parent / "data" / "lagrace.db",
            # 4. Chemin utilisateur
            Path.home() / ".lagrace" / "data" / "lagrace.db"
        ]
        
        # Filtrer les chemins None
        possible_paths = [p for p in possible_paths if p is not None]
        
        for path in possible_paths:
            if path.exists():
                self.db_path = path
                break
        
        if not self.db_path or not self.db_path.exists():
            print(f"{Fore.YELLOW}⚠️  Base de données non trouvée{Style.RESET_ALL}")
            print(f"{Fore.CYAN}   Recherché dans: {[str(p) for p in possible_paths]}{Style.RESET_ALL}")
            return False
        
        try:
            # Connexion en mode lecture seule
            self.connection = sqlite3.connect(
                str(self.db_path),
                check_same_thread=False,
                timeout=10
            )
            self.connection.row_factory = sqlite3.Row
            print(f"{Fore.GREEN}✅ Base de données connectée: {self.db_path}{Style.RESET_ALL}")
            return True
        except Exception as e:
            print(f"{Fore.RED}❌ Erreur connexion DB: {e}{Style.RESET_ALL}")
            return False
    
    def _execute(self, query: str, params: tuple = ()) -> List[Dict]:
        """Exécuter une requête et retourner les résultats"""
        if not self.connection:
            return []
        
        try:
            cursor = self.connection.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            print(f"{Fore.RED}❌ Erreur SQL: {e}{Style.RESET_ALL}")
            return []
    
    def get_product_stock(self, product_name: str) -> Optional[Dict]:
        """Obtenir le stock d'un produit par nom ou code"""
        query = """
            SELECT p.code, p.label, p.brand, s.quantity, p.sell_price
            FROM products p
            LEFT JOIN stock s ON p.id = s.product_id
            WHERE UPPER(p.code) LIKE ? 
               OR UPPER(p.label) LIKE ?
               OR UPPER(p.brand) LIKE ?
            LIMIT 1
        """
        search = f"%{product_name.upper()}%"
        results = self._execute(query, (search, search, search))
        return results[0] if results else None
    
    def search_products(self, query: str, limit: int = 5) -> List[Dict]:
        """Rechercher des produits"""
        sql = """
            SELECT p.code, p.label, p.brand, s.quantity, p.sell_price
            FROM products p
            LEFT JOIN stock s ON p.id = s.product_id
            WHERE UPPER(p.code) LIKE ? 
               OR UPPER(p.label) LIKE ?
               OR UPPER(p.brand) LIKE ?
            ORDER BY s.quantity DESC
            LIMIT ?
        """
        search = f"%{query.upper()}%"
        return self._execute(sql, (search, search, search, limit))
    
    def get_today_sales(self) -> Dict:
        """Obtenir le résumé des ventes du jour"""
        today = datetime.now().strftime("%Y-%m-%d")
        
        query = """
            SELECT 
                COUNT(*) as count,
                COALESCE(SUM(total_cdf), 0) as total_cdf,
                COALESCE(SUM(total_usd), 0) as total_usd
            FROM sales
            WHERE DATE(created_at) = ?
        """
        results = self._execute(query, (today,))
        return results[0] if results else {"count": 0, "total_cdf": 0, "total_usd": 0}
    
    def get_sales_period(self, period: str = "today") -> Dict:
        """Obtenir les ventes pour une période"""
        now = datetime.now()
        
        if period == "today":
            start_date = now.strftime("%Y-%m-%d")
        elif period == "yesterday":
            start_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        elif period == "week":
            start_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        elif period == "month":
            start_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        else:
            start_date = now.strftime("%Y-%m-%d")
        
        query = """
            SELECT 
                COUNT(*) as count,
                COALESCE(SUM(total_cdf), 0) as total_cdf,
                COALESCE(SUM(total_usd), 0) as total_usd
            FROM sales
            WHERE DATE(created_at) >= ?
        """
        results = self._execute(query, (start_date,))
        return results[0] if results else {"count": 0, "total_cdf": 0, "total_usd": 0}
    
    def get_debts(self, limit: int = 10) -> List[Dict]:
        """Obtenir la liste des dettes impayées"""
        query = """
            SELECT 
                d.client_name,
                d.amount_cdf,
                d.amount_usd,
                d.due_date,
                d.created_at
            FROM debts d
            WHERE d.status = 'pending' OR d.status = 'partial'
            ORDER BY d.amount_usd DESC, d.amount_cdf DESC
            LIMIT ?
        """
        return self._execute(query, (limit,))
    
    def get_total_debts(self) -> Dict:
        """Obtenir le total des dettes"""
        query = """
            SELECT 
                COUNT(*) as count,
                COALESCE(SUM(amount_cdf), 0) as total_cdf,
                COALESCE(SUM(amount_usd), 0) as total_usd
            FROM debts
            WHERE status = 'pending' OR status = 'partial'
        """
        results = self._execute(query)
        return results[0] if results else {"count": 0, "total_cdf": 0, "total_usd": 0}
    
    def get_product_price(self, product_name: str) -> Optional[Dict]:
        """Obtenir le prix d'un produit"""
        query = """
            SELECT code, label, brand, sell_price, buy_price
            FROM products
            WHERE UPPER(code) LIKE ? 
               OR UPPER(label) LIKE ?
               OR UPPER(brand) LIKE ?
            LIMIT 1
        """
        search = f"%{product_name.upper()}%"
        results = self._execute(query, (search, search, search))
        return results[0] if results else None
    
    def get_low_stock_products(self, threshold: int = 10) -> List[Dict]:
        """Obtenir les produits en stock bas"""
        query = """
            SELECT p.code, p.label, s.quantity
            FROM products p
            LEFT JOIN stock s ON p.id = s.product_id
            WHERE s.quantity IS NOT NULL AND s.quantity <= ?
            ORDER BY s.quantity ASC
            LIMIT 10
        """
        return self._execute(query, (threshold,))
    
    def get_last_sale(self) -> Optional[Dict]:
        """Obtenir la dernière vente"""
        query = """
            SELECT id, invoice_number, total_cdf, total_usd, created_at
            FROM sales
            ORDER BY created_at DESC
            LIMIT 1
        """
        results = self._execute(query)
        return results[0] if results else None
    
    def stop(self):
        """Fermer la connexion à la base de données"""
        if self.connection:
            try:
                self.connection.close()
            except:
                pass
            self.connection = None
        print(f"{Fore.YELLOW}📁 Base de données fermée{Style.RESET_ALL}")


# Instance globale
_db_instance: Optional[DatabaseService] = None

def get_database() -> DatabaseService:
    """Obtenir l'instance de la base de données"""
    global _db_instance
    if _db_instance is None:
        _db_instance = DatabaseService()
    return _db_instance
