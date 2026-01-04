#!/usr/bin/env python3
"""
Injecte les dettes dans la VRAIE base de données à C:\Glowflixprojet\db
"""

import sqlite3
import os
from pathlib import Path

# Le vrai chemin de la BD
db_path = Path("C:\\Glowflixprojet\\db\\glowflixprojet.db")

print("🔧 Injection des dettes dans la vraie BD\n")
print(f"📍 BD: {db_path}")

if not db_path.exists():
    print(f"❌ BD non trouvée: {db_path}")
    print("\n📍 Fichiers trouvés dans C:\\Glowflixprojet\\db:")
    try:
        for f in Path("C:\\Glowflixprojet\\db").glob("*.db"):
            print(f"   - {f}")
    except Exception as e:
        print(f"   ❌ Erreur: {e}")
    exit(1)

conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# Vérifier si la table debts existe
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='debts'")
if not cursor.fetchone():
    print("\n📋 Création de la table debts...")
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
    print("✅ Table créée")
else:
    print("✅ Table debts existe déjà")

# Vider d'abord pour éviter les doublons
print("\n🧹 Nettoyage des anciennes dettes...")
cursor.execute('DELETE FROM debts')
conn.commit()
print("✅ Nettoyage fait")

# Insérer les dettes
print("\n📥 Insertion des dettes...\n")
DEBTS = [
    ('PA MUKANIA', '001', 13800, 0, 13800),
    ('PA SAMY', '002', 100000, 0, 100000),
    ('muyomba', '003', 50000, 0, 50000),
]

import time
for i, (client, invoice, total, paid, remaining) in enumerate(DEBTS):
    uuid = f'debt-{int(time.time()*1000)}-{i}'
    cursor.execute('''
        INSERT INTO debts 
        (uuid, invoice_number, client_name, total_fc, paid_fc, remaining_fc, status, product_description, total_usd, debt_fc_in_usd)
        VALUES (?, ?, ?, ?, ?, ?, 'open', 'CARTON', ?, 0)
    ''', (uuid, invoice, client, total, paid, remaining, total/2000))
    print(f"✅ {client} - Facture {invoice} - {remaining:,.0f} FC")

conn.commit()

# Vérifier
print("\n🔍 Vérification...\n")
cursor.execute('SELECT COUNT(*) FROM debts')
count = cursor.fetchone()[0]
print(f"✅ {count} dette(s) dans la BD")

cursor.execute('SELECT client_name, invoice_number, remaining_fc, status FROM debts ORDER BY created_at DESC')
for row in cursor.fetchall():
    print(f"   • {row[0]:20} - Facture {row[1]:5} - {row[2]:>10,.0f} FC - {row[3]}")

conn.close()

print("\n✅ Les dettes sont maintenant dans la vraie BD!")
print("📍 Redémarrez l'application pour les voir s'afficher")
