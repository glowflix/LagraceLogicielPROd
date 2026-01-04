#!/usr/bin/env python3
import sqlite3
import os

db_path = r'C:\Glowflixprojet\db\glowflixprojet.db'

if not os.path.exists(db_path):
    print(f"❌ DB not found: {db_path}")
    exit(1)

db = sqlite3.connect(db_path)
c = db.cursor()

print("=" * 80)
print("🔍 CHECK PRODUCT 1 IN DATABASE (direct SQL)")
print("=" * 80)

# Vérifier le produit 1
c.execute("SELECT id, code, name FROM products WHERE code = '1' LIMIT 1")
product = c.fetchone()

if product:
    product_id = product[0]
    code = product[1]
    name = product[2]
    print(f"\nProduct ID: {product_id}, Code: {code}, Name: {name}")
    
    # Compter les unités
    c.execute(
        """SELECT id, unit_level, unit_mark, stock_current, purchase_price_usd, sale_price_usd 
           FROM product_units WHERE product_id = ? ORDER BY unit_level""",
        (product_id,)
    )
    units = c.fetchall()
    
    print(f"\n📊 UNITS IN DATABASE: {len(units)}\n")
    
    for u in units:
        print(f"Unit ID {u[0]}:")
        print(f"   Level: {u[1]}")
        print(f"   Mark: {u[2]}")
        print(f"   Stock: {u[3]}")
        print(f"   Purchase: {u[4]} USD")
        print(f"   Sale: {u[5]} USD")
        print()

else:
    print("\n❌ Product 1 NOT FOUND!")

print("=" * 80)
db.close()
