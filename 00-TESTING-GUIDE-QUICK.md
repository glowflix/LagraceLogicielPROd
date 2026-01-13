# 🧪 Quick Testing Guide - SalesPOS Clickability Fixes

## ⚡ 30 Second Quick Test

1. **Ouvrir la page SalesPOS**
   ```
   F12 (DevTools) → Console tab
   ```

2. **Test 1: Client Input**
   ```
   Cliquer sur "Nom du client" field
   Vérifier le log: 🎯 [CLIENT-INPUT] onFocus
   Taper un nom: "Serge Sokulu"
   Vérifier le log: 👤 [CLIENT-INPUT] onChange
   ```

3. **Test 2: Qty Input**
   ```
   Cliquer sur "Quantité" field
   Vérifier le log: 🎯 [QTY-INPUT] onFocus
   Taper: "5"
   Vérifier le log: 📝 [QTY-INPUT] onChange
   ```

4. **Test 3: Après SalesHistory Modal**
   ```
   Ouvrir SalesHistory modal (autre page)
   Fermer le modal
   Revenir à SalesPOS
   Cliquer sur Quantité field
   ✅ Si cliquable = FIX OK
   ❌ Si non-cliquable = Problème persistant
   ```

---

## 📋 Full Testing Checklist

### Phase 1: Input Fields (5 min)

#### Client Name Input
- [ ] Clic sur champ → log 🎯
- [ ] Saisie "Jean Dupont" → log 👤
- [ ] Double-clic → log ✋
- [ ] Appuyer Escape → suggestions ferment
- [ ] Sélectionner suggestion → champ remplit

#### Search Input
- [ ] Clic sur champ → log 🎯
- [ ] Saisie "Biscuit" → log 🔍
- [ ] Résultats apparaissent
- [ ] Sélectionner produit → champ vide

#### Qty Input
- [ ] Clic sur champ → log 🎯
- [ ] Saisie "10" → log 📝
- [ ] Clic bouton `-` → log ➖
- [ ] Clic bouton `+` → log ➕
- [ ] Double-clic → sélectionne le texte

#### Price Input
- [ ] Clic sur champ → log 💰
- [ ] Double-clic → reset à prix par défaut

### Phase 2: Mode Buttons (3 min)

- [ ] Clic "💵 Payant" → log 💵 MODE-PAYANT
- [ ] Clic "📋 Dette" → log 📋 MODE-DETTE
- [ ] Mode Dette force devise USD
- [ ] Bouton "FC" disabled en mode Dette
- [ ] Clic "FC" → log 🏦 CURRENCY-FC
- [ ] Clic "USD" → log 💵 CURRENCY-USD

### Phase 3: Cart & Add (2 min)

- [ ] Clic toggle panier → log 🛒
- [ ] Clic "Ajouter" → log ➕ ADD-TO-CART
- [ ] Item apparaît dans panier
- [ ] Logs finaux montrent le prix

### Phase 4: Interaction avec SalesHistory (5 min)

1. **Avant SalesHistory:**
   - [ ] Tous les inputs cliquables
   - [ ] Logs apparaissent en console

2. **Ouvrir SalesHistory:**
   - [ ] Cliquer sur vente pour ouvrir modal
   - [ ] Modal s'affiche correctement

3. **Fermer SalesHistory:**
   - [ ] Cliquer X pour fermer modal
   - [ ] Modal disparaît

4. **Revenir à SalesPOS:**
   - [ ] Cliquer sur Client field
   - [ ] ✅ DOIT ÊTRE CLIQUABLE
   - [ ] Vérifier log 🎯 [CLIENT-INPUT] onFocus

---

## 🔍 Log Output Examples

