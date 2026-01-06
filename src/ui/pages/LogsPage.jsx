/**
 * LogsPage - Affichage des logs en temps réel (DEV + EXE)
 * Permet de visualiser les logs du serveur, de l'impression et du système
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { Terminal, RefreshCw, Trash2, Download, Play, Pause, Search, Filter, ChevronDown } from 'lucide-react';
import axios from 'axios';

const API_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

// Types de logs avec couleurs
const LOG_TYPES = {
  info: { color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'INFO' },
  warn: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'WARN' },
  error: { color: 'text-red-400', bg: 'bg-red-500/10', label: 'ERROR' },
  success: { color: 'text-green-400', bg: 'bg-green-500/10', label: 'OK' },
  print: { color: 'text-purple-400', bg: 'bg-purple-500/10', label: 'PRINT' },
  sync: { color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: 'SYNC' },
  debug: { color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'DEBUG' },
};

// Détecte le type de log basé sur le contenu
function detectLogType(line) {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('❌') || lower.includes('fail')) return 'error';
  if (lower.includes('warn') || lower.includes('⚠️')) return 'warn';
  if (lower.includes('success') || lower.includes('✅') || lower.includes('ok')) return 'success';
  if (lower.includes('print') || lower.includes('🖨️') || lower.includes('imprim')) return 'print';
  if (lower.includes('sync') || lower.includes('🔄')) return 'sync';
  if (lower.includes('debug')) return 'debug';
  return 'info';
}

// Parse une ligne de log
function parseLogLine(line, index) {
  const type = detectLogType(line);
  const timestamp = new Date().toISOString();
  
  // Essayer d'extraire le timestamp du log
  const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/);
  
  return {
    id: `${Date.now()}-${index}`,
    timestamp: timestampMatch ? timestampMatch[1] : timestamp,
    type,
    message: line,
    raw: line,
  };
}

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [logSource, setLogSource] = useState('app');
  const [showFilters, setShowFilters] = useState(false);
  const logsEndRef = useRef(null);
  const intervalRef = useRef(null);

  // Sources de logs disponibles
  const logSources = [
    { id: 'app', label: 'Application', icon: '📋' },
    { id: 'error', label: 'Erreurs', icon: '❌' },
    { id: 'sync', label: 'Synchronisation', icon: '🔄' },
    { id: 'print', label: 'Impression', icon: '🖨️' },
  ];

  // Charger les logs
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/api/logs/${logSource}`, {
        params: { lines: 500 },
        timeout: 5000,
      });
      
      if (response.data?.logs) {
        const parsedLogs = response.data.logs
          .split('\n')
          .filter(line => line.trim())
          .map((line, i) => parseLogLine(line, i));
        
        setLogs(parsedLogs);
      } else if (response.data?.content) {
        const parsedLogs = response.data.content
          .split('\n')
          .filter(line => line.trim())
          .map((line, i) => parseLogLine(line, i));
        
        setLogs(parsedLogs);
      }
    } catch (error) {
      console.error('Erreur chargement logs:', error);
      // Ajouter un log d'erreur local
      setLogs(prev => [...prev, {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        type: 'error',
        message: `Erreur chargement: ${error.message}`,
        raw: error.message,
      }]);
    } finally {
      setLoading(false);
    }
  }, [logSource]);

  // Auto-scroll vers le bas
  useEffect(() => {
    if (autoRefresh && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoRefresh]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      loadLogs();
      intervalRef.current = setInterval(loadLogs, 3000);
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh, loadLogs]);

  // Chargement initial
  useEffect(() => {
    loadLogs();
  }, [logSource]);

  // Filtrer les logs
  const filteredLogs = logs.filter(log => {
    const matchesSearch = !searchQuery || 
      log.message.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || log.type === filterType;
    return matchesSearch && matchesType;
  });

  // Effacer les logs (local seulement)
  const clearLogs = () => {
    setLogs([]);
  };

  // Télécharger les logs
  const downloadLogs = () => {
    const content = logs.map(l => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lagrace-logs-${logSource}-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-8 h-8 text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-gray-100">Logs Système</h1>
            <p className="text-sm text-gray-400">Visualisation en temps réel</p>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`btn btn-sm ${autoRefresh ? 'btn-success' : 'btn-ghost'}`}
            title={autoRefresh ? 'Pause' : 'Play'}
          >
            {autoRefresh ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={loadLogs}
            disabled={loading}
            className="btn btn-sm btn-ghost"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={downloadLogs}
            className="btn btn-sm btn-ghost"
            title="Télécharger"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={clearLogs}
            className="btn btn-sm btn-ghost text-red-400"
            title="Effacer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Source des logs */}
          <div className="flex items-center gap-2">
            {logSources.map(source => (
              <button
                key={source.id}
                onClick={() => setLogSource(source.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  logSource === source.id
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {source.icon} {source.label}
              </button>
            ))}
          </div>

          {/* Recherche */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher dans les logs..."
              className="input-field pl-10 py-1.5 text-sm"
            />
          </div>

          {/* Filtre par type */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn btn-sm btn-ghost flex items-center gap-1"
          >
            <Filter className="w-4 h-4" />
            Filtres
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Types de filtres */}
        {showFilters && (
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-700">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2 py-1 rounded text-xs ${filterType === 'all' ? 'bg-gray-600' : 'bg-gray-800'}`}
            >
              Tous
            </button>
            {Object.entries(LOG_TYPES).map(([key, config]) => (
              <button
                key={key}
                onClick={() => setFilterType(key)}
                className={`px-2 py-1 rounded text-xs ${config.color} ${filterType === key ? config.bg : 'bg-gray-800'}`}
              >
                {config.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Terminal */}
      <div className="card flex-1 overflow-hidden flex flex-col">
        <div className="bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500"></span>
              <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
              <span className="w-3 h-3 rounded-full bg-green-500"></span>
            </div>
            <span className="text-sm text-gray-400 ml-2">
              {logSources.find(s => s.id === logSource)?.label} — {filteredLogs.length} lignes
            </span>
          </div>
          {autoRefresh && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
              Live
            </span>
          )}
        </div>
        
        <div className="flex-1 overflow-auto bg-gray-950 p-4 font-mono text-sm">
          {filteredLogs.length === 0 ? (
            <div className="text-gray-500 text-center py-8">
              {loading ? 'Chargement...' : 'Aucun log disponible'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredLogs.map((log) => {
                const config = LOG_TYPES[log.type] || LOG_TYPES.info;
                return (
                  <div
                    key={log.id}
                    className={`${config.bg} px-2 py-1 rounded border-l-2 ${config.color.replace('text-', 'border-')}`}
                  >
                    <span className="text-gray-500 mr-2">
                      [{log.timestamp.slice(11, 19) || '??:??:??'}]
                    </span>
                    <span className={`${config.color} font-semibold mr-2`}>
                      [{config.label}]
                    </span>
                    <span className="text-gray-200 break-all">
                      {log.message}
                    </span>
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="text-xs text-gray-500 flex items-center justify-between px-2">
        <span>
          Chemin logs: C:\Glowflixprojet\logs\{logSource}.log
        </span>
        <span>
          Dernière mise à jour: {new Date().toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
