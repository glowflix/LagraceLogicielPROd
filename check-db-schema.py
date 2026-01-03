#!/usr/bin/env python3
"""
Vérifier la structure de la base de données
"""
import sqlite3
import os

db_path = r'C:\Glowflixprojet\db\glowflixprojet.db'

print(f"🔍 Testing local database at: {db_path}")
print(f"📂 Database exists: {os.path.exists(db_path)}\n")

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get table structure
    cursor.execute("PRAGMA table_info(products)")
    columns = cursor.fetchall()
    
    print("=" * 80)
    print("PRODUCTS TABLE STRUCTURE")
    print("=" * 80)
    for col in columns:
        print(f"Column: {col[1]:25s} Type: {col[2]:15s} Not Null: {col[3]} Default: {col[4]}")
    
    print("\n" + "=" * 80)
    print("CHECKING PRODUCT CODE '1'")
    print("=" * 80)
    
    cursor.execute("SELECT * FROM products WHERE code = '1' LIMIT 1")
    row = cursor.fetchone()
    
    if row:
        print(f"✅ Product found:")
        col_names = [desc[0] for desc in cursor.description]
        for i, val in enumerate(row):
            print(f"   {col_names[i]:25s}: {val}")
    else:
        print("❌ Product code '1' not found")
    
    conn.close()

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
