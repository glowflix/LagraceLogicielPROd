# 🔍 Diagnostic Clickability Issues - SalesPOS.jsx

## 🎯 Problème Identifié
Les champs de saisie deviennent **non-cliquables** de façon intermittente dans SalesPOS.jsx.

## 📊 Éléments avec Logs Ajoutés

### 1️⃣ Input Quantité (Qty)
**Ligne ~1938**
- ✅ `onChange` - log de la valeur brute
- ✅ `onBlur` - log de la valeur finale
- ✅ `onFocus` - log du ref et de la sélection
- ✅ `onKeyDown` - capture des touches
- ✅ `onMouseDown` - détecte les clics souris
- ✅ `onClick` - détecte les clics et l'état disabled
- ✅ `style={{ pointerEvents: 'auto' }}` - force l'interaction

### 2️⃣ Input Prix (Price)
**Ligne ~2032**
- ✅ `onChange` - log de la valeur
- ✅ `onDoubleClick` - log du reset
- ✅ `onFocus` - log du focus
- ✅ `onClick` - détecte les clics
- ✅ `style={{ pointerEvents: 'auto' }}` - force l'interaction

### 3️⃣ Input Recherche (Search)
**Ligne ~1597**
- ✅ `onChange` - log de la recherche
- ✅ `onFocus` - log du focus
- ✅ `onBlur` - log du blur
- ✅ `onClick` - détecte les clics
- ✅ `onKeyDown` - capture des touches
- ✅ `style={{ pointerEvents: 'auto' }}` - force l'interaction

### 4️⃣ Input Client (Client Name)
**Ligne ~1097**
- ✅ `onChange` - log avec mode dette
- ✅ `onFocus` - log du focus
- ✅ `onBlur` - log du blur
- ✅ `onClick` - détecte les clics
- ✅ `style={{ pointerEvents: 'auto' }}` - force l'interaction

### 5️⃣ Boutons de Quantité
**Lignes ~1879 et ~1950**
- ✅ Bouton `-` (Minus) - log avec `pointerEvents: 'auto'`
- ✅ Bouton `+` (Plus) - log avec `pointerEvents: 'auto'`

### 6️⃣ Boutons Mode de Paiement
**Lignes ~1219 et ~1264**
- ✅ Bouton "💵 Payant" - log + `pointerEvents: 'auto'`
- ✅ Bouton "📋 Dette" - log + `pointerEvents: 'auto'`

### 7️⃣ Boutons Devise
**Lignes ~1305 et ~1345**
- ✅ Bouton "FC" - log bloqué en mode dette + `pointerEvents: 'auto'`
- ✅ Bouton "USD" - log + `pointerEvents: 'auto'`

### 8️⃣ Bouton Panier (Cart Toggle)
**Ligne ~1443**
- ✅ Log de toggle + `pointerEvents: 'auto'`

### 9️⃣ Bouton Ajouter au Panier (Add to Cart)
**Ligne ~2131**
- ✅ Log de clic et de validation + `pointerEvents: 'auto'`
- ✅ Log après ajout au panier

## 🎚️ Z-Index Issues

### Structure Actuelle
```
z-[300]  ← Suggestions de clients (bloquent les overlays)
z-[100]  ← Résultats de recherche produit
z-50     ← Recherche (onFocus scale)
z-20     ← Labels recherche + saisie (input field)
z-10     ← Boutons, Cart toggle, Add to cart
```

### ⚠️ Problème Identifié
Les **suggestions de clients** (`z-[300]`) peuvent bloquer les interactions sur des éléments en `z-10` ou `z-20` si l'overlay s'affiche même quand les suggestions sont fermées.

**Solution appliquée:**
- Ajout de `style={{ pointerEvents: 'auto' }}` à tous les inputs
- Ajout de `style={{ pointerEvents: 'auto' }}` à tous les boutons
- Les overlays conservent leur z-index mais doivent être fermés correctement

## 🔧 Vérifications à Faire

### 1. Observer les logs dans la console
Ouvrir DevTools (F12) et voir:
```
🎯 [QTY-INPUT] onFocus: ...
📝 [QTY-INPUT] onChange: ...
✋ [QTY-INPUT] onClick detected: ...
```

### 2. Vérifier la propriété `showClientSuggestions`
- Cette variable contrôle l'affichage du `z-[300]`
- Si elle reste `true` même après sélection, elle bloquera les clics

### 3. Tester le flow complet
1. Cliquer sur le champ client
2. Vérifier que les suggestions apparaissent
3. Sélectionner un client
4. Vérifier que les suggestions disparaissent
5. Cliquer sur le champ quantité
6. Vérifier que c'est cliquable

## 📝 Format des Logs

Chaque log utilise un emoji + prefix entre `[]` pour faciliter le debugging:
- 📝 = onChange
- 🎯 = onFocus
- 📌 = onBlur
- ✋ = onClick
- ⌨️ = onKeyDown
- 🖱️ = onMouseDown
- ➕ = Plus/Add
- ➖ = Minus
- 💰 = Price
- 🔍 = Search
- 👤 = Client
- 📦 = Product
- 📏 = Unit
- 💵 = Payant mode
- 📋 = Debt mode
- 🏦 = Currency
- 🛒 = Cart
- ✅ = Success/Final

## 🚨 Prochaines Étapes

1. **Tester avec les logs**: Reproduire le problème et observer les logs
2. **Vérifier `showClientSuggestions`**: S'assurer qu'il se ferme correctement
3. **Vérifier les refs**: Tester les `ref={qtyInputRef}`, `ref={searchInputRef}`, etc.
4. **Vérifier le parent context**: S'assurer qu'aucun parent avec `overflow: hidden` ne coupe les overlays
5. **Tester sans SaleHistory**: Vérifier si le problème vient d'une interaction avec SaleHistory.jsx

---
**Créé:** 9 Jan 2026
**Dernier Update:** 9 Jan 2026
