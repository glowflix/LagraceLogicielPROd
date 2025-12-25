/**
 * Mapping entre la structure SQLite et les colonnes Google Sheets
 * Utilise les noms de colonnes EXACTS des feuilles
 */

export const SHEET_MAPPINGS = {
  // Feuilles Stock
  CARTON: {
    sheetName: 'Carton',
    columns: {
      code: 'Code produit',
      name: 'Nom du produit',
      stock_initial: 'Stock initial',
      purchase_price_usd: 'Prix d\'achat (USD)',
      sale_price_fc: 'Prix de vente (FC)',
      mark: 'Mark',
      last_update: 'Date de dernière mise à jour',
      auto_stock_factor: 'Automatisation Stock',
      sale_price_usd: 'Prix ventes (USD)',
      uuid: '_uuid'
    }
  },
  MILLIERS: {
    sheetName: 'Milliers',
    columns: {
      code: 'Code produit',
      name: 'Nom du produit',
      stock_initial: 'Stock initial',
      purchase_price_usd: 'Prix d\'achat (USD)',
      sale_price_fc: 'Prix de vente (FC)',
      mark: 'Mark',
      last_update: 'Date de dernière mise à jour',
      auto_stock_factor: 'Automatisation Stock',
      sale_price_usd: 'Prix ventes (USD)',
      uuid: '_uuid'
    }
  },
  PIECE: {
    sheetName: 'Piece',
    columns: {
      code: 'Code produit',
      name: 'Nom du produit',
      stock_initial: 'Stock initial',
      purchase_price_usd: 'Prix d\'achat (USD)',
      sale_price_fc: 'Prix de vente détail (FC)',
      mark: 'Mark',
      last_update: 'Date de dernière mise à jour',
      auto_stock_factor: 'Automatisation Stock',
      sale_price_usd: 'Prix ventes (USD)',
      uuid: '_uuid'
    }
  },
  
  // Feuille Ventes
  VENTES: {
    sheetName: 'Ventes',
    columns: {
      date: 'Date',
      invoice_number: 'Numéro de facture',
      product_code: 'Code produit',
      client: 'client',
      qty: 'QTE',
      mark: 'MARK',
      unit_price: 'Prix unitaire',
      seller: 'Vendeur',
      unit_level: 'mode stock',
      phone: 'Telephone',
      usd: 'USD',
      uuid: '_uuid'
    }
  },
  
  // Feuille Dettes
  DETTES: {
    sheetName: 'Dettes',
    columns: {
      client: 'Client',
      product: 'Produit',
      argent: 'Argent',
      prix_a_payer: 'prix a payer',
      prix_paye: 'prix payer deja',
      reste: 'reste',
      date: 'date',
      invoice_number: 'numero de facture',
      dollars: 'Dollars',
      description: 'objet\\Description',
      dettes_fc_usd: 'Dettes Fc en usd',
      uuid: '_uuid'
    }
  },
  
  // Feuille Taux
  TAUX: {
    sheetName: 'Taux',
    columns: {
      taux: 'Taux',
      usd: 'USD',
      fc: 'Fc',
      date: 'DATE',
      uuid: '_uuid'
    }
  },
  
  // Feuille Utilisateurs
  COMPTER_UTILISATEUR: {
    sheetName: 'Compter Utilisateur',
    columns: {
      nom: 'Nom',
      mode_passe: 'Mode passe',
      numero: 'Numero',
      valide: 'Valide',
      date_creation: 'date de creation du compter',
      token: 'Token Expo Push',
      marque: 'marque',
      url_profile: 'Urlprofile',
      admin: 'admi',
      uuid: '_uuid'
    }
  },
  
  // Feuille Stock de prix effectué
  STOCK_PRIX: {
    sheetName: 'Stock de prix effectué',
    columns: {
      date: 'Date',
      prix: 'Prix',
      product_code: 'Numero du produit',
      total: 'Total',
      invoice_number: 'Numero de facture',
      uuid: '_uuid'
    }
  }
};

/**
 * Convertit une entité SQLite vers le format Sheets
 */
export function mapToSheets(entity, data, mapping) {
  const mapped = {};
  for (const [dbField, sheetColumn] of Object.entries(mapping.columns)) {
    if (sheetColumn === '_uuid') {
      mapped[sheetColumn] = data.uuid || data[dbField];
    } else if (data[dbField] !== undefined) {
      mapped[sheetColumn] = data[dbField];
    }
  }
  return mapped;
}

/**
 * Convertit une ligne Sheets vers le format SQLite
 */
export function mapFromSheets(row, mapping) {
  const mapped = {};
  for (const [dbField, sheetColumn] of Object.entries(mapping.columns)) {
    const colIndex = findColumnIndexByName(sheetColumn);
    if (colIndex >= 0 && row[colIndex] !== undefined && row[colIndex] !== '') {
      mapped[dbField] = row[colIndex];
    }
  }
  return mapped;
}

function findColumnIndexByName(columnName) {
  // Cette fonction sera utilisée côté Apps Script
  // Ici c'est juste pour référence
  return -1;
}

