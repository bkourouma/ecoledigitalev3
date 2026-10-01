#!/usr/bin/env node
/**
 * Scan léger de secrets sur les fichiers SUIVIS par git.
 *
 *   pnpm check:secrets          (ou : node scripts/check-secrets.mjs)
 *
 * Règles
 *   postgres-url      URL postgres(ql):// contenant un mot de passe en clair
 *   hardcoded-secret  `password = '...'` / `password: "..."` codé en dur
 *   secret-default    `process.env.X_SECRET || '...'` (valeur par défaut d'un secret)
 *   private-key       clé privée PEM
 *
 * Sort avec le code 1 s'il trouve quelque chose. N'affiche JAMAIS la valeur
 * trouvée, seulement fichier:ligne et règle.
 *
 * Exceptions
 *   - dossiers exclus : docs/, specs/, .specify/, .github/ (documentation et
 *     historique de spécifications, hors périmètre de ce contrôle) ;
 *   - `hardcoded-secret` n'est pas appliqué aux fichiers de test
 *     (__tests__/, tests/, e2e/, *.test.*, *.spec.*) ni aux fichiers Markdown ;
 *   - une ligne portant `secret-scan:allow` est ignorée (à justifier en commentaire).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "scripts/check-secrets.mjs";

const EXCLUDED_PREFIXES = ["docs/", "specs/", ".specify/", ".github/"];
const EXCLUDED_FILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", SELF]);
const TEST_PATH = /(^|\/)(__tests__|tests|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const MARKDOWN = /\.(md|mdx)$/i;

/** Valeurs qui ne sont manifestement pas des secrets (documentation, gabarits). */
const PLACEHOLDER =
  /^(<[^>]*>|\$\{?[^}]*\}?.*|%[A-Za-z_]+%|\*+|x{3,}|\.{3}|\{\{.*\}\}|pass(word)?|user|motdepasse|mot[-_ ]de[-_ ]passe|votre[-_]?mot[-_]?de[-_]?passe|change[-_]?me\w*|your[-_]\S*|replace[-_]\S*|example|exemple)$/i;

const RULES = [
  {
    id: "postgres-url",
    // user:motdepasse@hôte — le mot de passe peut contenir des « @ » (on prend jusqu'au dernier).
    regex: /postgres(?:ql)?:\/\/[^\s:\/@"'`<>]+:([^\s"'`]+)@/gi,
    secretGroup: 1,
  },
  {
    id: "hardcoded-secret",
    regex: /\b[\w.]*(?:password|passwd|pwd)[\w]*["']?\s*[:=]\s*(["'`])([^"'`\n]{4,}?)\1/gi,
    secretGroup: 2,
    skip: ({ file, line, name, value }) =>
      // Un texte avec espaces est un message ("Le mot de passe est requis"), pas un secret.
      /\s/.test(value) ||
      TEST_PATH.test(file) ||
      MARKDOWN.test(file) ||
      /^\s*(\*|\/\/|#)/.test(line) ||
      // Noms de clés de stockage / de paramétrage, pas des mots de passe.
      /(?:_key|key|label|placeholder|type|field|name|id)$/i.test(name),
  },
  {
    id: "secret-default",
    regex: /process\.env\.[A-Z0-9_]*(?:SECRET|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*(?:\|\||\?\?)\s*(["'`])([^"'`\n]{3,}?)\1/g,
    secretGroup: 2,
    skip: ({ file }) => TEST_PATH.test(file),
  },
  {
    id: "private-key",
    regex: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g,
    secretGroup: 0,
    noPlaceholderCheck: true,
  },
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  return out.split("\0").filter(Boolean);
}

function isExcluded(file) {
  return EXCLUDED_FILES.has(file) || EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function readText(file) {
  let buffer;
  try {
    buffer = readFileSync(resolve(ROOT, file));
  } catch {
    return null; // fichier supprimé dans l'arbre de travail, ou illisible
  }
  if (buffer.subarray(0, 8000).includes(0)) return null; // binaire
  if (buffer.length > 2_000_000) return null;
  return buffer.toString("utf8");
}

const findings = [];

for (const file of trackedFiles()) {
  if (isExcluded(file)) continue;
  const text = readText(file);
  if (text === null) continue;

  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes("secret-scan:allow")) return;
    for (const rule of RULES) {
      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(line)) !== null) {
        const value = match[rule.secretGroup] ?? "";
        const name = (match[0].match(/[\w.]*(?:password|passwd|pwd)[\w]*/i) ?? [""])[0];
        if (!rule.noPlaceholderCheck && PLACEHOLDER.test(value.trim())) continue;
        if (rule.skip?.({ file, line, name, value })) continue;
        findings.push({ file, line: index + 1, rule: rule.id });
        break; // une règle = un constat par ligne
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`check-secrets : ${findings.length} constat(s) (valeurs masquées) :`);
  for (const { file, line, rule } of findings) console.error(`  ${file}:${line}  [${rule}]`);
  console.error(
    "\nRetirer le secret du code (lire l'environnement : voir .env.example), ou ajouter " +
      "`secret-scan:allow` sur la ligne avec une justification si c'est un faux positif."
  );
  process.exit(1);
}

console.log("check-secrets : aucun secret détecté dans les fichiers suivis.");
