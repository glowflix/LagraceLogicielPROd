#!/usr/bin/env python3
"""
Test: Vérifier que GET /api/products retourne le produit 1 avec 2 units
"""
import requests
import json

print("=" * 80)
print("TEST: GET /api/products - Vérifier produit 1 avec 2 units")
print("=" * 80)

try:
    # Appeler l'endpoint
    response = requests.get('http://localhost:3000/api/products', timeout=10)
    response.raise_for_status()
    
    products = response.json()
    print(f"\n✅ Réponse reçue: {len(products)} produit(s)")
    
    # Trouver le produit 1
    product1 = None
    for p in products:
        if str(p.get('code', '')).strip() == '1' or p.get('id') == 1:
            product1 = p
            break
    
    if not product1:
        print("\n❌ ERREUR: Produit code='1' NOT FOUND!")
        print("Produits disponibles (premiers 5):")
        for i, p in enumerate(products[:5], 1):
            units_count = len(p.get('units', []))
            print(f"  [{i}] Code: {p.get('code')}, Units: {units_count}")
    else:
        print(f"\n✅ Produit trouvé:")
        print(f"  Code: {product1.get('code')}")
        print(f"  Nom: {product1.get('name')}")
        print(f"  ID: {product1.get('id')}")
        
        units = product1.get('units', [])
        print(f"\n📦 Units ({len(units)} total):")
        if units:
            for i, unit in enumerate(units, 1):
                print(f"  [{i}] {unit.get('unit_level')}")
                print(f"      Mark: '{unit.get('unit_mark')}'")
                print(f"      Stock: {unit.get('stock_current')}")
                print(f"      Prix USD: ${unit.get('sale_price_usd')}")
            
            # Vérifier résultat
            unit_levels = [u.get('unit_level') for u in units]
            has_carton = 'CARTON' in unit_levels
            has_millier = 'MILLIER' in unit_levels
            
            print(f"\n📋 Résumé:")
            print(f"  ✅ CARTON: {'OUI' if has_carton else '❌ NON'}")
            print(f"  {'✅' if has_millier else '❌'} MILLIER: {'OUI' if has_millier else 'NON'}")
            
            if has_carton and has_millier:
                print(f"\n🎉 SUCCESS: API retourne bien les 2 units!")
            else:
                print(f"\n⚠️  PROBLEM: Units manquante(s)!")
        else:
            print("   ❌ Aucun unit!")
    
except requests.exceptions.ConnectionError:
    print("\n❌ Erreur: Impossible de se connecter au serveur http://localhost:3000")
    print("   Assurez-vous que le serveur Node.js est en cours d'exécution")
except Exception as e:
    print(f"\n❌ Erreur: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 80)
