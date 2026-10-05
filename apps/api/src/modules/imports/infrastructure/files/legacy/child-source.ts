/**
 * Programme du processus enfant qui convertit un classeur .xls / .ods (O-11). Il est fourni comme TEXTE (`node --eval`) :
 * pas de fichier annexe à localiser (ni en développement, ni en production, ni dans un bundle).
 *
 * Protocole : le parent écrit sur l'entrée standard une ligne JSON (configuration) puis les octets du fichier ; l'enfant
 * répond par UNE ligne JSON sur la sortie standard et se termine. Aucun fichier temporaire, aucune variable
 * d'environnement, aucun argument contenant de la donnée.
 *
 * Durcissement dans l'enfant (en plus du modèle de permissions de Node et des plafonds posés par le parent) :
 *  - les modules réseau / processus / threads (`net`, `http`, `dns`, `child_process`, `worker_threads`, `vm`...) sont
 *    refusés au chargement, ainsi que les addons natifs (`process.dlopen`) ;
 *  - le classeur est lu SANS jamais évaluer une formule (la bibliothèque ne sait pas en calculer) ni suivre un lien :
 *    les liens et formules sont seulement COMPTÉS ; les macros (VBA) ne sont pas lues ;
 *  - la feuille lue est plafonnée en lignes (`sheetRows`), le nombre de feuilles et le volume de sortie sont plafonnés.
 */
