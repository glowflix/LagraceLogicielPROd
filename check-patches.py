#!/usr/bin/env python3
import sqlite3
import json

db_path = 'la-grace-sync.sqlite3'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("=" * 80)
print("🔍 DIAGNOSTIC: Opérations PRODUCT_PATCH pending")
print("=" * 80)

# Vérifier les opérations pending par type
cursor.execute("SELECT op_type, COUNT(*) FROM sync_operations WHERE status='pending' GROUP BY op_type")
for row in cursor.fetchall():
    print(f"\n✅ {row[0]}: {row[1]} pending")

# Chercher les PRODUCT_PATCH pour produit '1'
print(f"\n" + "=" * 80)
print(f"Détail des PRODUCT_PATCH pour produit '1':")
cursor.execute("""
SELECT op_id, op_type, entity_code, status, payload_json, created_at
FROM sync_operations 
WHERE entity_code = '1' AND op_type = 'PRODUCT_PATCH'
ORDER BY created_at DESC
""")

patches = cursor.fetchall()
if patches:
    for patch in patches:
        print(f"\n  Op ID: {patch[0]}")
        print(f"  Type: {patch[1]}")
        print(f"  Status: {patch[3]}")
        print(f"  Created: {patch[5]}")
        try:
            payload = json.loads(patch[4])
            print(f"  Name: {payload.get('name', 'VIDE')}")
            print(f"  Unit Level: {payload.get('unit_level', 'VIDE')}")
        except:
            print(f"  Error parsing payload")
else:
    print("  ❌ Aucun PRODUCT_PATCH trouvé pour produit '1'")

# Vérifier le produit
print(f"\n" + "=" * 80)
cursor.execute("SELECT code, name, uuid, synced_at FROM products WHERE code='1'")
prod = cursor.fetchone()
if prod:
    print(f"✅ Produit '1' trouvé:")
    print(f"  Name: {prod[1]}")
    print(f"  UUID: {prod[2]}")
    print(f"  Synced at: {prod[3]}")
else:
    print(f"❌ Produit '1' NOT found")

conn.close()
print("\n" + "=" * 80)
