#!/usr/bin/env python3
"""
Test de la base de données locale C:\Glowflixprojet\db\glowflixprojet.db
Vérifie l'état du produit code '1' et les chemins des scripts
"""
import sqlite3
import os
import json
from pathlib import Path

# Chemin de la base de données LOCAL
db_path = r'C:\Glowflixprojet\db\glowflixprojet.db'

print(f"🔍 Testing local database at: {db_path}")
print(f"📂 Database exists: {os.path.exists(db_path)}")
print()

if not os.path.exists(db_path):
    print(f"❌ Database not found! Creating directory...")
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Check if products table exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='products'")
    if not cursor.fetchone():
        print("❌ Table 'products' does not exist!")
        conn.close()
        exit(1)
    
    print("✅ Table 'products' exists\n")
    
    # Check product code '1'
    print("=" * 60)
    print("CHECKING PRODUCT CODE '1'")
    print("=" * 60)
    cursor.execute("""
        SELECT 
            code, 
            name, 
            unit_level, 
            _uuid, 
            _updated_at,
            _device_id
        FROM products 
        WHERE code = '1' 
        LIMIT 1
    """)
    
    row = cursor.fetchone()
    if row:
        print(f"✅ Product found:")
        print(f"   Code: {row['code']}")
        print(f"   Name: {row['name'] or '(EMPTY - THIS IS THE PROBLEM!)' if row['name'] else 'NULL'}")
        print(f"   Unit Level: {row['unit_level']}")
        print(f"   UUID: {row['_uuid']}")
        print(f"   Updated At: {row['_updated_at']}")
        print(f"   Device ID: {row['_device_id']}")
    else:
        print("❌ Product code '1' not found in database")
    
    print("\n" + "=" * 60)
    print("ALL PRODUCTS SUMMARY")
    print("=" * 60)
    cursor.execute("""
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN name IS NULL OR name = '' THEN 1 ELSE 0 END) as without_name,
            SUM(CASE WHEN code = '1' THEN 1 ELSE 0 END) as code_1_count
        FROM products
    """)
    
    summary = cursor.fetchone()
    print(f"Total products: {summary['total']}")
    print(f"Products without name: {summary['without_name']}")
    print(f"Products with code '1': {summary['code_1_count']}")
    
    print("\n" + "=" * 60)
    print("FIRST 10 PRODUCTS")
    print("=" * 60)
    cursor.execute("""
        SELECT code, name, unit_level 
        FROM products 
        LIMIT 10
    """)
    
    for idx, row in enumerate(cursor.fetchall(), 1):
        print(f"{idx:2d}. Code: {row['code']:20s} Name: {row['name'] or '(EMPTY)':30s} Unit: {row['unit_level']}")
    
    conn.close()
    print("\n✅ Database test completed successfully")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
