import { useEffect, useState, useMemo, useCallback, memo, useRef, startTransition } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { Search, Receipt, Printer, Eye, Calendar, ChevronLeft, ChevronRight, Package, X, ChevronDown, ChevronUp, Clock, DollarSign, User, Cloud, CloudOff, CheckCircle, AlertCircle, Trash2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useOfflineSales } from '../hooks/useOfflineFirst';
import { useSmartSales, useWebSocketStatus, getGlobalSocket } from '../hooks/useSmartSync';
import VirtualList from '../components/VirtualList';
import ErrorBoundary from '../components/ErrorBoundary';
import { ToastContainer } from '../components/Toast';
import { useToastNotifications } from '../hooks/useToastNotifications';
import axios from 'axios';
import { format, startOfMonth, endOfMonth, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, parseISO, getHours, getMinutes, isToday, isYesterday, isSameDay } from 'date-fns';
import { fr } from 'date-fns/locale';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

/**
 * Convertit unit_level en texte lisible avec icône
 * unit_level peut être: 'MILLIER', 'CARTON', 'PIECE' (string) ou 1, 2, 3 (number)
 */
const formatUnitLevel = (unitLevel, withIcon = false) => {
  if (!unitLevel) return withIcon ? '📦 Pièce' : 'Pièce';
  
  const normalized = String(unitLevel).toUpperCase().trim();
  
  if (normalized === 'MILLIER' || normalized === '1' || normalized === 'MILLIERS' || normalized === 'DETAIL') {
    return withIcon ? '📦 Millier' : 'Millier';
  }
  if (normalized === 'CARTON' || normalized === '2' || normalized === 'CARTONS') {
    return withIcon ? '🗃️ Carton' : 'Carton';
  }
  if (normalized === 'PIECE' || normalized === '3' || normalized === 'PIÈCE' || normalized === 'PIECES') {
    return withIcon ? '🎯 Pièce' : 'Pièce';
  }
  
  // Fallback: retourner la valeur telle quelle si non reconnue
  return withIcon ? `📦 ${normalized}` : normalized;
};

/**
 * Obtient la couleur CSS pour un type d'unité
 */
const getUnitColor = (unitLevel) => {
  if (!unitLevel) return 'text-gray-400';
  
  const normalized = String(unitLevel).toUpperCase().trim();
  
  if (normalized === 'MILLIER' || normalized === '1' || normalized === 'MILLIERS' || normalized === 'DETAIL') {
    return 'text-amber-400';
  }
  if (normalized === 'CARTON' || normalized === '2' || normalized === 'CARTONS') {
    return 'text-blue-400';
  }
  if (normalized === 'PIECE' || normalized === '3' || normalized === 'PIÈCE' || normalized === 'PIECES') {
    return 'text-green-400';
  }
  
  return 'text-gray-400';
};

/**
 * Obtient les classes CSS de badge pour un type d'unité
 */
const getUnitBadgeClass = (unitLevel) => {
  if (!unitLevel) return 'badge-ghost';
  
  const normalized = String(unitLevel).toUpperCase().trim();
  
  if (normalized === 'MILLIER' || normalized === '1' || normalized === 'MILLIERS' || normalized === 'DETAIL') {
    return 'badge bg-amber-500/20 text-amber-400 border-amber-500/30';
  }
  if (normalized === 'CARTON' || normalized === '2' || normalized === 'CARTONS') {
    return 'badge bg-blue-500/20 text-blue-400 border-blue-500/30';
  }
  if (normalized === 'PIECE' || normalized === '3' || normalized === 'PIÈCE' || normalized === 'PIECES') {
    return 'badge bg-green-500/20 text-green-400 border-green-500/30';
  }
  
  return 'badge-ghost';
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

// Composant de ligne de vente memoizé
const SaleRow = memo(({ sale, index, printStatuses, onSelect, onPrint, onDelete, deleting }) => {
  const printStatus = printStatuses[sale.invoice_number];
  const status = printStatus?.status || 'none';
  const isDeleting = deleting === sale.invoice_number;
  
  return (
    <m.div
      initial={{ opacity: 1, x: 0 }}
      animate={{ opacity: isDeleting ? 0 : 1, x: isDeleting ? 100 : 0 }}
      exit={{ opacity: 0, x: 100 }}
      transition={{ duration: 0.3 }}
      className="p-4 glass rounded-lg hover:bg-white/5 transition-all cursor-pointer"
      onClick={() => !isDeleting && onSelect(sale)}
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
            <span
              className={`badge ${
                sale.synced_at
                  ? 'badge-success'
                  : 'badge-warning'
              }`}
              title={sale.synced_at ? `Synchronisé le ${format(new Date(sale.synced_at), 'dd/MM/yyyy HH:mm', { locale: fr })}` : 'En attente de synchronisation'}
            >
              {sale.synced_at ? (
                <>
                  <Cloud className="w-3 h-3 inline mr-1" />
                  Sync
                </>
              ) : (
                <>
                  <CloudOff className="w-3 h-3 inline mr-1" />
                  Sync
                </>
              )}
            </span>
            <span
              className={`badge ${
                status === 'printed'
                  ? 'badge-success'
                  : status === 'error'
                  ? 'badge-error'
                  : status === 'processing'
                  ? 'badge-info'
                  : 'badge-warning'
              }`}
              title={
                status === 'printed' ? 'Imprimé' :
                status === 'error' ? `Erreur: ${printStatus?.last_error || ''}` :
                status === 'processing' ? 'En cours d\'impression...' :
                'En attente d\'impression'
              }
            >
              {status === 'printed' ? (
                <>
                  <CheckCircle className="w-3 h-3 inline mr-1" />
                  Print
                </>
              ) : status === 'error' ? (
                <>
                  <AlertCircle className="w-3 h-3 inline mr-1" />
                  Print
                </>
              ) : (
                <>
                  <Printer className="w-3 h-3 inline mr-1" />
                  Print
                </>
              )}
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
              onPrint(sale.invoice_number);
            }}
            className="p-2 glass rounded-lg hover:bg-white/10"
            title="Imprimer"
          >
            <Printer className="w-5 h-5 text-gray-400" />
          </button>
          <button
            onClick={(e) => onDelete(sale.invoice_number, e)}
            disabled={deleting === sale.invoice_number}
            className={`p-2 glass rounded-lg transition-colors ${
              deleting === sale.invoice_number 
                ? 'bg-red-900/50 cursor-not-allowed' 
                : 'hover:bg-red-600/30'
            }`}
            title="Supprimer et restaurer le stock"
          >
            <Trash2 className={`w-5 h-5 ${
              deleting === sale.invoice_number 
                ? 'text-red-300 animate-pulse' 
                : 'text-red-400 hover:text-red-300'
            }`} />
          </button>
        </div>
      </div>
    </m.div>
  );
});

