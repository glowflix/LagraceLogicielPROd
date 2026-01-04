#!/usr/bin/env python3
"""
Vérification complète de la synchronisation des dettes:
1. Lire les dettes depuis Google Sheets
2. Vérifier les UUID dans Sheets
3. Vérifier que les dettes sont dans SQLite avec UUID
"""

import requests
import json
import sqlite3
from pathlib import Path
from datetime import datetime

SPREADSHEET_ID = '111HH1yCU1gB5Uovbcach_Olz1e3hL4-J0z8QGHoOEtI'
SHEETS_API_URL = f'https://script.google.com/macros/d/{SPREADSHEET_ID.replace("-", "")}/usercache'

# Chemin réel de la BD
DB_PATH = Path(r'C:\Glowflixprojet\db\glowflixprojet.db')

def log(msg, prefix="ℹ️"):
    """Log avec timestamp"""
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"{prefix} [{ts}] {msg}")

def fetch_debts_from_sheets():
    """Récupère les dettes depuis Google Sheets via l'API Apps Script"""
    log("📥 Récupération des dettes depuis Google Sheets...", "📊")
    
    try:
        # Appeler le doGet de Apps Script pour récupérer les dettes
        # Remplacer par votre URL de déploiement si nécessaire
        url = 'https://script.google.com/macros/d/1uP2gq1cNNlDG8vqAVzz8sxGGy5fVz_x3VXEfJE-sQQVBhkjUkLPjAM5/usercache'
        
        params = {
            'entity': 'debts',
            'full': '1'
        }
        
        log(f"   URL: {url}")
        log(f"   Paramètres: {params}")
        
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        
        if data.get('success'):
            debts = data.get('data', [])
            log(f"   ✅ {len(debts)} dette(s) récupérée(s) depuis Sheets", "✅")
            
            if debts:
                log(f"   📋 Première dette:", "📋")
                first = debts[0]
                for key in ['invoice_number', 'client_name', 'total_fc', 'uuid']:
                    log(f"      {key}: {first.get(key, 'N/A')}")
            
            return debts
        else:
            log(f"   ❌ Erreur API: {data.get('error', 'Unknown')}", "❌")
            return []
            
    except Exception as e:
        log(f"   ❌ Erreur réseau: {e}", "❌")
        return []

