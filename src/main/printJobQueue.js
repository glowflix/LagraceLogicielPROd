import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getPaths } from "./paths.js";

function uid() {
  return crypto.randomUUID();
}

/**
 * Crée un job d'impression dans printer/tmp
 * @param {Object} payload - données du job (template, data, format, etc.)
 * @returns {Object} {id, jobPath, timestamp}
 */
export function enqueuePrintJob(payload) {
  const p = getPaths();
  const id = uid();
  const timestamp = Date.now();

  const jobData = {
    id,
    createdAt: timestamp,
    status: "pending",
    payload,
    result: null,
    error: null,
  };

  const jobPath = path.join(p.printerTmp, `${id}.json`);

  try {
    fs.writeFileSync(jobPath, JSON.stringify(jobData, null, 2));
    console.log(`✓ Job enqueued: ${id} → ${jobPath}`);
    return { id, jobPath, timestamp };
  } catch (err) {
    console.error(`❌ Erreur enqueue job:`, err);
    throw err;
  }
}

/**
 * Récupère les jobs en attente (tmp/)
 * @returns {Array} liste des fichiers jobs
 */
export function getPendingJobs() {
  const p = getPaths();
  try {
    return fs.readdirSync(p.printerTmp).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

/**
 * Marque un job comme succès (déplace tmp → ok)
 * @param {string} id - ID du job
 * @param {Object} result - résultat (pdfPath, htmlPath, etc.)
 */
export function markJobOk(id, result = {}) {
  const p = getPaths();
  const src = path.join(p.printerTmp, `${id}.json`);
  const dst = path.join(p.printerOk, `${id}.json`);

  try {
    // Lire le job original
    const data = JSON.parse(fs.readFileSync(src, "utf-8"));
    data.status = "success";
    data.completedAt = Date.now();
    data.result = result;

    // Écrire en ok/
    fs.writeFileSync(dst, JSON.stringify(data, null, 2));
    fs.unlinkSync(src);
    console.log(`✓ Job OK: ${id}`);
  } catch (err) {
    console.error(`❌ Erreur marking job OK:`, err);
  }
}

/**
 * Marque un job comme erreur (déplace tmp → err + écrit error.txt)
 * @param {string} id - ID du job
 * @param {Error|string} error - l'erreur
 */
export function markJobErr(id, error) {
  const p = getPaths();
  const src = path.join(p.printerTmp, `${id}.json`);
  const dst = path.join(p.printerErr, `${id}.json`);
  const errFile = path.join(p.printerErr, `${id}.error.txt`);

  try {
    // Lire le job original s'il existe
    let data = {};
    if (fs.existsSync(src)) {
      data = JSON.parse(fs.readFileSync(src, "utf-8"));
      fs.renameSync(src, dst);
    } else {
      // Job déjà disparu, créer minimal
      data = { id, status: "error", createdAt: Date.now() };
      fs.writeFileSync(dst, JSON.stringify(data, null, 2));
    }

    // Écrire l'erreur
    const errorMsg = error instanceof Error ? error.stack : String(error);
    fs.writeFileSync(errFile, errorMsg);
    console.log(`✗ Job ERR: ${id} → ${errFile}`);
  } catch (err) {
    console.error(`❌ Erreur marking job ERR:`, err);
  }
}

/**
 * Supprime un job (tmp ou ok/err)
 * @param {string} id - ID du job
 */
export function deleteJob(id) {
  const p = getPaths();
  const locations = [
    path.join(p.printerTmp, `${id}.json`),
    path.join(p.printerOk, `${id}.json`),
    path.join(p.printerErr, `${id}.json`),
    path.join(p.printerErr, `${id}.error.txt`),
  ];

  locations.forEach((loc) => {
    try {
      if (fs.existsSync(loc)) fs.unlinkSync(loc);
    } catch {
      // ignore
    }
  });
}

/**
 * Nettoie les vieux jobs (> X jours)
 * @param {number} daysOld - supprimer les jobs > X jours
 */
export function cleanupOldJobs(daysOld = 30) {
  const p = getPaths();
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;

  [p.printerOk, p.printerErr].forEach((dir) => {
    try {
      fs.readdirSync(dir).forEach((f) => {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fp);
        }
      });
    } catch (err) {
      console.warn(`Cleanup error in ${dir}:`, err.message);
    }
  });
}
