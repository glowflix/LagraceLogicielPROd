import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Receipt, Printer, Eye, Calendar, ChevronLeft, ChevronRight, Package, X, ChevronDown, ChevronUp, Clock, DollarSign, User } from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';
import { format, startOfMonth, endOfMonth, parseISO, getHours, getMinutes } from 'date-fns';
import { fr } from 'date-fns/locale';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

/**
 * Convertit unit_level en texte lisible
 * unit_level peut être: 'MILLIER', 'CARTON', 'PIECE' (string) ou 1, 2, 3 (number)
 */
const formatUnitLevel = (unitLevel) => {
  if (!unitLevel) return 'Pièce';
  
  const normalized = String(unitLevel).toUpperCase().trim();
  
  if (normalized === 'MILLIER' || normalized === '1' || normalized === 'MILLIERS') {
    return 'Millier';
  }
  if (normalized === 'CARTON' || normalized === '2' || normalized === 'CARTONS') {
    return 'Carton';
  }
  if (normalized === 'PIECE' || normalized === '3' || normalized === 'PIÈCE' || normalized === 'PIECES') {
    return 'Pièce';
  }
  
  // Fallback: retourner la valeur telle quelle si non reconnue
  return normalized;
};

/**
 * Vérifie si une valeur est une unité (millier, carton, piece) et non un vrai vendeur
 */
const isUnitValue = (value) => {
  if (!value || typeof value !== 'string') return false;
  const normalized = value.toLowerCase().trim();
  return normalized === 'millier' || normalized === 'milliers' || 
         normalized === 'carton' || normalized === 'cartons' || 
         normalized === 'piece' || normalized === 'pièce' || normalized === 'pieces';
};

