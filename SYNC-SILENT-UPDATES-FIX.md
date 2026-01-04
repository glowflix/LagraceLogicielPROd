# 🔄 FIX: Mise à Jour Silencieuse des Produits depuis Google Sheets

## 📋 Problème Identifié

**Issue**: Les modifications faites dans Google Sheets ne remontent pas silencieusement sur `ProduitsPage.jsx`. La page affiche les données anciennes jusqu'au refresh manuel.

**Symptômes**:
- Éditer un produit dans Google Sheets
- La synchronisation backend s'exécute (toutes les 10 secondes)
- SQLite est mis à jour correctement
- ❌ UI sur ProduitsPage.jsx ne se rafraîchit PAS (sauf si l'utilisateur recharge manuellement la page)

**Root Causes**:
1. **Backend**: SQLite était mis à jour mais aucun événement Socket.IO n'était émis pour notifier l'UI
2. **Frontend**: ProduitsPage.jsx n'écoutait pas les événements Socket.IO de mises à jour de produits
3. **Store**: useStore n'avait pas de listener pour l'événement batch `products:updated`

---

## ✅ Solution Complète (4 Composants)

### 1️⃣ Helpers ISO Date Normalization
**Fichier**: `src/services/sync/sync.worker.js` (lignes 35-56)
**Status**: ✅ **DÉJÀ EN PLACE**

```javascript
// Normaliser les dates en ISO 8601 strict
const toIso = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
};

// Ajouter une marge de sécurité (60s) pour éviter les race conditions
const sinceIsoWithSkew = (lastIso, skewMs = 60000) => {
  if (!lastIso) return null;
  const d = new Date(lastIso);
  d.setTime(d.getTime() - skewMs);
  return d.toISOString();
};
```

**Pourquoi**: Prévient les problèmes de parsing quand les dates JavaScript Date sont mal sérialisées

---

### 2️⃣ Boucle Dédiée Produits (10s)
**Fichier**: `src/services/sync/sync.worker.js` (lignes 285-350)
**Status**: ✅ **DÉJÀ EN PLACE**

```javascript
const startProductsSyncLoop = () => {
  if (_productsSyncRunning) return;
  
  _productsSyncRunning = true;
  const syncProducts = async () => {
    try {
      await syncProductsFromSheets();
    } finally {
      _productsSyncRunning = false;
    }
  };
  
  // Boucle indépendante: toutes les 10 secondes
  _loopTimeout = setInterval(syncProducts, 10000);
};
```

**Pourquoi**: Empêche les syncs de ventes ou de push de bloquer les syncs de produits

---

### 3️⃣ Google Sheets Auto-Update `_updated_at`
**Fichier**: `tools/apps-script/Code.gs` (lignes 322-375)
**Status**: ✅ **DÉJÀ EN PLACE**

```javascript
function onEdit(e) {
  if (!e.range) return;
  
  const sheetName = e.range.getSheet().getName();
  const updatedAtCol = getUpdatedAtColumn(sheetName);
  
  if (updatedAtCol) {
    // Mettre à jour la colonne _updated_at avec la date/heure actuelle
    const sheet = e.range.getSheet();
    const row = e.range.getRow();
    
    sheet.getRange(row, updatedAtCol).setValue(new Date());
    
    // Générer UUID si manquant
    if (!sheet.getRange(row, 1).getValue()) {
      sheet.getRange(row, 1).setValue(Utilities.getUuid());
    }
  }
}
```

**Pourquoi**: Signale à la sync que ce produit a été modifié (incremental sync via le champ `since`)

---

### 4️⃣ Socket.IO Broadcast après Updates ✨ **NOUVEAU**

#### 4A. Backend: Émettre l'événement
**Fichier**: `src/services/sync/sync.worker.js` (lignes 3195-3220)
**Status**: ✅ **AJOUTÉ**

```javascript
// Dans applyProductUpdates(), après les insertions/updates SQL:
if (insertedCount + updatedCount > 0) {
  try {
    const { getSocketIO } = await import('../../api/socket.js');
    const io = getSocketIO();
    if (io) {
      const eventData = {
        ts: new Date().toISOString(),
        count: insertedCount + updatedCount,
        inserted: insertedCount,
        updated: updatedCount,
        source: 'SHEETS'
      };
      io.emit('products:updated', eventData);
      syncLogger.info(`📡 [SOCKET.IO] Event 'products:updated' émis: ${count} produit(s)`);
    }
  } catch (ioError) {
    syncLogger.debug(`⚠️ [SOCKET.IO] Erreur (non bloquant): ${ioError.message}`);
  }
}
```

**Pourquoi**: Notifie les clients en temps réel que les produits ont changé

---

#### 4B. Store: Écouter l'événement (Global)
**Fichier**: `src/ui/store/useStore.js` (lignes 449-454)
**Status**: ✅ **AJOUTÉ**

```javascript
// ✅ Écouter les mises à jour batch de produits depuis Google Sheets
socket.on('products:updated', (data) => {
  // Recharger les produits pour avoir les données à jour
  // (Plus simple qu'essayer de mettre à jour les produits partiellement)
  get().loadProducts();
});
```

**Pourquoi**: Recharge les produits au niveau du store global quand la mise à jour est reçue

---

#### 4C. Page: Écouter l'événement (Component Level)
**Fichier**: `src/ui/pages/ProductsPage.jsx` (lignes 298-336)
**Status**: ✅ **AJOUTÉ**

```javascript
// ✅ Socket.IO listener pour écouter les mises à jour de produits depuis Google Sheets
useEffect(() => {
  if (!socket) return; // Socket pas encore initialisé
  
  const handleProductsUpdated = async (data) => {
    if (IS_DEV) {
      console.log('📡 [ProductsPage] Event "products:updated" reçu:', data);
      console.log(`   → ${data.count} produit(s) mis à jour depuis Google Sheets`);
    }
    
    try {
      // Recharger les produits pour avoir les données à jour
      await loadProducts();
      
      if (IS_DEV) {
        console.log('✅ [ProductsPage] Produits rechargés depuis le serveur');
      }
    } catch (error) {
      console.error('❌ [ProductsPage] Erreur lors du rechargement:', error);
    }
  };
  
  // S'abonner à l'événement 'products:updated'
  socket.on('products:updated', handleProductsUpdated);
  
  if (IS_DEV) {
    console.log('🔗 [ProductsPage] Listener Socket.IO "products:updated" enregistré');
  }
  
  // Cleanup: désabonner au démontage du composant
  return () => {
    socket.off('products:updated', handleProductsUpdated);
    if (IS_DEV) {
      console.log('🔓 [ProductsPage] Listener Socket.IO désabonné');
    }
  };
}, [socket, loadProducts]);
```

**Pourquoi**: Déclenche le refetch des produits au moment exact où le serveur envoie l'événement

---

## 🔄 Flux Complet (Sheets → UI)

```
1. Utilisateur édite un produit dans Google Sheets
   ↓
2. Apps Script onEdit() met à jour _updated_at
   ↓
3. Sync.worker (boucle 10s) détecte le changement via le champ _updated_at
   ↓
4. syncProductsFromSheets() récupère le produit modifié
   ↓
5. applyProductUpdates() insère/update dans SQLite
   ↓
6. Socket.IO émet 'products:updated' avec les détails
   ↓
7. useStore.js recharge via loadProducts()
   ↓
8. ProductsPage.jsx reçoit l'événement et recharge aussi
   ↓
9. UI se rafraîchit silencieusement sans que l'utilisateur n'ait rien à faire ✅
```

---

## 🧪 Test End-to-End

### Scénario 1: Modification Produit Simple
1. Ouvrir ProduitsPage.jsx et Google Sheets côte à côte
2. Modifier le prix d'un produit dans Sheets
3. Attendre max 10 secondes + Socket.IO latency (~100ms)
4. ✅ ProduitsPage doit afficher la nouvelle prix automatiquement

### Scénario 2: Multiple Produits
1. Modifier 5 produits dans une feuille Sheets
2. ✅ Event 'products:updated' doit indiquer `count: 5`
3. ✅ Tous les 5 produits doivent se rafraîchir simultanément

### Scénario 3: Mode Offline
1. Déconnecter le Socket.IO
2. Modifier un produit dans Sheets
3. Reconnecter le Socket.IO
4. ✅ Event 'products:updated' doit être reçu et produits rechargés

---

## 📝 Notes Techniques

### Mutex Patterns
- `_productsSyncRunning`: Empêche les syncs concurrentes de produits
- Séparation complète des boucles: products (10s), sales (10s), push (15s)

### ISO Date Safety
- `sinceIsoWithSkew(lastIso, 60000)`: Marge de 60 secondes pour éviter les race conditions
- Tous les champs `updated_at` sont en ISO 8601 strict

### Socket.IO Reliability
- Gestion d'erreur gracieuse: Socket.IO non-bloquant
- Retry automatique via la reconnexion Socket.IO
- Logs détaillés en mode DEV pour le debugging

---

## 🚀 Déploiement

1. **Build**: `npm run build` (compile TypeScript → JavaScript)
2. **Test**: Vérifier les logs console en mode DEV
3. **Deploy**: Remplacer l'EXE Electron avec la nouvelle build
4. **Verify**: Tester les 3 scénarios ci-dessus

---

## 📊 Résumé des Modifications

| Fichier | Lignes | Type | Contenu |
|---------|--------|------|---------|
| `sync.worker.js` | 35-56 | Existing ✅ | Helpers `toIso()`, `sinceIsoWithSkew()` |
| `sync.worker.js` | 285-350 | Existing ✅ | Loop `startProductsSyncLoop()` |
| `sync.worker.js` | 3195-3220 | **NEW** ✨ | Socket.IO broadcast 'products:updated' |
| `Code.gs` | 322-375 | Existing ✅ | onEdit() auto-update `_updated_at` |
| `useStore.js` | 449-454 | **NEW** ✨ | Socket.IO listener 'products:updated' |
| `ProductsPage.jsx` | 165 | **MODIFIED** ✨ | Import `socket` from useStore |
| `ProductsPage.jsx` | 298-336 | **NEW** ✨ | useEffect Socket.IO listener |

---

## ✨ Résultat Attendu

**Avant** (Ancien Comportement):
- Utilisateur modifie un produit dans Sheets
- Page reste figée avec l'ancienne valeur
- Doit refresher manuellement pour voir la nouvelle valeur

**Après** (Nouveau Comportement):
- Utilisateur modifie un produit dans Sheets
- La page se met à jour automatiquement en ~10 secondes
- Aucune action manuelle requise
- Notification console disponible en mode DEV

---

## 🔗 Références

- **Socket.IO Events**: `src/api/socket.js`
- **Sync Loop Config**: `src/services/sync/sync.worker.js` lignes 10-20
- **Product Sync**: `src/services/sync/sync.worker.js` lignes 952-1015
- **Apps Script**: `tools/apps-script/Code.gs` lignes 1-400

