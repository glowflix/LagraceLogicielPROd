#!/usr/bin/env python3
import sqlite3
import os

db_path = r'C:\Glowflixprojet\db\glowflixprojet.db'

db = sqlite3.connect(db_path)
c = db.cursor()

print("=" * 80)
print("🔍 DEBUG: Vérifier les unités du produit 1 en BD")
print("=" * 80)

# Produit 1
c.execute("SELECT id, code, name FROM products WHERE code = '1'")
product = c.fetchone()

if product:
    pid = product[0]
    print(f"\n✅ Product trouvé: ID={pid}, Code={product[1]}, Name={product[2]}")
    
    # Compter les unités
    c.execute("SELECT COUNT(*) FROM product_units WHERE product_id = ?", (pid,))
    count = c.fetchone()[0]
    print(f"   Units count: {count}")
    
    # Lister les unités
    c.execute("""
        SELECT id, unit_level, unit_mark, stock_current, sale_price_usd 
        FROM product_units 
        WHERE product_id = ? 
        ORDER BY id
    """, (pid,))
    
    for row in c.fetchall():
        print(f"   - ID={row[0]}, Level={row[1]}, Mark={row[2]}, Stock={row[3]}, Price={row[4]} USD")
else:
    print("❌ Product 1 not found!")

print("\n" + "=" * 80)
print("🔍 TEST DIRECT QUERY (comme products.repo.js)")
print("=" * 80)

# Simuler la requête du repo
c.execute("""
    SELECT p.id, p.code, p.name, COUNT(pu.id) as unit_count
    FROM products p
    LEFT JOIN product_units pu ON p.id = pu.product_id
    WHERE p.code = '1'
    GROUP BY p.id
""")

result = c.fetchone()
if result:
    print(f"\n✅ GROUP BY query result:")
    print(f"   Product ID: {result[0]}")
    print(f"   Code: {result[1]}")
    print(f"   Name: {result[2]}")
    print(f"   Unit count: {result[3]}")

db.close()
