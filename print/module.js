// src/print/module.js — Ultra PRO v2.4 (+ DZ/SZN full patch + auto font fit)

import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import dayjs from "dayjs";
import { fileURLToPath } from "url";
import express from "express";
import ptp from "pdf-to-printer";
const { print: printPDF, getPrinters } = ptp;
import Handlebars from "handlebars";
import { exec, spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ========= Console helpers ========= */
const ANSI = { reset:"\u001b[0m", bold:"\u001b[1m", dim:"\u001b[2m", red:"\u001b[31m", green:"\u001b[32m", yellow:"\u001b[33m", blue:"\u001b[34m", magenta:"\u001b[35m", cyan:"\u001b[36m", gray:"\u001b[90m" };
const clr = (c,s)=>`${ANSI[c]||""}${s}${ANSI.reset}`;
const banner = (level, title, lines=[]) => {
  const color = level==="error"?"red":level==="warn"?"yellow":level==="info"?"cyan":"gray";
  const border = "".padEnd(60,"=");
  const head = `${clr(color,border)}\n${clr(color,`■■ ${title}`)}\n${clr(color,border)}`;
  return [head, ...lines].filter(Boolean).join("\n");
};

/* ========= Constantes ========= */
const DEFAULT_TEMPLATE   = process.env.PRINT_DEFAULT_TEMPLATE || "receipt-80";
const TOP_NUDGE_MM_ENV   = Number(process.env.PRINT_TOP_NUDGE_MM ?? 0.5);
const SAFE_NUDGE_MAX_MM  = 0.9;
const TOP_NUDGE_MM       = Math.min(Math.max(0, TOP_NUDGE_MM_ENV), SAFE_NUDGE_MAX_MM);
const ROTATE_180         = (process.env.PRINT_ROTATE_180 ?? "0") !== "0";

/* ========= Front (deep-link dettes) ========= */
const FRONT_BASE = (process.env.DETTEs_FRONT_BASE || process.env.APP_BASE_URL || "http://localhost:3000").trim();
const COMP_PATH  = (process.env.COMP_PATH || "/comp.html").trim();
const DEEPLINK_DELAY_MS       = Number(process.env.DETTEs_DEEPLINK_DELAY_MS || 3000);
const DEEPLINK_EXTRA_WAIT_MS  = Number(process.env.DETTEs_DEEPLINK_EXTRA_WAIT_MS || 3500);
const USE_PS_FALLBACK         = (process.env.DEEPLINK_PS_FALLBACK ?? "1") !== "0";

/* ========= Stock API (MARK lookup + contrôle unité CARTON) ========= */
const STOCK_API_URL = (process.env.STOCK_API_URL || "http://localhost:3000/api/stock").trim();
const STOCK_API_TIMEOUT_MS = Number(process.env.STOCK_API_TIMEOUT_MS || 2000);
const LOOKUP_MARK_FROM_STOCK = (process.env.LOOKUP_MARK_FROM_STOCK ?? "1") !== "0";
const NBSP = "\u202f";
const HAIRSP = "\u200a";
const MAX_MONEY_CHARS = Number(process.env.PRINT_MAX_MONEY_CHARS || 18);
const FC_MONEY = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const USD_MONEY = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FC_COMPACT = new Intl.NumberFormat("fr-FR", { notation: "compact", compactDisplay: "short", maximumFractionDigits: 1 });
const USD_COMPACT = new Intl.NumberFormat("fr-FR", { notation: "compact", compactDisplay: "short", maximumFractionDigits: 2 });
const QTY_INT_FMT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const QTY_FLOAT_FMT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MarkCache = new Map(); // key: nom normalisé -> { mark, unite, code, nom }

/* ========= Fetch JSON avec timeout ========= */
async function timedFetchJson(url, { timeoutMs = STOCK_API_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const limit = Math.max(400, timeoutMs || STOCK_API_TIMEOUT_MS);
  const timer = setTimeout(() => ctrl.abort(), limit);
  try {
    const f = globalThis.fetch || (await import("node-fetch")).default;
    const res = await f(url, { signal: ctrl.signal, headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[PRINT] timedFetchJson fallback (${url}) ->`, err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function candidateUrls(base) {
  const u = (base || "").trim();
  const urls = new Set();
  if (!u) return [];
  urls.add(u);
  if (/stockmode/i.test(u) && !/carton/i.test(u)) urls.add(`${u}/carton`);
  if (!/stockmode/i.test(u)) {
    urls.add(`${u}?mode=carton`);
    urls.add(`${u}/carton`);
  }
  return Array.from(urls);
}

const normNameKey = (s) => String(s||"").normalize("NFKC").toLowerCase().replace(/\s+/g," ").trim();
const ULOW = (s)=>String(s||"").trim().toLowerCase();

/* Lookup inventaire nom/code */
async function findByNameOrCodeFromStock({ name, code }) {
  const keyName = normNameKey(name);
  const keyCode = (code||"").trim().toLowerCase();
  for (const url of candidateUrls(STOCK_API_URL)) {
    try {
      const json  = await timedFetchJson(url);
      const items = Array.isArray(json) ? json
                  : Array.isArray(json?.data) ? json.data
                  : (json && typeof json === "object") ? [json] : [];
      const hit = items.find(it => {
        const n = normNameKey(it?.nom || it?.name || it?.designation);
        const c = String(it?.code || it?.ref || "").trim().toLowerCase();
        return (keyName && n === keyName) || (keyCode && c === keyCode);
      });
      if (!hit) continue;
      return {
        mark:  String(hit?.mark ?? hit?.marque ?? "").trim(),
        unite: String(hit?.unite ?? hit?.unit   ?? "").trim().toLowerCase(),
        code:  String(hit?.code ?? hit?.ref     ?? "").trim(),
        nom:   String(hit?.nom  ?? hit?.name    ?? hit?.designation ?? "").trim(),
      };
    } catch {}
  }
  return null;
}

/* ========= Build-mode friendly (Electron asar + Chrome vendored) ========= */
function resolveTemplatesDir(fallbackDirByModule) {
  try {
    const manual = process.env.PRINT_TEMPLATES_DIR && path.resolve(process.env.PRINT_TEMPLATES_DIR);
    const candidates = [
      manual,
      (typeof process !== "undefined" && process.resourcesPath)
        ? path.join(process.resourcesPath, "print", "templates") : null,
      fallbackDirByModule,
    ].filter(Boolean);
    for (const d of candidates) {
      try { if (d && fs.existsSync(d)) return d; } catch {}
    }
    return fallbackDirByModule;
  } catch { return fallbackDirByModule; }
}

/* ========= Détection Chrome/Chromium exécutable ========= */
function pathExists(p){ try{ return !!p && fs.existsSync(p); }catch{ return false; } }
function findFileDeep(dir, names, depth=4){
  try{
    if (!dir || !fs.existsSync(dir) || depth<0) return null;
    const ents = fs.readdirSync(dir,{withFileTypes:true});
    for(const e of ents){
      const full = path.join(dir, e.name);
      if (e.isFile() && names.includes(e.name)) return full;
      if (e.isDirectory()){
        const hit = findFileDeep(full, names, depth-1);
        if (hit) return hit;
      }
    }
  }catch{}
  return null;
}
function detectChromeExecutableFromBase(base){
  if (!pathExists(base)) return null;
  if (process.platform === "win32") {
    const hit = findFileDeep(base, ["chrome.exe","msedge.exe"], 6);
    if (hit) return hit;
  } else if (process.platform === "darwin") {
    const app = findFileDeep(base, ["Google Chrome.app","Chromium.app","Microsoft Edge.app"], 6);
    if (app) return path.join(app, "Contents", "MacOS", path.basename(app, ".app"));
  } else {
    const hit = findFileDeep(base, ["chrome","chromium","chromium-browser","google-chrome","msedge"], 6);
    if (hit) return hit;
  }
  return null;
}
function detectChromeExecutable() {
  const envPath = (process.env.LAGRACE_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (pathExists(envPath)) return envPath;

  const resBase = (process.resourcesPath ? path.join(process.resourcesPath, "chromium") : null);
  if (resBase && pathExists(resBase)) {
    if (process.platform === "win32") {
      const hit = findFileDeep(resBase, ["chrome.exe","msedge.exe"], 6);
      if (hit) return hit;
    } else if (process.platform === "darwin") {
      const app = findFileDeep(resBase, ["Chromium.app","Google Chrome.app","Microsoft Edge.app"], 6);
      if (app) return path.join(app, "Contents", "MacOS", path.basename(app, ".app"));
    } else {
      const hit = findFileDeep(resBase, ["chrome","chromium","chromium-browser","google-chrome","msedge"], 6);
      if (hit) return hit;
    }
  }

  const devVendor = path.join(process.cwd(), "vendor", "chromium");
  const devHit = detectChromeExecutableFromBase(devVendor);
  if (devHit) return devHit;

  if (process.platform === "win32") {
    const guesses = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    ];
    const hit = guesses.find(pathExists);
    if (hit) return hit;
  } else if (process.platform === "darwin") {
    const guesses = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ];
    const hit = guesses.find(pathExists);
    if (hit) return hit;
  } else {
    const guesses = [
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge"
    ];
    const hit = guesses.find(pathExists);
    if (hit) return hit;
  }

  return null;
}
const CHROME_EXECUTABLE = detectChromeExecutable();

/* ========= Handlebars ========= */
function registerHbsHelpers({ assetsDir }) {
  if (Handlebars.helpers.__ultra_registered__) return;

  Handlebars.registerHelper("fmtFC", (v) => formatMoneyTight(v, "FC"));
  Handlebars.registerHelper("fmtUSD", (total, taux) => {
    const t = Number(total || 0);
    const r = Number(taux || 0);
    if (!t || !r) return formatMoneyTight(0, "USD");
    return formatMoneyTight(t / r, "USD");
  });
  Handlebars.registerHelper("fmtUSDnum", (v) => formatMoneyTight(v, "USD"));

  Handlebars.registerHelper("date", (d, fmt) => dayjs(d || new Date()).format(fmt || "YYYY-MM-DD HH:mm"));
  Handlebars.registerHelper("now", (fmt) => dayjs().format(fmt || "YYYY-MM-DD HH:mm"));
  Handlebars.registerHelper("eq", (a,b)=>a===b);
  Handlebars.registerHelper("or", (a,b)=>a||b);
  // ➕ helpers pour sizing intelligent
  Handlebars.registerHelper("and", (a,b)=>a&&b);
  Handlebars.registerHelper("len", (a)=>Array.isArray(a)?a.length:(a&&a.length)||0);
  Handlebars.registerHelper("gte", (a,b)=>Number(a)>=Number(b));
  Handlebars.registerHelper("lte", (a,b)=>Number(a)<=Number(b));

  Handlebars.registerHelper("asset", (rel) => {
    try {
      const file = path.join(assetsDir, String(rel || ""));
      const buf = fs.readFileSync(file);
      const ext = path.extname(file).toLowerCase();
      const mime = ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" :
                  ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
                  ext === ".gif" ? "image/gif" : "application/octet-stream";
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch { return ""; }
  });
  Handlebars.registerHelper("coalesce", (a,b) => (a!=null && String(a).trim()!=="") ? a : b);
  Handlebars.registerHelper("raw", (html) => new Handlebars.SafeString(String(html ?? "")));

  Handlebars.helpers.__ultra_registered__ = true;
}

function ensureDefaultTemplates(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "receipt-80.hbs");
    if (!fs.existsSync(file)) fs.writeFileSync(file, DEFAULT_80MM_HBS, "utf-8");
  } catch (e) {
    console.warn("[PRINT] ensureDefaultTemplates error:", e?.message || e);
  }
}

function createTemplateEngine(templatesDir, assetsDir) {
  ensureDefaultTemplates(templatesDir);
  registerHbsHelpers({ assetsDir });
  const cache = new Map();
  const exists = (name)=>fs.existsSync(path.join(templatesDir, `${name}.hbs`));
  const load = (name)=>Handlebars.compile(fs.readFileSync(path.join(templatesDir, `${name}.hbs`), "utf-8"), { noEscape: true });
  const compileIntoCache = (name) => {
    const use = exists(name) ? name : DEFAULT_TEMPLATE;
    if (!exists(name)) console.warn(`[PRINT] Template '${name}' introuvable → fallback '${DEFAULT_TEMPLATE}'`);
    if (!cache.has(use)) cache.set(use, load(use));
    return cache.get(use);
  };
  return {
    exists,
    list: () => fs.readdirSync(templatesDir).filter(f=>f.endsWith(".hbs")).map(f=>f.replace(/\.hbs$/,"")),
    render: (name, data) => compileIntoCache(name)(data || {}),
    preloadAll: () => {
      try {
        const all = fs.readdirSync(templatesDir).filter(f => f.endsWith(".hbs"));
        for (const tpl of all) compileIntoCache(tpl.replace(/\.hbs$/,""));
      } catch (e) {
        console.warn("[PRINT] preload templates error:", e?.message || e);
      }
    }
  };
}

/* ========= Déduplication (anti-réimpression) ========= */
const DEDUPE_DEPTH = Number(process.env.PRINT_DEDUPE_DEPTH || 3);
const DEDUPE_FILE  = ".dedupe.json";

function safeStringify(obj){
  return JSON.stringify(obj, (k, v) => (v === undefined ? null : v));
}

function pickLineForFingerprint(l){
  return {
    code: String(l.code ?? "").trim(),
    nom: String(l.nom ?? l.designation ?? "").trim().toLowerCase(),
    unite: String(l.unite ?? l.unit ?? "").trim().toLowerCase(),
    qteLabel: String(l.qteLabel ?? "").trim(),
    qty: Number(l.qty ?? l.quantite ?? l.qte ?? 0),
    puFC: Number(l.puFC ?? l.pu ?? 0),
    totalFC: Number(l.totalFC ?? l.total ?? 0),
    puUSD: Number(l.puUSD ?? 0),
    totalUSD: Number(l.totalUSD ?? 0),
  };
}

function normalizeForFingerprint(job){
  const d = job?.data && typeof job.data === "object" ? job.data : job;

  const raw = Array.isArray(d.lines) ? d.lines : (Array.isArray(d.lignes) ? d.lignes : []);
  const lines = raw.map(pickLineForFingerprint).sort((a,b)=>{
    return (
      (a.code||"").localeCompare(b.code||"") ||
      (a.nom||"").localeCompare(b.nom||"") ||
      (a.unite||"").localeCompare(b.unite||"") ||
      (a.qty||0) - (b.qty||0) ||
      (a.totalFC||0) - (b.totalFC||0) ||
      (a.totalUSD||0) - (b.totalUSD||0)
    );
  });

  const totalFC  = Number(d.totalFC ?? d.total ?? 0);
  const totalUSD = Number(d.totalUSD ?? 0);

  return {
    numero: String(d.factureNum ?? d.numero ?? d.num ?? "").trim(),
    client: String(d.client ?? "").trim().toLowerCase(),
    lines, totalFC, totalUSD,
    entreprise: {
      nom: String(d?.entreprise?.nom ?? "").trim().toLowerCase(),
      rccm: String(d?.entreprise?.rccm ?? "").trim().toLowerCase(),
      impot: String(d?.entreprise?.impot ?? "").trim().toLowerCase(),
    },
    dette: String(d?.meta?.dette ?? d?.meta?.credit ?? "").trim().toLowerCase(),
  };
}

function hashFingerprint(obj){
  const data = safeStringify(obj);
  const { createHash } = require("crypto");
  return createHash("sha1").update(data).digest("hex");
}

function loadDedupeStore(dir){
  try{
    const p = path.join(dir, DEDUPE_FILE);
    if (!fs.existsSync(p)) return { last: [] };
    const j = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!Array.isArray(j?.last)) return { last: [] };
    return { last: j.last.slice(-Math.max(3, DEDUPE_DEPTH)) };
  }catch{ return { last: [] }; }
}

function saveDedupeStore(dir, store){
  try{
    const p = path.join(dir, DEDUPE_FILE);
    fs.writeFileSync(p, JSON.stringify({ last: store.last.slice(-Math.max(3, DEDUPE_DEPTH)) }, null, 2), "utf-8");
  }catch{}
}

function recordSuccessfulJobFingerprint(store, fp, meta={}){
  store.last.push({
    at: Date.now(),
    fp,
    numero: meta.numero || "",
    totalFC: meta.totalFC ?? 0,
    totalUSD: meta.totalUSD ?? 0,
  });
  if (store.last.length > Math.max(3, DEDUPE_DEPTH)*4) {
    store.last = store.last.slice(-Math.max(3, DEDUPE_DEPTH)*4);
  }
}

function isDuplicate(store, fp, numero){
  if (numero){
    const seenSameNum = store.last.slice(-Math.max(6, DEDUPE_DEPTH*2)).some(e => String(e.numero||"") === String(numero));
    if (seenSameNum) return { duplicate: true, reason: "same-facture" };
  }
  const recent = store.last.slice(-Math.max(3, DEDUPE_DEPTH));
  if (recent.some(e => e.fp === fp)) return { duplicate: true, reason: "same-fingerprint" };
  return { duplicate: false };
}

/* ========= HTML → PDF (ticket 80mm, collé en haut) ========= */
async function renderPDFfromHTML(html, { ticketWidthMM } = {}) {
  const puppeteer = (await import("puppeteer")).default;

  const baseArgs = [
    "--no-sandbox","--disable-setuid-sandbox","--disable-gpu","--disable-dev-shm-usage",
    "--no-first-run","--no-default-browser-check","--disable-features=TranslateUI",
  ];
  const opts = { headless: "new", args: baseArgs };

  if (CHROME_EXECUTABLE) {
    opts.executablePath = CHROME_EXECUTABLE;
  } else {
    if (process.platform === "win32" || process.platform === "darwin") opts.channel = "chrome";
    else opts.channel = "chromium";
  }

  let browser;
  try {
    browser = await puppeteer.launch(opts);
  } catch {
    const alt = { headless: "new", args: baseArgs };
    browser = await puppeteer.launch(alt);
  }

  try {
    const page = await browser.newPage();
    await page.emulateMediaType("screen");

    const safetyCSS = `
      @page{margin:0}
      html,body{margin:0;padding:0;background:#fff;color:#000}
      .__ticket-root{position:fixed;left:0;top:0;width:100%;}
      .__ticket-nudge{transform: translateY(-${TOP_NUDGE_MM}mm);}
      ${ROTATE_180 ? "body{transform:rotate(180deg)}" : ""}
    `;
    const wrappedHTML = `
      <!doctype html><html><head><meta charset="utf-8">
        <style>${safetyCSS}</style>
      </head><body>
        <div class="__ticket-root __ticket-nudge">${html}</div>
      </body></html>`;

    await page.setContent(wrappedHTML, { waitUntil: "networkidle0" });

    if (ticketWidthMM) {
      const pxHeight = await page.evaluate(() =>
        Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 0)
      );
      const mmHeight = Math.max(40, Math.ceil(pxHeight * 0.264583));
      return await page.pdf({
        printBackground: true,
        preferCSSPageSize: false,
        width: `${ticketWidthMM}mm`,
        height: `${mmHeight}mm`,
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
        displayHeaderFooter: false,
        pageRanges: "1",
        scale: 1
      });
    }
    return await page.pdf({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  } finally {
    try { await browser?.close(); } catch {}
  }
}

/* ========= Impression ========= */
async function printPDFSilent(pdfPath, { printer, copies=1 } = {}) {
  const opts = { printer: printer || undefined, copies: Number(copies) || 1, scale: "noscale" };
  await printPDF(pdfPath, opts);
}

/* ========= Erreurs ========= */
function classifyError(err = {}, ctx = {}) {
  const msg = String(err?.message || err || "");
  const low = msg.toLowerCase();
  let code = "E_UNKNOWN";
  let hint = "Raison inconnue. Vérifie le Spouleur et la disponibilité de l'imprimante.";
  if (err?.name === "SyntaxError" && /json/i.test(msg)) { code = "E_BAD_JSON"; hint = "JSON invalide."; }
  else if (err?.code === "ENOENT") { code = "E_NOFILE"; hint = "Fichier introuvable (chemin invalide ou supprimé)."; }
  else if (/printer name is invalid|unknown printer|not found/.test(low)) { code = "E_PRINTER_NOT_FOUND"; hint = "Imprimante inconnue."; }
  else if (/no default printer|default printer/i.test(low)) { code = "E_NO_DEFAULT_PRINTER"; hint = "Aucune imprimante par défaut Windows."; }
  else if (/spool|winspool|0x00000|access is denied/.test(low)) { code = "E_SPOOLER"; hint = "Spouleur arrêté ou permissions insuffisantes."; }
  else if (/puppeteer|chromium|executable|could not find chrome/.test(low)) { code = "E_RENDERER"; hint = "Puppeteer/Chromium ne démarre pas (vérifie Chrome embarqué)."; }
  else if (/pdf|print|spawn|exit code/i.test(low)) { code = "E_PRINT_TOOL"; hint = "Échec d'envoi au pilote/outil PDF."; }
  else if (ctx?.cartonAssert === false) { code = "E_CARTON_LOOKUP_FAIL"; hint = "Article non trouvé comme CARTON dans le stock."; }
  return { code, message: msg, hint, context: ctx };
}
function writeErrorArtifacts(dirErr, baseName, errorInfo) {
  try {
    const txt = path.join(dirErr, baseName.replace(/\.(json|pdf)$/i, ".error.txt"));
    const jso = path.join(dirErr, baseName.replace(/\.(json|pdf)$/i, ".error.json"));
    const payload = { at: new Date().toISOString(), ...errorInfo };
    const human = [
      `[${payload.at}] ${errorInfo.code}: ${errorInfo.message}`,
      errorInfo.hint ? `hint: ${errorInfo.hint}` : null,
      errorInfo.context ? `context: ${JSON.stringify(errorInfo.context)}` : null,
      errorInfo.stack ? `stack: ${errorInfo.stack}` : null,
    ].filter(Boolean).join("\r\n");
    fs.writeFileSync(txt, human, "utf-8");
    fs.writeFileSync(jso, JSON.stringify(payload, null, 2), "utf-8");
  } catch {}
}

/* ========= Data helpers + règles MARK/QTY ========= */
const ensureNumber = (x) => { const n = Number(x ?? 0); return Number.isFinite(n) ? n : 0; };

const PIECE_LABEL_ABBR  = (process.env.PRINT_PIECE_LABEL || "PCE").toUpperCase();
const CARTON_LABEL      = (process.env.PRINT_CARTON_LABEL || "CARTON").toUpperCase();

/* ==== DZ / SZN rules (douzaine / sous-douzaine) ==== */
const DZ_LABEL  = "DZ";
const SZN_LABEL = (process.env.PRINT_SZN_LABEL || "SZN").toUpperCase(); // sous-douzaine = 1/2 DZ
const BASE_DZ_IN_MILLIER = 1/12; // 1 DZ = 0,083333…
const EPS = 0.015; // tolérance flottante
const roundToHalf = (n) => Math.round(n * 2) / 2;
const isNear = (v, t, tol=0.12) => Math.abs(v - t) <= tol;

const normalizeNbsp = (str = "") => String(str ?? "").replace(/\s/g, NBSP);
function formatMoneyTight(value, currency = "FC") {
  const upper = String(currency || "FC").toUpperCase();
  const n = Number(value || 0);
  const formatter = upper === "USD" ? USD_MONEY : FC_MONEY;
  const compactFormatter = upper === "USD" ? USD_COMPACT : FC_COMPACT;

  let formatted = normalizeNbsp(formatter.format(n));
  let out = `${formatted}${NBSP}${upper}`;
  if (out.length > MAX_MONEY_CHARS) {
    formatted = normalizeNbsp(compactFormatter.format(n));
    out = `${formatted}${NBSP}${upper}`;
  }
  return `${out}${HAIRSP}`;
}

function formatQuantityNumber(n) {
  const value = Number(n || 0);
  const formatter = Number.isInteger(value) ? QTY_INT_FMT : QTY_FLOAT_FMT;
  return normalizeNbsp(formatter.format(value));
}

/** tokens */
function isDZToken(s) {
  const x = String(s||"").toLowerCase();
  return /\b(dz|douz|douzaine|dozen)\b/.test(x);
}
function isSZNToken(s) {
  const x = String(s||"").toLowerCase();
  return /\b(szn|sous[-\s]?douzaine)\b/.test(x);
}
function isDZMark(mark) {
  return String(mark||"").trim().toUpperCase() === DZ_LABEL;
}

// Parse quantité "en DZ" + conversion millier→DZ avec arrondi au 0,5
function parseQtyInDZ({ qteLabel, qty, mark, unite }) {
  const raw = String(qteLabel||"").trim();
  let dz = null;

  const hasDZ  = isDZToken(raw) || isDZMark(mark);
  const hasSZN = isSZNToken(raw);
  const demi   = /\b(demi|1\/2|½)\b/i.test(raw) ? 0.5 : 0;

  const numM = raw.match(/-?\d+(?:[.,]\d+)?/);
  const num  = numM ? Number(String(numM[0]).replace(",", ".")) : null;

  if (hasSZN) {
    dz = (num != null ? num : 1) * 0.5;
    return dz > 0 ? dz : null;
  }

  if (hasDZ) {
    if (num != null && demi) dz = num + 0.5;
    else if (demi) dz = 0.5;
    else if (num != null) {
      if (num <= 1 + EPS) dz = roundToHalf(num / BASE_DZ_IN_MILLIER);
      else dz = num; // déjà en DZ
    } else dz = 1;
    return dz > 0 ? dz : null;
  }

  // Pas d'indication dans le label → si mark DZ + qty numérique → convertit "millier→DZ"
  if (isDZMark(mark) && qty != null && qty > 0) {
    if (isNear(qty, BASE_DZ_IN_MILLIER))        dz = 1;
    else if (isNear(qty, BASE_DZ_IN_MILLIER/2)) dz = 0.5;
    else                                        dz = roundToHalf(qty / BASE_DZ_IN_MILLIER);
    return dz > 0 ? dz : null;
  }

  return null;
}

/** Affichage DZ demandé
 * - 0.5 (±) → "DEMI DZ"
 * - n + 0.5 → "n 1/2 DZ" (1/2 plus petit)
 * - entier → "n DZ"
 * - autre fraction → fallback SZN
 */
function displayQtyDZ(dz) {
  const n = Number(dz || 0);
  const isHalfOnly = isNear(n, 0.5, 0.12); // couvre 0.4–0.6
  const frac = n - Math.trunc(n);

  if (isHalfOnly) {
    return {
      text: `DEMI ${DZ_LABEL}`,
      html:
        `<span class="qty-badge">` +
          `<span class="q">DEMI</span>` +
          `<span class="mk"><span class="mk-txt">${DZ_LABEL}</span></span>` +
        `</span>`
    };
  }

  // n + 1/2
  if (Math.abs(frac - 0.5) < 1e-9) {
    const int = Math.trunc(n);
    const formattedInt = formatQuantityNumber(int);
    return {
      text: `${formattedInt} 1/2 ${DZ_LABEL}`,
      html:
        `<span class="qty-badge">` +
          `<span class="q"><span class="q-int">${formattedInt}</span>&nbsp;<span class="q-frac">1/2</span></span>` +
          `<span class="mk"><span class="mk-txt">${DZ_LABEL}</span></span>` +
        `</span>`
    };
  }

  // entier strict
  if (Number.isInteger(n)) {
    const formatted = formatQuantityNumber(n);
    return {
      text: `${formatted} ${DZ_LABEL}`,
      html:
        `<span class="qty-badge">` +
          `<span class="q">${formatted}</span>` +
          `<span class="mk"><span class="mk-txt">${DZ_LABEL}</span></span>` +
        `</span>`
    };
  }

  // autre fraction → valeur décimale DZ (compacte)
  const formatted = formatQuantityNumber(n);
  return {
    text: `${formatted} ${DZ_LABEL}`,
    html:
      `<span class="qty-badge">` +
        `<span class="q">${formatted}</span>` +
        `<span class="mk"><span class="mk-txt">${DZ_LABEL}</span></span>` +
      `</span>`
  };
}

const UNIT_ALIASES = new Map([
  ["carton","carton"], ["ctn","carton"], ["cart","carton"], ["box","carton"],
  ["piece","piece"], ["pièce","piece"], ["pc","piece"], ["pcs","piece"], ["pce","piece"],
  ["millier","millier"], ["milliers","millier"], ["det","millier"], ["detail","millier"]
]);
const canonUnit = (u) => UNIT_ALIASES.get(ULOW(u)) || ULOW(u) || "";

// --- Détecter & retirer le suffixe "piece" dans nom/code ---
const PIECE_SUFFIX_RE = /(?:\s|-|_)*(?:pi[eè]ce|pi[eè]ces|piece|pieces|pce|pcs|pc)\s*$/i;
function looksPieceFromNameOrCode(s) {
  return PIECE_SUFFIX_RE.test(String(s || ""));
}
function stripPieceSuffix(s) {
  return String(s || "").replace(PIECE_SUFFIX_RE, "").trim();
}

/** Icône SVG carton */
const ICON_SVG_CARTON = `
<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
  <path d="M3 7.5 12 3l9 4.5v9L12 21 3 16.5v-9Z" fill="none" stroke="#000" stroke-width="1.6" />
  <path d="M12 21v-9M3 7.5l9 4.5 9-4.5" fill="none" stroke="#000" stroke-width="1.6"/>
</svg>`.trim();

function isUnitPiece(u){
  const s = canonUnit(u);
  return s==="piece";
}
function isUnitMillier(u){
  const s = canonUnit(u);
  return s==="millier";
}
function markLooksCarton(mark) {
  const m = String(mark||"").toLowerCase();
  return m.includes("carton") || m.includes("ctn") || m === "cart";
}
function markLooksPiece(mark) {
  const m = String(mark||"").toLowerCase();
  return m==="piece" || m==="pièce" || m==="pc" || m==="pcs" || m==="pce";
}

/* Cherche mark/unité depuis l’API par nom/code (cache) */
async function lookupFromStock({ nom, code }) {
  const key = normNameKey(nom || code || "");
  if (MarkCache.has(key)) return MarkCache.get(key);
  const hit = await findByNameOrCodeFromStock({ name: nom, code });
  if (!hit) return null;
  const out = { mark: String(hit.mark||"").trim(), unite: String(hit.unite||"").toLowerCase(), code: hit.code, nom: hit.nom };
  MarkCache.set(key, out);
  return out;
}

/** Résolution de la MARK */
async function resolveLineMark({ nom, code, unite, mark }) {
  const unit = canonUnit(unite);

  // Exception "douzaine": si mark = DZ on le garde même en 'millier'
  if (unit === "millier") {
    const wantDZ = String(mark||"").trim().toUpperCase() === DZ_LABEL;
    return wantDZ ? DZ_LABEL : "";
  }

  if (unit === "carton" && LOOKUP_MARK_FROM_STOCK) {
    const api = await lookupFromStock({ nom, code });
    const chosen = String((api?.mark || mark || "")).toUpperCase().trim();
    if (!chosen || chosen === "0") return CARTON_LABEL;
    return chosen;
  }
  return String(mark || "").toUpperCase().trim();
}

/** Construit {text, html, mark} pour la colonne Qté (hors cas DZ) */
function buildDisplayQtyFromLabel({ qteLabel, qty, unite, mark }) {
  const base = String((qteLabel != null ? String(qteLabel).trim() : "") ||
                      (Number.isFinite(qty) ? qty : "")).trim();
  const hasBase = base !== "";

  // RÈGLE MILLIER : badge simple sans mark (DZ traité ailleurs)
  if (isUnitMillier(unite) && !isDZMark(mark) && !isDZToken(qteLabel)) {
    const onlyHtml = hasBase
      ? `<span class="qty-badge"><span class="q">${base}</span></span>`
      : "";
    return { text: hasBase ? base : "", html: onlyHtml, mark: "" };
  }

  let mk = String(mark || "").trim().toUpperCase();
  if (isDZMark(mk)) mk = DZ_LABEL;
  else if (markLooksCarton(mk)) mk = CARTON_LABEL;
  else if (markLooksPiece(mk) || isUnitPiece(unite)) mk = PIECE_LABEL_ABBR;
  else if (!mk) mk = "";

  const text = hasBase && mk ? `${base}${NBSP}${mk}` : (hasBase ? base : mk);

  let mkHtml = "";
  if (mk === CARTON_LABEL) {
    mkHtml = `<span class="mk"><span class="mk-ic" title="Carton">${ICON_SVG_CARTON}</span></span>`;
  } else if (mk) {
    mkHtml = `<span class="mk"><span class="mk-txt">${mk}</span></span>`;
  }

  const html = `
    <span class="qty-badge">
      ${hasBase ? `<span class="q">${base}</span>` : ""}
      ${mkHtml}
    </span>`.replace(/\s+/g,' ').trim();

  return { text, html: mk ? html : (hasBase ? `<span class="qty-badge"><span class="q">${base}</span></span>` : ""), mark: mk };
}

/* ========= Parsing qteLabel (½, 1/2, DZ, etc.) ========= */
const HALF_RE = /\b(demi|1\/2|½)\b/i;
const NUM_FRACTION_RE = /(\d+)\s*\/\s*(\d+)/;
const NUM_DECIMAL_RE  = /-?\d+(?:[.,]\d+)?/;

function parseQteLabelToNumber(qteLabel) {
  const s = String(qteLabel || "").trim();
  if (!s) return null;

  if (HALF_RE.test(s)) return 0.5;

  const frac = s.match(NUM_FRACTION_RE);
  if (frac) {
    const a = Number(frac[1] || 0), b = Number(frac[2] || 0);
    if (b) return a / b;
  }

  const dec = s.match(NUM_DECIMAL_RE);
  if (dec) {
    const n = Number(String(dec[0]).replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/* ========= Détection intelligente du mode USD ========= */
function detectUSDMode(d) {
  const S = (v)=>String(v??"").trim().toUpperCase();
  const B = (v)=>{
    if (typeof v === "boolean") return v;
    const sv = S(v);
    return ["1","TRUE","YES","OUI","USD"].includes(sv);
  };
  if (S(d?.printCurrency) === "USD") return true;
  if (S(d?.currency) === "USD") return true;
  if (S(d?.saleCurrency) === "USD") return true;
  if (B(d?.ventesUsd)) return true;

  const m = d?.meta || {};
  if (S(m.currency) === "USD") return true;
  if (S(m.saleCurrency) === "USD") return true;
  if (B(m.ventesUsd) || B(m.usd)) return true;

  return false;
}

/* ========= SHRINK-TO-FIT PRO (anti-découpe, auto-adapté) ========= */

/**
 * Calcule la taille de police optimale selon le nombre de lignes et la longueur du contenu
 * Stratégie palier: 3-8 lignes (normal), 9-15 (tight), 16+ (ultra) + ajustements fin
 */
function calculateOptimalFontSize(lines, maxLabelLength = 0) {
  const count = lines.length;
  
  // Base: classes CSS existantes
  let baseClass = "";
  let fsScale = 1.0;
  let lhScale = 1.0;
  let marginScale = 1.0;
  
  if (count >= 16) {
    baseClass = "ultra";
    fsScale = 0.75; // 10px base → ~7.5px
    lhScale = 0.85;
    marginScale = 0.8;
  } else if (count >= 9) {
    baseClass = "tight";
    fsScale = 0.85; // 12px base → ~10.2px
    lhScale = 0.9;
    marginScale = 0.9;
  }
  
  // Ajustement fin si libellés très longs (> 25 chars moyen)
  const avgLen = maxLabelLength > 0 ? maxLabelLength : 15;
  if (avgLen > 30 && count > 5) {
    fsScale = Math.max(0.7, fsScale * 0.92); // réduction supplémentaire
  }
  
  return { baseClass, fsScale, lhScale, marginScale };
}

/**
 * Tronque intelligemment un libellé trop long
 * Stratégie: garder début + ... + fin (plus le milieu si il reste de la place)
 * Ex: "Very long product name with many words" → "Very long...many words"
 */
function truncateLongLabel(text, maxLength = 28) {
  const s = String(text || "").trim();
  if (s.length <= maxLength) return s;
  
  // Si contient des mots courts, essayer de garder le début et la fin
  const words = s.split(/\s+/);
  if (words.length >= 4) {
    const half = Math.floor(words.length / 2);
    const start = words.slice(0, half - 1).join(" ");
    const end = words.slice(-half + 1).join(" ");
    const candidate = `${start}…${end}`;
    if (candidate.length <= maxLength) return candidate;
  }
  
  // Fallback: début + ellipsis
  return s.slice(0, maxLength - 2) + "…";
}

/* ========= Normalisation (PU/PT selon devise) ========= */
async function normalizeData(job) {
  const d = job.data && typeof job.data === "object" ? job.data : job;

  const printCurrency = detectUSDMode(d) ? "USD" : "FC";
  const raw = Array.isArray(d.lines) ? d.lines : (Array.isArray(d.lignes) ? d.lignes : []);
  const outLines = [];

  const taux = ensureNumber(d.taux);
  
  // === SHRINK-TO-FIT PRO: Analyse préliminaire ===
  const maxLabelLength = raw.reduce((max, l) => {
    const lbl = String(l.nom || l.designation || "").length;
    return Math.max(max, lbl);
  }, 0);

  function rebuildPU({ puFC, puUSD, totalFC, totalUSD, qty, taux }) {
    let pu_fc  = ensureNumber(puFC);
    let pu_usd = ensureNumber(puUSD);
    const tot_fc  = ensureNumber(totalFC);
    const tot_usd = ensureNumber(totalUSD);
    const q = ensureNumber(qty) || 0;

    if ((!pu_fc || pu_fc === 0) && tot_fc > 0 && q > 0) pu_fc = tot_fc / q;
    if ((!pu_fc || pu_fc === 0) && tot_usd > 0 && q > 0 && taux > 0) { pu_usd = tot_usd / q; pu_fc  = pu_usd * taux; }

    if ((!pu_usd || pu_usd === 0) && pu_fc > 0 && taux > 0) pu_usd = +(pu_fc / taux);
    if ((!pu_fc || pu_fc === 0) && pu_usd > 0 && taux > 0) pu_fc = pu_usd * taux;

    pu_usd = Number.isFinite(pu_usd) ? +(pu_usd.toFixed(2)) : 0;
    pu_fc  = Number.isFinite(pu_fc)  ? Math.round(pu_fc) : 0;

    return { pu_fc, pu_usd };
  }

  for (const l of raw) {
    // ===== lecture brutes
    let qtyIn = ensureNumber(l.qty ?? l.quantite ?? l.qte);
    const puFCIn  = ensureNumber(l.puFC ?? l.pu ?? l.puFc);
    let totalFCIn = ensureNumber(l.totalFC ?? l.total ?? (qtyIn * puFCIn));

    const puUSDIn    = (l.puUSD != null) ? ensureNumber(l.puUSD)    : (taux ? Number((puFCIn / taux).toFixed(2)) : 0);
    let totalUSDIn   = (l.totalUSD != null) ? ensureNumber(l.totalUSD) : (taux ? Number((totalFCIn / taux).toFixed(2)) : qtyIn * puUSDIn);

    const qteLabel  = (l.qteLabel != null) ? String(l.qteLabel).trim() : "";
    let   unite     = canonUnit(l.unite ?? l.unit ?? "");
    const codeIn    = l.code ?? l.ref ?? "";
    let   nomIn     = l.nom  ?? l.designation ?? l.libelle ?? codeIn;
    const markIn    = l.mark ?? l.marque ?? "";

    // ===== qty fallback général depuis qteLabel (½, 1/2, 1.5, etc.) si qty nul
    if ((!qtyIn || qtyIn === 0) && qteLabel) {
      const parsed = parseQteLabelToNumber(qteLabel);
      if (parsed != null && parsed > 0) qtyIn = parsed;
    }
    if (!qtyIn || qtyIn <= 0) qtyIn = 1; // sécurité

    // === RÈGLE PIECE : suffixe "piece/pcs/pce" -> force unite='piece' et nettoie le nom
    const isPieceByText = looksPieceFromNameOrCode(nomIn) || looksPieceFromNameOrCode(codeIn);
    if (isPieceByText) {
      unite = "piece";
      const stripped = stripPieceSuffix(nomIn);
      nomIn = stripped || stripPieceSuffix(codeIn) || nomIn;
    }

    // Contrôle CARTON (ignoré si unite 'piece')
    const check = await assertCartonIfRequired({ nom: nomIn, code: codeIn, unite });
    if (!check.ok) {
      const err = new Error(check.error || "Contrôle CARTON échoué");
      err.cartonAssert = false;
      throw err;
    }

    // ===== Résolution du mark
    let markResolved = await resolveLineMark({ nom: nomIn, code: codeIn, unite, mark: markIn });

    // ====== Spécial DOUZAINE (DZ / SZN)
    let dzQty = null;
    let disp;
    if (isDZMark(markResolved) || isDZToken(qteLabel)) {
      dzQty = parseQtyInDZ({ qteLabel, qty: qtyIn, mark: markResolved, unite });
      if (dzQty != null) {
        qtyIn = dzQty; // quantité "vérité" pour calcul PU/PT en DZ
        const dispDZ = displayQtyDZ(dzQty); // DEMI DZ | n 1/2 DZ | n DZ | SZN
        disp = { text: dispDZ.text, html: dispDZ.html, mark: DZ_LABEL };
      }
    }

    // Si pas en mode DZ, on utilise l’affichage standard
    if (!dzQty) {
      const _d = buildDisplayQtyFromLabel({ qteLabel, qty: qtyIn, unite, mark: markResolved });
      disp = _d;
      markResolved = _d.mark || markResolved;
    }

    // ===== Reconstruction PU si manquant/0 (avec qtyIn possiblement = dzQty)
    const rebuilt = rebuildPU({
      puFC: puFCIn,
      puUSD: puUSDIn,
      totalFC: totalFCIn,
      totalUSD: totalUSDIn,
      qty: qtyIn,
      taux
    });
    let puFC  = rebuilt.pu_fc;
    let puUSD = rebuilt.pu_usd;

    // ===== Recalcule PT si incohérent
    if (totalFCIn <= 0 && puFC > 0) totalFCIn = Math.round(puFC * qtyIn);
    if (totalUSDIn <= 0 && puUSD > 0) totalUSDIn = +(puUSD * qtyIn).toFixed(2);

    const usesUSD = (printCurrency === "USD");
    const puPrint = usesUSD ? puUSD : puFC;
    const totalPrint = usesUSD ? totalUSDIn : totalFCIn;
    const currencyLabel = usesUSD ? "USD" : "FC";

    const puPrintTxt = formatMoneyTight(puPrint, currencyLabel);
    const totalPrintTxt = formatMoneyTight(totalPrint, currencyLabel);

    // === SHRINK-TO-FIT PRO: Troncature libellés longs ===
    let finalNom = String(nomIn || codeIn || "").trim();
    const rawCount = raw.length;
    if (finalNom.length > 28 && rawCount >= 10) {
      // Tronque si on a beaucoup de lignes
      finalNom = truncateLongLabel(finalNom, 28);
    } else if (finalNom.length > 35) {
      // Sinon tolère un peu plus
      finalNom = truncateLongLabel(finalNom, 35);
    }

    outLines.push({
      code: codeIn,
      nom: finalNom,
      unite,
      mark:  disp.mark,
      qteLabel,
      displayQte: disp.text,
      displayQteHtml: disp.html,
      qty: qtyIn,

      // "vérité" (FC)
      pu: puFC, puFC,
      total: totalFCIn, totalFC: totalFCIn,

      // USD
      puUSD,
      totalUSD: totalUSDIn,

      // Affichage selon devise
      puPrint,
      totalPrint,
      puPrintTxt,
      totalPrintTxt
    });
  }

  const sum = (k) => outLines.reduce((s,l)=>s + ensureNumber(l[k]), 0);

  const totalFC = ensureNumber(d.totalFC) || sum("totalFC");
  const total   = ensureNumber(d.total)   || totalFC;
  const totalUSD = Number.isFinite(Number(d.totalUSD)) ? ensureNumber(d.totalUSD)
                    : (taux ? Number((totalFC / taux).toFixed(2)) : sum("totalUSD"));

  // === SHRINK-TO-FIT PRO: Calcul des métadonnées CSS ===
  const shrinkFit = calculateOptimalFontSize(outLines, maxLabelLength>50 ? 50 : maxLabelLength);

  return {
    ...d,
    lines: outLines,
    total,
    totalFC,
    totalUSD,
    taux,
    printCurrency,
    factureNum: d.factureNum || d.numero || d.num || "",
    dateISO: d.dateISO || d.date || null,
    meta: d.meta || {},
    // Métadonnées shrink-to-fit pour le template
    shrinkFit: {
      class: shrinkFit.baseClass,
      fsScale: shrinkFit.fsScale,
      lhScale: shrinkFit.lhScale,
      marginScale: shrinkFit.marginScale,
      linesCount: outLines.length
    }
  };
}

/* ========= Pré-contrôle CARTON ========= */
async function assertCartonIfRequired(line) {
  const unit = canonUnit(line.unite);
  if (unit !== "carton") return { ok: true, reason: "not-carton" };
  const api = await lookupFromStock({ nom: line.nom, code: line.code });
  if (!api || api.unite !== "carton") {
    return { ok: false, error: `Article '${line.nom || line.code || "?"}' introuvable comme CARTON dans le stock.` };
  }
  return { ok: true, mark: api.mark };
}

/* ========= Deep-link DETTES (puppeteer + fallback) ========= */
function buildDetteDeepLink({ factureNum, isUSD=false, delayMs=DEEPLINK_DELAY_MS }) {
  const base = FRONT_BASE.endsWith("/") ? FRONT_BASE.slice(0, -1) : FRONT_BASE;
  const comp = COMP_PATH.startsWith("/") ? COMP_PATH : `/${COMP_PATH}`;
  const u = new URL(`${base}${comp}`);
  u.searchParams.set("facture", String(factureNum));
  u.searchParams.set("auto", "1");
  if (isUSD) u.searchParams.set("usd", "1"); else u.searchParams.delete("usd");
  u.searchParams.set("delay", String(Math.max(0, Number(delayMs)||0)));
  return u.toString();
}

async function openDeepLinkHeadless(url, { totalWaitMs, log }) {
  try {
    const puppeteer = (await import("puppeteer")).default;
    const baseArgs = [
      "--no-sandbox","--disable-setuid-sandbox","--disable-gpu","--disable-dev-shm-usage",
      "--no-first-run","--no-default-browser-check","--disable-features=TranslateUI",
    ];
    const opts = { headless: "new", args: baseArgs };
    if (CHROME_EXECUTABLE) opts.executablePath = CHROME_EXECUTABLE;
    let browser;
    try { browser = await puppeteer.launch(opts); }
    catch { browser = await puppeteer.launch({ headless:"new", args: baseArgs }); }

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
    await page.waitForTimeout(Math.max(500, totalWaitMs));
    try { await browser.close(); } catch {}
    log?.info?.(banner("info","DETTES via deep-link (headless)", [url]));
    return { ok:true, mode:"puppeteer" };
  } catch (e) {
    log?.warn?.(banner("warn","DEEP-LINK puppeteer KO → fallback", [String(e?.message||e)]));
    return { ok:false, error:e?.message || String(e) };
  }
}

async function openDeepLinkViaPowerShell(url, { totalWaitMs, log }) {
  if (process.platform !== "win32" || !USE_PS_FALLBACK) {
    return { ok:false, error:"fallback disabled or non-windows" };
  }
  const exe = CHROME_EXECUTABLE || "msedge.exe";
  const waitSec = Math.ceil(Math.max(1000, totalWaitMs)/1000);
  const ps = `
try {
  $p = Start-Process -FilePath "${exe}" -ArgumentList "--headless=new --disable-gpu --disable-extensions --mute-audio --window-size=800,600 --remote-allow-origins=* --disable-software-rasterizer --allow-insecure-localhost --disable-features=TranslateUI --app=\\"${url}\\"" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds ${waitSec}
  try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
  exit 0
} catch { exit 1 }`.trim();

  const { ok, stderr } = await execCmd(`powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`);
  if (ok) {
    log?.info?.(banner("info","DETTES via deep-link (PowerShell fallback)", [url]));
    return { ok:true, mode:"powershell" };
  }
  return { ok:false, error: stderr || "powershell failed" };
}

async function autoCreateDettesForFacture({ factureNum, isUSD=false, delayMs=DEEPLINK_DELAY_MS, io, log }) {
  if (!factureNum) return { ok:false, error:"factureNum requis" };
  const url = buildDetteDeepLink({ factureNum, isUSD, delayMs });
  const totalWaitMs = Number(delayMs) + Number(DEEPLINK_EXTRA_WAIT_MS);
  let r = await openDeepLinkHeadless(url, { totalWaitMs, log });
  if (!r.ok) r = await openDeepLinkViaPowerShell(url, { totalWaitMs, log });
  if (r.ok) {
    io?.emit?.("dettes-update");
    return { ok:true, mode:r.mode, factureNum, isUSD, url };
  }
  return { ok:false, error:r.error || "deep-link failed", factureNum, isUSD, url };
}

function shouldAutoDette(job) {
  const d = job?.data && typeof job.data === "object" ? job.data : job;
  const meta = d?.meta || job?.meta || {};
  const S = (v)=>String(v??"").trim().toUpperCase();
  const B = (v)=>{
    if (typeof v === "boolean") return v;
    const sv = S(v);
    return ["1","TRUE","YES","OUI","USD","OUI,DETTE","DETTE","CREDIT"].includes(sv);
  };
  return !!(
    job?.autoDette ||
    d?.autoDette ||
    meta?.autoDette ||
    B(meta?.isDette) ||
    B(meta?.credit) ||
    B(meta?.dette)
  );
}

/* ========= Template build ========= */
async function buildHTML(job, TPL) {
  const data = await normalizeData(job);
  data.entreprise = data.entreprise || {
    nom: "ALIMENTATION LA GRACE",
    rccm: "CD/KIS/RCCM 22-A-00172",
    impot: "A220883T",
    tel: "+243 896 885 373 / +243 819 082 637",
    logo: null,
    adresse: "Avenue Lac Tanganyika, Makiso, Kisangani, R.D.Congo"
  };
  data.now = new Date();
  const wanted = job.template || DEFAULT_TEMPLATE;
  return TPL.render(wanted, data);
}

/* ========= Default printer ========= */
async function getDefaultPrinterName() {
  try {
    const list = await getPrinters();
    const cand = list.find(p => p?.isDefault || p?.default || String(p?.attributes||"").toUpperCase().includes("DEFAULT"));
    return cand?.name;
  } catch { return undefined; }
}

/* ========= Guardian PS ========= */
function getGuardianPath() {
  const projectRoot = process.env.GLOWFLIX_ROOT_DIR 
    ? path.resolve(process.env.GLOWFLIX_ROOT_DIR)
    : (process.platform === "win32" 
      ? "C:\\Glowflixprojet" 
      : path.join(os.homedir(), "Glowflixprojet"));
  return path.join(projectRoot, "PrintQueueGuardian.ps1");
}
const PS_PATH = getGuardianPath();
function guardianScript(printRoot) {
  const root = printRoot || (process.platform === "win32" ? "C:\\Glowflixprojet\\printer" : path.join(os.homedir(), "Glowflixprojet", "printer"));
  return `# PrintQueueGuardian.ps1
$ErrorActionPreference = "Stop"
$Root = "${root.replace(/\\/g, "\\\\")}"
$LogName = "Application"
$Source  = "LaGrace-Printer"
if (-not [System.Diagnostics.EventLog]::SourceExists($Source)) { New-EventLog -LogName $LogName -Source $Source | Out-Null }
function Write-Event($lvl, $msg) { Write-Host "[$lvl] $msg"; $type = @{INFO="Information"; WARN="Warning"; ERROR="Error"}[$lvl]; Write-EventLog -LogName $LogName -Source $Source -EventId 5000 -EntryType $type -Message $msg }
try { $svc = Get-Service -Name Spooler -ErrorAction Stop; if ($svc.Status -ne "Running") { Start-Service Spooler; Write-Event INFO "Spooler démarré" } } catch { Write-Event ERROR "Spooler indisponible: $($_.Exception.Message)" }
while ($true) {
  try {
    $ok  = Join-Path $Root "ok"; $err = Join-Path $Root "err"; $tmp = Join-Path $Root "tmp"
    $files = Get-ChildItem -Path $Root -File -Include *.json,*.pdf -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notlike "$ok*" -and $_.FullName -notlike "$err*" -and $_.FullName -notlike "$tmp*" }
    foreach ($f in $files) {
      if ((New-TimeSpan -Start $f.LastWriteTime -End (Get-Date)).TotalSeconds -ge 10) {
        $tmpName = "$($f.FullName).poke"
        try { Rename-Item -Path $f.FullName -NewName $tmpName -ErrorAction Stop; Rename-Item -Path $tmpName -NewName $f.FullName -ErrorAction Stop; Write-Event WARN "Poke: $($f.Name)" } catch { Write-Event WARN "Poke échoué: $($f.Name) — $($_.Exception.Message)" }
      }
    }
  } catch { Write-Event ERROR "Guardian loop: $($_.Exception.Message)" }
  Start-Sleep -Seconds 2
}`;
}
function writeFileIfChanged(file, content) {
  try {
    if (fs.existsSync(file)) {
      const cur = fs.readFileSync(file, "utf-8");
      if (cur === content) return false;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf-8");
    return true;
  } catch { return false; }
}
const execCmd = (cmd, opts={}) => new Promise((resolve)=>exec(cmd,{windowsHide:true,...opts},(err,stdout,stderr)=>resolve({ok:!err,err,stdout,stderr})));
async function installGuardian({ logger, printDir }) {
  if (process.platform !== "win32") return { ok:false, reason:"non-windows" };
  const wrote = writeFileIfChanged(PS_PATH, guardianScript(printDir));
  const psArg = `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${PS_PATH}"`;
  const t1 = await execCmd(`schtasks /Create /TN "LaGrace Print Guardian (Startup)" /SC ONSTART /TR "${psArg}" /RU SYSTEM /RL HIGHEST /F`);
  const t2 = await execCmd(`schtasks /Create /TN "LaGrace Print Guardian (Logon)" /SC ONLOGON /TR "${psArg}" /RL HIGHEST /F`);
  try { const p = spawn("powershell.exe", ["-NoProfile","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File", PS_PATH], { windowsHide:true, stdio:"ignore", detached:true }); p?.unref?.(); } catch {}
  logger?.info?.(banner("info","Guardian installé", [
    `script: ${PS_PATH} ${wrote?"(écrit/maj)":"(déjà à jour)"}`,
    `schtasks Startup: ${t1.ok?"OK":"FAIL"}`,
    `schtasks Logon:   ${t2.ok?"OK":"FAIL"}`,
  ]));
  return { ok:true, wrote, schtasks:{ startup:t1, logon:t2 } };
}

/* ========= File queue helpers ========= */
function listRootJobs(PRINT_DIR) {
  try {
    return fs.readdirSync(PRINT_DIR)
      .filter(f => f.toLowerCase().endsWith(".json") || f.toLowerCase().endsWith(".pdf"))
      .map(f => path.join(PRINT_DIR, f))
      .filter(full => !full.toLowerCase().includes(`${path.sep}ok${path.sep}`) &&
                      !full.toLowerCase().includes(`${path.sep}err${path.sep}`) &&
                      !full.toLowerCase().includes(`${path.sep}tmp${path.sep}`));
  } catch { return []; }
}
function enqueueIfNotQueued(queue, file) {
  if (queue.some(q => q.file === file)) return false;
  const ext = path.extname(file).toLowerCase();
  queue.push({ type: ext === ".pdf" ? "pdf" : "json", file, enqueuedAt: Date.now() });
  return true;
}

/* ========= Module principal ========= */
export function createPrinterModule({
  io = null,
  logger = console,
  printDir = null, // Sera déterminé depuis project root
  printerName = process.env.PRINTER_NAME || "",
  templatesDir = null, // Sera déterminé depuis project root
  assetsDir = null, // Sera déterminé depuis project root
  maxRetry = 3,
  retryDelays = [2000, 5000, 10000],
  forceDefault = true,
} = {}) {
  // Déterminer le project root (C:\Glowflixprojet ou depuis env)
  const projectRoot = process.env.GLOWFLIX_ROOT_DIR 
    ? path.resolve(process.env.GLOWFLIX_ROOT_DIR)
    : (process.platform === "win32" 
      ? "C:\\Glowflixprojet" 
      : path.join(os.homedir(), "Glowflixprojet"));
  
  // Chemins par défaut basés sur project root
  const defaultPrintDir = printDir || path.join(projectRoot, "printer");
  const defaultTemplatesDir = templatesDir || resolveTemplatesDir(path.join(projectRoot, "printer", "templates"));
  const defaultAssetsDir = assetsDir || path.join(projectRoot, "printer", "assets");
  
  // Utiliser les valeurs fournies ou les defaults
  const PRINT_DIR = defaultPrintDir;
  const templatesDirFinal = defaultTemplatesDir;
  const assetsDirFinal = defaultAssetsDir;
  
  const PRINT_OK  = path.join(PRINT_DIR, "ok");
  const PRINT_ERR = path.join(PRINT_DIR, "err");
  const PRINT_TMP = path.join(PRINT_DIR, "tmp");

  fs.mkdirSync(PRINT_DIR, { recursive: true });
  fs.mkdirSync(PRINT_OK,  { recursive: true });
  fs.mkdirSync(PRINT_ERR, { recursive: true });
  fs.mkdirSync(PRINT_TMP, { recursive: true });
  fs.mkdirSync(assetsDirFinal, { recursive: true });
  
  // Copier les templates depuis print/templates vers PRINT_DIR/templates si nécessaire
  const sourceTemplatesDir = path.join(__dirname, "templates");
  if (fs.existsSync(sourceTemplatesDir) && templatesDirFinal !== sourceTemplatesDir) {
    try {
      fs.mkdirSync(templatesDirFinal, { recursive: true });
      const sourceTemplates = fs.readdirSync(sourceTemplatesDir).filter(f => f.endsWith(".hbs"));
      for (const tpl of sourceTemplates) {
        const src = path.join(sourceTemplatesDir, tpl);
        const dst = path.join(templatesDirFinal, tpl);
        if (!fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
          logger?.info?.(`[PRINT] Template copié: ${tpl}`);
        }
      }
    } catch (e) {
      logger?.warn?.(`[PRINT] Erreur copie templates: ${e?.message || e}`);
    }
  }

  /* ===== DEDUPE (persistant disque + mémoire) ===== */
  const dedupeStore = loadDedupeStore(PRINT_DIR);

  const TPL = createTemplateEngine(templatesDirFinal, assetsDirFinal);

  let watcher = null;
  const queue = [];
  let busy = false;
  let sweepTimer = null;
  const spoolDeadlineMs = Number(process.env.PRINT_SPOOL_DEADLINE_MS || 2000);
  let drainTimer = null;

  const log = {
    info:  (...a) => logger?.info ? logger.info(...a)   : console.log(...a),
    warn:  (...a) => logger?.warn ? logger.warn(...a)   : console.warn(...a),
    error: (...a) => logger?.error ? logger.error(...a) : console.error(...a),
  };

  try { TPL.preloadAll?.(); } catch (e) { log.warn(`[PRINT] preload templates failed: ${e?.message || e}`); }

  const retries = new Map();
  let cachedDefaultPrinter = null;

  const scheduleDrain = () => {
    if (drainTimer) return;
    drainTimer = setTimeout(() => {
      drainTimer = null;
      if (busy) return;
      drain().catch((err) => log.error(banner("error", "DRAIN FAIL", [`${err?.message || err}`])));
    }, 0);
  };

  async function resolvePrinter(jobPrinter) {
    if (forceDefault) {
      if (!cachedDefaultPrinter) cachedDefaultPrinter = await getDefaultPrinterName();
      return cachedDefaultPrinter || undefined;
    }
    if (jobPrinter && String(jobPrinter).trim()) return jobPrinter;
    if (printerName && String(printerName).trim()) return printerName;
    if (!cachedDefaultPrinter) cachedDefaultPrinter = await getDefaultPrinterName();
    return cachedDefaultPrinter || undefined;
  }

  function logProgress(stage, meta) {
    const msg = `[PRINT] ${stage} ${meta?.file || ""} ${meta?.extra || ""}`.trim();
    log.info(clr("cyan", msg));
    io?.emit?.("print:progress", { stage, ...meta });
  }

  async function processPdfFile(pdfPath) {
    const base = path.basename(pdfPath);
    try {
      if (!fs.existsSync(pdfPath)) { log.warn(`[PRINT] skip missing (pdf): ${base}`); return; }
      logProgress("queue:start", { file: base });
      const usePrinter = await resolvePrinter();
      logProgress("spool", { file: base, extra: `→ ${usePrinter || "Windows Default"}` });
      await printPDFSilent(pdfPath, { printer: usePrinter, copies: 1 });
      try { fs.renameSync(pdfPath, path.join(PRINT_OK, base)); } catch {}
      log.info(banner("info", "PRINT OK", [`file: ${base}`, `printer: ${usePrinter || "Windows Default"}`]));
      io?.emit?.("print:done", { file: base, printer: usePrinter || "Windows Default" });
    } catch (e) {
      const tries = (retries.get(pdfPath) || 0) + 1;
      retries.set(pdfPath, tries);
      if (tries <= maxRetry) {
        const delay = retryDelays[Math.min(tries - 1, retryDelays.length - 1)];
        log.warn(banner("warn", `RETRY ${tries}/${maxRetry}`, [`file: ${base}`, `in: ${delay} ms`, `reason: ${e.message}`]));
        setTimeout(() => {
          queue.push({ type: "pdf", file: pdfPath, enqueuedAt: Date.now() });
          scheduleDrain();
        }, delay);
        return;
      }
      const errFile = path.join(PRINT_ERR, base);
      const usePrinter = await resolvePrinter();
      const info = classifyError(e, { printer: usePrinter });
      info.stack = e?.stack || undefined;
      try { fs.renameSync(pdfPath, errFile); } catch {}
      writeErrorArtifacts(PRINT_ERR, base, info);
      log.error(banner("error", "PDF FAILED", [`file: ${base}`, `code: ${info.code}`, `hint: ${info.hint}`, `message: ${e.message}`]));
      io?.emit?.("print:error", { file: base, ...info });
    }
  }

  async function processJsonFile(jsonPath) {
    const base = path.basename(jsonPath);
    let job;
    let tmpPdfPath = null;
    let usePrinter;

    // Lecture JSON + petit retry anti-écriture incomplète
    try {
      if (!fs.existsSync(jsonPath)) { log.warn(`[PRINT] skip missing (json): ${base}`); return; }
      logProgress("queue:start", { file: base });

      let raw = fs.readFileSync(jsonPath, "utf-8");
      try {
        job = JSON.parse(raw || "{}");
      } catch {
        await new Promise((r) => setTimeout(r, 150));
        raw = fs.readFileSync(jsonPath, "utf-8");
        job = JSON.parse(raw || "{}");
      }

      if (!job.template && !job.html && !job.pdfPath) job.template = DEFAULT_TEMPLATE;
    } catch (e) {
      const errFile = path.join(PRINT_ERR, base);
      const info = classifyError(e, {});
      info.stack = e?.stack || undefined;
      try { if (fs.existsSync(jsonPath)) fs.renameSync(jsonPath, errFile); } catch {}
      writeErrorArtifacts(PRINT_ERR, base, info);
      log.error(banner("error", "JSON_PARSE FAILED", [
        `file: ${base}`,
        `code: ${info.code}`,
        `hint: ${info.hint}`,
        `message: ${e.message}`
      ]));
      io?.emit?.("print:error", { file: base, ...info });
      return;
    }

    // ===== Anti-doublon intelligent =====
    try {
      const forceReprint =
        job?.forceReprint === true ||
        job?.data?.forceReprint === true ||
        job?.data?.meta?.forceReprint === true;

      if (!forceReprint) {
        const d = job?.data && typeof job.data === "object" ? job.data : job;
        const numero = String(d.factureNum ?? d.numero ?? d.num ?? "").trim();

        const norm = normalizeForFingerprint(job);
        const fp   = hashFingerprint(norm);

        const dup  = isDuplicate(dedupeStore, fp, numero);
        if (dup.duplicate) {
          const errFile = path.join(PRINT_ERR, base);
          try { if (fs.existsSync(jsonPath)) fs.renameSync(jsonPath, errFile); } catch {}

          const info = {
            code: "E_DUPLICATE_JOB",
            message: dup.reason === "same-facture"
              ? "Facture avec le même numéro déjà traitée récemment."
              : "Job identique aux derniers imprimés (fingerprint).",
            hint: "Active `forceReprint` pour forcer l’impression si nécessaire.",
            context: { reason: dup.reason, numero, fp }
          };
          writeErrorArtifacts(PRINT_ERR, base, info);
          log.warn(banner("warn", "DUPLICATE BLOCKED", [
            `file: ${base}`,
            `reason: ${info.context.reason}`,
            numero ? `facture: ${numero}` : null
          ].filter(Boolean)));
          io?.emit?.("print:error", { file: base, ...info });
          return;
        }

        job.___fingerprint = { fp, numero };
      }
    } catch (e) {
      log.warn(`[DEDUPE] erreur non bloquante: ${e?.message || e}`);
    }

    // ===== Rendu + Spool =====
    try {
      let pdfPath = (job.pdfPath && fs.existsSync(job.pdfPath)) ? job.pdfPath : null;

      const safeName = (
        job.factureNum ||
        job?.data?.factureNum ||
        job?.data?.numero ||
        base.replace(/\.json$/i, "")
      ).toString().replace(/[^\w\-]+/g, "_").slice(0, 96);

      tmpPdfPath = path.join(PRINT_TMP, `${safeName}.pdf`);

      if (!pdfPath) {
        if (fs.existsSync(tmpPdfPath)) {
          pdfPath = tmpPdfPath;
        } else {
          logProgress("render", { file: base });
          const html = await buildHTML(job, TPL);
          const tname = String(job.template || "").toLowerCase();
          const ticketWidthMM =
            Number(job.ticketWidthMM || 0) ||
            ((tname.includes("receipt-") || tname.includes("ticket")) ? 80 : 0);
          const buf = await renderPDFfromHTML(html, ticketWidthMM ? { ticketWidthMM } : {});
          fs.writeFileSync(tmpPdfPath, buf);
          pdfPath = tmpPdfPath;
        }
      }

      usePrinter = await resolvePrinter(typeof job.printer === "string" ? job.printer : undefined);
      const copies = Math.max(1, Number(job.copies || job?.data?.copies || 1));
      logProgress("spool", { file: base, extra: `→ ${usePrinter || "Windows Default"} • copies=${copies}` });
      await printPDFSilent(pdfPath, { printer: usePrinter, copies });

      const keepPdfOnOk = (process.env.PRINT_KEEP_PDF_ON_OK ?? "0") !== "0";
      if (!keepPdfOnOk) {
        try { if (pdfPath === tmpPdfPath && fs.existsSync(tmpPdfPath)) fs.unlinkSync(tmpPdfPath); } catch {}
      } else {
        try {
          if (pdfPath === tmpPdfPath && fs.existsSync(tmpPdfPath)) {
            const okPdfName = base.replace(/\.json$/i, ".pdf");
            fs.renameSync(tmpPdfPath, path.join(PRINT_OK, okPdfName));
          }
        } catch {}
      }

      try { if (fs.existsSync(jsonPath)) fs.renameSync(jsonPath, path.join(PRINT_OK, base)); } catch {}

      // ===== Enregistrer l’empreinte après succès =====
      try {
        if (job.___fingerprint?.fp) {
          const d = job?.data && typeof job.data === "object" ? job.data : job;
          recordSuccessfulJobFingerprint(
            dedupeStore,
            job.___fingerprint.fp,
            {
              numero: job.___fingerprint.numero || (d?.factureNum ?? d?.numero ?? ""),
              totalFC: Number(d?.totalFC ?? d?.total ?? 0),
              totalUSD: Number(d?.totalUSD ?? 0),
            }
          );
          saveDedupeStore(PRINT_DIR, dedupeStore);
        }
      } catch {}

      log.info(banner("info", "PRINT OK", [
        `file: ${base}`,
        `printer: ${usePrinter || "Windows Default"}`,
        (job?.data?.factureNum || job?.factureNum) ? `facture: ${job?.data?.factureNum || job?.factureNum}` : null,
      ].filter(Boolean)));
      io?.emit?.("print:done", { file: base, printer: usePrinter || "Windows Default", factureNum: job?.data?.factureNum || job?.factureNum || null });

      // ===== Auto-DETTE (via deep-link uniquement) =====
      try {
        const d = job?.data && typeof job.data === "object" ? job.data : job;
        const fact = d?.factureNum || d?.numero || job?.factureNum || null;
        if (shouldAutoDette(job) && fact) {
          const isUSD = detectUSDMode(d);
          const delayMs = Number(d?.meta?.delay || d?.delay || DEEPLINK_DELAY_MS);
          const defer = (typeof setImmediate === "function") ? setImmediate : (fn) => setTimeout(fn, 0);
          defer(async () => {
            const out = await autoCreateDettesForFacture({ factureNum: String(fact), isUSD, delayMs, io, log });
            if (!out?.ok) log.warn(`[DETTES][deep-link] ${fact} → ${out?.error || "échec"}`);
          });
        }
      } catch (e) {
        log.warn(`[DETTES][auto] erreur init: ${e?.message || e}`);
      }

    } catch (e) {
      const tries = (retries.get(jsonPath) || 0) + 1;
      retries.set(jsonPath, tries);

      if (tries <= maxRetry) {
        const delay = retryDelays[Math.min(tries - 1, retryDelays.length - 1)];
        log.warn(banner("warn", `RETRY ${tries}/${maxRetry}`, [`file: ${base}`, `in: ${delay} ms`, `reason: ${e.message}`]));
        setTimeout(() => {
          queue.push({ type: "json", file: jsonPath, enqueuedAt: Date.now() });
          scheduleDrain();
        }, delay);
        return;
      }

      const errFile = path.join(PRINT_ERR, base);
      const info = classifyError(e, {
        printer: usePrinter,
        cartonAssert: e?.cartonAssert !== false ? undefined : false
      });
      info.stack = e?.stack || undefined;

      try { if (fs.existsSync(jsonPath)) fs.renameSync(jsonPath, errFile); } catch {}
      try {
        if (tmpPdfPath && fs.existsSync(tmpPdfPath)) {
          const errPdf = path.join(PRINT_ERR, base.replace(/\.json$/i, ".pdf"));
          fs.renameSync(tmpPdfPath, errPdf);
        }
      } catch {}

      writeErrorArtifacts(PRINT_ERR, base, info);
      log.error(banner("error", "PRINT FAILED", [`file: ${base}`, `code: ${info.code}`, `hint: ${info.hint}`, `message: ${e.message}`]));
      io?.emit?.("print:error", { file: base, ...info });
    }
  }

  async function drain() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const job = queue.shift();
      try {
        if (!job?.file) continue;
        const base = path.basename(job.file);
        const waited = Date.now() - (job.enqueuedAt || Date.now());
        if (waited > spoolDeadlineMs) {
          log.warn(banner("warn", "PRINT WAIT", [`file: ${base}`, `wait=${waited} ms`]));
        }
        if (!fs.existsSync(job.file)) { log.warn(`[PRINT] skip missing (drain): ${path.basename(job.file)}`); continue; }
        if (job.type === "pdf") await processPdfFile(job.file);
        else await processJsonFile(job.file);
      } catch (e) {
        log.error(banner("error", "UNCAUGHT", [`${e?.message || e}`]));
      }
    }
    busy = false;
  }

  function listRootAndEnqueue(reason = "periodic") {
    const files = listRootJobs(PRINT_DIR);
    let added = 0;
    for (const f of files) added += enqueueIfNotQueued(queue, f) ? 1 : 0;
    if (added > 0) { log.info(`[PRINT][sweep:${reason}] ${added} fichier(s) (re)mis en file`); scheduleDrain(); }
  }

  function start() {
    if (watcher) return;
    watcher = chokidar.watch(
      [path.join(PRINT_DIR, "*.json"), path.join(PRINT_DIR, "*.pdf")],
      { ignoreInitial: false, awaitWriteFinish: false, depth: 0 }
    );
    watcher.on("add", (file) => {
      const low = file.toLowerCase();
      if (low.includes(`${path.sep}ok${path.sep}`) || low.includes(`${path.sep}err${path.sep}`) || low.includes(`${path.sep}tmp${path.sep}`)) return;
      log.info(banner("info", "NEW JOB", [`${file}`]));
      if (enqueueIfNotQueued(queue, file)) {
        scheduleDrain();
      }
    });
    watcher.on("error", (e) => log.error(banner("error", "WATCHER ERROR", [e.message])));
    log.info(clr("magenta", `[PRINT] watching ${PRINT_DIR}\\*.json and *.pdf`));

    listRootAndEnqueue("startup");
    scheduleDrain();
    clearInterval(sweepTimer); sweepTimer = setInterval(() => listRootAndEnqueue("periodic"), 1500);

    const auto = (process.env.PRINT_GUARDIAN_AUTO ?? "1") !== "0";
    if (auto && process.platform === "win32") {
      installGuardian({ logger, printDir: PRINT_DIR }).catch(e => log.warn(`[guardian] install fail: ${e?.message}`));
    }
  }

  function stop() {
    if (watcher) { watcher.close(); watcher = null; }
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
    log.warn(clr("yellow", "[PRINT] watcher stopped"));
  }

  /* ========= REST API ========= */
  const router = express.Router();

  router.get("/printers", async (_req, res) => {
    try { res.json(await getPrinters()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get("/default", async (_req, res) => {
    try { res.json({ defaultPrinter: await resolvePrinter() || "Windows Default" }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get("/templates", (_req, res) => {
    try { res.json({ default: DEFAULT_TEMPLATE, templates: TPL.list() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get("/queue", (_req, res) => {
    res.json({ busy, size: queue.length, pending: queue.map(q => ({ type: q.type, file: path.basename(q.file) })) });
  });

  router.get("/errors", (_req, res) => {
    try {
      const files = fs.readdirSync(PRINT_ERR).filter(f => f.endsWith(".error.json"));
      const out = files.map(f => JSON.parse(fs.readFileSync(path.join(PRINT_ERR, f), "utf-8"))).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
      res.json({ count: out.length, errors: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post("/errors/retry", express.json(), (req, res) => {
    try {
      const base = String(req.body?.file || "").trim();
      if (!base) return res.status(400).json({ error: "file requis (nom dans err/)" });
      const src = path.join(PRINT_ERR, base);
      const dst = path.join(PRINT_DIR, base);
      if (!fs.existsSync(src)) return res.status(404).json({ error: "introuvable" });
      fs.renameSync(src, dst);
      if (enqueueIfNotQueued(queue, dst)) {
        scheduleDrain();
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post("/guardian/install", async (_req, res) => {
    try { const r = await installGuardian({ logger }); res.json(r); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post("/test", async (_req, res) => {
    try {
      const demo = {
        template: DEFAULT_TEMPLATE,
        data: {
          factureNum: "TEST-" + Date.now(),
          client: "Client Démo",
          taux: 2700,
          printCurrency: "USD",
          lignes: [
            { code:"A1", nom:"Very strong", unite:"carton", mark:"", qteLabel:"1", puFC:54000, totalFC:54000 },
            { code:"A2", nom:"Vin Swag",   unite:"carton", mark:"JUTE", qteLabel:"2.5 DZ", puFC:10800, totalFC:21600 },
            { code:"A3", nom:"Vin Amour",  unite:"millier",  mark:"DZ", qteLabel:"0,04 DZ", puFC:0, totalFC:3000 },
            { code:"A4", nom:"Soft Cola",  unite:"carton", mark:"DZ", qteLabel:"DEMI DZ", puFC:2000, totalFC:1000 },
          ],
          totalFC: 78600,
          entreprise: {
            nom: "ALIMENTATION LA GRACE",
            rccm: "CD/KIS/RCCM 22-A-00172",
            impot: "A220883T",
            tel: "+243 896 885 373 / +243 819 082 637",
            logo: null,
            adresse: "Avenue Lac Tanganyika, Makiso, Kisangani, R.D.Congo"
          },
          meta: { currency: "USD", ventesUsd: true, dette: "oui" }
        },
        copies: 1,
        autoDette: true
      };
      const html = await buildHTML(demo, TPL);
      const buf  = await renderPDFfromHTML(html, { ticketWidthMM: 80 });
      const tmp  = path.join(PRINT_TMP, `test-${Date.now()}.pdf`);
      fs.writeFileSync(tmp, buf);
      const usePrinter = await resolvePrinter();
      await printPDFSilent(tmp, { printer: usePrinter, copies: demo.copies });
      try { fs.unlinkSync(tmp); } catch {}

      const isUSD = detectUSDMode(demo.data);
      const delayMs = Number(demo?.data?.meta?.delay || DEEPLINK_DELAY_MS);
      autoCreateDettesForFacture({ factureNum: String(demo.data.factureNum), isUSD, delayMs, io, log })
        .catch(()=>{});

      res.json({ ok: true, printer: usePrinter || "Windows Default" });
    } catch (e) {
      const info = classifyError(e, { cartonAssert: e?.cartonAssert !== false ? undefined : false });
      info.stack = e?.stack || undefined;
      console.error(banner("error", "TEST ERROR", [info.message, `code: ${info.code}`, `hint: ${info.hint}`]));
      res.status(500).json({ error: e.message, code: info.code, hint: info.hint });
    }
  });

  // *** Deep-link dettes depuis un N° de facture (pas d'API directe) ***
  router.post("/dette/from-facture", express.json(), async (req, res) => {
    try {
      const { factureNum, isUSD = false, delay = DEEPLINK_DELAY_MS } = req.body || {};
      const out = await autoCreateDettesForFacture({
        factureNum: String(factureNum || "").trim(),
        isUSD: !!isUSD,
        delayMs: Number(delay)||0,
        io, log
      });
      if (!out.ok) return res.status(404).json(out);
      res.json(out);
    } catch (e) {
      res.status(500).json({ ok:false, error: e?.message || String(e) });
    }
  });

  router.get("/dette/from-facture", async (req, res) => {
    try {
      const factureNum = String(req.query.facture || req.query.f || "").trim();
      const isUSD = req.query.usd === "1";
      const delay = req.query.delay ? Number(req.query.delay) : DEEPLINK_DELAY_MS;
      const out = await autoCreateDettesForFacture({ factureNum, isUSD, delayMs: delay, io, log });
      if (!out.ok) return res.status(404).json(out);
      res.json(out);
    } catch (e) {
      res.status(500).json({ ok:false, error: e?.message || String(e) });
    }
  });

  // Dépôt de job d’impression (JSON/PDF)
  router.post("/jobs", express.json({ limit: "4mb" }), async (req, res) => {
    try {
      const job = req.body || {};
      if (!job.template && !job.html && !job.pdfPath) job.template = DEFAULT_TEMPLATE;

      const d = job.data && typeof job.data === "object" ? job.data : job;
      const raw = Array.isArray(d.lines) ? d.lines : (Array.isArray(d.lignes) ? d.lignes : []);
      for (const l of raw) {
        const u = l.unite ?? l.unit;
        if (u) l.unite = canonUnit(u);
      }

      const ts   = Date.now();
      const base = `job-${ts}.json`;
      const tmp  = path.join(PRINT_TMP, `${base}.partial`);
      const fin  = path.join(PRINT_DIR, base);
      fs.writeFileSync(tmp, JSON.stringify(job, null, 2), "utf-8");
      fs.renameSync(tmp, fin);
      res.json({ ok: true, file: fin });
    } catch (e) {
      const info = classifyError(e, {});
      info.stack = e?.stack || undefined;
      console.error(banner("error", "JOBS ERROR", [info.message, `code: ${info.code}`, `hint: ${info.hint}`]));
      res.status(500).json({ error: e.message, code: info.code, hint: info.hint });
    }
  });

  return { router, start, stop, dirs: { PRINT_DIR, PRINT_OK, PRINT_ERR, PRINT_TMP, templatesDir: templatesDirFinal, assetsDir: assetsDirFinal } };
}

/* ========= Template par défaut (receipt-80.hbs) ========= */
const DEFAULT_80MM_HBS = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<title>Ticket</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body { margin:0; padding:0; background:#fff; color:#000; }
  *, *::before, *::after {
    background:transparent !important; color:#000 !important; -webkit-text-fill-color:#000 !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; image-rendering: crisp-edges; text-rendering: geometricPrecision;
  }

  :root{
    --pageW:80mm;
    --w:78mm;
    --padX:1.2mm;     /* + marge latérale */
    --padTop:2.2mm;   /* + marge haut     */
    --padBot:2.2mm;   /* + marge bas      */

    --fs:12px;
    --lh:1.28;
    --fsTable:11.4px;
    --fsBadge:10.6px;

    --rule:1.3px solid #000;
    --ruleDot:1px dotted #000;
  }

  body{ font-family: Arial, Helvetica, sans-serif; font-size:var(--fs); line-height:var(--lh); }
  .ticket{ width:var(--w); margin:0 auto; padding:var(--padTop) var(--padX) var(--padBot); }

  /* ====== AUTO FIT FONTS (SHRINK-TO-FIT PRO) ====== */
  .ticket.tight  { --fs:11px; --fsTable:10.2px; --fsBadge:9.6px; --padTop:1.8mm; --padBot:1.8mm; }
  .ticket.ultra  { --fs:9.5px; --fsTable:8.8px; --fsBadge:8.2px; --padTop:1.5mm; --padBot:1.5mm; }

  .brand{ text-align:center; margin:0 0 2px 0; }
  .h1{ font-weight:900; font-size:16.5px; margin:0; letter-spacing:.25px; }
  .h2{ font-weight:800; font-size:13px; margin:1px 0 4px; letter-spacing:.2px; }

  .row{ margin:1px 0; word-break:break-word; overflow-wrap:anywhere; }
  .muted{opacity:.95}
  .sep{ border:0; border-top:var(--rule); margin:5px 0; }

  table{ width:100%; border-collapse:collapse; table-layout:fixed; border:var(--rule); }
  thead th{
    border-bottom:var(--rule);
    padding:1.2mm .9mm; font-weight:800; text-align:center;
    border-right:var(--rule);
    font-size:var(--fsTable);
    letter-spacing:.2px;
  }
  thead th:last-child{ border-right:0; }

  tbody td{
    padding:1mm .9mm; vertical-align:top;
    border-right:var(--rule);
    border-bottom:var(--ruleDot);
    font-size:var(--fsTable);
    word-break:break-word;
    overflow-wrap:break-word;
    hyphens:auto;
  }
  tbody tr:last-child td{ border-bottom:0; }
  tbody td:last-child{ border-right:0; }
  
  /* Ajustement padding quand ultra-compact */
  .ticket.ultra tbody td{ padding:.8mm .7mm; }

  /* colonnes ré-équilibrées (éviter coupures) */
  .w-qty{ width:24%; text-align:center; white-space:normal; line-height:1.1; }
  .w-name{ width:40%; text-align:left; line-height:1.15; }
  .w-pu{   width:18%; text-align:right; }
  .w-pt{   width:18%; text-align:right; }

  .qty-badge{
    display:inline-flex; flex-wrap:wrap; row-gap:.4mm; column-gap:.6mm;
    align-items:center; justify-content:center;
    padding:.3mm .9mm; border-radius:.7mm; border:1px solid #000;
    max-width:100%;
  }
  .qty-badge .q{ font-weight:800; }
  .qty-badge .q-int{ font-weight:900; }
  .qty-badge .q-frac{ font-weight:900; font-size:0.78em; line-height:1; }
  .qty-badge .mk{ display:inline-flex; align-items:center; gap:.4mm; }
  .qty-badge .mk-ic{ display:inline-flex; width:11px; height:11px; line-height:0; vertical-align:middle; }
  .qty-badge .mk-ic svg{ width:11px; height:11px; }
  .qty-badge .mk-txt{ font-weight:800; font-size:var(--fsBadge); letter-spacing:.2px; }
  
  /* Badge compact pour mode ultra */
  .ticket.ultra .qty-badge{ padding:.2mm .7mm; gap:.3mm .4mm; }
  .ticket.ultra .qty-badge .mk-txt{ font-size:8px; }
  .ticket.ultra .qty-badge .q{ font-size:9px; }

  .name{ font-weight:600; word-break:break-word; overflow-wrap:anywhere; hyphens:auto; }
  .money{ font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1, "lnum" 1; }

  .totals{
    margin-top:6px;
    text-align:center;
    font-weight:800;
    padding:2mm 1mm;
    border:var(--rule);
    border-radius:1mm;
  }
  
  /* Totals compacts en mode tight/ultra */
  .ticket.tight .totals{ margin-top:4px; padding:1.5mm .9mm; font-size:11px; }
  .ticket.ultra .totals{ margin-top:3px; padding:1.2mm .8mm; font-size:10px; }
  
  .foot{ margin-top:7px; text-align:center; font-size:11px }
  .ticket.tight .foot{ margin-top:5px; font-size:10px; }
  .ticket.ultra .foot{ margin-top:4px; font-size:9px; }
  
  /* Headers plus compacts */
  .ticket.tight .h1{ font-size:15px; margin:0 0 1px 0; }
  .ticket.tight .h2{ font-size:12px; margin:0 0 2px 0; }
  .ticket.ultra .h1{ font-size:14px; margin:0 0 1px 0; }
  .ticket.ultra .h2{ font-size:11px; margin:0 0 2px 0; }
</style>
</head>
<body>
  <div class="ticket{{#if shrinkFit.class}} {{shrinkFit.class}}{{/if}}">

    {{#if entreprise.logo}}
      <div style="text-align:center;margin-bottom:4px">
        <img src="{{asset entreprise.logo}}" alt="logo" style="max-width:64mm;max-height:18mm">
      </div>
    {{/if}}

    <div class="brand">
      <div class="h1">{{entreprise.nom}}</div>
      <div class="h2">LA GRACE</div>
    </div>

    {{#if entreprise.rccm}}<div class="row"><b>. RCCM :</b> {{entreprise.rccm}}</div>{{/if}}
    {{#if entreprise.impot}}<div class="row"><b>. N° Impôt :</b> {{entreprise.impot}}</div>{{/if}}
    {{#if entreprise.tel}}<div class="row"><b>. Tél :</b> {{entreprise.tel}}</div>{{/if}}
    <div class="row"><b>. DATE & HEURE :</b> {{#if dateISO}}{{date dateISO "YYYY-MM-DD HH:mm"}}{{else}}—{{/if}}</div>

    <hr class="sep"/>

    {{#if (or factureNum numero)}}
      <div class="row"><b>. FACTURE N° :</b> {{#if factureNum}}{{factureNum}}{{else}}{{numero}}{{/if}}</div>
    {{else}}
      <div class="row"><b>. FACTURE N° :</b> —</div>
    {{/if}}

    {{#if client}}
      <div class="row"><b>. Client :</b> {{client}}</div>
    {{else}}
      <div class="row"><b>. Client :</b> —</div>
    {{/if}}

    {{#if (eq printCurrency "USD")}}
      <div class="row"><b>. Devise :</b> USD (taux {{taux}} FC/USD)</div>
    {{else}}
      <div class="row"><b>. Devise :</b> FC</div>
    {{/if}}

    <hr class="sep"/>

    <table>
      <thead>
        <tr>
          <th class="w-qty">Qté</th>
          <th class="w-name">Désignation</th>
          <th class="w-pu">PU</th>
          <th class="w-pt">PT</th>
        </tr>
      </thead>
      <tbody>
      {{#if lines.length}}
        {{#each lines}}
          <tr>
            <td class="w-qty">
              {{#if displayQteHtml}}{{{displayQteHtml}}}{{else}}{{#if displayQte}}{{displayQte}}{{else}}—{{/if}}{{/if}}
            </td>
            <td class="w-name"><span class="name">{{nom}}</span></td>

            {{#if (eq ../printCurrency "USD")}}
              <td class="w-pu money">{{fmtUSDnum (coalesce puUSD 0)}} USD</td>
              <td class="w-pt money"><b>{{fmtUSDnum (coalesce totalUSD 0)}}</b> USD</td>
            {{else}}
              <td class="w-pu money">{{fmtFC (or puFC pu)}} FC</td>
              <td class="w-pt money"><b>{{fmtFC (or totalFC total)}}</b> FC</td>
            {{/if}}
          </tr>
        {{/each}}
      {{else}}
        <tr><td class="w-qty" colspan="4" style="text-align:center">— Aucune ligne —</td></tr>
      {{/if}}
      </tbody>
    </table>

    <div class="totals">
      {{#if (eq printCurrency "USD")}}
        <div>Total USD : <b class="money">{{fmtUSDnum totalUSD}}</b> USD</div>
        <div>FC : <b class="money">{{fmtFC (or totalFC total)}}</b> FC</div>
      {{else}}
        <div>Total FC : <b class="money">{{fmtFC (or totalFC total)}}</b> FC</div>
        <div>USD : <b class="money">{{fmtUSDnum totalUSD}}</b> USD</div>
      {{/if}}
    </div>

    <div class="foot">
      <div class="row"><b>Les marchandises vendues ne sont ni retournées ni échangées</b></div>
      {{#if entreprise.adresse}}<div class="row muted">{{entreprise.adresse}}</div>{{/if}}
      <div class="row">— Merci —</div>
      {{#if meta.vendeur}}<div class="row muted">Vendeur : {{meta.vendeur}}</div>{{/if}}
    </div>

  </div>
</body>
</html>`;