const SalesHistory = () => {
  const { sales, loadSales } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchAllMonths, setSearchAllMonths] = useState(false);
  const [selectedSale, setSelectedSale] = useState(null);
  const [saleDetails, setSaleDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [expandedItems, setExpandedItems] = useState(false);

  // Par défaut, afficher le mois actuel
  const today = new Date();
  const [currentDisplayDate, setCurrentDisplayDate] = useState(today);

  useEffect(() => {
    if (!searchQuery || !searchAllMonths) {
      loadSalesData();
    }
  }, [currentDisplayDate]); // Recharger quand le mois affiché change

  // Charger toutes les ventes si recherche globale activée
  useEffect(() => {
    if (searchQuery && searchAllMonths) {
      loadAllSales();
    }
  }, [searchQuery, searchAllMonths]);

  // Charger les détails de la vente sélectionnée
  useEffect(() => {
    if (selectedSale) {
      loadSaleDetails(selectedSale.invoice_number);
    }
  }, [selectedSale]);

  const loadSalesData = async () => {
    setLoading(true);
    try {
      // Calculer le début et la fin du mois sélectionné
      const startOfSelectedMonth = startOfMonth(currentDisplayDate);
      const endOfSelectedMonth = endOfMonth(currentDisplayDate);

      // Formater les dates au format ISO pour l'API
      const fromDate = format(startOfSelectedMonth, 'yyyy-MM-dd') + 'T00:00:00.000Z';
      const toDate = format(endOfSelectedMonth, 'yyyy-MM-dd') + 'T23:59:59.999Z';

      console.log(`📅 Chargement des ventes pour le mois: ${format(currentDisplayDate, 'MMMM yyyy', { locale: fr })}`);
      console.log(`   Du: ${fromDate} au: ${toDate}`);

      // Charger les ventes pour ce mois uniquement
      await loadSales({
        from: fromDate,
        to: toDate
      });
    } catch (error) {
      console.error('Erreur chargement ventes:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAllSales = async () => {
    setLoading(true);
    try {
      // Charger toutes les ventes sans filtre de date
      await loadSales({});
    } catch (error) {
      console.error('Erreur chargement toutes les ventes:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSaleDetails = async (invoiceNumber) => {
    setLoadingDetails(true);
    try {
      const response = await axios.get(`${API_URL}/api/sales/${invoiceNumber}`);
      setSaleDetails(response.data);
    } catch (error) {
      console.error('Erreur chargement détails:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handlePreviousMonth = () => {
    setCurrentDisplayDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() - 1);
      return newDate;
    });
  };

  const handleNextMonth = () => {
    setCurrentDisplayDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + 1);
      return newDate;
    });
  };

  const handleToday = () => {
    setCurrentDisplayDate(new Date());
    setSearchAllMonths(false);
  };

  const handleMonthChange = (e) => {
    const selectedDate = new Date(e.target.value + '-01');
    setCurrentDisplayDate(selectedDate);
    setSearchAllMonths(false);
  };

  // Grouper les ventes par (client_name, invoice_number) et limiter à 50
  const uniqueSales = useMemo(() => {
    // D'abord, filtrer par mois si recherche globale désactivée
    let salesToProcess = sales;
    
    if (!searchQuery || !searchAllMonths) {
      const startOfSelectedMonth = startOfMonth(currentDisplayDate);
      const endOfSelectedMonth = endOfMonth(currentDisplayDate);
      const startTime = startOfSelectedMonth.getTime();
      const endTime = endOfSelectedMonth.getTime();

      salesToProcess = sales.filter((sale) => {
        if (!sale.sold_at) return false;
        const saleDate = parseISO(sale.sold_at).getTime();
        return saleDate >= startTime && saleDate <= endTime;
      });
    }

    // Appliquer le filtre de recherche
    const filtered = salesToProcess.filter(
      (sale) =>
        sale.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (sale.client_name &&
          sale.client_name.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Grouper par (client_name, invoice_number)
    const groupedMap = new Map();
    
    filtered.forEach((sale) => {
      const key = `${sale.client_name || 'Sans nom'}_${sale.invoice_number}`;
      
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          ...sale,
          itemCount: 1,
          duplicateCount: 1
        });
      } else {
        const existing = groupedMap.get(key);
        const existingDate = parseISO(existing.sold_at).getTime();
        const currentDate = parseISO(sale.sold_at).getTime();
        
        if (currentDate > existingDate) {
          groupedMap.set(key, {
            ...sale,
            itemCount: existing.itemCount + 1,
            duplicateCount: existing.duplicateCount + 1
          });
        } else {
          existing.duplicateCount = (existing.duplicateCount || 1) + 1;
        }
      }
    });

    // Convertir en tableau et trier par date (plus récent en premier)
    const uniqueSalesArray = Array.from(groupedMap.values()).sort(
      (a, b) => parseISO(b.sold_at).getTime() - parseISO(a.sold_at).getTime()
    );

    // Limiter à 50 ventes uniques
    return uniqueSalesArray.slice(0, 50);
  }, [sales, searchQuery, currentDisplayDate, searchAllMonths]);

  // Calculer les statistiques du mois
  const monthStats = useMemo(() => {
    const total = uniqueSales.reduce((sum, sale) => sum + (sale.total_fc || 0), 0);
    return {
      count: uniqueSales.length,
      total: total
    };
  }, [uniqueSales]);

  // Calculer le graphique d'heure pour la vente sélectionnée
  const hourChart = useMemo(() => {
    if (!saleDetails?.sold_at) return null;
    const saleDate = parseISO(saleDetails.sold_at);
    const hour = getHours(saleDate);
    const minute = getMinutes(saleDate);
    
    // Créer un graphique simple avec 24 heures
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      active: i === hour,
      value: i === hour ? 100 : 0
    }));
    
    return { hours, currentHour: hour, currentMinute: minute };
  }, [saleDetails]);

  const handlePrint = async (invoiceNumber) => {
    try {
      await axios.post(`${API_URL}/api/sales/${invoiceNumber}/print`);
      // Optionnel: notification de succès
    } catch (error) {
      console.error('Erreur impression:', error);
      alert('Erreur lors de l\'impression');
    }
  };

  const handleSaleClick = (sale) => {
    setSelectedSale(sale);
    setExpandedItems(false);
  };

  const closeModal = () => {
    setSelectedSale(null);
    setSaleDetails(null);
    setExpandedItems(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Historique des ventes</h1>
        <p className="text-gray-400">Consultez toutes vos factures</p>
      </div>

      {/* Navigation mensuelle et filtres */}
      <div className="card space-y-4">
        {/* Navigation mensuelle */}
        <div className="flex justify-between items-center pb-4 border-b border-gray-700">
          <button 
            onClick={handlePreviousMonth} 
            className="p-2 glass rounded-lg hover:bg-white/10 transition-all"
            title="Mois précédent"
            disabled={searchAllMonths}
          >
            <ChevronLeft className={`w-5 h-5 ${searchAllMonths ? 'text-gray-600' : 'text-gray-400'}`} />
          </button>
          
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary-400" />
              <h2 className="text-xl font-semibold text-gray-100">
                {searchAllMonths ? 'Tous les mois' : format(currentDisplayDate, 'MMMM yyyy', { locale: fr })}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={format(currentDisplayDate, 'yyyy-MM')}
                onChange={handleMonthChange}
                className="input-field text-sm"
                title="Sélectionner un mois"
                disabled={searchAllMonths}
              />
              <button 
                onClick={handleToday}
                className="btn btn-primary btn-sm"
                title="Retour au mois actuel"
                disabled={searchAllMonths}
              >
                Aujourd'hui
              </button>
            </div>
          </div>
          
          <button 
            onClick={handleNextMonth} 
            className="p-2 glass rounded-lg hover:bg-white/10 transition-all"
            title="Mois suivant"
            disabled={searchAllMonths}
          >
            <ChevronRight className={`w-5 h-5 ${searchAllMonths ? 'text-gray-600' : 'text-gray-400'}`} />
          </button>
        </div>

        {/* Statistiques du mois */}
        {!loading && (
          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className="text-center p-4 glass rounded-lg">
              <p className="text-sm text-gray-400 mb-1">Ventes uniques</p>
              <p className="text-3xl font-bold text-primary-400">{monthStats.count}</p>
              <p className="text-xs text-gray-500 mt-1">
                {searchAllMonths ? 'toutes périodes' : `pour ce mois`}
              </p>
            </div>
            <div className="text-center p-4 glass rounded-lg">
              <p className="text-sm text-gray-400 mb-1">Total</p>
              <p className="text-3xl font-bold text-primary-400">{monthStats.total.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Francs Congolais</p>
            </div>
          </div>
        )}

        {/* Recherche */}
        <div className="space-y-2 pt-2 border-t border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par numéro de facture ou nom de client..."
              className="input-field pl-10"
            />
          </div>
          {searchQuery && (
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={searchAllMonths}
                onChange={(e) => setSearchAllMonths(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-primary-500 focus:ring-primary-500"
              />
              <span>Rechercher dans tous les mois</span>
            </label>
          )}
        </div>
      </div>

      {/* Liste des ventes */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"
            />
            <p className="mt-4 text-gray-400">Chargement des ventes...</p>
          </div>
        ) : uniqueSales.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
              <p className="text-sm text-gray-400">
                Affichage de <span className="font-semibold text-gray-200">{uniqueSales.length}</span> vente(s) unique(s)
                {searchAllMonths ? ' (toutes périodes)' : ` pour ${format(currentDisplayDate, 'MMMM yyyy', { locale: fr })}`}
              </p>
              {uniqueSales.length === 50 && (
                <p className="text-xs text-gray-500">Limité aux 50 plus récentes</p>
              )}
            </div>
            {uniqueSales.map((sale, index) => (
              <motion.div
                key={`${sale.client_name}_${sale.invoice_number}_${sale.id}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="p-4 glass rounded-lg hover:bg-white/5 transition-all cursor-pointer"
                onClick={() => handleSaleClick(sale)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <User className="w-5 h-5 text-primary-400" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-lg text-gray-200">
                          {sale.client_name || 'Client'}
                        </span>
                        <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Receipt className="w-3 h-3 text-primary-400" />
                          {sale.invoice_number}
                        </span>
                      </div>
                      {sale.duplicateCount > 1 && (
                        <span className="badge badge-warning" title={`${sale.duplicateCount} articles dans cette facture`}>
                          <Package className="w-3 h-3 inline mr-1" />
                          {sale.duplicateCount} article{sale.duplicateCount > 1 ? 's' : ''}
                        </span>
                      )}
                      <span
                        className={`badge ${
                          sale.status === 'paid'
                            ? 'badge-success'
                            : sale.status === 'void'
                            ? 'badge-error'
                            : 'badge-warning'
                        }`}
                      >
                        {sale.status === 'paid'
                          ? 'Payé'
                          : sale.status === 'void'
                          ? 'Annulé'
                          : 'En attente'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {format(new Date(sale.sold_at), 'dd MMM yyyy HH:mm', {
                          locale: fr,
                        })}
                      </span>
                      {sale.seller_name && !isUnitValue(sale.seller_name) && (
                        <span>Vendeur: {sale.seller_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right mr-4">
                    <p className="text-xl font-bold text-primary-400">
                      {sale.total_fc.toLocaleString()} FC
                    </p>
                    <p className="text-sm text-gray-400">
                      {sale.payment_mode === 'cash' ? 'Cash' : 'Dette'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrint(sale.invoice_number);
                      }}
                      className="p-2 glass rounded-lg hover:bg-white/10"
                      title="Imprimer"
                    >
                      <Printer className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <Receipt className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-semibold mb-2">
              Aucune vente trouvée
              {searchAllMonths ? '' : ` pour ${format(currentDisplayDate, 'MMMM yyyy', { locale: fr })}`}
            </p>
            {searchQuery ? (
              <p className="text-sm mt-2">Essayez de modifier votre recherche ou sélectionnez un autre mois</p>
            ) : (
              <p className="text-sm mt-2">Sélectionnez un autre mois pour voir les ventes</p>
            )}
          </div>
        )}
      </div>

      {/* Modal de détails */}
      <AnimatePresence>
        {selectedSale && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={closeModal}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {loadingDetails ? (
                <div className="p-8 text-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"
                  />
                  <p className="mt-4 text-gray-400">Chargement des détails...</p>
                </div>
              ) : saleDetails ? (
                <div className="p-6 space-y-6">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-gray-700 pb-4">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-100">
                        {saleDetails.client_name || 'Client'}
                      </h2>
                      <p className="text-sm text-gray-400 mt-1 flex items-center gap-2">
                        <Receipt className="w-4 h-4" />
                        Facture {saleDetails.invoice_number}
                      </p>
                    </div>
                    <button
                      onClick={closeModal}
                      className="p-2 glass rounded-lg hover:bg-white/10"
                    >
                      <X className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>

                  {/* Informations principales */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 glass rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="w-5 h-5 text-primary-400" />
                        <p className="text-sm text-gray-400">Client</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-200">
                          {saleDetails.client_name || 'Non renseigné'}
                        </p>
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <Receipt className="w-3 h-3" />
                          {saleDetails.invoice_number}
                        </p>
                      </div>
                    </div>
                    <div className="p-4 glass rounded-lg">
                      <p className="text-sm text-gray-400 mb-1">Date & Heure</p>
                      <p className="text-lg font-semibold text-gray-200">
                        {format(new Date(saleDetails.sold_at), 'dd MMMM yyyy à HH:mm', { locale: fr })}
                      </p>
                    </div>
                    <div className="p-4 glass rounded-lg">
                      <p className="text-sm text-gray-400 mb-1">Nombre de produits</p>
                      <p className="text-lg font-semibold text-primary-400">
                        {saleDetails.items?.length || 0} article{saleDetails.items?.length > 1 ? 's' : ''}
                      </p>
                    </div>
                    {saleDetails.seller_name && !isUnitValue(saleDetails.seller_name) && (
                      <div className="p-4 glass rounded-lg">
                        <p className="text-sm text-gray-400 mb-1">Vendeur</p>
                        <p className="text-lg font-semibold text-gray-200">
                          {saleDetails.seller_name}
                        </p>
                      </div>
                    )}
                    <div className="p-4 glass rounded-lg">
                      <p className="text-sm text-gray-400 mb-1">Total</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-semibold text-primary-400">
                          {saleDetails.total_fc?.toLocaleString() || 0} FC
                        </p>
                        {saleDetails.total_usd && (
                          <p className="text-sm text-gray-400">
                            / ${saleDetails.total_usd.toFixed(2)} USD
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Graphique d'heure */}
                  {hourChart && (
                    <div className="p-4 glass rounded-lg">
                      <div className="flex items-center gap-2 mb-4">
                        <Clock className="w-5 h-5 text-primary-400" />
                        <h3 className="text-lg font-semibold text-gray-200">Heure de vente</h3>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm text-gray-400 mb-2">
                          <span>Heure: {hourChart.currentHour}h{hourChart.currentMinute.toString().padStart(2, '0')}</span>
                          <span>0h - 23h</span>
                        </div>
                        <div className="flex items-end gap-1 h-32">
                          {hourChart.hours.map((h, i) => (
                            <div
                              key={i}
                              className={`flex-1 rounded-t transition-all ${
                                h.active
                                  ? 'bg-primary-500'
                                  : i % 6 === 0
                                  ? 'bg-gray-700'
                                  : 'bg-gray-800'
                              }`}
                              style={{
                                height: h.active ? '100%' : '20%',
                                minHeight: '4px'
                              }}
                              title={`${h.hour}h`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Articles (repliables) */}
                  {saleDetails.items && saleDetails.items.length > 0 && (
                    <div className="p-4 glass rounded-lg">
                      <button
                        onClick={() => setExpandedItems(!expandedItems)}
                        className="flex items-center justify-between w-full mb-4"
                      >
                        <div className="flex items-center gap-2">
                          <Package className="w-5 h-5 text-primary-400" />
                          <h3 className="text-lg font-semibold text-gray-200">
                            Articles ({saleDetails.items.length})
                          </h3>
                        </div>
                        {expandedItems ? (
                          <ChevronUp className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        )}
                      </button>

                      <AnimatePresence>
                        {expandedItems && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-2 mt-4">
                              {saleDetails.items.map((item, idx) => (
                                <div
                                  key={item.id || idx}
                                  className="p-3 bg-gray-800/50 rounded-lg flex items-center justify-between"
                                >
                                  <div className="flex-1">
                                    <p className="font-semibold text-gray-200">{item.product_name || item.product_code}</p>
                                    <div className="flex items-center gap-4 text-sm text-gray-400 mt-1">
                                      <span>Code: {item.product_code}</span>
                                      <span>
                                        Qté: {item.qty} {item.qty_label || ''}
                                      </span>
                                      <span>
                                        Unité: {formatUnitLevel(item.unit_level)}
                                      </span>
                                      {item.unit_mark && (
                                        <span className="badge badge-info">{item.unit_mark}</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className="font-semibold text-primary-400">
                                      {item.subtotal_fc?.toLocaleString() || 0} FC
                                    </p>
                                    <p className="text-sm text-gray-400">
                                      {item.unit_price_fc?.toLocaleString() || 0} FC/u
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-700">
                    <button
                      onClick={() => handlePrint(saleDetails.invoice_number)}
                      className="btn btn-primary flex items-center gap-2"
                    >
                      <Printer className="w-5 h-5" />
                      Imprimer
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-gray-400">
                  <p>Impossible de charger les détails de la vente</p>
                  <button onClick={closeModal} className="btn btn-primary mt-4">
                    Fermer
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SalesHistory;
