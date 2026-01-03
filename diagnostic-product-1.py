#!/usr/bin/env python3
r"""
Diagnostic complet: Vérifier les units du produit code '1'
et tous les chemins de la base de données
"""
import sqlite3
import os
from pathlib import Path

db_path = r'C:\Glowflixprojet\db\glowflixprojet.db'

print("=" * 80)
print("DIAGNOSTIC GLOWFLIXPROJET DATABASE")
print("=" * 80)
print(f"\n📂 Database Path: {db_path}")
print(f"✅ Exists: {os.path.exists(db_path)}\n")

try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # ===== PRODUCT DETAILS =====
    print("=" * 80)
    print("PRODUCT CODE '1' - DETAILS")
    print("=" * 80)
    
    cursor.execute("""
        SELECT 
            id, code, name, is_active, created_at, updated_at, uuid
        FROM products 
        WHERE code = '1'
    """)
    
    product = cursor.fetchone()
    if product:
        print(f"✅ Product found:")
        print(f"   ID: {product['id']}")
        print(f"   Code: {product['code']}")
        print(f"   Name: '{product['name']}' {'✅ HAS NAME' if product['name'] else '❌ EMPTY'}")
        print(f"   Active: {product['is_active']}")
        print(f"   Created: {product['created_at']}")
        print(f"   Updated: {product['updated_at']}")
        print(f"   UUID: {product['uuid']}")
        
        # ===== UNITS =====
        print(f"\n📦 UNITS FOR PRODUCT '1':")
        
        # First check table structure
        cursor.execute("PRAGMA table_info(product_units)")
        columns = [row[1] for row in cursor.fetchall()]
        print(f"   Available columns: {', '.join(columns)}")
        
        cursor.execute("""
            SELECT 
                id, uuid, unit_level, unit_mark, 
                sale_price_fc, sale_price_usd, 
                stock_current, qty_step
            FROM product_units 
            WHERE product_id = ?
            ORDER BY unit_level
        """, (product['id'],))
        
        units = cursor.fetchall()
        if units:
            print(f"   Found {len(units)} unit(s):")
            for idx, unit in enumerate(units, 1):
                print(f"   {idx}. {unit['unit_level']:10s} / {unit['unit_mark']:10s}")
                print(f"      UUID: {unit['uuid']}")
                print(f"      Price: FC={unit['sale_price_fc']}, USD={unit['sale_price_usd']}")
                print(f"      Stock: {unit['stock_current']}, Step: {unit['qty_step']}")
        else:
            print(f"   ❌ NO UNITS FOUND!")
            
        # ===== OUTBOX =====
        print(f"\n📤 OUTBOX OPERATIONS FOR PRODUCT '1':")
        try:
            cursor.execute("""
                SELECT 
                    op_id, op_type, entity_code, status, 
                    payload_json, created_at, updated_at
                FROM outbox 
                WHERE entity_code = '1' 
                ORDER BY created_at DESC
                LIMIT 5
            """)
            
            ops = cursor.fetchall()
            if ops:
                print(f"   Found {len(ops)} pending operations:")
                for idx, op in enumerate(ops, 1):
                    print(f"   {idx}. Op: {op['op_type']:15s} Status: {op['status']:10s}")
                    print(f"      Created: {op['created_at']}")
                    if op['payload_json']:
                        import json
                        try:
                            payload = json.loads(op['payload_json'])
                            print(f"      Payload keys: {list(payload.keys())}")
                            if 'name' in payload:
                                print(f"      Name in payload: '{payload['name']}'")
                        except:
                            print(f"      Payload: {op['payload_json'][:100]}...")
            else:
                print(f"   ℹ️ No pending operations")
        except:
            print(f"   ⚠️ Table 'outbox' does not exist (normal, synced mode)")
            
    else:
        print("❌ Product code '1' NOT FOUND!")
    
    # ===== DATABASE SUMMARY =====
    print(f"\n" + "=" * 80)
    print("DATABASE SUMMARY")
    print("=" * 80)
    
    cursor.execute("""
        SELECT 
            COUNT(*) as total_products,
            SUM(CASE WHEN name IS NULL OR name = '' THEN 1 ELSE 0 END) as products_without_name
        FROM products
    """)
    summary = cursor.fetchone()
    print(f"Total Products: {summary['total_products']}")
    print(f"Products without name: {summary['products_without_name']}")
    
    cursor.execute("""
        SELECT 
            COUNT(*) as total_units,
            COUNT(DISTINCT product_id) as products_with_units
        FROM product_units
    """)
    unit_summary = cursor.fetchone()
    print(f"Total Product Units: {unit_summary['total_units']}")
    print(f"Products with units: {unit_summary['products_with_units']}")
    
    try:
        cursor.execute("""
            SELECT 
                COUNT(*) as total_pending,
                COUNT(DISTINCT entity_code) as unique_products
            FROM outbox 
            WHERE status = 'pending'
        """)
        outbox_summary = cursor.fetchone()
        print(f"Pending Outbox Ops: {outbox_summary['total_pending']}")
        print(f"Unique Products: {outbox_summary['unique_products']}")
    except:
        print(f"Pending Outbox Ops: N/A (table does not exist)")
    
    # ===== TABLES =====
    print(f"\n" + "=" * 80)
    print("TABLES IN DATABASE")
    print("=" * 80)
    
    cursor.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        ORDER BY name
    """)
    
    for table in cursor.fetchall():
        cursor.execute(f"SELECT COUNT(*) FROM {table[0]}")
        count = cursor.fetchone()[0]
        print(f"  {table[0]:30s} {count:8d} rows")
    
    conn.close()
    print("\n✅ Diagnostic completed!")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
