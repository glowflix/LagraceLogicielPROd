import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { User, UserPlus, Edit, Shield, Phone, RefreshCw, Download } from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';
import { format } from 'date-fns';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

const UsersPage = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    phone: '',
    is_admin: false,
    is_active: true,
  });
  const { user: currentUser } = useStore();

  useEffect(() => {
    loadUsers();
    
    // Rafraîchir automatiquement toutes les 10 secondes pour voir les nouveaux utilisateurs synchronisés
    const interval = setInterval(() => {
      loadUsers();
    }, 10000);
    
    return () => clearInterval(interval);
  }, []);

  const loadUsers = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/users`);
      setUsers(response.data || []);
    } catch (error) {
      console.error('❌ [UsersPage] Erreur chargement utilisateurs:', error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingUser(null);
    setFormData({
      username: '',
      password: '',
      phone: '',
      is_admin: false,
      is_active: true,
    });
    setShowModal(true);
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '', // Ne pas pré-remplir le mot de passe
      phone: user.phone || '',
      is_admin: user.is_admin === 1 || user.is_admin === true,
      is_active: user.is_active === 1 || user.is_active === true,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const config = {
        headers: { Authorization: `Bearer ${token}` },
      };

      if (editingUser) {
        // Mettre à jour
        await axios.put(
          `${API_URL}/api/users/${editingUser.id}`,
          formData,
          config
        );
      } else {
        // Créer
        await axios.post(`${API_URL}/api/users`, formData, config);
      }

      setShowModal(false);
      loadUsers();
    } catch (error) {
      console.error('Erreur sauvegarde utilisateur:', error);
      alert(error.response?.data?.error || 'Erreur lors de la sauvegarde');
    }
  };

  const handleSync = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(
        `${API_URL}/api/sync/now`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert('Synchronisation déclenchée, les utilisateurs seront mis à jour dans quelques secondes');
      setTimeout(loadUsers, 3000);
    } catch (error) {
      console.error('Erreur synchronisation:', error);
      alert('Erreur lors de la synchronisation');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Compte Utilisateur</h1>
          <p className="text-gray-400">Gestion des utilisateurs et permissions</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSync}
            className="btn-secondary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Synchroniser
          </button>
          {currentUser?.is_admin && (
            <button
              onClick={handleCreate}
              className="btn-primary flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Nouvel utilisateur
            </button>
          )}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"
            />
          </div>
        ) : users.length > 0 ? (
          <div className="space-y-4">
            {users.map((user, index) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="p-4 glass rounded-lg"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary-500/20 flex items-center justify-center">
                      <User className="w-6 h-6 text-primary-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-semibold text-gray-200 text-lg">
                          {user.username}
                        </span>
                        {user.is_admin === 1 || user.is_admin === true ? (
                          <span className="badge badge-warning flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            Administrateur
                          </span>
                        ) : (
                          <span className="badge badge-success">Vendeur</span>
                        )}
                        {user.is_active === 0 || user.is_active === false ? (
                          <span className="badge badge-error">Inactif</span>
                        ) : (
                          <span className="badge badge-success">Actif</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-400">
                        {user.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-4 h-4" />
                            {user.phone}
                          </span>
                        )}
                        {user.created_at && (
                          <span>
                            Créé le {format(new Date(user.created_at), 'dd MMM yyyy')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {currentUser?.is_admin && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(user)}
                        className="p-2 glass rounded-lg hover:bg-primary-500/20 transition-colors"
                        title="Modifier"
                      >
                        <Edit className="w-4 h-4 text-primary-400" />
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <User className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg mb-2">Aucun utilisateur</p>
            <p className="text-sm opacity-75 mb-4">
              Les utilisateurs se synchronisent automatiquement depuis Google Sheets
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={loadUsers}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Rafraîchir
              </button>
              {currentUser?.is_admin && (
                <button
                  onClick={handleCreate}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  Créer un utilisateur
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal Création/Modification */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-strong p-6 rounded-lg w-full max-w-md"
          >
            <h2 className="text-2xl font-bold text-gray-100 mb-4">
              {editingUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Nom d'utilisateur
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {editingUser ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe'}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500"
                  required={!editingUser}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Téléphone
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:border-primary-500"
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_admin}
                    onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                    className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-300">Administrateur</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4 rounded bg-white/5 border-white/10 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-300">Actif</span>
                </label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 btn-secondary"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 btn-primary"
                >
                  {editingUser ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default UsersPage;