def check_debts_in_sqlite():
    """Vérifie les dettes dans SQLite"""
    log("📊 Vérification des dettes dans SQLite...", "🗄️")
    
    if not DB_PATH.exists():
        log(f"   ❌ BD non trouvée: {DB_PATH}", "❌")
        return []
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Vérifier que la table existe
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='debts'
        """)
        
        if not cursor.fetchone():
            log(f"   ❌ Table debts n'existe pas", "❌")
            conn.close()
            return []
        
        # Récupérer toutes les dettes
        cursor.execute("""
            SELECT id, uuid, invoice_number, client_name, total_fc, 
                   paid_fc, remaining_fc, status, created_at 
            FROM debts 
            ORDER BY created_at DESC
        """)
        
        debts = cursor.fetchall()
        conn.close()
        
        log(f"   ✅ {len(debts)} dette(s) trouvée(s) dans SQLite", "✅")
        
        if debts:
            log(f"   📋 Premières dettes:", "📋")
            for debt in debts[:3]:
                log(f"      ID={debt[0]}, UUID={debt[1] or 'NULL'}, Invoice={debt[2]}, Client={debt[3]}, Total={debt[4]} FC, Status={debt[7]}")
        
        return debts
        
    except Exception as e:
        log(f"   ❌ Erreur SQLite: {e}", "❌")
        return []

def analyze_sync():
    """Analyse complète du flux de sync"""
    log("\n" + "="*70, "🔍")
    log("ANALYSE DE SYNCHRONISATION DES DETTES", "🔍")
    log("="*70, "🔍")
    
    # Étape 1: Dettes depuis Sheets
    sheets_debts = fetch_debts_from_sheets()
    
    # Étape 2: Dettes dans SQLite
    sqlite_debts = check_debts_in_sqlite()
    
    # Étape 3: Comparaison
    log("\n📊 COMPARAISON:", "📊")
    
    if not sheets_debts and not sqlite_debts:
        log("   ⚠️  Aucune dette dans Sheets NI dans SQLite", "⚠️")
        return
    
    sheets_invoices = {d.get('invoice_number'): d for d in sheets_debts if d.get('invoice_number')}
    sqlite_invoices = {d[2]: d for d in sqlite_debts if d[2]}
    
    log(f"   📥 Sheets: {len(sheets_invoices)} facture(s) unique(s)")
    log(f"   💾 SQLite: {len(sqlite_invoices)} facture(s) unique(s)")
    
    # Dettes en Sheets mais pas en SQLite
    missing_in_sqlite = set(sheets_invoices.keys()) - set(sqlite_invoices.keys())
    if missing_in_sqlite:
        log(f"\n   ⚠️  {len(missing_in_sqlite)} dette(s) EN SHEETS MAIS PAS EN SQLITE:", "⚠️")
        for invoice in list(missing_in_sqlite)[:5]:
            debt = sheets_invoices[invoice]
            log(f"      ❌ {invoice}: {debt.get('client_name', 'N/A')} ({debt.get('total_fc', 0)} FC)")
            log(f"         UUID Sheets: {debt.get('uuid', 'NULL')}")
    
    # Dettes en SQLite mais pas en Sheets
    extra_in_sqlite = set(sqlite_invoices.keys()) - set(sheets_invoices.keys())
    if extra_in_sqlite:
        log(f"\n   ℹ️  {len(extra_in_sqlite)} dette(s) EN SQLITE MAIS PAS EN SHEETS (OK si créées localement):", "ℹ️")
        for invoice in list(extra_in_sqlite)[:5]:
            debt = sqlite_invoices[invoice]
            log(f"      ✅ {invoice}: {debt[3]} ({debt[4]} FC)")
            log(f"         UUID SQLite: {debt[1] or 'NULL'}")
    
    # Vérifier UUID
    log(f"\n🔑 VÉRIFICATION UUID:", "🔑")
    
    sheets_with_uuid = sum(1 for d in sheets_debts if d.get('uuid'))
    sheets_without_uuid = len(sheets_debts) - sheets_with_uuid
    
    sqlite_with_uuid = sum(1 for d in sqlite_debts if d[1])
    sqlite_without_uuid = len(sqlite_debts) - sqlite_with_uuid
    
    log(f"   📥 Sheets: {sheets_with_uuid}/{len(sheets_debts)} avec UUID, {sheets_without_uuid} sans UUID")
    log(f"   💾 SQLite: {sqlite_with_uuid}/{len(sqlite_debts)} avec UUID, {sqlite_without_uuid} sans UUID (STABLE GENERATED)")
    
    # Dettes synchronisées avec UUID valide
    synced_with_uuid = 0
    for invoice in set(sheets_invoices.keys()) & set(sqlite_invoices.keys()):
        sheets_debt = sheets_invoices[invoice]
        sqlite_debt = sqlite_invoices[invoice]
        
        if sheets_debt.get('uuid') and sqlite_debt[1]:
            synced_with_uuid += 1
    
    if synced_with_uuid > 0:
        log(f"\n   ✅ {synced_with_uuid} dette(s) SYNCHRONISÉE(S) avec UUID valide", "✅")
    
    # Résumé final
    log(f"\n" + "="*70, "📋")
    log("RÉSUMÉ:", "📋")
    
    if len(sheets_debts) > 0 and len(sqlite_debts) > 0:
        sync_ratio = (len(set(sheets_invoices.keys()) & set(sqlite_invoices.keys())) / max(len(sheets_debts), len(sqlite_debts)) * 100)
        log(f"   📊 Taux de synchronisation: {sync_ratio:.1f}%", "📊")
    
    if missing_in_sqlite:
        log(f"\n   🔴 ACTION REQUISE: {len(missing_in_sqlite)} dette(s) à synchroniser", "🔴")
        log(f"      Relancer le sync worker Node.js ou attendre le prochain cycle")
    else:
        log(f"\n   🟢 SYNC OK: Toutes les dettes de Sheets sont dans SQLite", "🟢")
    
    log("="*70, "📋")

if __name__ == '__main__':
    try:
        analyze_sync()
    except KeyboardInterrupt:
        log("\n\n⏹️  Arrêt par utilisateur", "⏹️")
    except Exception as e:
        log(f"\n❌ Erreur non gérée: {e}", "❌")
        import traceback
        traceback.print_exc()
