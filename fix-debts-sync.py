#!/usr/bin/env python3
"""
🔧 SCRIPT DE RÉPARATION - Synchronisation des dettes (version Python)
Injecte les dettes dans la base de données SQLite
"""

import sqlite3
import os
import sys
from pathlib import Path
from datetime import datetime
import uuid as uuid_lib

# Chemin de la base de données
DB_PATH = Path(__file__).parent / 'app.db'

# Dettes à injecter
SAMPLE_DEBTS = [
    {
        'client_name': 'PA MUKANIA',
        'invoice_number': '001',
        'total_fc': 13800,
        'paid_fc': 0,
        'remaining_fc': 13800,
        'status': 'open',
        'product_description': 'CARTON',
        'total_usd': 7,
        'debt_fc_in_usd': 0
    },
    {
        'client_name': 'PA SAMY',
        'invoice_number': '002',
        'total_fc': 100000,
        'paid_fc': 0,
        'remaining_fc': 100000,
        'status': 'open',
        'product_description': 'CARTON',
        'total_usd': 50,
        'debt_fc_in_usd': 0
    },
    {
        'client_name': 'muyomba',
        'invoice_number': '003',
        'total_fc': 50000,
        'paid_fc': 0,
        'remaining_fc': 50000,
        'status': 'open',
        'product_description': 'Produits divers',
        'total_usd': 25,
        'debt_fc_in_usd': 0
    }
]

print('🔧 ============================================')
print('SCRIPT DE RÉPARATION - SYNCHRONISATION DETTES')
print('🔧 ============================================\n')

# Vérifier si la BD existe
if not DB_PATH.exists():
    print(f'❌ Base de données non trouvée: {DB_PATH}')
    sys.exit(1)

print(f'✅ Base de données trouvée: {DB_PATH}\n')

# Connexion
try:
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
except Exception as e:
    print(f'❌ Erreur connexion BD: {e}')
    sys.exit(1)

print('✅ Connecté à la base de données\n')

# Vérifier/créer la table
print('📋 Vérification du schéma de la table debts...\n')

try:
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS debts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE,
            invoice_number TEXT,
            client_name TEXT,
            total_fc REAL DEFAULT 0,
            paid_fc REAL DEFAULT 0,
            remaining_fc REAL DEFAULT 0,
            status TEXT DEFAULT 'open',
            product_description TEXT,
            total_usd REAL DEFAULT 0,
            debt_fc_in_usd REAL DEFAULT 0,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT,
            device_id TEXT
        )
    ''')
    conn.commit()
    print('✅ Table debts vérifiée\n')
except Exception as e:
    print(f'❌ Erreur création table: {e}')
    conn.close()
    sys.exit(1)

# Insérer les dettes
print('📥 Insertion des dettes exemples...\n')

inserted = 0
for i, debt in enumerate(SAMPLE_DEBTS):
    try:
        debt_uuid = f"debt-{int(datetime.now().timestamp()*1000)}-{i}"
        
        cursor.execute('''
            INSERT OR REPLACE INTO debts 
            (uuid, invoice_number, client_name, total_fc, paid_fc, remaining_fc, status, product_description, total_usd, debt_fc_in_usd)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            debt_uuid,
            debt['invoice_number'],
            debt['client_name'],
            debt['total_fc'],
            debt['paid_fc'],
            debt['remaining_fc'],
            debt['status'],
            debt['product_description'],
            debt['total_usd'],
            debt['debt_fc_in_usd']
        ))
        conn.commit()
        print(f"✅ {debt['client_name']} - {debt['invoice_number']}")
        inserted += 1
    except Exception as e:
        print(f"❌ Erreur insertion {debt['client_name']}: {e}")

print(f'\n✅ {inserted} dette(s) insérée(s)\n')

# Vérifier
print('🔍 Vérification des dettes insérées...\n')

try:
    cursor.execute('SELECT * FROM debts ORDER BY created_at DESC')
    debts = cursor.fetchall()
    
    # Récupérer les noms de colonnes
    cursor.execute('PRAGMA table_info(debts)')
    columns = cursor.fetchall()
    col_names = [col[1] for col in columns]
    
    if debts:
        print(f'📊 {len(debts)} dette(s) trouvée(s):\n')
        
        total_amount = 0
        total_remaining = 0
        
        for i, debt_row in enumerate(debts):
            debt_dict = dict(zip(col_names, debt_row))
            print(f"{i + 1}. {debt_dict['client_name']}")
            print(f"   Facture: {debt_dict['invoice_number']}")
            print(f"   Total: {debt_dict['total_fc']:,.0f} FC ({debt_dict['total_usd']} USD)")
            print(f"   Payé: {debt_dict['paid_fc']:,.0f} FC")
            print(f"   Restant: {debt_dict['remaining_fc']:,.0f} FC")
            print(f"   Statut: {debt_dict['status']}")
            print('')
            
            total_amount += debt_dict['total_fc']
            total_remaining += debt_dict['remaining_fc']
        
        print('📊 RÉSUMÉ:')
        print(f"   Total dettes: {len(debts)}")
        print(f"   Montant total: {total_amount:,.0f} FC")
        print(f"   Montant restant: {total_remaining:,.0f} FC\n")
        
        print('✅ Les dettes sont maintenant disponibles dans l\'API /api/debts')
        print('🔄 Elles vont s\'afficher dans la page "Dettes" de l\'application\n')
    else:
        print('❌ Aucune dette trouvée après insertion')
        conn.close()
        sys.exit(1)
        
except Exception as e:
    print(f'❌ Erreur vérification: {e}')
    conn.close()
    sys.exit(1)

conn.close()

print('🔧 ============================================')
print('✅ Script de réparation terminé')
print('🔧 ============================================\n')
print('📝 PROCHAINES ÉTAPES:')
print('   1. Redémarrez l\'application')
print('   2. Allez sur la page "Dettes"')
print('   3. Vous devriez voir les dettes s\'afficher')
print('   4. Vous pouvez cliquer "Payer" pour enregistrer des paiements\n')
