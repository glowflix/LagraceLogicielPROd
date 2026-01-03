#!/usr/bin/env python3
import sqlite3
import json

db_path = 'C:/Glowflixprojet/db/glowflixprojet.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("=" * 80)
print("🔍 PENDING PRODUCT_PATCH FOR PRODUCT '1':")
print("=" * 80)

cursor.execute("""
SELECT op_id, op_type, entity_code, status, payload_json, created_at, updated_at
FROM sync_operations 
WHERE entity_code = '1' AND op_type = 'PRODUCT_PATCH'
ORDER BY created_at DESC
LIMIT 5
""")

rows = cursor.fetchall()
for row in rows:
    op_id, op_type, entity_code, status, payload_json, created_at, updated_at = row
    print(f"\n✅ Op ID: {op_id}")
    print(f"   Type: {op_type}")
    print(f"   Status: {status}")
    print(f"   Created: {created_at}")
    print(f"   Updated: {updated_at}")
    
    try:
        payload = json.loads(payload_json)
        print(f"   Payload:")
        for key, value in payload.items():
            print(f"     - {key}: {value}")
    except Exception as e:
        print(f"   Error parsing payload: {e}")

print("\n" + "=" * 80)
print("ALL PENDING OPERATIONS:")
print("=" * 80)

cursor.execute("""
SELECT op_type, COUNT(*) as count, MAX(updated_at) as last_update
FROM sync_operations 
WHERE status = 'pending'
GROUP BY op_type
ORDER BY last_update DESC
""")

for row in cursor.fetchall():
    op_type, count, last_update = row
    print(f"\n{op_type}:")
    print(f"  Count: {count}")
    print(f"  Last update: {last_update}")

conn.close()
