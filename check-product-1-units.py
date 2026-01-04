#!/usr/bin/env python3
import requests
import json

try:
    print("🔍 Fetching /api/products from http://localhost:3030...\n")
    response = requests.get('http://localhost:3030/api/products', timeout=5)
    products = response.json()
    
    print(f"✅ Got {len(products)} products\n")
    
    # Find product 1
    product_1 = next((p for p in products if str(p.get('code')) == '1'), None)
    
    if product_1:
        print("=" * 80)
        print("✅ PRODUCT 1 FROM API")
        print("=" * 80)
        print(f"Code: {product_1.get('code')}")
        print(f"Name: {product_1.get('name')}")
        print(f"UUID: {product_1.get('uuid')}")
        print(f"\n📊 UNITS COUNT: {len(product_1.get('units', []))}")
        print()
        
        for i, unit in enumerate(product_1.get('units', []), 1):
            print(f"Unit {i}:")
            print(f"   Level: {unit.get('unit_level')}")
            print(f"   Mark: {unit.get('unit_mark')}")
            print(f"   Stock: {unit.get('stock_current')}")
            print(f"   Sale USD: {unit.get('sale_price_usd')}")
            print(f"   Sale FC: {unit.get('sale_price_fc')}")
            print()
        
        if len(product_1.get('units', [])) == 2:
            print("✅ SUCCESS: Product 1 has 2 units from API!")
        elif len(product_1.get('units', [])) == 1:
            print("⚠️  WARNING: Product 1 still shows only 1 unit from API")
            print("   Note: The backend fix needs a restart to take effect")
        
    else:
        print("❌ Product 1 not found")
        print(f"\nFirst 5 products:")
        for p in products[:5]:
            print(f"  - Code {p.get('code')}: {len(p.get('units', []))} units")
            
except requests.exceptions.ConnectionError:
    print("❌ Cannot connect to http://localhost:3030")
    print("   Is the server running on port 3030?")
except Exception as e:
    print(f"❌ Error: {e}")
