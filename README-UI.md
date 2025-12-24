# Interface React - Glowflixprojet

Application React moderne avec design professionnel et animations.

## Installation

```bash
# Installer les dépendances
npm install

# Démarrer le serveur de développement UI
npm run dev:ui

# Build pour production
npm run build:ui
```

## Structure

```
src/ui/
├── main.jsx              # Point d'entrée React
├── App.jsx               # Router principal
├── index.css             # Styles globaux (Tailwind)
├── store/
│   └── useStore.js       # State management (Zustand)
├── pages/                # Pages de l'application
│   ├── SplashScreen.jsx  # Écran de démarrage
│   ├── LicensePage.jsx   # Activation licence offline
│   ├── LoginPage.jsx     # Connexion
│   ├── Dashboard.jsx     # Tableau de bord
│   ├── SalesPOS.jsx      # Point de vente
│   ├── SalesHistory.jsx  # Historique ventes
│   ├── SalesDetail.jsx   # Détail vente
│   ├── ProductsPage.jsx  # Gestion produits (style Sheets)
│   ├── DebtsPage.jsx     # Gestion dettes
│   ├── AnalyticsPage.jsx # Statistiques
│   ├── SettingsPage.jsx  # Paramètres
│   └── SyncPage.jsx      # Synchronisation
└── components/
    └── Layout.jsx        # Layout avec sidebar
```

## Fonctionnalités

### ✅ Pages système
- **SplashScreen**: Écran de démarrage avec vérification DB/serveur/sync
- **LicensePage**: Activation licence offline (clé: 0987654321)
- **LoginPage**: Connexion utilisateur (fonctionne offline)

### ✅ Pages principales
- **Dashboard**: KPIs, ventes du jour, dettes, stock faible
- **SalesPOS**: Point de vente avec panier, recherche produits, paiement
- **SalesHistory**: Liste des ventes avec filtres date/recherche
- **SalesDetail**: Détail vente + annulation + réimpression
- **ProductsPage**: Gestion produits style tableur (édition cellule)
- **DebtsPage**: Liste des dettes clients
- **AnalyticsPage**: Statistiques et rapports
- **SettingsPage**: Paramètres application
- **SyncPage**: État synchronisation Google Sheets

### ✅ Fonctionnalités techniques
- **WebSocket**: Mises à jour temps réel (ventes, stock)
- **Offline-first**: Fonctionne sans Internet, sync en arrière-plan
- **Animations**: Framer Motion pour transitions fluides
- **Design**: Glass morphism, dark theme, gradients
- **Responsive**: Adapté mobile/tablette/desktop

## Configuration

Créer un fichier `.env` dans `src/ui/`:

```env
VITE_API_URL=http://localhost:3030
```

## Utilisation

1. **Démarrer le backend** (port 3030):
```bash
npm start
```

2. **Démarrer l'UI** (port 5173):
```bash
npm run dev:ui
```

3. **Accéder à l'application**:
- Ouvrir http://localhost:5173
- Activer avec la clé: `0987654321`
- Se connecter (n'importe quel utilisateur en mode offline)

## Technologies

- **React 18**: Framework UI
- **Vite**: Build tool rapide
- **React Router**: Navigation
- **Zustand**: State management
- **Framer Motion**: Animations
- **Tailwind CSS**: Styles
- **Socket.io-client**: WebSocket
- **Axios**: HTTP client
- **Lucide React**: Icônes
- **date-fns**: Formatage dates

## Design

- **Thème**: Dark premium avec glass morphism
- **Couleurs**: Primary (bleu), Dark (gris foncé)
- **Animations**: Fade, slide, scale, hover effects
- **Composants**: Cards, buttons, inputs avec styles cohérents

## Mode Offline

L'application fonctionne 100% hors ligne:
- Les ventes sont stockées localement si le serveur est inaccessible
- La synchronisation reprend automatiquement quand Internet revient
- Les données sont mises en cache dans le store Zustand

