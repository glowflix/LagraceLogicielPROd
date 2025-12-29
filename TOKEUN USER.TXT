import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  Hash
} from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';
import { format, parseISO, isValid } from 'date-fns';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

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
  const { user: currentUser } = useStore();
  const saveTimeoutRef = useRef(null);
  const pendingSavesRef = useRef(new Map());

  // Charger les utilisateurs
  useEffect(() => {
    loadUsers();
    const interval = setInterval(() => {
      loadUsers();
    }, 30000); // 30 secondes
    
    return () => clearInterval(interval);
  }, []);

  // Debug: Surveiller l'état du modal
  useEffect(() => {
    console.log('🔍 [DEBUG] État du modal changé:');
    console.log('  - showProfileModal:', showProfileModal);
    console.log('  - profileUser:', profileUser?.username, profileUser?.id);
  }, [showProfileModal, profileUser]);

  const loadUsers = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/users`);
      setUsers(response.data || []);
    } catch (error) {
      console.error('❌ [UsersPage] Erreur chargement utilisateurs:', error);
      setUsers([]);
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
        const token = localStorage.getItem('token');
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
    
    const newValue = !(user[field] === 1 || user[field] === true);
    await saveFieldChange(userId, field, newValue);
  }, [users, saveFieldChange]);

  // Édition inline - Tous les utilisateurs peuvent modifier tous les comptes
  const handleInlineEdit = (user, field) => {
    // TOUJOURS autoriser l'édition - pas de restriction
    setEditingField({ userId: user.id, field });
    if (field === 'password') {
      setEditingValue('');
    } else {
      setEditingValue(user[field] || '');
    }
  };
  
  // Vérifier si l'utilisateur peut modifier un autre utilisateur - TOUS peuvent modifier TOUS
  const canEditUser = useCallback((user) => {
    // TOUJOURS autoriser la modification - pas de restriction
    return true;
  }, []);

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


  // Créer un nouvel utilisateur
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUserForm.username || !newUserForm.password) {
      alert('Le nom d\'utilisateur et le mot de passe sont requis');
      return;
    }

    try {
      setCreating(true);
      const token = localStorage.getItem('token');
      const config = {
        headers: { Authorization: `Bearer ${token}` },
      };

      await axios.post(`${API_URL}/api/users`, newUserForm, config);

      // Réinitialiser le formulaire
      setNewUserForm({
      username: '',
      password: '',
      phone: '',
      is_admin: false,
      is_active: true,
      device_brand: '',
      profile_url: '',
    });
      setShowCreateForm(false);
      
      // Recharger les utilisateurs
      await loadUsers();
      
      // Message de succès
      alert('✅ Utilisateur créé avec succès !');
    } catch (error) {
      console.error('Erreur création utilisateur:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Erreur lors de la création de l\'utilisateur';
      alert(`❌ ${errorMessage}`);
    } finally {
      setCreating(false);
    }
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
    console.log('🔵 [DEBUG] openProfileModal appelé pour:', user?.username, user?.id);
    
    const latestDevice = user.devices && user.devices.length > 0 
      ? user.devices[user.devices.length - 1] 
      : null;
    
    console.log('✅ [DEBUG] Ouverture du modal pour:', user.username);
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
    console.log('✅ [DEBUG] showProfileModal défini à true');
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
      const token = localStorage.getItem('token');
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

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Compte Utilisateur</h1>
          <p className="text-gray-400">Gestion des utilisateurs et permissions</p>
        </div>
        <div className="flex gap-3">
          {/* Bouton visible pour tous les utilisateurs */}
            <motion.button
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
          </motion.button>
          
          {/* Bouton toggle pour afficher/masquer le formulaire */}
          {showCreateForm && (
            <motion.button
              onClick={() => setShowCreateForm(false)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn-secondary flex items-center gap-2"
            >
              <X className="w-5 h-5" />
              Annuler
            </motion.button>
          )}
        </div>
      </div>

      {/* Formulaire de création inline - Visible pour tous */}
      {showCreateForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={fastTransition}
          className="glass p-6 rounded-lg border border-primary-500/30 shadow-lg"
        >
          <h2 className="text-2xl font-bold text-gray-100 mb-6 flex items-center gap-2">
            <UserPlus className="w-6 h-6" />
            Créer un Nouveau Client
          </h2>
          <form onSubmit={handleCreateUser} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Nom d'utilisateur *
                </label>
                <input
                  type="text"
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all"
                  placeholder="Entrez le nom d'utilisateur"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Mot de passe *
                </label>
                <input
                  type="password"
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all"
                  placeholder="Choisissez un mot de passe sécurisé"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Téléphone
                </label>
                <input
                  type="text"
                  value={newUserForm.phone}
                  onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all"
                  placeholder="243xxxxxxxxx"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Marque du device
                </label>
                <input
                  type="text"
                  value={newUserForm.device_brand}
                  onChange={(e) => setNewUserForm({ ...newUserForm, device_brand: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all"
                  placeholder="Ex: TECNO, Samsung, iPhone, etc."
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  URL Photo de profil
                </label>
                <input
                  type="url"
                  value={newUserForm.profile_url}
                  onChange={(e) => setNewUserForm({ ...newUserForm, profile_url: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500 transition-all"
                  placeholder="https://..."
                />
                {newUserForm.profile_url && (
                  <div className="mt-3">
                    <img
                      src={convertGoogleDriveUrl(newUserForm.profile_url) || newUserForm.profile_url}
                      alt="Aperçu"
                      className="w-20 h-20 rounded-full object-cover border border-primary-500/30"
                      crossOrigin="anonymous"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const url = newUserForm.profile_url;
                        if (url) {
                          const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                                             url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                                             url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                          if (fileIdMatch) {
                            const fileId = fileIdMatch[1];
                            e.target.src = `https://lh3.googleusercontent.com/d/${fileId}`;
                            return;
                          }
                        }
                        e.target.style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-4 border-t border-white/10">
              <label className="flex items-center gap-2 cursor-pointer group p-2 rounded-lg hover:bg-white/5 transition-all">
                <input
                  type="checkbox"
                  checked={newUserForm.is_admin}
                  onChange={(e) => setNewUserForm({ ...newUserForm, is_admin: e.target.checked })}
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
                  checked={newUserForm.is_active}
                  onChange={(e) => setNewUserForm({ ...newUserForm, is_active: e.target.checked })}
                  className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500 transition-all"
                />
                <div className="flex items-center gap-1.5">
                  {newUserForm.is_active ? (
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
                  checked={newUserForm.is_vendeur}
                  onChange={(e) => setNewUserForm({ ...newUserForm, is_vendeur: e.target.checked })}
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
                  checked={newUserForm.is_gerant_stock}
                  onChange={(e) => setNewUserForm({ ...newUserForm, is_gerant_stock: e.target.checked })}
                  className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500 transition-all"
                />
                <div className="flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-purple-400" />
                  <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors font-medium">Stock</span>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group p-2 rounded-lg hover:bg-white/5 transition-all">
                <input
                  type="checkbox"
                  checked={newUserForm.can_manage_products}
                  onChange={(e) => setNewUserForm({ ...newUserForm, can_manage_products: e.target.checked })}
                  className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500 transition-all"
                />
                <div className="flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-orange-400" />
                  <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors font-medium">Produits</span>
                </div>
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="flex-1 btn-secondary"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex-1 btn-primary flex items-center justify-center gap-2"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Création en cours...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Créer le Compte
                  </>
                )}
              </button>
            </div>
          </form>
          </motion.div>
      )}

      {/* Statistiques - animations rapides */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total utilisateurs', value: stats.total, color: 'text-gray-100' },
          { label: 'Actifs', value: stats.active, color: 'text-green-400' },
          { label: 'Administrateurs', value: stats.admin, color: 'text-yellow-400' },
          { label: 'Avec devices', value: stats.withDevices, color: 'text-blue-400' },
        ].map((stat, index) => (
        <motion.div
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
          </motion.div>
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
                  <motion.div
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
                      console.log('🟢 [DEBUG] Clic sur la carte utilisateur:', user.username, user.id);
                      console.log('🟢 [DEBUG] Target:', e.target, 'TagName:', e.target.tagName);
                      
                      // Empêcher la propagation si on clique sur un élément interactif
                      const target = e.target;
                      
                      // Vérifier si on clique sur un élément interactif
                      const isInteractive = 
                        target.closest('button') || 
                        target.closest('input') || 
                        target.closest('a') ||
                        target.tagName === 'INPUT' || 
                        target.tagName === 'BUTTON' ||
                        target.tagName === 'A' ||
                        target.closest('.badge');
                      
                      console.log('🟢 [DEBUG] isInteractive:', isInteractive);
                      
                      // Ne pas ouvrir le modal si on clique sur un élément interactif
                      if (isInteractive) {
                        console.log('⚠️ [DEBUG] Clic sur élément interactif, annulation');
                        return;
                      }
                      
                      console.log('🟢 [DEBUG] Vérification conditions:');
                      console.log('  - isEditingUsername:', isEditingUsername);
                      console.log('  - isEditingPhone:', isEditingPhone);
                      console.log('  - isEditingPassword:', isEditingPassword);
                      
                      // Ouvrir le modal pour modifier l'utilisateur - TOUJOURS autorisé
                      if (!isEditingUsername && !isEditingPhone && !isEditingPassword) {
                        console.log('✅ [DEBUG] Conditions OK, appel de openProfileModal');
                        openProfileModal(user);
                      } else {
                        console.log('❌ [DEBUG] Édition en cours, impossible d\'ouvrir le modal');
                        alert(`⚠️ Édition en cours: username=${isEditingUsername}, phone=${isEditingPhone}, password=${isEditingPassword}`);
                      }
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
                            console.log('🖼️ [DEBUG] Clic sur l\'avatar de:', user.username);
                            e.stopPropagation();
                            console.log('🖼️ [DEBUG] canEditUser:', canEditUser(user));
                            if (canEditUser(user)) {
                              console.log('✅ [DEBUG] Appel de openProfileModal depuis l\'avatar');
                              openProfileModal(user);
                            } else {
                              console.log('❌ [DEBUG] Pas de permission pour modifier cet utilisateur');
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

                      {/* Badges - Modifiables par tous les utilisateurs connectés */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggle(user.id, 'is_admin');
                          }}
                          className={`badge flex items-center gap-1 text-xs transition-all ${
                            isAdmin ? 'badge-warning' : 'badge-secondary'
                          }`}
                        >
                          <Shield className="w-3 h-3" />
                          {isAdmin ? 'Admin' : 'Vendeur'}
                        </button>
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggle(user.id, 'is_active');
                          }}
                          className={`badge flex items-center gap-1 text-xs transition-all ${
                            isActive ? 'badge-success' : 'badge-error'
                          }`}
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
                  </motion.div>
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

      {/* Indicateur de débogage visuel */}
      {showProfileModal && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-[10000]">
          🟢 Modal ouvert pour: {profileUser?.username}
        </div>
      )}

      {/* Modal de profil avec zoom/pan et édition complète - Portal pour Electron */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence mode="wait">
          {showProfileModal && profileUser && (
            <motion.div
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
            onClick={() => {
              console.log('🔴 [DEBUG] Clic sur le fond du modal (fermeture)');
              closeProfileModal();
            }}
          >
            <motion.div
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
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        ,
        document.body
      )}
    </div>
  );
};

export default UsersPage;
