import winston from "winston";
import path from "path";
import { getLogsDir } from "./paths.js";

const logsDir = getLogsDir();

// Format personnalisé pour les logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Format console (plus lisible)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Création du logger principal
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  defaultMeta: { service: "glowflixprojet" },
  transports: [
    // Fichier pour toutes les logs
    new winston.transports.File({
      filename: path.join(logsDir, "app.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Fichier séparé pour les erreurs
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 5242880,
      maxFiles: 5,
    }),
    // Console en développement
    ...(process.env.NODE_ENV !== "production" 
      ? [new winston.transports.Console({ format: consoleFormat })]
      : []
    ),
  ],
});

// Logger spécialisé pour la synchronisation
export const syncLogger = winston.createLogger({
  level: "info",
  format: logFormat,
  defaultMeta: { service: "sync" },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, "sync.log"),
      maxsize: 5242880,
      maxFiles: 5,
    }),
    // Console pour voir les logs dans le terminal
    new winston.transports.Console({ format: consoleFormat }),
  ],
});

// Logger spécialisé pour l'impression
export const printLogger = winston.createLogger({
  level: "info",
  format: logFormat,
  defaultMeta: { service: "print" },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, "print.log"),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

