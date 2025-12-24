import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, Edit2, Save, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3030';

const ProductsPage = () => {
  const { products, loadProducts } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCell, setEditingCell] = useState(null);
  const [editedData, setEditedData] = useState({});
  const [newRow, setNewRow] = useState(null);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleCellEdit = (rowIndex, field, value) => {
    setEditingCell({ rowIndex, field });
    setEditedData({ ...editedData, [field]: value });
  };

  const handleSave = async () => {
    // Sauvegarder les modifications
    try {
      await axios.post(`${API_URL}/api/products`, editedData);
      await loadProducts();
      setEditingCell(null);
      setEditedData({});
    } catch (error) {
      console.error('Erreur sauvegarde:', error);
    }
  };

  const handleAddRow = () => {
    setNewRow({
      code: '',
      name: '',
      stock_initial: 0,
      stock_current: 0,
      sale_price_fc: 0,
      sale_price_usd: 0,
      unit_mark: '',
      auto_stock_factor: 1,
      qty_step: 1,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Produits</h1>
          <p className="text-gray-400">Gestion des produits style tableur</p>
        </div>
        <button onClick={handleAddRow} className="btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Ajouter une ligne
        </button>
      </div>

      {/* Recherche */}
      <div className="card">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un produit..."
            className="input-field pl-10"
          />
        </div>
      </div>

      {/* Tableau */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left p-3 text-sm font-semibold text-gray-300">Code</th>
              <th className="text-left p-3 text-sm font-semibold text-gray-300">Nom</th>
              <th className="text-left p-3 text-sm font-semibold text-gray-300">
                Stock initial
              </th>
              <th className="text-left p-3 text-sm font-semibold text-gray-300">
                Stock courant
              </th>
              <th className="text-left p-3 text-sm font-semibold text-gray-300">PU FC</th>
              <th className="text-left p-3 text-sm font-semibold text-gray-300">PU USD</th>
              <th className="text-left p-3 text-sm font-semibold text-gray-300">Mark</th>
              <th className="text-left p-3 text-sm font-semibold text-gray-300">
                Auto Stock
              </th>
              <th className="text-left p-3 text-sm font-semibold text-gray-300">Step</th>
              <th className="text-left p-3 text-sm font-semibold text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product, index) => (
              <motion.tr
                key={product.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border-b border-white/5 hover:bg-white/5"
              >
                <td className="p-3">
                  {editingCell?.rowIndex === index && editingCell?.field === 'code' ? (
                    <input
                      type="text"
                      value={editedData.code || product.code}
                      onChange={(e) => handleCellEdit(index, 'code', e.target.value)}
                      className="input-field text-sm"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="cursor-pointer hover:text-primary-400"
                      onClick={() => handleCellEdit(index, 'code', product.code)}
                    >
                      {product.code}
                    </span>
                  )}
                </td>
                <td className="p-3">
                  {editingCell?.rowIndex === index && editingCell?.field === 'name' ? (
                    <input
                      type="text"
                      value={editedData.name || product.name}
                      onChange={(e) => handleCellEdit(index, 'name', e.target.value)}
                      className="input-field text-sm"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="cursor-pointer hover:text-primary-400"
                      onClick={() => handleCellEdit(index, 'name', product.name)}
                    >
                      {product.name}
                    </span>
                  )}
                </td>
                {/* Autres colonnes similaires */}
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    {editingCell?.rowIndex === index ? (
                      <>
                        <button onClick={handleSave} className="text-green-400">
                          <Save className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingCell(null)}
                          className="text-red-400"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setEditingCell({ rowIndex: index, field: 'code' })}
                        className="text-gray-400 hover:text-primary-400"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProductsPage;

