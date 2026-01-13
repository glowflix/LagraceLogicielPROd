import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'framer-motion';
import { 
  User, 
  UserPlus, 
  Edit, 
  Shield, 
  Phone, 
  Smartphone, 
  CheckCircle2,
  XCircle,
  Calendar,
  Loader2,
  Save,
  X,
  Check,
  Plus,
  ToggleLeft,
  ToggleRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Package,
  ShoppingCart,
  Database,
  Key,
  Hash,
  Ban,
  Lock
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { isUserAdmin, getUserRole, hasPermission, PERMISSIONS } from '../utils/permissions';
import axios from 'axios';
import { format, parseISO, isValid } from 'date-fns';

// En mode proxy Vite, utiliser des chemins relatifs pour compatibilité LAN
const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

// Fonction robuste pour vérifier si un utilisateur est admin (compatible Electron)
const isAdminUser = (u) => {
  if (!u) return false;
  const admin = u.is_admin;
  return admin === 1 || admin === true || admin === '1' || admin === 'true';
};

const UsersPage = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileUser, setProfileUser] = useState(null);
  const [editingField, setEditingField] = useState(null); // { userId, field }
  const [editingValue, setEditingValue] = useState('');
  const [saving, setSaving] = useState(new Set()); // IDs des utilisateurs en cours de sauvegarde
  const [avatarErrorIds, setAvatarErrorIds] = useState(() => new Set()); // IDs des avatars en erreur
  // État pour le zoom et pan de l'image dans le modal
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef(null);
  const viewerRef = useRef(null);
  const [newUserForm, setNewUserForm] = useState({
    username: '',
    password: '',
    phone: '',
    is_admin: false,
    is_active: true,
    is_vendeur: true,
    is_gerant_stock: false,
    can_manage_products: false,
    device_brand: '',
    profile_url: '',
    expo_push_token: '',
  });
  const [editForm, setEditForm] = useState({
    username: '',
    password: '',
    phone: '',
    is_admin: false,
    is_active: true,
    is_vendeur: true,
    is_gerant_stock: false,
    can_manage_products: false,
    device_brand: '',
    profile_url: '',
    expo_push_token: '',
  });
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  // ✅ Récupérer user ET token depuis le store
  const { user: currentUser, token } = useStore();
  const saveTimeoutRef = useRef(null);
  const pendingSavesRef = useRef(new Map());

  // Vérifier si l'utilisateur actuel est admin
  const isCurrentUserAdmin = useMemo(() => {
    return isUserAdmin(currentUser);
  }, [currentUser]);

  // ✅ MODE LICENSE: Détection si connecté avec license (pas de compte utilisateur)
  // En mode license = accès COMPLET à tout
  const isLicenseMode = useMemo(() => {
    // Si pas de currentUser ou pas d'ID = mode license
    return !currentUser || !currentUser.id;
  }, [currentUser]);

  // Vérifier les permissions de l'utilisateur
  const userRole = useMemo(() => getUserRole(currentUser), [currentUser]);
  const canManageUsers = useMemo(() => isLicenseMode || hasPermission(userRole, PERMISSIONS.MANAGE_USERS), [userRole, isLicenseMode]);
  const canManageUsersSelf = useMemo(() => isLicenseMode || hasPermission(userRole, PERMISSIONS.MANAGE_USERS_SELF), [userRole, isLicenseMode]);
  const canManageUsersAll = useMemo(() => isLicenseMode || hasPermission(userRole, PERMISSIONS.MANAGE_USERS_ALL), [userRole, isLicenseMode]);
  const canToggleAdmin = useMemo(() => isLicenseMode || hasPermission(userRole, PERMISSIONS.TOGGLE_ADMIN), [userRole, isLicenseMode]);

  // Charger les utilisateurs
  useEffect(() => {
    loadUsers();
    const interval = setInterval(() => {
      loadUsers();
    }, 30000); // 30 secondes
    
    return () => clearInterval(interval);
  }, []);

  // Debug: Surveiller l'état du modal (désactivé en production)
  // useEffect(() => {
  //   console.log('🔍 [DEBUG] État du modal changé:', showProfileModal, profileUser?.username);
  // }, [showProfileModal, profileUser]);

  // ✅ PRO: Timeout court de 2s
  const loadUsers = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/users`, { timeout: 2000 });
      setUsers(response.data || []);
    } catch (error) {
      // Silencieux - garder les données actuelles
    } finally {
      setLoading(false);
    }
  }, []);

  // Formater la date
  const formatDateFromSheets = useCallback((dateString) => {
    if (!dateString) return 'Date inconnue';
    
    try {
      let date = parseISO(dateString);
      if (isValid(date)) {
        return format(date, 'dd MMM yyyy');
      }
      date = new Date(dateString);
      if (isValid(date)) {
        return format(date, 'dd MMM yyyy');
      }
      return 'Date invalide';
    } catch (error) {
      return 'Date invalide';
    }
  }, []);

  // Sauvegarder avec debounce (auto-save immédiat)
  const saveFieldChange = useCallback(async (userId, field, value) => {
    // Annuler la sauvegarde précédente si elle existe
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Stocker la modification en attente
    const key = `${userId}-${field}`;
    pendingSavesRef.current.set(key, { userId, field, value });

    // Mettre à jour l'état local immédiatement pour un feedback instantané
    setUsers(prevUsers => 
      prevUsers.map(u => 
        u.id === userId ? { ...u, [field]: value } : u
      )
    );

    // Débouncer la sauvegarde (500ms pour être plus rapide)
    saveTimeoutRef.current = setTimeout(async () => {
      const pendingSave = pendingSavesRef.current.get(key);
      if (!pendingSave) return;

      try {
        setSaving(prev => new Set(prev).add(userId));
        // ✅ Utiliser le token depuis le store (pas localStorage)
        const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

        // Préparer les données de mise à jour
        const updateData = field === 'password' 
          ? { password: value }
          : { [field]: value };

        await axios.put(
          `${API_URL}/api/users/${userId}`,
          updateData,
          config
        );

        // La synchronisation avec Sheets se fait automatiquement via l'outbox dans le backend
        pendingSavesRef.current.delete(key);
      } catch (error) {
        console.error(`Erreur sauvegarde ${field}:`, error);
        // Revenir à la valeur précédente en cas d'erreur
        loadUsers();
        alert(error.response?.data?.error || `Erreur lors de la sauvegarde du ${field}`);
      } finally {
        setSaving(prev => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
    }, 500); // 500ms au lieu de 1000ms pour être plus rapide
  }, []);

  // Toggle pour is_admin et is_active
  const handleToggle = useCallback(async (userId, field) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    // ✅ Protection: is_admin ne peut être modifié que par OWNER
    if (field === 'is_admin' && !canToggleAdmin) {
      alert('⚠️ Seul le créateur peut changer le statut administrateur');
      return;
    }

    // ✅ Protection: Peut modifier is_active seulement sur son propre compte OU si admin/owner
    if (field === 'is_active' && userId !== currentUser?.id && !canManageUsersAll) {
      alert('⚠️ Vous ne pouvez changer le statut que de votre propre compte');
      return;
    }
    
    const newValue = !(user[field] === 1 || user[field] === true);
    await saveFieldChange(userId, field, newValue);
  }, [users, saveFieldChange, canToggleAdmin, canManageUsersAll, currentUser?.id]);

  // Édition inline
  const handleInlineEdit = (user, field) => {
    // Vérifier si l'utilisateur actuel peut éditer ce compte
    if (!canEditUser(user)) {
      const isOwnAccount = currentUser?.id === user.id;
      const message = isOwnAccount 
        ? '⚠️ Vous n\'avez pas la permission de modifier votre propre compte'
        : '⚠️ Vous n\'avez pas la permission de modifier les autres comptes. Vous pouvez seulement modifier votre propre compte.';
      alert(message);
      return;
    }
    setEditingField({ userId: user.id, field });
    if (field === 'password') {
      setEditingValue('');
    } else {
      setEditingValue(user[field] || '');
    }
  };
  
  // Vérifier si l'utilisateur peut modifier un autre utilisateur
  // ✅ Règles PRO:
  // 1. MODE LICENSE = ACCÈS COMPLET (peut tout modifier)
  // 2. Chacun peut modifier son propre compte (si MANAGE_USERS_SELF = true)
  // 3. ADMIN/OWNER peuvent modifier les autres comptes (si MANAGE_USERS_ALL = true)
  const canEditUser = useCallback((user) => {
    // ✅ Mode license = ACCÈS COMPLET à tous les comptes
    if (isLicenseMode) {
      return true;
    }
    // Cas 1: Modifier son propre compte = AUTORISÉ si permission MANAGE_USERS_SELF
    if (currentUser?.id === user.id) {
      return canManageUsersSelf;
    }
    // Cas 2: Modifier un AUTRE compte = AUTORISÉ seulement si MANAGE_USERS_ALL
    return canManageUsersAll;
  }, [currentUser?.id, canManageUsersSelf, canManageUsersAll, isLicenseMode]);

  const handleInlineSave = useCallback((userId, field) => {
    if (field === 'password' && !editingValue.trim()) {
      setEditingField(null);
      setEditingValue('');
      return;
    }
    saveFieldChange(userId, field, editingValue);
    setEditingField(null);
    setEditingValue('');
  }, [editingValue, saveFieldChange]);

  const handleInlineCancel = () => {
    setEditingField(null);
    setEditingValue('');
  };


  // État pour afficher les infos de connexion après création
  const [createdUserInfo, setCreatedUserInfo] = useState(null);

  // Créer un nouvel utilisateur
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUserForm.username || !newUserForm.password) {
      alert('Le nom d\'utilisateur et le mot de passe sont requis');
      return;
    }

    try {
      setCreating(true);
      // ✅ Utiliser le token depuis le store (pas localStorage)
      const config = {
        headers: { Authorization: `Bearer ${token}` },
      };

      const response = await axios.post(`${API_URL}/api/users`, newUserForm, config);
      const createdUser = response.data?.user;

      // Stocker les infos pour affichage
      setCreatedUserInfo({
        username: newUserForm.username,
        password: newUserForm.password,
        phone: newUserForm.phone || 'Non renseigné',
        uuid: createdUser?.uuid || 'Auto-généré',
        is_vendeur: newUserForm.is_vendeur,
        is_gerant_stock: newUserForm.is_gerant_stock,
        can_manage_products: newUserForm.can_manage_products,
      });

      // Réinitialiser le formulaire
      setNewUserForm({
        username: '',
        password: '',
        phone: '',
        is_admin: false,
        is_active: true,
        is_vendeur: true,
        is_gerant_stock: false,
        can_manage_products: false,
        device_brand: '',
        profile_url: '',
        expo_push_token: '',
      });
      setShowCreateForm(false);
      
      // Recharger les utilisateurs
      await loadUsers();
    } catch (error) {
      console.error('Erreur création utilisateur:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Erreur lors de la création de l\'utilisateur';
      alert(`❌ ${errorMessage}`);
    } finally {
      setCreating(false);
    }
  };

  // Fermer le modal d'infos de connexion
  const closeCreatedUserInfo = () => {
    setCreatedUserInfo(null);
  };

  // Convertir URL Google Drive - Utilise lh3.googleusercontent.com pour éviter CORS
  const convertGoogleDriveUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    
    // Si c'est déjà une URL lh3, la retourner telle quelle
    if (url.includes('lh3.googleusercontent.com')) {
      return url;
    }
    
    // Extraire le file ID de différentes formes d'URL Google Drive
    let fileId = null;
    
    // Format: https://drive.google.com/file/d/FILE_ID/view
    const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) {
      fileId = fileMatch[1];
    }
    
    // Format: https://drive.google.com/uc?id=FILE_ID
    if (!fileId) {
      const ucMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (ucMatch) {
        fileId = ucMatch[1];
      }
    }
    
    // Format: https://drive.google.com/open?id=FILE_ID
    if (!fileId) {
      const openMatch = url.match(/open\?id=([a-zA-Z0-9_-]+)/);
      if (openMatch) {
        fileId = openMatch[1];
      }
    }
    
    // Format: /d/FILE_ID
    if (!fileId) {
      const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (dMatch) {
        fileId = dMatch[1];
      }
    }
    
    // Si on a un file ID, utiliser lh3.googleusercontent.com (pas de CORS)
    if (fileId) {
      return `https://lh3.googleusercontent.com/d/${fileId}`;
    }
    
    // Si c'est déjà une URL valide, la retourner
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    return null;
  };

  const getProfileImage = useCallback((user) => {
    if (!user || !user.devices) return null;
    
    // Trouver le device avec une profile_url, sinon prendre le premier
    const device = user.devices.length > 0 
      ? user.devices.find(d => d.profile_url) || user.devices[0]
      : null;
    
    if (device?.profile_url) {
      const convertedUrl = convertGoogleDriveUrl(device.profile_url);
      return convertedUrl;
    }
    return null;
  }, []);

  // Fonctions pour le modal de profil avec zoom/pan et édition
  const openProfileModal = useCallback((user) => {
    const latestDevice = user.devices && user.devices.length > 0 
      ? user.devices[user.devices.length - 1] 
      : null;
    
    setProfileUser(user);
    const allTokens = user.devices?.map(d => d.expo_push_token).filter(Boolean).join('|') || '';
    setEditForm({
      username: user.username || '',
      password: '',
      phone: user.phone || '',
      is_admin: user.is_admin === 1 || user.is_admin === true,
      is_active: user.is_active === 1 || user.is_active === true,
      is_vendeur: user.is_vendeur !== undefined ? (user.is_vendeur === 1 || user.is_vendeur === true) : true,
      is_gerant_stock: user.is_gerant_stock === 1 || user.is_gerant_stock === true,
      can_manage_products: user.can_manage_products === 1 || user.can_manage_products === true,
      device_brand: latestDevice?.device_brand || '',
      profile_url: latestDevice?.profile_url || '',
      expo_push_token: allTokens,
    });
    setShowProfileModal(true);
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
  }, []);

  const closeProfileModal = useCallback(() => {
    setShowProfileModal(false);
    setProfileUser(null);
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
  }, []);

  // Sauvegarder depuis le modal de profil
  const handleSaveFromProfileModal = async (e) => {
    e.preventDefault();
    if (!profileUser) return;

    try {
      setUpdating(true);
      // ✅ Utiliser le token depuis le store (pas localStorage)
      const config = {
        headers: { Authorization: `Bearer ${token}` },
      };

      const updateData = { ...editForm };
      
      // Ne pas envoyer le mot de passe s'il est vide
      if (!updateData.password || updateData.password.trim() === '') {
        delete updateData.password;
      }
      
      // Ne pas modifier profile_url car géré automatiquement par l'app Android
      // L'URL sera mise à jour automatiquement quand l'utilisateur change sa photo dans l'app
      delete updateData.profile_url;

      await axios.put(
        `${API_URL}/api/users/${profileUser.id}`,
        updateData,
        config
      );

      closeProfileModal();
      await loadUsers();
      alert('✅ Modifications enregistrées avec succès !');
    } catch (error) {
      console.error('Erreur mise à jour utilisateur:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Erreur lors de la mise à jour de l\'utilisateur';
      alert(`❌ ${errorMessage}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleZoomIn = useCallback(() => {
    setImageZoom(prev => Math.min(prev + 0.2, 6));
  }, []);

  const handleZoomOut = useCallback(() => {
    setImageZoom(prev => Math.max(prev - 0.2, 1));
  }, []);

  const handleZoomReset = useCallback(() => {
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    setImageZoom(prev => {
      const newZoom = Math.max(1, Math.min(6, prev + (delta < 0 ? 0.15 : -0.15)));
      return newZoom;
    });
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (imageZoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ 
      x: e.clientX - imagePan.x, 
      y: e.clientY - imagePan.y 
    });
  }, [imageZoom, imagePan]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || imageZoom <= 1) return;
    e.preventDefault();
    setImagePan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  }, [isDragging, dragStart, imageZoom]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  const handleDoubleClick = useCallback(() => {
    if (imageZoom === 1) {
      setImageZoom(2);
    } else {
      setImageZoom(1);
      setImagePan({ x: 0, y: 0 });
    }
  }, [imageZoom]);

  // Gestion du clavier pour fermer le modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showProfileModal) {
        closeProfileModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showProfileModal, closeProfileModal]);

  const getDeviceBrands = useCallback((user) => {
    if (!user.devices || user.devices.length === 0) return [];
    const brands = user.devices
      .map(d => d.device_brand)
      .filter(b => b && b.trim() !== '');
    return [...new Set(brands)];
  }, []);

  const getExpoTokensCount = useCallback((user) => {
    if (!user.devices || user.devices.length === 0) return 0;
    return user.devices.filter(d => d.expo_push_token && d.expo_push_token.trim() !== '').length;
  }, []);

  // Statistiques mémorisées
  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter(u => u.is_active === 1 || u.is_active === true).length,
    admin: users.filter(u => u.is_admin === 1 || u.is_admin === true).length,
    withDevices: users.filter(u => u.devices && u.devices.length > 0).length,
  }), [users]);

  // Animation rapide et optimisée
  const cardVariants = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95 },
  };

  const fastTransition = { duration: 0.15, ease: 'easeOut' };
  
  // Animation professionnelle pour le modal
  const modalVariants = {
    hidden: { 
      opacity: 0, 
      scale: 0.92,
      y: 20,
    },
    visible: { 
      opacity: 1, 
      scale: 1,
      y: 0,
      transition: {
        duration: 0.25,
        ease: [0.16, 1, 0.3, 1], // Courbe d'accélération professionnelle
        staggerChildren: 0.05,
      }
    },
    exit: { 
      opacity: 0, 
      scale: 0.95,
      y: 10,
      transition: {
        duration: 0.2,
        ease: 'easeIn'
      }
    }
  };

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { duration: 0.2 }
    },
    exit: { 
      opacity: 0,
      transition: { duration: 0.15 }
    }
  };

  // ✅ Afficher la page à tous, mais contrôler l'accès aux actions
  // (Au lieu de bloquer l'accès complètement)

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Gestion des Comptes</h1>
          <p className="text-gray-400">Créer et gérer les utilisateurs</p>
          {isLicenseMode ? (
            <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded-lg w-fit">
              <Key className="w-3 h-3" />
              Mode License - Accès Complet
            </p>
          ) : isCurrentUserAdmin ? (
            <p className="text-xs text-primary-400 mt-1 flex items-center gap-1">
              <Shield className="w-3 h-3" />
              Mode Administrateur
            </p>
          ) : null}
        </div>
        <div className="flex gap-3">
          {/* Bouton visible pour tous les utilisateurs */}
            <m.button
            onClick={() => {
              setShowCreateForm(true);
              setNewUserForm({
                username: '',
                password: '',
                phone: '',
                is_admin: false,
                is_active: true,
                is_vendeur: true,
                is_gerant_stock: false,
                can_manage_products: false,
                device_brand: '',
                profile_url: '',
                expo_push_token: '',
              });
            }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn-primary flex items-center gap-2 shadow-lg"
            >
              <UserPlus className="w-5 h-5" />
              Créer Nouveau Compte
          </m.button>
          
          {/* Bouton toggle pour afficher/masquer le formulaire */}
          {showCreateForm && (
            <m.button
              onClick={() => setShowCreateForm(false)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn-secondary flex items-center gap-2"
            >
              <X className="w-5 h-5" />
              Annuler
            </m.button>
          )}
        </div>
      </div>

      {/* Formulaire de création PRO - Design amélioré */}
      {showCreateForm && (
        <m.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="rounded-2xl overflow-hidden shadow-2xl border border-primary-500/20"
          style={{
            background: 'linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.9) 50%, rgba(15,23,42,0.95) 100%)',
          }}
        >
          {/* Header du formulaire */}
          <div className="relative px-6 py-5 border-b border-white/10">
            <div className="absolute inset-0 bg-gradient-to-r from-primary-600/20 via-transparent to-primary-600/20"></div>
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/30">
                  <UserPlus className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Créer un Nouveau Compte</h2>
                  <p className="text-sm text-gray-400">Ajoutez un client ou collaborateur</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="w-10 h-10 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center justify-center transition-all hover:scale-105"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>

          <form onSubmit={handleCreateUser} className="p-6 space-y-6">
            {/* Section: Informations principales */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary-400">
                <User className="w-4 h-4" />
                <span>Informations d'identification</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Nom d'utilisateur */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <User className="w-4 h-4 text-blue-400" />
                    Nom d'utilisateur <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={newUserForm.username}
                    onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all"
                    placeholder="ex: Jean Dupont"
                    required
                  />
                </div>

                {/* Mot de passe */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Key className="w-4 h-4 text-amber-400" />
                    Mot de passe <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all font-mono"
                    placeholder="ex: 12345678"
                    required
                  />
                  <p className="text-xs text-gray-500">Visible pour pouvoir le communiquer au client</p>
                </div>

                {/* Numéro de téléphone */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Phone className="w-4 h-4 text-green-400" />
                    Numéro de téléphone
                  </label>
                  <input
                    type="text"
                    value={newUserForm.phone}
                    onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all"
                    placeholder="243xxxxxxxxx"
                  />
                  <p className="text-xs text-gray-500">Peut servir à se connecter</p>
                </div>
              </div>
            </div>

            {/* Section: Rôles et Permissions */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary-400">
                <Shield className="w-4 h-4" />
                <span>Rôles et Permissions</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {/* Actif */}
                <button
                  type="button"
                  onClick={() => setNewUserForm({ ...newUserForm, is_active: !newUserForm.is_active })}
                  className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                    newUserForm.is_active 
                      ? 'border-green-500/50 bg-green-500/10' 
                      : 'border-white/10 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2">
                    {newUserForm.is_active ? (
                      <CheckCircle2 className="w-6 h-6 text-green-400" />
                    ) : (
                      <XCircle className="w-6 h-6 text-gray-500" />
                    )}
                    <span className={`text-xs font-medium ${newUserForm.is_active ? 'text-green-300' : 'text-gray-400'}`}>
                      Actif
                    </span>
                  </div>
                  {newUserForm.is_active && (
                    <div className="absolute top-2 right-2 w-2 h-2 bg-green-400 rounded-full"></div>
                  )}
                </button>

                {/* Vendeur */}
                <button
                  type="button"
                  onClick={() => setNewUserForm({ ...newUserForm, is_vendeur: !newUserForm.is_vendeur })}
                  className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                    newUserForm.is_vendeur 
                      ? 'border-blue-500/50 bg-blue-500/10' 
                      : 'border-white/10 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2">
                    <ShoppingCart className={`w-6 h-6 ${newUserForm.is_vendeur ? 'text-blue-400' : 'text-gray-500'}`} />
                    <span className={`text-xs font-medium ${newUserForm.is_vendeur ? 'text-blue-300' : 'text-gray-400'}`}>
                      Vendeur
                    </span>
                  </div>
                  {newUserForm.is_vendeur && (
                    <div className="absolute top-2 right-2 w-2 h-2 bg-blue-400 rounded-full"></div>
                  )}
                </button>

                {/* Gérant Stock */}
                <button
                  type="button"
                  onClick={() => setNewUserForm({ ...newUserForm, is_gerant_stock: !newUserForm.is_gerant_stock })}
                  className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                    newUserForm.is_gerant_stock 
                      ? 'border-purple-500/50 bg-purple-500/10' 
                      : 'border-white/10 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2">
                    <Database className={`w-6 h-6 ${newUserForm.is_gerant_stock ? 'text-purple-400' : 'text-gray-500'}`} />
                    <span className={`text-xs font-medium ${newUserForm.is_gerant_stock ? 'text-purple-300' : 'text-gray-400'}`}>
                      Gérant Stock
                    </span>
                  </div>
                  {newUserForm.is_gerant_stock && (
                    <div className="absolute top-2 right-2 w-2 h-2 bg-purple-400 rounded-full"></div>
                  )}
                </button>

                {/* Produits */}
                <button
                  type="button"
                  onClick={() => setNewUserForm({ ...newUserForm, can_manage_products: !newUserForm.can_manage_products })}
                  className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                    newUserForm.can_manage_products 
                      ? 'border-orange-500/50 bg-orange-500/10' 
                      : 'border-white/10 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2">
                    <Package className={`w-6 h-6 ${newUserForm.can_manage_products ? 'text-orange-400' : 'text-gray-500'}`} />
                    <span className={`text-xs font-medium ${newUserForm.can_manage_products ? 'text-orange-300' : 'text-gray-400'}`}>
                      Produits
                    </span>
                  </div>
                  {newUserForm.can_manage_products && (
                    <div className="absolute top-2 right-2 w-2 h-2 bg-orange-400 rounded-full"></div>
                  )}
                </button>

                {/* Admin (réservé) */}
                <button
                  type="button"
                  onClick={() => setNewUserForm({ ...newUserForm, is_admin: !newUserForm.is_admin })}
                  className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                    newUserForm.is_admin 
                      ? 'border-yellow-500/50 bg-yellow-500/10' 
                      : 'border-white/10 bg-black/20 hover:border-white/20'
                  }`}
                  title={isCurrentUserAdmin ? "Définir comme administrateur" : "Seul un admin peut créer un autre admin"}
                >
                  <div className="flex flex-col items-center gap-2">
                    <Shield className={`w-6 h-6 ${newUserForm.is_admin ? 'text-yellow-400' : 'text-gray-500'}`} />
                    <span className={`text-xs font-medium ${newUserForm.is_admin ? 'text-yellow-300' : 'text-gray-400'}`}>
                      Admin
                    </span>
                  </div>
                  {newUserForm.is_admin && (
                    <div className="absolute top-2 right-2 w-2 h-2 bg-yellow-400 rounded-full"></div>
                  )}
                </button>
              </div>
            </div>

            {/* Section: Device (optionnel, collapsed) */}
            <details className="group">
              <summary className="flex items-center gap-2 text-sm font-semibold text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
                <Smartphone className="w-4 h-4" />
                <span>Informations Device (optionnel)</span>
                <span className="text-xs text-gray-500 ml-2">▼</span>
              </summary>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Smartphone className="w-4 h-4 text-gray-400" />
                    Marque du device
                  </label>
                  <input
                    type="text"
                    value={newUserForm.device_brand}
                    onChange={(e) => setNewUserForm({ ...newUserForm, device_brand: e.target.value })}
                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all"
                    placeholder="TECNO, Samsung, iPhone..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <User className="w-4 h-4 text-gray-400" />
                    URL Photo de profil
                  </label>
                  <input
                    type="url"
                    value={newUserForm.profile_url}
                    onChange={(e) => setNewUserForm({ ...newUserForm, profile_url: e.target.value })}
                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all"
                    placeholder="https://drive.google.com/..."
                  />
                </div>
              </div>
            </details>

            {/* Boutons d'action */}
            <div className="flex gap-4 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="flex-1 py-3 px-6 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 font-medium rounded-xl transition-all flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" />
                Annuler
              </button>
              <button
                type="submit"
                disabled={creating || !newUserForm.username || !newUserForm.password}
                className="flex-[2] py-3 px-6 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 disabled:from-gray-700 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Création en cours...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-5 h-5" />
                    Créer le Compte
                  </>
                )}
              </button>
            </div>

            {/* Info UUID */}
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
              <Hash className="w-3 h-3" />
              <span>L'UUID sera généré automatiquement</span>
            </div>
          </form>
        </m.div>
      )}

      {/* Statistiques - animations rapides */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total utilisateurs', value: stats.total, color: 'text-gray-100' },
          { label: 'Actifs', value: stats.active, color: 'text-green-400' },
          { label: 'Administrateurs', value: stats.admin, color: 'text-yellow-400' },
          { label: 'Avec devices', value: stats.withDevices, color: 'text-blue-400' },
        ].map((stat, index) => (
        <m.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
            transition={{ ...fastTransition, delay: index * 0.05 }}
          className="glass p-4 rounded-lg hover:bg-white/5 transition-all"
        >
            <div className="text-sm text-gray-400 mb-1">{stat.label}</div>
            <div className={`text-2xl font-bold ${stat.color}`}>
              {stat.value}
            </div>
          </m.div>
        ))}
      </div>

      {/* Liste des utilisateurs */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="w-12 h-12 animate-spin mx-auto text-primary-400" />
            <p className="text-gray-400 mt-4">Chargement des utilisateurs...</p>
          </div>
        ) : users.length > 0 ? (
          <div className="flex flex-col gap-2" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <AnimatePresence mode="popLayout">
              {users.map((user, index) => {
                const profileImage = getProfileImage(user);
                const hasAvatar = !!profileImage && !avatarErrorIds.has(user.id);
                const deviceBrands = getDeviceBrands(user);
                const expoTokensCount = getExpoTokensCount(user);
                const isEditingUsername = editingField?.userId === user.id && editingField?.field === 'username';
                const isEditingPhone = editingField?.userId === user.id && editingField?.field === 'phone';
                const isEditingPassword = editingField?.userId === user.id && editingField?.field === 'password';
                const isSaving = saving.has(user.id);
                const isActive = user.is_active === 1 || user.is_active === true;
                const isAdmin = user.is_admin === 1 || user.is_admin === true;
                
                return (
                  <m.div
                    key={user.id}
                    variants={cardVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={{ ...fastTransition, delay: index * 0.01 }}
                    whileHover={{ x: 4 }}
                    className={`glass p-4 rounded-lg border transition-all ${
                      canEditUser(user)
                        ? 'border-white/5 hover:border-primary-500/30 cursor-pointer' 
                        : 'border-white/5'
                    } ${isSaving ? 'ring-2 ring-primary-500/50' : ''}`}
                    onClick={(e) => {
                      // Empêcher la propagation si on clique sur un élément interactif
                      const target = e.target;
                      
                      // Vérifier si on clique sur un élément interactif (bouton, input, badge)
                      const isInteractive = 
                        target.closest('button') || 
                        target.closest('input') || 
                        target.closest('a') ||
                        target.tagName === 'INPUT' || 
                        target.tagName === 'BUTTON' ||
                        target.tagName === 'A' ||
                        target.closest('.badge');
                      
                      // Ne pas ouvrir le modal si on clique sur un élément interactif
                      if (isInteractive) {
                        return;
                      }
                      
                      // ✅ MODE LICENSE: Annuler toute édition en cours et ouvrir le modal
                      if (isEditingUsername || isEditingPhone || isEditingPassword) {
                        handleInlineCancel(); // Annuler l'édition en cours
                      }
                      
                      // Ouvrir le modal pour modifier l'utilisateur
                      openProfileModal(user);
                    }}
                  >
                    <div 
                      className="flex items-center gap-4 w-full"
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '1rem', 
                        width: '100%' 
                      }}
                    >
                      {/* Photo de profil - UN SEUL AVATAR */}
                      <div className="relative flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // ✅ Mode license = toujours autorisé
                            if (isLicenseMode || canEditUser(user)) {
                              // Annuler toute édition en cours
                              if (isEditingUsername || isEditingPhone || isEditingPassword) {
                                handleInlineCancel();
                              }
                              openProfileModal(user);
                            }
                          }}
                          className="cursor-zoom-in hover:scale-105 transition-transform"
                          title={canEditUser(user) ? "Cliquer pour modifier le profil" : "Voir le profil"}
                          type="button"
                        >
                          {hasAvatar ? (
                            <img
                              src={profileImage}
                              alt={user.username}
                              className="w-12 h-12 rounded-full object-cover border-2 border-primary-500/30"
                              crossOrigin="anonymous"
                              referrerPolicy="no-referrer"
                              draggable={false}
                              onError={(e) => {
                                // Essayer d'autres formats d'URL Google Drive
                                const originalUrl = getProfileImage(user);
                                if (originalUrl) {
                                  // Essayer avec le format view
                                  const fileIdMatch = originalUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                                                     originalUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
                                  if (fileIdMatch) {
                                    const fileId = fileIdMatch[1];
                                    // Essayer le format direct lh3
                                    e.target.src = `https://lh3.googleusercontent.com/d/${fileId}`;
                                    return;
                                  }
                                }
                                // Si tout échoue, marquer comme erreur
                                setAvatarErrorIds((prev) => {
                                  const next = new Set(prev);
                                  next.add(user.id);
                                  return next;
                                });
                              }}
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-600/20 flex items-center justify-center border-2 border-primary-500/30">
                              <User className="w-6 h-6 text-primary-400" />
                            </div>
                          )}
                        </button>
                        <div
                          className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-gray-900 ${
                            isActive ? 'bg-green-500' : 'bg-gray-500'
                          }`}
                        />
                        </div>
                        
                      {/* Nom d'utilisateur - Éditable au clic */}
                        <div className="flex-1 min-w-0">
                          {isEditingUsername ? (
                          <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleInlineSave(user.id, 'username');
                                  } else if (e.key === 'Escape') {
                                    handleInlineCancel();
                                  }
                                }}
                                className="flex-1 px-2 py-1 bg-white/10 border border-primary-500 rounded text-gray-100 text-sm focus:outline-none focus:border-primary-400"
                                autoFocus
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleInlineSave(user.id, 'username');
                                }}
                              className="p-1 text-green-400 hover:bg-green-500/20 rounded transition-colors"
                                title="Sauvegarder"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleInlineCancel();
                                }}
                              className="p-1 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                                title="Annuler"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div 
                            className={`flex items-center gap-2 ${canEditUser(user) ? 'group cursor-pointer px-2 py-1 rounded hover:bg-white/5 transition-all' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (canEditUser(user)) {
                                  handleInlineEdit(user, 'username');
                                }
                              }}
                              title={canEditUser(user) ? "Cliquer pour modifier le nom" : ""}
                            >
                            <h3 className={`font-semibold text-gray-100 text-base truncate ${canEditUser(user) ? 'hover:text-primary-400 transition-colors' : ''}`}>
                                {user.username}
                              </h3>
                              {canEditUser(user) && (
                              <Edit className="w-3 h-3 text-gray-400 group-hover:text-primary-400 opacity-60 group-hover:opacity-100 transition-all flex-shrink-0" />
                              )}
                            </div>
                        )}
                      </div>
                      
                      {/* Mot de passe - Éditable au clic (seulement pour soi-même ou admin) */}
                      {canEditUser(user) && (
                        <div className="flex items-center gap-2 min-w-[140px]">
                          {isEditingPassword ? (
                            <div className="flex items-center gap-1 flex-1">
                              <Shield className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <input
                                type="password"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                    handleInlineSave(user.id, 'password');
                              } else if (e.key === 'Escape') {
                                handleInlineCancel();
                              }
                            }}
                                className="flex-1 px-2 py-1 bg-white/10 border border-primary-500 rounded text-gray-100 text-xs focus:outline-none focus:border-primary-400"
                            autoFocus
                                placeholder="Nouveau mot de passe"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                                  handleInlineSave(user.id, 'password');
                            }}
                                className="p-1 text-green-400 hover:bg-green-500/20 rounded transition-colors"
                            title="Sauvegarder"
                          >
                                <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInlineCancel();
                            }}
                                className="p-1 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                            title="Annuler"
                          >
                                <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                          <div 
                              className="flex items-center gap-1 text-gray-400 text-sm group cursor-pointer px-2 py-1 rounded hover:bg-white/5 hover:text-primary-400 transition-all"
                            onClick={(e) => {
                              e.stopPropagation();
                                handleInlineEdit(user, 'password');
                              }}
                              title="Cliquer pour modifier le mot de passe"
                            >
                              <Shield className="w-3 h-3 flex-shrink-0" />
                              <span className="text-xs">Modifier mot de passe</span>
                              <Edit className="w-3 h-3 text-gray-400 group-hover:text-primary-400 opacity-60 group-hover:opacity-100 transition-all flex-shrink-0" />
                            </div>
                            )}
                          </div>
                      )}
                      
                      {/* Téléphone - Éditable au clic */}
                      <div className="flex items-center gap-2 min-w-[140px]">
                      {isEditingPhone ? (
                          <div className="flex items-center gap-1 flex-1">
                            <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <input
                            type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                handleInlineSave(user.id, 'phone');
                                } else if (e.key === 'Escape') {
                                  handleInlineCancel();
                                }
                              }}
                              className="flex-1 px-2 py-1 bg-white/10 border border-primary-500 rounded text-gray-100 text-xs focus:outline-none focus:border-primary-400"
                              autoFocus
                              placeholder="Numéro"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                              handleInlineSave(user.id, 'phone');
                              }}
                              className="p-1 text-green-400 hover:bg-green-500/20 rounded transition-colors"
                              title="Sauvegarder"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInlineCancel();
                              }}
                              className="p-1 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                              title="Annuler"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div 
                          className={`flex items-center gap-1 text-gray-400 text-sm ${canEditUser(user) ? 'group cursor-pointer px-2 py-1 rounded hover:bg-white/5 hover:text-primary-400 transition-all' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                            if (canEditUser(user)) {
                              handleInlineEdit(user, 'phone');
                            }
                          }}
                          title={canEditUser(user) ? "Cliquer pour modifier le numéro" : ""}
                        >
                          <Phone className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{user.phone || (canEditUser(user) ? 'Cliquer pour ajouter' : 'Non renseigné')}</span>
                          {canEditUser(user) && (
                              <Edit className="w-3 h-3 text-gray-400 group-hover:text-primary-400 opacity-60 group-hover:opacity-100 transition-all flex-shrink-0" />
                          )}
                          </div>
                      )}
                      </div>

                      {/* Badges - Modifiables par OWNER seulement pour is_admin */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Bouton is_admin - Seul OWNER peut modifier */}
                        <button
                          disabled={!canToggleAdmin}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggle(user.id, 'is_admin');
                          }}
                          className={`badge flex items-center gap-1 text-xs transition-all ${
                            !canToggleAdmin ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            isAdmin ? 'badge-warning' : 'badge-secondary'
                          }`}
                          title={canToggleAdmin ? "Cliquer pour modifier le statut administrateur" : "Seul le créateur peut modifier le statut administrateur"}
                        >
                          <Shield className="w-3 h-3" />
                          {isAdmin ? 'Admin' : 'Vendeur'}
                        </button>
                        
                        {/* Bouton is_active - Propriétaire peut modifier tout, autres seulement leur compte */}
                        <button
                          disabled={user.id !== currentUser?.id && !canManageUsersAll}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggle(user.id, 'is_active');
                          }}
                          className={`badge flex items-center gap-1 text-xs transition-all ${
                            (user.id !== currentUser?.id && !canManageUsersAll) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            isActive ? 'badge-success' : 'badge-error'
                          }`}
                          title={
                            user.id === currentUser?.id ? "Cliquer pour modifier votre statut" :
                            canManageUsersAll ? "Cliquer pour modifier le statut" :
                            "Vous pouvez seulement modifier votre propre compte"
                          }
                        >
                          {isActive ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              Actif
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3" />
                              Inactif
                            </>
                          )}
                        </button>
                      </div>

                      {/* Devices info */}
                      <div className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0 min-w-[120px]">
                      {deviceBrands.length > 0 && (
                          <div className="flex items-center gap-1">
                            <Smartphone className="w-3 h-3" />
                            <span className="truncate">{deviceBrands[0]}</span>
                            {deviceBrands.length > 1 && (
                              <span className="text-gray-500">+{deviceBrands.length - 1}</span>
                            )}
                        </div>
                      )}
                      {expoTokensCount > 0 && (
                          <span className="text-gray-500">({expoTokensCount} token)</span>
                        )}
                      </div>

                      {/* Date de création */}
                      {user.created_at && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0 min-w-[100px]">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDateFromSheets(user.created_at)}</span>
                        </div>
                      )}
                    
                      {/* Indicateur de sauvegarde */}
                      {isSaving && (
                        <div className="flex items-center gap-1 text-xs text-primary-400 flex-shrink-0">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Sauvegarde...</span>
                      </div>
                    )}
                    </div>
                  </m.div>
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <User className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg mb-2">Aucun utilisateur</p>
            <p className="text-sm opacity-75 mb-4">
              Les utilisateurs se synchronisent automatiquement depuis Google Sheets
            </p>
              <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-2 mx-auto"
                >
                  <UserPlus className="w-4 h-4" />
              Créer le Premier Utilisateur
            </button>
          </div>
        )}
      </div>

      {/* Modal d'informations de connexion après création - PRO Design */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence mode="wait">
          {createdUserInfo && (
            <m.div
              key="created-user-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-[10000]"
              onClick={closeCreatedUserInfo}
            >
              <m.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Carte de succès avec design premium */}
                <div className="bg-gradient-to-br from-emerald-900/90 via-emerald-800/80 to-teal-900/90 rounded-2xl shadow-2xl border border-emerald-500/30 overflow-hidden">
                  {/* Header avec icône de succès */}
                  <div className="relative p-6 text-center border-b border-emerald-500/20">
                    <div className="absolute inset-0 bg-gradient-to-b from-emerald-400/10 to-transparent"></div>
                    <div className="relative">
                      <div className="w-16 h-16 mx-auto mb-3 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30">
                        <CheckCircle2 className="w-9 h-9 text-white" />
                      </div>
                      <h2 className="text-2xl font-bold text-white mb-1">Compte Créé avec Succès !</h2>
                      <p className="text-emerald-200/80 text-sm">Voici les informations de connexion</p>
                    </div>
                  </div>

                  {/* Informations de connexion */}
                  <div className="p-6 space-y-4">
                    {/* Nom d'utilisateur */}
                    <div className="bg-black/20 rounded-xl p-4 border border-white/10">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                          <User className="w-4 h-4 text-blue-400" />
                        </div>
                        <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Nom d'utilisateur</span>
                      </div>
                      <p className="text-xl font-bold text-white pl-11 select-all">{createdUserInfo.username}</p>
                    </div>

                    {/* Mot de passe */}
                    <div className="bg-black/20 rounded-xl p-4 border border-white/10">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center">
                          <Key className="w-4 h-4 text-amber-400" />
                        </div>
                        <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Mot de passe</span>
                      </div>
                      <p className="text-xl font-bold text-white pl-11 font-mono select-all">{createdUserInfo.password}</p>
                    </div>

                    {/* Numéro de téléphone */}
                    <div className="bg-black/20 rounded-xl p-4 border border-white/10">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center">
                          <Phone className="w-4 h-4 text-green-400" />
                        </div>
                        <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Numéro de téléphone</span>
                      </div>
                      <p className="text-xl font-bold text-white pl-11 select-all">{createdUserInfo.phone}</p>
                    </div>

                    {/* Rôles assignés */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      {createdUserInfo.is_vendeur && (
                        <span className="px-3 py-1.5 bg-blue-500/20 text-blue-300 rounded-lg text-xs font-medium flex items-center gap-1.5">
                          <ShoppingCart className="w-3 h-3" /> Vendeur
                        </span>
                      )}
                      {createdUserInfo.is_gerant_stock && (
                        <span className="px-3 py-1.5 bg-purple-500/20 text-purple-300 rounded-lg text-xs font-medium flex items-center gap-1.5">
                          <Database className="w-3 h-3" /> Gérant Stock
                        </span>
                      )}
                      {createdUserInfo.can_manage_products && (
                        <span className="px-3 py-1.5 bg-orange-500/20 text-orange-300 rounded-lg text-xs font-medium flex items-center gap-1.5">
                          <Package className="w-3 h-3" /> Produits
                        </span>
                      )}
                    </div>

                    {/* UUID (discret) */}
                    <div className="pt-2 border-t border-white/10">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Hash className="w-3 h-3" />
                        <span className="font-mono truncate">{createdUserInfo.uuid}</span>
                      </div>
                    </div>
                  </div>

                  {/* Footer avec bouton */}
                  <div className="p-4 bg-black/20 border-t border-emerald-500/20">
                    <button
                      onClick={closeCreatedUserInfo}
                      className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold rounded-xl transition-all duration-200 shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 flex items-center justify-center gap-2"
                    >
                      <Check className="w-5 h-5" />
                      C'est noté, fermer
                    </button>
                    <p className="text-center text-xs text-gray-500 mt-3">
                      💡 L'utilisateur peut se connecter avec son nom ou numéro
                    </p>
                  </div>
                </div>
              </m.div>
            </m.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Modal de profil avec zoom/pan et édition complète - Portal pour Electron */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence mode="wait">
          {showProfileModal && profileUser && (
            <m.div
              key="profile-modal-backdrop"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]"
            style={{ 
              position: 'fixed',
              zIndex: 9999,
              top: 0,
              left: 0,
              right: 0,
              bottom: 0
            }}
            onClick={closeProfileModal}
          >
            <m.div
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="glass-strong rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl border border-white/10 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* En-tête avec titre et bouton fermer */}
              <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-gray-900/80 to-gray-900/60">
                <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
                  <Edit className="w-6 h-6" />
                  Modifier le compte : {profileUser?.username}
                </h2>
                <button
                  onClick={closeProfileModal}
                  className="w-9 h-9 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                  aria-label="Fermer (Esc)"
                >
                  <X className="w-5 h-5 text-gray-300" />
                </button>
              </div>

              {/* Zone de visualisation de l'image avec zoom - Version compacte */}
              {getProfileImage(profileUser) ? (
                <div
                  ref={viewerRef}
                  className="relative bg-gray-900/50 h-[25vh] min-h-[200px] flex items-center justify-center overflow-hidden border-b border-white/10"
                  style={{
                    cursor: imageZoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
                  }}
                  onWheel={handleWheel}
                  onDoubleClick={handleDoubleClick}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  <img
                    ref={imageRef}
                    src={getProfileImage(profileUser)}
                    alt={profileUser?.username || 'Photo de profil'}
                    className="max-w-full max-h-full object-contain select-none pointer-events-none rounded-lg"
                    style={{
                      transform: `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})`,
                      transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                    }}
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      // Si l'image ne charge pas, essayer de récupérer l'URL originale depuis les devices
                      if (profileUser?.devices && profileUser.devices.length > 0) {
                        const deviceWithUrl = profileUser.devices.find(d => d.profile_url);
                        if (deviceWithUrl?.profile_url) {
                          // Essayer différentes conversions
                          const originalUrl = deviceWithUrl.profile_url;
                          const fileIdMatch = originalUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                                             originalUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                                             originalUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                          if (fileIdMatch) {
                            const fileId = fileIdMatch[1];
                            const newUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
                            if (e.target.src !== newUrl) {
                              e.target.src = newUrl;
                              return;
                            }
                          }
                        }
                      }
                      // Si tout échoue, masquer l'image
                      e.target.style.display = 'none';
                    }}
                    draggable={false}
                  />

                  {/* Contrôles de zoom flottants */}
                  <div className="absolute top-4 right-4 flex flex-col gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleZoomIn();
                      }}
                      className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition-all hover:scale-110 backdrop-blur-sm"
                      title="Zoom +"
                    >
                      <ZoomIn className="w-5 h-5 text-gray-300" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleZoomOut();
                      }}
                      className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition-all hover:scale-110 backdrop-blur-sm"
                      title="Zoom -"
                    >
                      <ZoomOut className="w-5 h-5 text-gray-300" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleZoomReset();
                      }}
                      className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition-all hover:scale-110 backdrop-blur-sm"
                      title="Réinitialiser"
                    >
                      <RotateCcw className="w-5 h-5 text-gray-300" />
                    </button>
                  </div>

                  {/* Indicateur de zoom */}
                  {imageZoom > 1 && (
                    <div className="absolute top-4 left-4 text-xs text-gray-300 bg-black/50 px-3 py-1.5 rounded-lg border border-white/20 backdrop-blur-sm">
                      {Math.round(imageZoom * 100)}%
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative bg-gray-900/30 h-[15vh] min-h-[120px] flex items-center justify-center border-b border-white/10">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-600/20 flex items-center justify-center border-4 border-primary-500/30">
                      <User className="w-10 h-10 text-primary-400" />
                    </div>
                    <p className="text-xs text-gray-400">Aucune photo de profil</p>
                  </div>
                </div>
              )}

              {/* Formulaire d'édition - Design compact et professionnel */}
              <div className="flex-1 overflow-y-auto p-4">
                <form onSubmit={handleSaveFromProfileModal} className="space-y-4">
                  {/* Section: Informations de base */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Informations de base
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Nom d'utilisateur *</label>
                        <input
                          type="text"
                          value={editForm.username}
                          onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                          className="w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          Téléphone
                        </label>
                        <input
                          type="text"
                          value={editForm.phone}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all"
                          placeholder="243xxxxxxxxx"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1">
                          <Key className="w-3 h-3" />
                          Nouveau mot de passe
                        </label>
                        <input
                          type="password"
                          value={editForm.password}
                          onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                          className="w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all"
                          placeholder="Laisser vide pour ne pas changer"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1">
                          <Smartphone className="w-3 h-3" />
                          Marque du device
                        </label>
                        <input
                          type="text"
                          value={editForm.device_brand}
                          onChange={(e) => setEditForm({ ...editForm, device_brand: e.target.value })}
                          className="w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all"
                          placeholder="Ex: TECNO, Samsung"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          Token Expo Push
                        </label>
                        <textarea
                          value={editForm.expo_push_token}
                          onChange={(e) => setEditForm({ ...editForm, expo_push_token: e.target.value })}
                          className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all font-mono"
                          placeholder="ExponentPushToken[...]"
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section: Permissions et rôles */}
                  <div className="space-y-3 pt-3 border-t border-white/10">
                    <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Permissions et rôles
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <label className="flex items-center gap-2 cursor-pointer group p-2 rounded-lg hover:bg-white/5 transition-all">
                        <input
                          type="checkbox"
                          checked={editForm.is_admin}
                          onChange={(e) => setEditForm({ ...editForm, is_admin: e.target.checked })}
                          className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500 transition-all"
                        />
                        <div className="flex items-center gap-1.5">
                          <Shield className="w-4 h-4 text-yellow-400" />
                          <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors font-medium">Admin</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group p-2 rounded-lg hover:bg-white/5 transition-all">
                        <input
                          type="checkbox"
                          checked={editForm.is_active}
                          onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                          className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500 transition-all"
                        />
                        <div className="flex items-center gap-1.5">
                          {editForm.is_active ? (
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400" />
                          )}
                          <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors font-medium">Actif</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group p-2 rounded-lg hover:bg-white/5 transition-all">
                        <input
                          type="checkbox"
                          checked={editForm.is_vendeur}
                          onChange={(e) => setEditForm({ ...editForm, is_vendeur: e.target.checked })}
                          className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500 transition-all"
                        />
                        <div className="flex items-center gap-1.5">
                          <ShoppingCart className="w-4 h-4 text-blue-400" />
                          <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors font-medium">Vendeur</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group p-2 rounded-lg hover:bg-white/5 transition-all">
                        <input
                          type="checkbox"
                          checked={editForm.is_gerant_stock}
                          onChange={(e) => setEditForm({ ...editForm, is_gerant_stock: e.target.checked })}
                          className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500 transition-all"
                        />
                        <div className="flex items-center gap-1.5">
                          <Database className="w-4 h-4 text-purple-400" />
                          <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors font-medium">Gérant Stock</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group p-2 rounded-lg hover:bg-white/5 transition-all md:col-span-2">
                        <input
                          type="checkbox"
                          checked={editForm.can_manage_products}
                          onChange={(e) => setEditForm({ ...editForm, can_manage_products: e.target.checked })}
                          className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500 transition-all"
                        />
                        <div className="flex items-center gap-1.5">
                          <Package className="w-4 h-4 text-orange-400" />
                          <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors font-medium">Gérer Produits</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Section: Informations système (lecture seule) */}
                  {profileUser && (
                    <div className="space-y-2 pt-3 border-t border-white/10">
                      <h3 className="text-xs font-semibold text-gray-400">Informations système</h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                        {profileUser.uuid && (
                          <div className="bg-white/5 rounded p-2">
                            <div className="text-gray-400 mb-0.5">UUID</div>
                            <div className="text-gray-300 font-mono truncate">{profileUser.uuid}</div>
                          </div>
                        )}
                        {profileUser.created_at && (
                          <div className="bg-white/5 rounded p-2">
                            <div className="text-gray-400 mb-0.5 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              Date création
                            </div>
                            <div className="text-gray-300">{formatDateFromSheets(profileUser.created_at)}</div>
                          </div>
                        )}
                        {profileUser.updated_at && (
                          <div className="bg-white/5 rounded p-2">
                            <div className="text-gray-400 mb-0.5">Dernière MAJ</div>
                            <div className="text-gray-300">{formatDateFromSheets(profileUser.updated_at)}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                <button
                  type="button"
                      onClick={closeProfileModal}
                      className="flex-1 btn-secondary"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                      disabled={updating}
                      className="flex-1 btn-primary flex items-center justify-center gap-2"
                    >
                      {updating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sauvegarde...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Enregistrer
                        </>
                      )}
                </button>
                  </div>
            </form>
              </div>
              </m.div>
            </m.div>
          )}
        </AnimatePresence>
        ,
        document.body
      )}
    </div>
  );
};

export default UsersPage;
