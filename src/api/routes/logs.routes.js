/**
 * Routes API pour les logs système
 * Permet de récupérer les logs en temps réel pour l'affichage dans l'UI
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { optionalAuth } from '../middlewares/auth.js';
import { getLogsDir, getDataRoot } from '../../core/paths.js';

const router = express.Router();

// Buffer de logs en mémoire pour temps réel
const logBuffer = {
  main: [],
  server: [],
  print: [],
};
const MAX_BUFFER_SIZE = 1000;

// Ajouter un log au buffer
export function addLog(source, message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}`;
  
  if (!logBuffer[source]) logBuffer[source] = [];
  logBuffer[source].push(entry);
  
  // Limiter la taille du buffer
  if (logBuffer[source].length > MAX_BUFFER_SIZE) {
    logBuffer[source] = logBuffer[source].slice(-MAX_BUFFER_SIZE);
  }
}

// Lire les dernières lignes d'un fichier
function tailFile(filePath, lines = 500) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const stat = fs.statSync(filePath);
    const maxBytes = 1024 * 1024; // 1MB max
    const start = Math.max(0, stat.size - maxBytes);
    
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
      fs.readSync(fd, buffer, 0, buffer.length, start);
      const content = buffer.toString('utf-8');
      const allLines = content.split(/\r?\n/).filter(l => l.trim());
      return allLines.slice(-lines).join('\n');
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    console.error('Erreur lecture fichier log:', error);
    return null;
  }
}

/**
 * GET /api/logs/:source
 * Récupère les logs d'une source spécifique
 */
router.get('/:source', optionalAuth, (req, res) => {
  try {
    const source = req.params.source || 'app';
    const lines = parseInt(req.query.lines) || 500;
    
    // Sources autorisées (mapping vers noms de fichiers)
    const sourceMap = {
      'app': 'app.log',
      'main': 'app.log',
      'error': 'error.log',
      'sync': 'sync.log',
      'print': 'print.log',
      'server': 'app.log',
      'backend': 'app.log',
    };
    
    if (!sourceMap[source]) {
      return res.status(400).json({ 
        success: false, 
        error: 'Source non valide',
        allowed: Object.keys(sourceMap) 
      });
    }
    
    const logsDir = getLogsDir();
    const dataRoot = getDataRoot();
    
    // Chemins possibles pour les logs
    const fileName = sourceMap[source];
    const candidates = [
      path.join(logsDir, fileName),
      path.join(dataRoot, 'logs', fileName),
    ];
    
    // Essayer de lire le fichier
    let content = null;
    let foundPath = null;
    
    for (const candidate of candidates) {
      content = tailFile(candidate, lines);
      if (content !== null) {
        foundPath = candidate;
        break;
      }
    }
    
    // Si pas de fichier, utiliser le buffer mémoire
    if (content === null) {
      const bufferContent = logBuffer[source] || [];
      content = bufferContent.slice(-lines).join('\n');
    }
    
    res.json({
      success: true,
      source,
      path: foundPath || 'memory',
      lines: content.split('\n').filter(l => l).length,
      logs: content,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/logs
 * Liste toutes les sources de logs disponibles
 */
router.get('/', optionalAuth, (req, res) => {
  try {
    const logsDir = getLogsDir();
    const dataRoot = getDataRoot();
    
    const sources = [];
    
    // Lister les fichiers .log
    const dirs = [logsDir, path.join(dataRoot, 'logs')];
    
    for (const dir of dirs) {
      try {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.log'));
          files.forEach(f => {
            const name = f.replace('.log', '');
            if (!sources.find(s => s.name === name)) {
              const filePath = path.join(dir, f);
              const stat = fs.statSync(filePath);
              sources.push({
                name,
                file: f,
                path: filePath,
                size: stat.size,
                modified: stat.mtime,
              });
            }
          });
        }
      } catch {}
    }
    
    // Ajouter les sources en mémoire
    Object.keys(logBuffer).forEach(name => {
      if (!sources.find(s => s.name === name)) {
        sources.push({
          name,
          file: null,
          path: 'memory',
          size: logBuffer[name].length,
          modified: new Date(),
        });
      }
    });
    
    res.json({
      success: true,
      logsDir,
      dataRoot,
      sources,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/logs/:source
 * Ajoute un log (pour les composants frontend)
 */
router.post('/:source', optionalAuth, (req, res) => {
  try {
    const source = req.params.source || 'main';
    const { message, level } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message requis' });
    }
    
    const prefix = level ? `[${level.toUpperCase()}]` : '[INFO]';
    addLog(source, `${prefix} ${message}`);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/logs/:source
 * Efface les logs d'une source
 */
router.delete('/:source', optionalAuth, (req, res) => {
  try {
    const source = req.params.source || 'main';
    
    // Effacer le buffer mémoire
    if (logBuffer[source]) {
      logBuffer[source] = [];
    }
    
    // Optionnel: effacer le fichier
    if (req.query.file === 'true') {
      const logsDir = getLogsDir();
      const filePath = path.join(logsDir, `${source}.log`);
      if (fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '');
      }
    }
    
    res.json({ success: true, cleared: source });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