### Expected Success Logs
```
🎯 [CLIENT-INPUT] onFocus
👤 [CLIENT-INPUT] onChange: {value: "Serge Sokulu", isDebt: true}
✋ [CLIENT-INPUT] onClick detected
📌 [CLIENT-INPUT] onBlur
🎯 [QTY-INPUT] onFocus: {value: "", ref: input}
📝 [QTY-INPUT] onChange: {rawVal: "5", currentQty: 0, policy: {...}}
🔢 [QTY-INPUT] decimal allowed: 5
✋ [QTY-INPUT] onClick detected: {target: input, disabled: false}
➕ [QTY-PLUS] Clicked: {currentQty: 5, step: 1}
➕ [QTY-PLUS] New qty: 6
💰 [PRICE-INPUT] onChange: {val: 100, currency: "FC"}
🛒 [CART-TOGGLE] Clicked, isExpanded: true
➕ [ADD-TO-CART] Clicked: {selectedProduct: "BISCUIT", qty: 6}
➕ [ADD-TO-CART] Adding item: {qty: 6, priceUSD: 0.3, priceFC: 180}
➕ [ADD-TO-CART] Item added successfully
```

### Problematic Logs (WARNING SIGNS)
```
✋ [CLIENT-INPUT] onClick detected: {target: ???, disabled: true}
   ↑ Input est disabled - vérifier pourquoi
   
❌ Aucun log quand on clique
   ↑ Click event ne se déclenche pas - z-index bloquant
   
🎯 [QTY-INPUT] onFocus mais pas de onChange après saisie
   ↑ Input ne accepte pas la saisie - CSS issue
```

---

## 🛠️ Troubleshooting

### Problem: "No logs appear when clicking"
**Solution:**
1. Vérifier que Console tab est ouvert
2. Vérifier que DevTools pas sur "Paused on exceptions"
3. Vérifier le filtre console (pas de filter appliqué)
4. Faire F5 pour refresh la page

### Problem: "Input clicked but disabled=true in log"
**Solution:**
1. Vérifier que le produit est sélectionné
2. Vérifier qu'il y a une quantité saisie
3. Vérifier le produit n'est pas déjà dans le panier

### Problem: "After SalesHistory modal, inputs not clickable"
**Solution:**
1. Vérifier le modal est bien fermé
2. Appuyer F5 pour forcer refresh
3. Vérifier dans DevTools → Elements que z-50 div n'existe plus

### Problem: "Client suggestions don't close with Escape"
**Solution:**
1. Cliquer dans le champ client
2. Taper un nom
3. Appuyer Escape
4. Vérifier log: 🎯 [ESCAPE] Closed client suggestions
5. Vérifier que la dropdown disparaît

---

## 📊 Expected Console Output

Quand vous tapo "Serge Sokulu" dans le champ client:

```
👤 [CLIENT-INPUT] onChange: {value: "S", isDebt: true}
👤 [CLIENT-INPUT] onChange: {value: "Se", isDebt: true}
👤 [CLIENT-INPUT] onChange: {value: "Ser", isDebt: true}
...
👤 [CLIENT-INPUT] onChange: {value: "Serge Sokulu", isDebt: true}
```

Si le mode Debt est actif, vous verrez `isDebt: true`.
Si le mode Payant est actif, vous verrez `isDebt: false`.

---

## ✅ Validation Criteria

| Test | Expected | Status |
|------|----------|--------|
| Client field clickable | Yes | ☐ |
| Qty field clickable | Yes | ☐ |
| Price field clickable | Yes | ☐ |
| Logs appear in console | Yes | ☐ |
| After SalesHistory | Clickable | ☐ |
| Escape closes dropdown | Yes | ☐ |
| Add to cart works | Yes | ☐ |

---

## 📞 If Tests Fail

1. **Collect logs:** Copy all console output
2. **Note timing:** When exactly does it fail
3. **Check version:** Ensure you're on latest build
4. **Try incognito:** Clear cache issues
5. **Share logs:** Include timestamp and exact steps

---

**Last Updated:** 9 Jan 2026
**Test Duration:** ~15 minutes total
**Difficulty:** Easy - just observe console logs
