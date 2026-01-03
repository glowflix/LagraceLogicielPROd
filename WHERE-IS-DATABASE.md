# 🔍 WHERE TO FIND DATABASE IN PRODUCTION

## Quick Answer

After installing and running **LA GRACE POS**, the SQLite database is located at:

```
C:\Users\<YOUR_USERNAME>\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db
```

## How to Access It

### Method 1: Using File Explorer
```
1. Press: Windows Key + R
2. Type: %APPDATA%
3. Open folder: Glowflixprojet\db\
4. File: glowflixprojet.db ← This is the database
```

### Method 2: Direct Path
```
C:\Users\john\AppData\Roaming\Glowflixprojet\db\glowflixprojet.db
                 ^^^^^
                 Replace with your Windows username
```

### Method 3: Using Command Line
```powershell
# Open PowerShell and run:
explorer "$env:APPDATA\Glowflixprojet\db"

# Or show the file:
Get-Item "$env:APPDATA\Glowflixprojet\db\glowflixprojet.db"
```

## Database Folder Structure

```
C:\Users\<USER>\AppData\Roaming\Glowflixprojet\
│
├── db/                              ← Database folder
│   ├── glowflixprojet.db            ← SQLite database (main)
│   ├── glowflixprojet.db-shm        ← Write-Ahead Logging (temp)
│   └── glowflixprojet.db-wal        ← Write-Ahead Logging (log)
│
├── data/
│   ├── cache/
│   ├── imports/
│   ├── exports/
│   ├── backups/
│   └── attachments/
│
├── logs/                            ← Application logs
├── config/                          ← Configuration files
└── printer/                         ← Printer templates
```

## Important Notes

### ✅ Database Persists After Uninstall
When you uninstall **LA GRACE POS**:
- ❌ Removed: `C:\Program Files\LA GRACE POS\` (installation folder)
- ✅ Kept: `C:\Users\<USER>\AppData\Roaming\Glowflixprojet\` (data folder)

When you reinstall, the app automatically connects to the existing database!

### 🔐 Backup Your Database
```powershell
# Backup the database folder
Copy-Item "$env:APPDATA\Glowflixprojet" -Destination "D:\Backups\Glowflixprojet-$(Get-Date -Format 'yyyy-MM-dd')" -Recurse
```

### 🗑️ Delete Database (if needed)
```powershell
# WARNING: This will delete ALL data!
Remove-Item "$env:APPDATA\Glowflixprojet" -Recurse -Force

# Next launch will create a fresh database
```

## AppData Location by OS

| OS | Path |
|----|----|
| **Windows** | `C:\Users\<USER>\AppData\Roaming\Glowflixprojet\` |
| **macOS** | `~/Library/Application Support/Glowflixprojet/` |
| **Linux** | `~/.config/Glowflixprojet/` |

## Environment Variables

The app uses these environment variables:

```javascript
// In electron/main.cjs:
process.env.GLOWFLIX_ROOT_DIR = dataRoot;  // Auto-set to AppData/Roaming
process.env.LAGRACE_DATA_DIR = dataRoot;   // AI data directory
```

These are automatically configured during startup - no manual setup needed!

---

## Technical Details (for developers)

### Database Initialization Code
From [src/core/paths.js](src/core/paths.js):

```javascript
export function getProjectRoot() {
  // In Electron production: use userData (AppData/Roaming)
  if (isElectron && global.__ELECTRON_APP__) {
    return global.__ELECTRON_APP__.getPath("userData");
  }
  
  // Otherwise: use environment variable or default
  return process.env.GLOWFLIX_ROOT_DIR
    ? path.resolve(process.env.GLOWFLIX_ROOT_DIR)
    : (process.platform === "win32" 
      ? "C:\\Glowflixprojet" 
      : path.join(os.homedir(), "Glowflixprojet"));
}

export function getDbPath() {
  const root = getProjectRoot();
  return path.join(root, "db", "glowflixprojet.db");
}
```

### Database Connection Code
From [src/db/sqlite.js](src/db/sqlite.js):

```javascript
export function getDb() {
  if (db) return db;
  
  ensureDirs();  // Create AppData/Roaming folder if missing
  const dbPath = getDbPath();
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');     // Write-Ahead Logging
  db.pragma('synchronous = NORMAL');   // Balance between safety and speed
  db.pragma('busy_timeout = 5000');    // Retry on locked database
  
  return db;
}
```

### Production Startup Sequence
From [electron/main.cjs](electron/main.cjs):

```javascript
app.whenReady().then(async () => {
  // 1. Set data directory to AppData/Roaming
  const defaultProdRoot = path.join(app.getPath('appData'), 'Glowflixprojet');
  process.env.GLOWFLIX_ROOT_DIR = defaultProdRoot;
  
  // 2. Start Express backend in-process
  await startBackendInProcess();
  
  // 3. Backend initializes database
  // (calls initSchema() which uses getDb())
  
  // 4. Create window and load UI
  createWindow();
});
```

---

## Summary

```
Installation folder:    C:\Program Files\LA GRACE POS\     (deleted on uninstall)
           ↓
Database location:      C:\Users\<USER>\AppData\Roaming\Glowflixprojet\db\   (persists)
           ↓
Database file:          glowflixprojet.db
           ↓
First access:           Auto-created on first app launch
```

**No npm involved. No external dependencies. Pure production setup!**
