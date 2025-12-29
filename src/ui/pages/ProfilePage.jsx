import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  User, 
  Save, 
  Phone, 
  Key, 
  Shield, 
  CheckCircle2,
  XCircle,
  Loader2,
  UserCircle,
  Smartphone,
  Package,
  ShoppingCart,
  Database,
  AlertCircle
} from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';
import { getApiUrl } from '../utils/apiConfig';

const API_URL = getApiUrl();

const ProfilePage = () => {
  const { user: currentUser, token } = useStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [profileData, setProfileData] = useState({
    username: '',
    phone: '',
    password: '',
    device_brand: '',
  });

  // Charger les données du profil utilisateur
  useEffect(() => {
    if (currentUser) {
      setProfileData({
        username: currentUser.username || '',
        phone: currentUser.phone || '',
        password: '',
        device_brand: '',
      });
      setLoading(false);
    } else {
      // Si pas d'utilisateur connecté, charger depuis l'API
      loadUserProfile();
    }
  }, [currentUser]);

  const loadUserProfile = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.data) {
        setProfileData({
          username: response.data.username || '',
          phone: response.data.phone || '',
          password: '',
          device_brand: response.data.device_brand || '',
        });
      }
    } catch (error) {
      console.error('Erreur chargement profil:', error);
      setError('Impossible de charger votre profil');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const updateData = {
        username: profileData.username,
        phone: profileData.phone,
        device_brand: profileData.device_brand,
      };

      // Ajouter le mot de passe seulement s'il n'est pas vide
      if (profileData.password && profileData.password.trim() !== '') {
        updateData.password = profileData.password;
      }

      await axios.put(
        `${API_URL}/api/users/${currentUser.id}`,
        updateData,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      setSuccess('✅ Profil mis à jour avec succès !');
      
      // Recharger les données utilisateur dans le store
      const userResponse = await axios.get(`${API_URL}/api/users/${currentUser.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (userResponse.data) {
        // Mettre à jour le store avec les nouvelles données
        useStore.setState({ user: userResponse.data });
      }

      // Réinitialiser le champ mot de passe
      setProfileData(prev => ({ ...prev, password: '' }));
      
      setTimeout(() => {
        setSuccess('');
      }, 3000);
    } catch (error) {
      console.error('Erreur mise à jour profil:', error);
      setError(error.response?.data?.error || 'Erreur lors de la mise à jour du profil');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto text-primary-400 mb-4" />
          <p className="text-gray-400">Chargement de votre profil...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 mx-auto text-red-400 mb-4" />
          <p className="text-gray-400 text-lg">Vous devez être connecté pour accéder à votre profil</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Mon Profil</h1>
        <p className="text-gray-400">Gérez vos informations personnelles</p>
      </div>

      {/* Messages d'erreur et succès */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 p-4 bg-red-500/20 border border-red-500/30 rounded-lg"
        >
          <AlertCircle className="w-5 h-5 text-red-400" />
          <span className="text-sm text-red-300">{error}</span>
        </motion.div>
      )}

      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 p-4 bg-green-500/20 border border-green-500/30 rounded-lg"
        >
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <span className="text-sm text-green-300">{success}</span>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne gauche - Informations de profil */}
        <div className="lg:col-span-2 space-y-6">
          {/* Carte principale - Informations personnelles */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card"
          >
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-600/20 flex items-center justify-center border-2 border-primary-500/30">
                <UserCircle className="w-6 h-6 text-primary-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-100">Informations personnelles</h2>
                <p className="text-sm text-gray-400">Modifiez vos informations de compte</p>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Nom d'utilisateur *
                  </label>
                  <input
                    type="text"
                    value={profileData.username}
                    onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
                    className="input-field w-full"
                    placeholder="Votre nom d'utilisateur"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    Téléphone
                  </label>
                  <input
                    type="text"
                    value={profileData.phone}
                    onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    className="input-field w-full"
                    placeholder="243xxxxxxxxx"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    Nouveau mot de passe
                  </label>
                  <input
                    type="password"
                    value={profileData.password}
                    onChange={(e) => setProfileData({ ...profileData, password: e.target.value })}
                    className="input-field w-full"
                    placeholder="Laisser vide pour ne pas changer"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Laissez vide si vous ne souhaitez pas modifier votre mot de passe
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Smartphone className="w-4 h-4" />
                    Marque du device
                  </label>
                  <input
                    type="text"
                    value={profileData.device_brand}
                    onChange={(e) => setProfileData({ ...profileData, device_brand: e.target.value })}
                    className="input-field w-full"
                    placeholder="Ex: TECNO, Samsung, iPhone"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sauvegarde...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Enregistrer les modifications
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>

        {/* Colonne droite - Informations système et permissions */}
        <div className="space-y-6">
          {/* Carte - Permissions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card"
          >
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
              <Shield className="w-5 h-5 text-primary-400" />
              <h3 className="text-lg font-bold text-gray-100">Mes Permissions</h3>
            </div>

            <div className="space-y-3">
              <div className={`flex items-center justify-between p-3 rounded-lg ${
                currentUser.is_admin ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-white/5'
              }`}>
                <div className="flex items-center gap-2">
                  <Shield className={`w-4 h-4 ${currentUser.is_admin ? 'text-yellow-400' : 'text-gray-400'}`} />
                  <span className="text-sm text-gray-300">Administrateur</span>
                </div>
                {currentUser.is_admin ? (
                  <CheckCircle2 className="w-4 h-4 text-yellow-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-gray-500" />
                )}
              </div>

              <div className={`flex items-center justify-between p-3 rounded-lg ${
                currentUser.is_vendeur ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-white/5'
              }`}>
                <div className="flex items-center gap-2">
                  <ShoppingCart className={`w-4 h-4 ${currentUser.is_vendeur ? 'text-blue-400' : 'text-gray-400'}`} />
                  <span className="text-sm text-gray-300">Vendeur</span>
                </div>
                {currentUser.is_vendeur ? (
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-gray-500" />
                )}
              </div>

              <div className={`flex items-center justify-between p-3 rounded-lg ${
                currentUser.is_gerant_stock ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-white/5'
              }`}>
                <div className="flex items-center gap-2">
                  <Database className={`w-4 h-4 ${currentUser.is_gerant_stock ? 'text-purple-400' : 'text-gray-400'}`} />
                  <span className="text-sm text-gray-300">Gérant Stock</span>
                </div>
                {currentUser.is_gerant_stock ? (
                  <CheckCircle2 className="w-4 h-4 text-purple-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-gray-500" />
                )}
              </div>

              <div className={`flex items-center justify-between p-3 rounded-lg ${
                currentUser.can_manage_products ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-white/5'
              }`}>
                <div className="flex items-center gap-2">
                  <Package className={`w-4 h-4 ${currentUser.can_manage_products ? 'text-orange-400' : 'text-gray-400'}`} />
                  <span className="text-sm text-gray-300">Gérer Produits</span>
                </div>
                {currentUser.can_manage_products ? (
                  <CheckCircle2 className="w-4 h-4 text-orange-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-gray-500" />
                )}
              </div>

              <div className={`flex items-center justify-between p-3 rounded-lg ${
                currentUser.is_active ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'
              }`}>
                <div className="flex items-center gap-2">
                  {currentUser.is_active ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <span className="text-sm text-gray-300">Statut</span>
                </div>
                <span className={`text-xs font-medium ${
                  currentUser.is_active ? 'text-green-400' : 'text-red-400'
                }`}>
                  {currentUser.is_active ? 'Actif' : 'Inactif'}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Carte - Informations système */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="card"
          >
            <h3 className="text-lg font-bold text-gray-100 mb-4">Informations système</h3>
            <div className="space-y-3 text-sm">
              {currentUser.uuid && (
                <div>
                  <div className="text-gray-400 mb-1">UUID</div>
                  <div className="text-gray-300 font-mono text-xs break-all bg-white/5 p-2 rounded">
                    {currentUser.uuid}
                  </div>
                </div>
              )}
              {currentUser.id && (
                <div>
                  <div className="text-gray-400 mb-1">ID Utilisateur</div>
                  <div className="text-gray-300 font-mono">
                    {currentUser.id}
                  </div>
                </div>
              )}
              {currentUser.created_at && (
                <div>
                  <div className="text-gray-400 mb-1">Date de création</div>
                  <div className="text-gray-300">
                    {new Date(currentUser.created_at).toLocaleDateString('fr-FR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;

