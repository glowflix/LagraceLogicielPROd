#!/usr/bin/env python3
import sqlite3
import json

db_path = 'app.db'
db = sqlite3.connect(db_path)
db.row_factory = sqlite3.Row
cursor = db.cursor()

# Check pending operations
cursor.execute('SELECT COUNT(*) as count FROM sync_operations WHERE status = ?', ('PENDING',))
pending_count = cursor.fetchone()['count']

# Check sync_operations table structure
cursor.execute("PRAGMA table_info(sync_operations)")
columns = cursor.fetchall()

# Get sample of pending ops if any
if pending_count > 0:
    cursor.execute('SELECT op_id, entity, op, status, created_at FROM sync_operations WHERE status = ? LIMIT 5', ('PENDING',))
    samples = cursor.fetchall()
else:
    samples = []

db.close()

print(f'📊 PENDING OPERATIONS: {pending_count}')
if pending_count > 0:
    print(f'\n📋 Sample operations:')
    for row in samples:
        print(f'   - op_id={row["op_id"]}, entity={row["entity"]}, op={row["op"]}, created_at={row["created_at"]}')
else:
    print('✅ No pending operations (sync is up-to-date!)')

print(f'\n📝 Table columns: {", ".join([col[1] for col in columns])}')
