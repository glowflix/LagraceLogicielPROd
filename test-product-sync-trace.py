#!/usr/bin/env python3
"""
Test script: Modify product 1 and trace full sync flow
Montre en détail comment le produit est traité lors de la modification
"""
import requests
import json
import time

BASE_URL = 'http://localhost:3000'

print("=" * 80)
print("🔍 TEST: Modification produit et suivi complet du sync")
print("=" * 80)

# Step 1: Vérifier l'état de la base de données
print("\n[STEP 1] État initial du produit 1 en base de données:")
print("  💾 Chercher dans database...")
print("  - Code: 1")
print("  - Expected name: 'crist' (ou nouveau nom)")
print("  - Pending patches: Sera montré après modification")

# Step 2: Modifier le produit via l'API
print("\n[STEP 2] Modification du produit 1 via API PUT:")
product_update = {
    "name": f"TEST-SYNC-{int(time.time())}",
    "is_active": 1
}
print(f"  📝 Payload: {json.dumps(product_update, indent=2)}")

try:
    response = requests.put(
        f'{BASE_URL}/api/products/1',
        json=product_update,
        timeout=5
    )
    print(f"  ✅ Status: {response.status_code}")
    if response.status_code == 200:
        print(f"  ✅ Response: {response.json()}")
    else:
        print(f"  ❌ Error: {response.text}")
except Exception as e:
    print(f"  ❌ Erreur requête: {e}")

# Step 3: Vérifier les opérations pending
print("\n[STEP 3] Opérations pending après modification:")
try:
    response = requests.get(f'{BASE_URL}/api/sync/outbox', timeout=5)
    if response.status_code == 200:
        data = response.json()
        stats = data.get('stats', {})
        print(f"  📊 Statistiques:")
        print(f"     - Total pending: {stats.get('totalPending', 0)}")
        print(f"     - By type: {stats.get('pendingByType', {})}")
        
        recent = data.get('recentPending', [])
        print(f"\n  📋 Recent pending operations:")
        for op in recent[:5]:
            print(f"     - {op['op_type']}: {op['entity_code']} (status={op['status']})")
except Exception as e:
    print(f"  ❌ Erreur: {e}")

# Step 4: Forcer la connexion et pousser
print("\n[STEP 4] FORCER LA CONNEXION ET PUSH:")
print("  🌐 Appel POST /api/sync/reset-online-and-push...")
try:
    response = requests.post(
        f'{BASE_URL}/api/sync/reset-online-and-push',
        timeout=10
    )
    print(f"  ✅ Status: {response.status_code}")
    if response.status_code == 200:
        result = response.json()
        print(f"  ✅ Result: {result.get('message', 'OK')}")
        outbox = result.get('outbox', {})
        print(f"  📊 Outbox après push: {outbox}")
    else:
        print(f"  ❌ Error: {response.text}")
except Exception as e:
    print(f"  ❌ Erreur push: {e}")

# Step 5: Attendre et vérifier
print("\n[STEP 5] Vérification finale:")
print("  ⏳ Attendez 5 secondes pour la sync...")
time.sleep(5)

try:
    response = requests.get(f'{BASE_URL}/api/sync/status', timeout=5)
    if response.status_code == 200:
        status = response.json()
        outbox = status.get('outbox', {})
        print(f"  ✅ Outbox stats: {outbox}")
        print(f"\n  🎯 Si totalPending=0 ou PRODUCT_PATCH=0, le push a réussi!")
    else:
        print(f"  ❌ Error: {response.text}")
except Exception as e:
    print(f"  ❌ Erreur: {e}")

print("\n" + "=" * 80)
print("📝 PROCHAINES ÉTAPES:")
print("=" * 80)
print("1. Vérifier les LOGS du terminal (npm run dev)")
print("2. Chercher les logs avec '[PRODUCT-PATCH', '[pushProductPatches', '[handleProductUpsert'")
print("3. Vérifier Google Sheets: le nom du produit 1 dans feuille CARTON doit être mis à jour")
print("4. Si toujours vide, relancer avec: POST /api/sync/reset-online-and-push")
print("=" * 80)
