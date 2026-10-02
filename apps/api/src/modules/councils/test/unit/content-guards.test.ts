/**
 * Garde-fous de CONTENU (spec 006 §12, T6-GUARDS) sur le code du module — une violation volontaire de chaque règle fait échouer ce test :
 *  (1) aucune liste de séries, de langues, de coefficients, de types de sanction ni valeur réglementaire dans le code ;
 *  (2) aucune arithmétique sur les résultats (aucune moyenne, aucun rang, aucune mention calculés) ;
 *  (3) l'humain décide : tout cas d'usage qui écrit exige un utilisateur identifié (`requireHuman`), sauf les cas système listés ;
 *  (4) horloge injectée (aucun `new Date()` sans argument, aucun `Date.now()`), identifiants `newId()`, aucun `console.*`, aucun `pool.query`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");

function sources(dir = ROOT, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (["test", "migrations", "templates"].includes(name)) continue;
      sources(full, out);
    } else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Code sans commentaires (les commentaires documentent les interdits). */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const FILES = sources().map((f) => ({ file: relative(ROOT, f).replace(/\\/g, "/"), text: code(f) }));

describe("garde-fous de contenu du module councils", () => {
  it("il y a bien du code à contrôler", () => {
    expect(FILES.length).toBeGreaterThan(25);
  });

  it("(1) aucune valeur réglementaire ni liste de séries / langues / coefficients / sanctions dans le code", () => {
    const forbidden = [
      /["'`](BEPC|BAC|MGA|BAC[A-Z]|TLE|CEPE)["'`]/,
      /["'`](SERIE|SÉRIE)[ _-]?[A-Z0-9]{1,3}["'`]/i,
      /["'`](G1|G2|F1|F2|F3|F4|A1|A2|C|D|E)["'`]\s*[,\]]/,
      /["'`](ANGLAIS|ESPAGNOL|ALLEMAND|ARABE|LATIN)["'`]/i,
      /\bcoefficients?\s*[:=]\s*\[/i,
      /["'`](BLAME|AVERTISSEMENT|RENVOI|RETARD_REPETE)["'`]/i,
      /\bminParticipants\s*[:=]\s*[1-9]/,
      /\b(moyenne_?min|seuil_?passage|mga)\b\s*[:=]\s*\d/i,
    ];
    for (const { file, text } of FILES) for (const re of forbidden) expect(re.test(text), `${file} : ${re}`).toBe(false);
  });

  it("(2) aucune arithmétique sur les résultats : pas de moyenne, de rang ni de mention calculés", () => {
    const arithmetic = [/\bparseFloat\b/, /\.toFixed\(/, /\bMath\.(round|floor|ceil|avg|pow|sqrt|trunc)\b/, /\bNumber\((?:[^)]*)(average|moyenne|rank|rang|mention)/i, /\b(average|moyenne|rank)\s*[-+*/]=?\s*[\w(]/, /\b(average|moyenne)\b\s*[<>]=?\s*\d/i, /\.reduce\(\s*\([^)]*\)\s*=>\s*[^)]*(average|rank)/i];
    for (const { file, text } of FILES) for (const re of arithmetic) expect(re.test(text), `${file} : ${re}`).toBe(false);
  });

  it("(3) l'humain décide : tout cas d'usage qui écrit exige `requireHuman`, sauf les cas système explicitement listés", () => {
    // Fonctions exécutées par un job ou un abonné (contexte système) : aucun acte réglementaire, seulement de la plomberie rejouable.
    const system = new Set([
      "processRunnableEffects", // job : rejoue au nom de l'humain qui a enregistré la décision
      "onResultsReopened",
      "expireUnlockRequests",
      "requestMinutesRender",
      "onMinutesRendered",
      "instantiateCouncilsReferenceData",
      "getReference",
      "planEffects",
      "applyPendingEffects",
      "attemptEffect",
      "onInstitutionCreated",
      "onPeriodReopened",
      "onMinutesGenerated",
      "onOfficialDocumentRendered",
      "instantiate",
      "inTx",
      "safely",
    ]);
    const offenders: string[] = [];
    for (const { file, text } of FILES.filter((f) => f.file.startsWith("application/"))) {
      const parts = text.split(/\nexport (?:async )?function /).slice(1);
      for (const part of parts) {
        const name = part.slice(0, part.indexOf("(")).trim();
        if (system.has(name)) continue;
        const writes = /inTx\(\s*deps\s*,\s*ctx\s*,\s*async\s*\(tx\)/.test(part) && !/readOnly:\s*true/.test(part.slice(0, part.indexOf("\nexport "))) ;
        if (writes && !/requireHuman\(ctx\)/.test(part)) offenders.push(`${file}:${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("(3 bis) les routes qui écrivent passent par les cas d'usage : aucune ne lit un identifiant d'acteur dans la requête", () => {
    const plugin = FILES.find((f) => f.file === "http/plugin.ts")!.text;
    expect(plugin).not.toMatch(/req\.body[^;]*\b(userId|recordedBy|signedBy|decidedBy|resolvedBy|actorId)\b/);
    expect(plugin).not.toMatch(/\.user\b/);
  });

  it("(4) horloge injectée, identifiants newId(), aucune console, aucun pool direct, SQL seulement dans infrastructure/", () => {
    for (const { file, text } of FILES) {
      expect(/new Date\(\s*\)/.test(text), `${file} : new Date()`).toBe(false);
      // la doublure en mémoire (réservée aux tests) est exemptée de la règle d'horloge injectée
      if (file !== "infrastructure/in-memory-ports.ts") expect(/Date\.now\(\)/.test(text), `${file} : Date.now()`).toBe(false);
      expect(/\bconsole\./.test(text), `${file} : console`).toBe(false);
      expect(/\bpool\.query\b/.test(text), `${file} : pool.query`).toBe(false);
      expect(/\brandomUUID\(/.test(text), `${file} : identifiant hors newId()`).toBe(false);
    }
    // Aucun accès SQL hors infrastructure/ : les cas d'usage n'écrivent aucune requête, ils appellent les dépôts.
    const sqlOutside = FILES.filter((f) => !f.file.startsWith("infrastructure/") && /\b(?:tx|client|sp)\.(?:query|many|queryOne)\(/.test(f.text)).map((f) => f.file);
    expect(sqlOutside).toEqual([]);
  });
});