SaleRow.displayName = 'SaleRow';

const SalesHistory = () => {
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Par défaut, afficher les ventes d'aujourd'hui
  const today = new Date();
  const [currentDisplayDate, setCurrentDisplayDate] = useState(today);
  const [filterMode, setFilterMode] = useState('day'); // 'day' | 'month' | 'week' | 'all'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchAllMonths, setSearchAllMonths] = useState(false);
  const [selectedSale, setSelectedSale] = useState(null);
  const [saleDetails, setSaleDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [expandedItems, setExpandedItems] = useState(true); // ✅ Ouvert par défaut
  const [printStatuses, setPrintStatuses] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const { toasts, closeToast, error: showError, success: showSuccess, info: showInfo } = useToastNotifications();
  
  // ✅ État de connexion WebSocket pour l'indicateur temps réel
  const { isConnected, reconnecting } = useWebSocketStatus();

  // Calculer les filtres pour useOfflineSales selon le mode
  const filters = useMemo(() => {
    if (searchAllMonths && searchQuery) {
      return { hideDeleted: true }; // Masquer les suppressions par défaut
    }
    
    let fromDate, toDate;
    
    switch (filterMode) {
      case 'day':
        // Filtrer par jour spécifique
        fromDate = format(startOfDay(currentDisplayDate), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        toDate = format(endOfDay(currentDisplayDate), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        break;
      case 'week':
        // Filtrer par semaine
        fromDate = format(startOfWeek(currentDisplayDate, { weekStartsOn: 1 }), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        toDate = format(endOfWeek(currentDisplayDate, { weekStartsOn: 1 }), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        break;
      case 'month':
        // Filtrer par mois
        fromDate = format(startOfMonth(currentDisplayDate), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        toDate = format(endOfMonth(currentDisplayDate), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        break;
      case 'all':
        return { hideDeleted: true, exclude_status: 'pending' };
      default:
        fromDate = format(startOfDay(currentDisplayDate), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        toDate = format(endOfDay(currentDisplayDate), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
    }
    
    return {
      from: fromDate,
      to: toDate,
      exclude_status: 'pending',
      hideDeleted: true,
    };
  }, [currentDisplayDate, filterMode, searchAllMonths, searchQuery]);

  // Utiliser useOfflineSales pour données locales instantanées
  const { data: sales = [], loading, refresh } = useOfflineSales(filters, {
    refetchOnMount: true,
  });

  // ✅ AUTO-ACTUALISATION: Écouter les événements Socket.IO pour nouvelles ventes
  useEffect(() => {
    const socket = getGlobalSocket();
    if (!socket) return;

    const handleSaleCreated = () => {
      console.log('📊 [SalesHistory] Nouvelle vente détectée, rafraîchissement...');
      startTransition(() => {
        refresh();
      });
    };

    const handleSaleDeleted = () => {
      console.log('🗑️ [SalesHistory] Vente supprimée, rafraîchissement...');
      startTransition(() => {
        refresh();
      });
    };

    // Écouter les événements de ventes
    socket.on('sale:created', handleSaleCreated);
    socket.on('sale:finalized', handleSaleCreated);
    socket.on('sale:deleted', handleSaleDeleted);
    socket.on('sales:synced', handleSaleCreated);

    return () => {
      socket.off('sale:created', handleSaleCreated);
      socket.off('sale:finalized', handleSaleCreated);
      socket.off('sale:deleted', handleSaleDeleted);
      socket.off('sales:synced', handleSaleCreated);
    };
  }, [refresh]);

  // Grouper les ventes par (client_name, invoice_number) et limiter à 50
  const uniqueSales = useMemo(() => {
    // IMPORTANT: Filtrer les ventes avec status='pending' (ne pas les afficher)
    let salesToProcess = sales.filter((sale) => sale.status !== 'pending');
    
    // Appliquer le filtre de recherche
    const filtered = searchQuery
      ? salesToProcess.filter(
          (sale) =>
            sale.invoice_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (sale.client_name &&
              sale.client_name.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      : salesToProcess;

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
  }, [sales, searchQuery]);

  // Charger les détails de la vente sélectionnée
  useEffect(() => {
    if (selectedSale) {
      loadSaleDetails(selectedSale.invoice_number);
    }
  }, [selectedSale]);

  // Charger les statuts d'impression pour toutes les ventes (en arrière-plan)
  useEffect(() => {
    if (uniqueSales.length === 0) return;
    
    // Charger les statuts en batch pour éviter trop de requêtes
    const loadPrintStatuses = async () => {
      if (!isMountedRef.current) return;
      const statuses = {};
      const promises = uniqueSales.slice(0, 50).map(async (sale) => {
        try {
          const response = await axios.get(`${API_URL}/api/print/status/${sale.invoice_number}`, {
            timeout: 2000,
          });
          statuses[sale.invoice_number] = response.data;
        } catch {
          statuses[sale.invoice_number] = { status: 'none' };
        }
      });
      
      await Promise.allSettled(promises);

      if (isMountedRef.current) {
        setPrintStatuses(statuses);
      }
    };
    
    // Utiliser requestIdleCallback si disponible pour ne pas bloquer l'UI
    let idleId = null;
    let timeoutId = null;
    if (window.requestIdleCallback) {
      idleId = window.requestIdleCallback(loadPrintStatuses, { timeout: 2000 });
    } else {
      timeoutId = setTimeout(loadPrintStatuses, 100);
    }

    return () => {
      if (idleId != null) window.cancelIdleCallback?.(idleId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [uniqueSales]);

  const loadSaleDetails = async (invoiceNumber) => {
    if (!isMountedRef.current) return;
    setLoadingDetails(true);
    try {
      const response = await axios.get(`${API_URL}/api/sales/${invoiceNumber}`);
      if (isMountedRef.current) {
        setSaleDetails(response.data);
      }
    } catch (error) {
      console.error('Erreur chargement détails:', error);
    } finally {
      if (isMountedRef.current) {
        setLoadingDetails(false);
      }
    }
  };

  // ✅ Navigation selon le mode
  const handlePrevious = useCallback(() => {
    setCurrentDisplayDate(prev => {
      const newDate = new Date(prev);
      if (filterMode === 'day') {
        newDate.setDate(newDate.getDate() - 1);
      } else if (filterMode === 'week') {
        newDate.setDate(newDate.getDate() - 7);
      } else {
        newDate.setMonth(newDate.getMonth() - 1);
      }
      return newDate;
    });
  }, [filterMode]);

  const handleNext = useCallback(() => {
    setCurrentDisplayDate(prev => {
      const newDate = new Date(prev);
      if (filterMode === 'day') {
        newDate.setDate(newDate.getDate() + 1);
      } else if (filterMode === 'week') {
        newDate.setDate(newDate.getDate() + 7);
      } else {
        newDate.setMonth(newDate.getMonth() + 1);
      }
      return newDate;
    });
  }, [filterMode]);

  const handleToday = useCallback(() => {
    setCurrentDisplayDate(new Date());
    setFilterMode('day');
    setSearchAllMonths(false);
  }, []);

  const handleYesterday = useCallback(() => {
    setCurrentDisplayDate(subDays(new Date(), 1));
    setFilterMode('day');
    setSearchAllMonths(false);
  }, []);

  const handleThisWeek = useCallback(() => {
    setCurrentDisplayDate(new Date());
    setFilterMode('week');
    setSearchAllMonths(false);
  }, []);

  const handleThisMonth = useCallback(() => {
    setCurrentDisplayDate(new Date());
    setFilterMode('month');
    setSearchAllMonths(false);
  }, []);

  const handleDateChange = useCallback((e) => {
    const selectedDate = new Date(e.target.value);
    setCurrentDisplayDate(selectedDate);
    setFilterMode('day');
    setSearchAllMonths(false);
    setShowCalendar(false);
  }, []);

  const handleMonthChange = useCallback((e) => {
    const selectedDate = new Date(e.target.value + '-01');
    setCurrentDisplayDate(selectedDate);
    setFilterMode('month');
    setSearchAllMonths(false);
  }, []);

  // ✅ Obtenir le label de la période
  const getPeriodLabel = useCallback(() => {
    if (filterMode === 'all') return 'Toutes les ventes';
    if (filterMode === 'day') {
      if (isToday(currentDisplayDate)) return "Aujourd'hui";
      if (isYesterday(currentDisplayDate)) return 'Hier';
      return format(currentDisplayDate, 'EEEE d MMMM yyyy', { locale: fr });
    }
    if (filterMode === 'week') {
      const start = startOfWeek(currentDisplayDate, { weekStartsOn: 1 });
      const end = endOfWeek(currentDisplayDate, { weekStartsOn: 1 });
      return `Semaine du ${format(start, 'd MMM', { locale: fr })} au ${format(end, 'd MMM yyyy', { locale: fr })}`;
    }
    return format(currentDisplayDate, 'MMMM yyyy', { locale: fr });
  }, [currentDisplayDate, filterMode]);

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

  const closeModal = useCallback(() => {
    setSelectedSale(null);
    setSaleDetails(null);
    setExpandedItems(false);
  }, []);

  const handlePrint = useCallback(async (invoiceNumber) => {
    if (!invoiceNumber) {
      showError('❌ Numéro de facture manquant');
      return;
    }
    
    try {
      console.log(`🖨️ [SalesHistory] Impression demandée: ${invoiceNumber}`);
      
      // ✅ Encoder l'invoiceNumber pour l'URL (caractères spéciaux)
      const encodedInvoice = encodeURIComponent(invoiceNumber);
      const response = await axios.post(`${API_URL}/api/sales/${encodedInvoice}/print`, {
        template: 'receipt-80',
        copies: 1
      }, {
        timeout: 15000 // 15 secondes max
      });
      
      console.log(`✅ [SalesHistory] Réponse impression:`, response.data);
      
      if (response.data.success) {
        showSuccess(`✅ Impression envoyée (${response.data.file || invoiceNumber})`);
        
        // Mettre à jour le statut d'impression localement
        setPrintStatuses(prev => ({
          ...prev,
          [invoiceNumber]: { status: 'processing', timestamp: Date.now() }
        }));
      } else {
        showError(`❌ Erreur: ${response.data.error || 'Erreur inconnue'}`);
      }
    } catch (error) {
      console.error('❌ [SalesHistory] Erreur impression:', error);
      console.error('   Status:', error.response?.status);
      console.error('   Data:', error.response?.data);
      
      const errorMsg = error.response?.data?.error || 
                      error.response?.data?.message ||
                      error.message ||
                      'Erreur inconnue';
      
      if (error.code === 'ECONNABORTED') {
        showError('⏱️ Timeout - Le serveur est trop lent ou injoignable');
      } else if (error.response?.status === 404) {
        showError(`❌ Facture non trouvée: ${invoiceNumber}`);
      } else {
        showError(`❌ Erreur impression: ${errorMsg}`);
      }
    }
  }, [showSuccess, showError]);

  // ✅ Supprimer une vente et restaurer le stock - NON-BLOQUANT pour l'UI
  const handleDeleteSale = useCallback(async (invoiceNumber, e) => {
    e?.stopPropagation();
    
    console.log(`🗑️ [SalesHistory] Demande suppression: "${invoiceNumber}"`);
    
    if (!invoiceNumber) {
      console.error('❌ Invoice number manquant!');
      return;
    }
    
    // Message de confirmation plus détaillé
    const confirmMsg = `🗑️ Supprimer la facture ${invoiceNumber} ?

Cette action va :
• Restaurer le stock de tous les articles
• Synchroniser les modifications avec Google Sheets
• Supprimer définitivement la facture

Continuer ?`;
    
    if (!confirm(confirmMsg)) {
      console.log('   ❌ Suppression annulée par utilisateur');
      return;
    }
    
    // 1. Fermer le modal IMMÉDIATEMENT avant toute opération async
    // Cela libère le backdrop et évite les blocages de pointer-events
    if (selectedSale?.invoice_number === invoiceNumber) {
      closeModal();
    }
    
    // 2. Yield au main thread pour permettre à React de mettre à jour le DOM
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    setDeleting(invoiceNumber);
    
    try {
      // 3. Encoder l'invoice number pour l'URL
      const encodedInvoice = encodeURIComponent(invoiceNumber);
      console.log(`   📤 DELETE ${API_URL}/api/sales/${encodedInvoice}`);
      
      // 4. Appel API (async, ne bloque pas l'UI)
      const response = await axios.delete(`${API_URL}/api/sales/${encodedInvoice}`, {
        timeout: 30000 // 30 secondes max
      });
      
      console.log(`   📥 Réponse:`, response.data);
      
      if (response.data.success) {
        // Log détaillé des restaurations de stock
        if (response.data.stockRestored && response.data.stockRestored.length > 0) {
          console.log(`✅ Facture supprimée, stock restauré:`);
          response.data.stockRestored.forEach((item) => {
            console.log(`   📦 ${item.product_code}: +${item.qty} ${formatUnitLevel(item.unit_level)} (→ ${item.stock_after})`);
          });
        } else {
          console.log(`✅ Facture supprimée (aucun stock à restaurer)`);
        }
        
        // Afficher succès via Toast
        const restoredCount = response.data.stockRestored?.length || 0;
        if (restoredCount > 0) {
          showSuccess(`✅ Facture supprimée - ${restoredCount} produit(s) restauré(s)`);
        } else {
          showSuccess(`✅ Facture supprimée avec succès`);
        }
        
        // ✅ PRO FIX: Libérer l'état de suppression IMMÉDIATEMENT
        setDeleting(null);
        
        // ✅ PRO: Invalider le cache de façon non-bloquante
        setTimeout(() => {
          const filtersKey = JSON.stringify(filters);
          try {
            localStorage.removeItem(`offline_cache_sales_${filtersKey}`);
            console.log('🗑️ Cache ventes invalidé');
          } catch (err) {
            console.warn('⚠️ Impossible d\'invalider cache:', err.message);
          }
        }, 0);
        
        // ✅ PRO FIX CRITIQUE: Utiliser startTransition de React 18 pour le refresh
        // startTransition marque l'update comme "non-urgente" → les inputs restent réactifs
        // C'est LA solution React officielle pour les updates qui ne doivent pas bloquer l'UI
        const doNonBlockingRefresh = () => {
          startTransition(() => {
            refresh().catch(err => {
              console.warn('⚠️ Refresh warning:', err.message);
            });
          });
        };
        
        // ✅ Double yield: d'abord libérer le thread, puis refresh en transition
        // 1) setTimeout(0) libère le thread principal pour les inputs
        // 2) startTransition évite le blocage pendant le re-render
        setTimeout(doNonBlockingRefresh, 16); // 1 frame (~16ms)
        
        console.log(`✅ Vente ${invoiceNumber} supprimée - refresh startTransition programmé`);
        return; // Sortir tôt, finally ne mettra pas deleting à null (déjà fait)
      } else {
        console.error('❌ Erreur serveur:', response.data.error);
        showError(`Erreur: ${response.data.error || 'Erreur inconnue'}`);
      }
    } catch (error) {
      console.error('❌ Erreur suppression:', error);
      console.error('   Status:', error.response?.status);
      console.error('   Data:', error.response?.data);
      
      // Ne pas bloquer avec alert si erreur réseau simple
      const errorMsg = error.response?.data?.error || 
                      error.response?.data?.message ||
                      error.message ||
                      'Erreur inconnue';
      
      // Si timeout ou connexion, message simplifié
      if (error.code === 'ECONNABORTED') {
        showError('⏱️ Timeout - serveur lent ou injoignable');
      } else {
        showError(`Erreur suppression: ${errorMsg}`);
      }
    } finally {
      // Seulement si on n'a pas déjà libéré (cas d'erreur)
      setDeleting(prev => prev === invoiceNumber ? null : prev);
    }
  }, [refresh, selectedSale, closeModal, filters, showSuccess, showError]);

  const handleSaleClick = useCallback((sale) => {
    setSelectedSale(sale);
    setExpandedItems(false);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Historique des ventes</h1>
        <p className="text-gray-400 flex items-center gap-2 flex-wrap">
          <span>Consultez toutes vos factures</span>
          {/* ✅ Indicateur de synchronisation temps réel */}
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
            isConnected 
              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
              : reconnecting 
              ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 animate-pulse' 
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3" />
                <span>Sync auto</span>
              </>
            ) : reconnecting ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Reconnexion...</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" />
                <span>Hors ligne</span>
              </>
            )}
          </span>
        </p>
      </div>

      {/* ✅ FILTRES DE DATE PRO */}
      <div className="card space-y-4">
        {/* Boutons de raccourci rapide */}
        <div className="flex flex-wrap gap-2 pb-4 border-b border-gray-700">
          <m.button
            onClick={handleToday}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
              filterMode === 'day' && isToday(currentDisplayDate)
                ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/25'
                : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10'
            }`}
          >
            <Clock className="w-4 h-4" />
            Aujourd'hui
          </m.button>
          
          <m.button
            onClick={handleYesterday}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
              filterMode === 'day' && isYesterday(currentDisplayDate)
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/25'
                : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Hier
          </m.button>
          
          <m.button
            onClick={handleThisWeek}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
              filterMode === 'week'
                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25'
                : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Cette semaine
          </m.button>
          
          <m.button
            onClick={handleThisMonth}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
              filterMode === 'month'
                ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg shadow-purple-500/25'
                : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Ce mois
          </m.button>
          
          <m.button
            onClick={() => { setFilterMode('all'); setSearchAllMonths(true); }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
              filterMode === 'all'
                ? 'bg-gradient-to-r from-gray-500 to-gray-600 text-white shadow-lg'
                : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10'
            }`}
          >
            <Receipt className="w-4 h-4" />
            Tout
          </m.button>
        </div>

        {/* Navigation de période avec calendrier */}
        <div className="flex justify-between items-center">
          <m.button 
            onClick={handlePrevious}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-3 glass rounded-xl hover:bg-white/10 transition-all border border-white/10"
            title="Période précédente"
            disabled={filterMode === 'all'}
          >
            <ChevronLeft className={`w-5 h-5 ${filterMode === 'all' ? 'text-gray-600' : 'text-gray-300'}`} />
          </m.button>
          
          <div className="flex flex-col items-center gap-3">
            <m.div 
              className="flex items-center gap-3 px-6 py-3 glass rounded-2xl border border-white/10 cursor-pointer hover:bg-white/5 transition-all"
              onClick={() => setShowCalendar(!showCalendar)}
              whileHover={{ scale: 1.02 }}
            >
              <Calendar className="w-6 h-6 text-primary-400" />
              <h2 className="text-xl font-bold text-gray-100 capitalize">
                {getPeriodLabel()}
              </h2>
              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showCalendar ? 'rotate-180' : ''}`} />
            </m.div>
            
            {/* Calendrier déroulant */}
            <AnimatePresence>
              {showCalendar && (
                <m.div
                  initial={{ opacity: 0, y: -10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                  className="flex flex-wrap gap-2 justify-center"
                >
                  <input
                    type="date"
                    value={format(currentDisplayDate, 'yyyy-MM-dd')}
                    onChange={handleDateChange}
                    className="input-field text-sm px-4 py-2 rounded-xl"
                    title="Choisir une date"
                  />
                  <input
                    type="month"
                    value={format(currentDisplayDate, 'yyyy-MM')}
                    onChange={handleMonthChange}
                    className="input-field text-sm px-4 py-2 rounded-xl"
                    title="Choisir un mois"
                  />
                </m.div>
              )}
            </AnimatePresence>
          </div>
          
          <m.button 
            onClick={handleNext}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-3 glass rounded-xl hover:bg-white/10 transition-all border border-white/10"
            title="Période suivante"
            disabled={filterMode === 'all'}
          >
            <ChevronRight className={`w-5 h-5 ${filterMode === 'all' ? 'text-gray-600' : 'text-gray-300'}`} />
          </m.button>
        </div>

        {/* ✅ Statistiques améliorées */}
        {!loading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-gray-700">
            <m.div 
              className="text-center p-4 glass rounded-xl border border-white/5"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Receipt className="w-6 h-6 text-primary-400 mx-auto mb-2" />
              <p className="text-3xl font-bold text-primary-400">{monthStats.count}</p>
              <p className="text-xs text-gray-400 mt-1">Ventes</p>
            </m.div>
            <m.div 
              className="text-center p-4 glass rounded-xl border border-white/5"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <DollarSign className="w-6 h-6 text-green-400 mx-auto mb-2" />
              <p className="text-3xl font-bold text-green-400">{monthStats.total.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">FC Total</p>
            </m.div>
            <m.div 
              className="text-center p-4 glass rounded-xl border border-white/5"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Package className="w-6 h-6 text-blue-400 mx-auto mb-2" />
              <p className="text-3xl font-bold text-blue-400">
                {uniqueSales.reduce((sum, s) => sum + (s.items?.length || 0), 0)}
              </p>
              <p className="text-xs text-gray-400 mt-1">Articles</p>
            </m.div>
            <m.div 
              className="text-center p-4 glass rounded-xl border border-white/5"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <User className="w-6 h-6 text-amber-400 mx-auto mb-2" />
              <p className="text-3xl font-bold text-amber-400">
                {monthStats.count > 0 ? Math.round(monthStats.total / monthStats.count).toLocaleString() : 0}
              </p>
              <p className="text-xs text-gray-400 mt-1">Moyenne FC</p>
            </m.div>
          </div>
        )}

        {/* ✅ Recherche améliorée */}
        <div className="space-y-2 pt-4 border-t border-gray-700">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              id="sales-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Rechercher facture, client..."
              className="input-field pl-12 py-3 text-lg rounded-xl"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 hover:bg-white/10 rounded-full"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Liste des ventes */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <m.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"
            />
            <p className="mt-4 text-gray-400">Chargement des ventes...</p>
          </div>
        ) : uniqueSales.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
              <p className="text-sm text-gray-400">
                Affichage de <span className="font-semibold text-gray-200">{uniqueSales.length}</span> vente(s) unique(s)
                {searchAllMonths ? ' (toutes périodes)' : ` pour ${format(currentDisplayDate, 'MMMM yyyy', { locale: fr })}`}
              </p>
              {uniqueSales.length === 50 && (
                <p className="text-xs text-gray-500">Limité aux 50 plus récentes</p>
              )}
            </div>
            <VirtualList
              items={uniqueSales}
              itemHeight={120}
              containerHeight={600}
              renderItem={(sale, index) => (
                <SaleRow
                  key={`${sale.client_name}_${sale.invoice_number}_${sale.id}`}
                  sale={sale}
                  index={index}
                  printStatuses={printStatuses}
                  onSelect={handleSaleClick}
                  onPrint={handlePrint}
                  onDelete={handleDeleteSale}
                  deleting={deleting}
                />
              )}
              keyExtractor={(sale) => `${sale.client_name}_${sale.invoice_number}_${sale.id}`}
              overscan={5}
            />
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

      {/* Modal de détails - FIXED: pointer-events properly handled */}
      <AnimatePresence mode="wait">
        {selectedSale && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={closeModal}
            style={{ 
              // CRITICAL: Ensure pointer-events are properly handled
              pointerEvents: 'auto',
              willChange: 'opacity'
            }}
          >
            <m.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ 
                duration: 0.25, 
                ease: [0.25, 0.1, 0.25, 1],
                // Ensure exit animation is fast enough
                exit: { duration: 0.15 }
              }}
              className="bg-gray-900 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
              style={{ pointerEvents: 'auto' }}
            >
              {loadingDetails ? (
                <div className="p-8 text-center">
                  <m.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-16 h-16 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"
                  />
                  <p className="mt-4 text-gray-400 text-lg">Chargement des détails...</p>
                </div>
              ) : saleDetails ? (
                <div className="p-0 space-y-0">
                  {/* ✅ HEADER PRO avec gradient */}
                  <div className="bg-gradient-to-r from-primary-600/30 via-primary-500/20 to-transparent p-6 border-b border-white/10">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4">
                        <m.div 
                          className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/30"
                          initial={{ scale: 0, rotate: -180 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                        >
                          <Receipt className="w-8 h-8 text-white" />
                        </m.div>
                        <div>
                          <m.h2 
                            className="text-2xl font-bold text-white"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.1 }}
                          >
                            {saleDetails.client_name || 'Client'}
                          </m.h2>
                          <m.div 
                            className="flex items-center gap-3 mt-1"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.2 }}
                          >
                            <span className="px-3 py-1 bg-white/10 rounded-full text-sm font-mono text-primary-300">
                              #{saleDetails.invoice_number}
                            </span>
                            <span className="text-gray-400 text-sm">
                              {format(new Date(saleDetails.sold_at), 'dd MMM yyyy • HH:mm', { locale: fr })}
                            </span>
                          </m.div>
                        </div>
                      </div>
                      <m.button
                        onClick={closeModal}
                        whileHover={{ scale: 1.1, rotate: 90 }}
                        whileTap={{ scale: 0.9 }}
                        className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all"
                      >
                        <X className="w-6 h-6 text-white" />
                      </m.button>
                    </div>
                    
                    {/* ✅ Total en grand */}
                    <m.div 
                      className="mt-4 flex items-baseline gap-3"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                    >
                      <span className="text-4xl font-black text-white">
                        {saleDetails.total_fc?.toLocaleString() || 0}
                      </span>
                      <span className="text-xl text-primary-300 font-semibold">FC</span>
                      {saleDetails.total_usd && (
                        <span className="text-lg text-gray-400 ml-2">
                          (${saleDetails.total_usd.toFixed(2)} USD)
                        </span>
                      )}
                    </m.div>
                  </div>

                  <div className="p-6 space-y-6">
                    {/* ✅ Informations en grille PRO */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <m.div 
                        className="p-4 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/20"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                      >
                        <User className="w-5 h-5 text-blue-400 mb-2" />
                        <p className="text-xs text-gray-400">Client</p>
                        <p className="text-sm font-semibold text-white truncate">{saleDetails.client_name || '-'}</p>
                      </m.div>
                      
                      <m.div 
                        className="p-4 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/20"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                      >
                        <Clock className="w-5 h-5 text-purple-400 mb-2" />
                        <p className="text-xs text-gray-400">Heure</p>
                        <p className="text-sm font-semibold text-white">
                          {format(new Date(saleDetails.sold_at), 'HH:mm', { locale: fr })}
                        </p>
                      </m.div>
                      
                      <m.div 
                        className="p-4 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                      >
                        <Package className="w-5 h-5 text-amber-400 mb-2" />
                        <p className="text-xs text-gray-400">Articles</p>
                        <p className="text-sm font-semibold text-white">{saleDetails.items?.length || 0} produit(s)</p>
                      </m.div>
                      
                      {saleDetails.seller_name && !isUnitValue(saleDetails.seller_name) && (
                        <m.div 
                          className="p-4 rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-500/20"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.25 }}
                        >
                          <User className="w-5 h-5 text-green-400 mb-2" />
                          <p className="text-xs text-gray-400">Vendeur</p>
                          <p className="text-sm font-semibold text-white truncate">{saleDetails.seller_name}</p>
                        </m.div>
                      )}
                    </div>

                  {/* Articles (repliables) - PRO UI avec animations staggered */}
                  {saleDetails.items && saleDetails.items.length > 0 && (
                    <div className="p-4 glass rounded-xl border border-white/5 bg-gradient-to-br from-gray-800/50 to-gray-900/50">
                      <m.button
                        onClick={() => setExpandedItems(!expandedItems)}
                        className="flex items-center justify-between w-full mb-3 p-2 rounded-lg hover:bg-white/5 transition-all group"
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary-500/20 border border-primary-500/30 group-hover:bg-primary-500/30 transition-colors">
                            <Package className="w-5 h-5 text-primary-400" />
                          </div>
                          <div className="text-left">
                            <h3 className="text-lg font-bold text-gray-100">
                              Articles
                            </h3>
                            <p className="text-xs text-gray-400">
                              {saleDetails.items.length} produit{saleDetails.items.length > 1 ? 's' : ''} • Cliquer pour {expandedItems ? 'réduire' : 'détailler'}
                            </p>
                          </div>
                        </div>
                        <m.div
                          animate={{ rotate: expandedItems ? 180 : 0 }}
                          transition={{ duration: 0.2 }}
                          className="p-2 rounded-full bg-white/5 group-hover:bg-white/10 transition-colors"
                        >
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        </m.div>
                      </m.button>
                      
                      {/* Résumé par unité - Design amélioré */}
                      {(() => {
                        const unitSummary = saleDetails.items.reduce((acc, item) => {
                          const unitKey = formatUnitLevel(item.unit_level);
                          if (!acc[unitKey]) {
                            acc[unitKey] = { qty: 0, total: 0, unitLevel: item.unit_level };
                          }
                          acc[unitKey].qty += item.qty || 0;
                          acc[unitKey].total += item.subtotal_fc || 0;
                          return acc;
                        }, {});
                        
                        return (
                          <div className="flex flex-wrap gap-2 mb-3 px-2">
                            {Object.entries(unitSummary).map(([unit, data], idx) => (
                              <m.span 
                                key={unit} 
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: idx * 0.05 }}
                                className={`${getUnitBadgeClass(data.unitLevel)} px-3 py-1.5 rounded-lg font-semibold shadow-sm`}
                              >
                                <span className="text-lg font-bold">{data.qty}</span>
                                <span className="ml-1 opacity-80">{unit}</span>
                              </m.span>
                            ))}
                          </div>
                        );
                      })()}

                      <AnimatePresence mode="wait">
                        {expandedItems && (
                          <m.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-2 mt-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                              {saleDetails.items.map((item, idx) => (
                                <m.div
                                  key={item.id || idx}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ 
                                    delay: idx * 0.03, 
                                    duration: 0.2,
                                    ease: [0.25, 0.1, 0.25, 1]
                                  }}
                                  className="p-4 bg-gradient-to-r from-gray-800/80 to-gray-800/40 rounded-xl border border-white/5 flex items-center justify-between hover:border-primary-500/30 hover:from-gray-800/90 transition-all group"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="font-bold text-gray-100 text-base truncate">
                                        {item.product_name || item.product_code}
                                      </p>
                                      <span className={`${getUnitBadgeClass(item.unit_level)} px-2 py-0.5 text-xs font-semibold`}>
                                        {formatUnitLevel(item.unit_level)}
                                      </span>
                                      {item.unit_mark && item.unit_mark !== formatUnitLevel(item.unit_level) && (
                                        <span className="badge badge-ghost text-xs px-2 py-0.5">{item.unit_mark}</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-4 text-sm mt-1.5">
                                      <span className="font-mono text-gray-500 text-xs">#{item.product_code}</span>
                                      <span className={`font-bold ${getUnitColor(item.unit_level)} text-base`}>
                                        × {item.qty}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-right ml-4 flex-shrink-0">
                                    <p className="font-bold text-primary-400 text-lg">
                                      {item.subtotal_fc?.toLocaleString() || 0} <span className="text-sm opacity-70">FC</span>
                                    </p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                      @ {item.unit_price_fc?.toLocaleString() || 0} FC/unité
                                    </p>
                                  </div>
                                </m.div>
                              ))}
                            </div>
                          </m.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* ✅ Actions PRO avec animations */}
                  <div className="flex items-center justify-between pt-6 border-t border-gray-700/50 mt-6">
                    <m.button
                      onClick={() => handleDeleteSale(saleDetails.invoice_number)}
                      disabled={deleting === saleDetails.invoice_number}
                      whileHover={{ scale: deleting === saleDetails.invoice_number ? 1 : 1.02 }}
                      whileTap={{ scale: deleting === saleDetails.invoice_number ? 1 : 0.98 }}
                      className={`flex items-center gap-3 px-5 py-3 rounded-xl font-semibold transition-all ${
                        deleting === saleDetails.invoice_number 
                          ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
                          : 'bg-gradient-to-r from-red-600/20 to-red-500/10 border border-red-500/30 text-red-400 hover:from-red-600/30 hover:to-red-500/20 hover:border-red-500/50 hover:shadow-lg hover:shadow-red-500/10'
                      }`}
                      title="Supprimer et restaurer le stock"
                    >
                      {deleting === saleDetails.invoice_number ? (
                        <m.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                          className="w-5 h-5 border-2 border-red-400 border-t-transparent rounded-full"
                        />
                      ) : (
                        <Trash2 className="w-5 h-5" />
                      )}
                      <span>{deleting === saleDetails.invoice_number ? 'Suppression...' : 'Supprimer la facture'}</span>
                    </m.button>
                    
                    <m.button
                      onClick={() => handlePrint(saleDetails.invoice_number)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="flex items-center gap-3 px-6 py-3 rounded-xl font-semibold bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30 transition-all"
                    >
                      <Printer className="w-5 h-5" />
                      <span>Imprimer</span>
                    </m.button>
                  </div>
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
            </m.div>
          </m.div>
        )}
      </AnimatePresence>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onCloseToast={closeToast} />
    </div>
  );
};

export default function SalesHistoryWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <SalesHistory />
    </ErrorBoundary>
  );
}
