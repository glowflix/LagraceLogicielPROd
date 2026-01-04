#!/usr/bin/env python3
"""
Test: Vérifier que le produit 1 'buiscuit loriie k' a DEUX units (CARTON + MILLIER)
"""
import sqlite3
from pathlib import Path

# Database path - try database.db first
db_paths = [
    Path("C:/Glowflixprojet/db/glowflixprojet.db"),
    Path(__file__).parent / 'database.db',
    Path(__file__).parent / 'app.db'
]

db_path = None
for p in db_paths:
    if p.exists():
        db_path = p
        break

if not db_path:
    print(f"❌ ERREUR: Aucune BD trouvée!")
    print(f"   Chemins testés:")
    for p in db_paths:
        print(f"   - {p} {'✅ existe' if p.exists() else '❌ non trouvé'}")
    exit(1)

print(f"📁 BD trouvée: {db_path}")
print()

print("=" * 80)
print("TEST: Produit 1 - Vérification des units")
print("=" * 80)

try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Récupérer le produit 1
    cursor.execute("SELECT id, code, name, uuid FROM products WHERE code = '1' LIMIT 1")
    product = cursor.fetchone()
    
    if not product:
        print("❌ ERREUR: Produit code='1' non trouvé!")
        print("\nProduits disponibles:")
        cursor.execute("SELECT code, name FROM products LIMIT 10")
        for row in cursor.fetchall():
            print(f"  - Code: {row['code']}, Nom: {row['name']}")
    else:
        print(f"\n✅ Produit trouvé:")
        print(f"  ID: {product['id']}")
        print(f"  Code: {product['code']}")
        print(f"  Nom: {product['name']}")
        print(f"  UUID: {product['uuid']}")
        
        # Récupérer tous les units
        cursor.execute("""
            SELECT 
              id, 
              uuid, 
              unit_level, 
              unit_mark, 
              stock_current, 
              sale_price_usd,
              sale_price_fc
            FROM product_units 
            WHERE product_id = ?
            ORDER BY unit_level
        """, (product['id'],))
        
        units = cursor.fetchall()
        print(f"\n📦 Units du produit:")
        if units:
            print(f"   Nombre total: {len(units)} unit(s)")
            for i, unit in enumerate(units, 1):
                print(f"\n   [{i}] {unit['unit_level']}")
                print(f"       Mark: '{unit['unit_mark']}'")
                print(f"       Stock: {unit['stock_current']}")
                print(f"       Prix USD: ${unit['sale_price_usd']}")
                print(f"       Prix FC: {unit['sale_price_fc']} FC")
                print(f"       UUID: {unit['uuid']}")
            
            # Vérifier si CARTON et MILLIER sont présents
            unit_levels = [u['unit_level'] for u in units]
            has_carton = 'CARTON' in unit_levels
            has_millier = 'MILLIER' in unit_levels
            
            print(f"\n📋 Résumé:")
            print(f"  ✅ CARTON: {'OUI' if has_carton else '❌ NON (MANQUANT!)'}")
            print(f"  {'✅' if has_millier else '❌'} MILLIER: {'OUI' if has_millier else 'NON (MANQUANT!)'}")
            
            if has_carton and has_millier:
                print(f"\n🎉 SUCCESS: Le produit 1 a BIEN les deux units CARTON et MILLIER!")
            else:
                print(f"\n⚠️  PROBLEM: Le produit 1 est incomplet!")
                if not has_millier:
                    print(f"   ❌ MILLIER manquante - c'est le bug rapporté par l'utilisateur")
        else:
            print("   ❌ Aucun unit trouvé!")
    
    conn.close()

except Exception as e:
    print(f"❌ Erreur: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 80)
