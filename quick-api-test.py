#!/usr/bin/env python3
import urllib.request
import json

try:
    response = urllib.request.urlopen('http://localhost:3030/api/products')
    data = json.loads(response.read().decode())
    
    # Trouver le produit 1
    product_1 = next((p for p in data if p.get('code') == '1'), None)
    
    if product_1:
        units = product_1.get('units', [])
        print(f"✅ Product 1 from API:")
        print(f"   Name: {product_1.get('name')}")
        print(f"   Units count: {len(units)}")
        for i, unit in enumerate(units, 1):
            print(f"   {i}. {unit.get('unit_level')} - Mark: {unit.get('unit_mark')} - Stock: {unit.get('stock_current')}")
    else:
        print("❌ Product 1 NOT FOUND")
        
except Exception as e:
    print(f"❌ Error: {e}")
