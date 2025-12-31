import fs from "node:fs";
import path from "node:path";
import { getPaths } from "./paths.js";

class Logger {
  constructor(name) {
    this.name = name;
    this.logFile = null;
  }

  initialize() {
    const { logsDir } = getPaths();
    const filename = `${this.name}.log`;
    this.logFile = path.join(logsDir, filename);
  }

  _write(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;
    const msg = data
      ? `${prefix} ${message} ${JSON.stringify(data, null, 2)}`
      : `${prefix} ${message}`;

    // Console
    switch (level) {
      case "ERROR":
        console.error(msg);
        break;
      case "WARN":
        console.warn(msg);
        break;
      default:
        console.log(msg);
    }

    // File
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, msg + "\n");
      } catch (err) {
        console.error(`Log file error: ${err.message}`);
      }
    }
  }

  info(message, data) {
    this._write("INFO", message, data);
  }

  warn(message, data) {
    this._write("WARN", message, data);
  }

  error(message, data) {
    this._write("ERROR", message, data);
  }

  debug(message, data) {
    if (process.env.DEBUG) {
      this._write("DEBUG", message, data);
    }
  }

  /**
   * Nettoie les anciens logs (> X jours)
   */
  cleanupOldLogs(daysOld = 14) {
    const { logsDir } = getPaths();
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;

    try {
      fs.readdirSync(logsDir).forEach((f) => {
        const fp = path.join(logsDir, f);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fp);
        }
      });
    } catch (err) {
      this.error("Cleanup logs error", err);
    }
  }
}

// Instances globales
export const mainLogger = new Logger("main");
export const backendLogger = new Logger("backend");
export const printLogger = new Logger("print");
export const aiLogger = new Logger("ai");

// Initialisation au démarrage
export function initializeLoggers() {
  mainLogger.initialize();
  backendLogger.initialize();
  printLogger.initialize();
  aiLogger.initialize();

  mainLogger.info("📝 Loggers initialized");
}
