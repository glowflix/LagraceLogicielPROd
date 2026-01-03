#!/usr/bin/env python3
import sqlite3
import json

db_path = 'C:/Glowflixprojet/db/glowflixprojet.db'

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # List all tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()

    print("=" * 80)
    print(f"📊 Database: {db_path}")
    print("=" * 80)
    print(f"✅ Tables ({len(tables)}):")
    
    for table in tables:
        table_name = table[0]
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        count = cursor.fetchone()[0]
        print(f"  - {table_name}: {count} rows")

    # Check for pending operations
    print("\n" + "=" * 80)
    print("🔍 PENDING OPERATIONS:")
    print("=" * 80)
    
    try:
        cursor.execute("SELECT op_type, COUNT(*) FROM sync_operations WHERE status='pending' GROUP BY op_type")
        for row in cursor.fetchall():
            print(f"  {row[0]}: {row[1]}")
    except:
        print("  ❌ sync_operations table not found or error")

    # Check product 1
    print("\n" + "=" * 80)
    print("🔍 PRODUCT CODE '1':")
    print("=" * 80)
    
    try:
        cursor.execute("SELECT code, name, uuid, synced_at FROM products WHERE code='1'")
        prod = cursor.fetchone()
        if prod:
            print(f"  ✅ Found:")
            print(f"     Name: {prod[1]}")
            print(f"     UUID: {prod[2]}")
            print(f"     Synced at: {prod[3]}")
        else:
            print(f"  ❌ Product '1' not found")
    except Exception as e:
        print(f"  ❌ Error: {e}")

    conn.close()

except Exception as e:
    print(f"❌ Database error: {e}")
    print(f"Database path: {db_path}")