export const LEGACY_CHILD_SOURCE = String.raw`
"use strict";
const BLOCKED = new Set(["net", "tls", "dns", "dgram", "http", "https", "http2", "child_process", "cluster", "worker_threads", "vm", "inspector", "repl", "wasi", "v8"]);
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request) {
  const name = String(request).replace(/^node:/, "").split("/")[0];
  if (BLOCKED.has(name)) throw new Error("module interdit dans le convertisseur : " + name);
  return originalLoad.apply(this, arguments);
};
process.dlopen = function () {
  throw new Error("addon natif interdit dans le convertisseur");
};

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let result;
  try {
    const all = Buffer.concat(chunks);
    const nl = all.indexOf(10);
    if (nl < 0) throw new Fail("corrupt", "Entrée du convertisseur invalide.");
    const config = JSON.parse(all.subarray(0, nl).toString("utf8"));
    const data = all.subarray(nl + 1);
    result = config.mode === "selftest" ? selftest(config) : convert(config, data);
  } catch (e) {
    result = e instanceof Fail ? { ok: false, code: e.code, message: e.message } : { ok: false, code: "corrupt", message: "Classeur illisible." };
  }
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
});

class Fail extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function selftest(config) {
  const out = { ok: true, envKeys: Object.keys(process.env), blocked: {}, fs: {} };
  for (const name of config.probeModules) {
    try {
      require(name);
      out.blocked[name] = false;
    } catch {
      out.blocked[name] = true;
    }
  }
  const fs = require("fs");
  try {
    fs.writeFileSync(config.probeWritePath, "x");
    out.fs.write = true;
    try { fs.unlinkSync(config.probeWritePath); } catch {}
  } catch {
    out.fs.write = false;
  }
  try {
    fs.readFileSync(config.probeReadPath);
    out.fs.readOutside = true;
  } catch {
    out.fs.readOutside = false;
  }
  out.permissionModel = typeof process.permission === "object" && process.permission !== null;
  return out;
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function normalizeNumber(n) {
  if (!Number.isFinite(n)) return "";
  const text = String(n);
  return /[eE]/.test(text) ? n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 15 }) : text;
}

function convert(config, data) {
  const limits = config.limits;
  const magic = config.kind === "XLS" ? OLE_MAGIC : ZIP_MAGIC;
  if (data.length < magic.length || !magic.every((b, i) => data[i] === b)) throw new Fail("corrupt", "Le contenu ne correspond pas au format annoncé.");
  const XLSX = require(config.xlsxPath);

  const guard = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Fail) throw e;
      const text = String((e && e.message) || e);
      if (/password|encrypt|protected/i.test(text)) throw new Fail("encrypted", "Le classeur est protégé par un mot de passe : enregistrez-le sans protection.");
      throw new Fail("corrupt", "Classeur illisible ou corrompu.");
    }
  };

  // 1. Liste des feuilles et état « masquée » (une ligne par feuille suffit : rien d'autre n'est lu à ce stade).
  const listing = guard(() => XLSX.read(data, { type: "buffer", bookSheets: true, bookProps: false, bookVBA: false, bookFiles: false }));
  const names = listing.SheetNames || [];
  if (names.length === 0) throw new Fail("corrupt", "Le classeur ne contient aucune feuille.");
  if (names.length > limits.maxSheets) throw new Fail("unsafe", "Le classeur contient trop de feuilles (" + names.length + " ; " + limits.maxSheets + " au plus).");
  const head = guard(() => XLSX.read(data, { type: "buffer", sheetRows: 1, cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, bookVBA: false, bookProps: false, bookFiles: false }));
  const meta = (head.Workbook && head.Workbook.Sheets) || [];
  const hidden = (i) => Boolean(meta[i] && meta[i].Hidden);
  let index = -1;
  if (config.sheet) {
    index = names.findIndex((n) => n.toLowerCase() === String(config.sheet).toLowerCase());
    if (index < 0) throw new Fail("sheet_unknown", "La feuille « " + config.sheet + " » n'existe pas dans le classeur.");
  } else {
    index = names.findIndex((_, i) => !hidden(i));
    if (index < 0) index = 0;
  }
  const sheetName = names[index];

  // 2. Lecture de LA feuille choisie : formules gardées sous forme de texte (jamais évaluées), ni style, ni HTML, ni macros.
  const book = guard(() =>
    XLSX.read(data, {
      type: "buffer",
      sheets: index,
      sheetRows: limits.maxRows + limits.headerSlack,
      cellFormula: true,
      cellHTML: false,
      cellStyles: false,
      cellNF: false,
      cellText: false,
      cellDates: false,
      bookVBA: false,
      bookProps: false,
      bookFiles: false,
      bookDeps: false,
      WTF: false,
    }),
  );
  const sheet = book.Sheets && book.Sheets[sheetName];
  if (!sheet) return { ok: true, sheetNames: names, sheetName, rows: [], formulas: 0, links: 0, errors: 0 };

  if (sheet["!fullref"] && sheet["!ref"]) {
    const full = XLSX.utils.decode_range(sheet["!fullref"]);
    const kept = XLSX.utils.decode_range(sheet["!ref"]);
    if (full.e.r > kept.e.r) throw new Fail("too_many_rows", "Le fichier dépasse " + limits.maxRows + " lignes de données.");
  }

  let formulas = 0;
  let links = 0;
  let errors = 0;
  let budget = limits.maxOutputChars;
  const byRow = new Map();
  for (const key of Object.keys(sheet)) {
    if (key.charCodeAt(0) === 33) continue; // « ! » : propriétés de la feuille
    const cell = sheet[key];
    if (!cell || typeof cell !== "object") continue;
    const at = XLSX.utils.decode_cell(key);
    if (at.c < 0 || at.c > limits.maxColumns || at.r < 0) continue;
    if (cell.f !== undefined) formulas += 1;
    if (cell.l !== undefined) links += 1;
    let text;
    switch (cell.t) {
      case "n":
        text = typeof cell.v === "number" ? normalizeNumber(cell.v) : String(cell.v == null ? "" : cell.v);
        break;
      case "b":
        text = cell.v ? "TRUE" : "FALSE";
        break;
      case "e":
        errors += 1;
        text = "";
        break;
      case "d":
        text = cell.v instanceof Date && !Number.isNaN(cell.v.getTime()) ? cell.v.toISOString() : String(cell.v == null ? "" : cell.v);
        break;
      default:
        text = String(cell.v == null ? "" : cell.v);
    }
    if (text === "") continue;
    if (text.length > limits.maxCellChars + 1) text = text.slice(0, limits.maxCellChars + 1);
    budget -= text.length;
    if (budget < 0) throw new Fail("unsafe", "Le contenu du classeur est trop volumineux.");
    let row = byRow.get(at.r);
    if (!row) byRow.set(at.r, (row = []));
    row[at.c] = text;
  }
  const rows = [...byRow.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const sparse = byRow.get(r);
      const cells = new Array(sparse.length);
      for (let i = 0; i < sparse.length; i += 1) cells[i] = sparse[i] === undefined ? "" : sparse[i];
      return [r + 1, cells];
    });
  return { ok: true, sheetNames: names, sheetName, rows, formulas, links, errors };
}
`;
