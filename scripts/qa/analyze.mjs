/**
 * Analyse d'une page visitee par le balayage QA : transforme un enregistrement brut (statut, console, API, texte) en constats
 * classes par gravite. Fonctions pures, testables sans navigateur (voir analyze.test.mjs).
 *
 * Gravites : « bloquant » (page inutilisable ou erreur serveur), « majeur » (fonction cassee, donnee fausse, menu mort),
 * « mineur » (cosmetique, 403 attendu hors menu, etat vide a revoir).
 */

const ERROR_SCREEN = /(Application error|client-side exception|Unhandled Runtime Error|Internal Server Error|This page could not be found|Une erreur est survenue|Something went wrong|Erreur inattendue)/i;
const NOT_FOUND = /(This page could not be found|Page introuvable|404)/i;
const KEY_LIKE = /^(?:[a-z][A-Za-z0-9]*)(?:\.[A-Za-z][A-Za-z0-9_-]*){1,6}$/;
const FILE_EXT = /\.(com|org|net|fr|ci|test|local|localhost|io|pdf|csv|xlsx?|docx?|png|jpe?g|svg|json|txt|zip|html?|js|ts|md|xml)$/i;
const SUSPECT_TOKENS = [
  { re: /\[object Object\]/, label: "[object Object]", severity: "majeur" },
  { re: /\bundefined\b/, label: "undefined", severity: "majeur" },
  { re: /\bNaN\b/, label: "NaN", severity: "majeur" },
  { re: /\bInfinity\b/, label: "Infinity", severity: "mineur" },
  { re: /(^|[\s(:>])null([\s).,:]|$)/, label: "null", severity: "majeur" },
];

function snippet(text, re, radius = 50) {
  const m = re.exec(text);
  if (!m) return "";
  const s = Math.max(0, m.index - radius);
  return text.slice(s, m.index + m[0].length + radius).replace(/\s+/g, " ");
}

/** Lignes de texte qui sont, en entier, une cle i18n brute (ex. `v2Foo.bar`, `admin.shell.menu.x`). */
export function rawI18nKeys(text) {
  const out = new Set();
  for (const line of text.split(/\n+/)) {
    const t = line.trim();
    if (t.length < 5 || t.length > 90 || /\s/.test(t)) continue;
    if (!KEY_LIKE.test(t) || FILE_EXT.test(t) || /^\d/.test(t)) continue;
    // Un identifiant a point sans majuscule interne ni segment >= 3 niveaux est trop souvent un nom de fichier / domaine / version.
    const segments = t.split(".");
    if (segments.length < 2) continue;
    if (!/[A-Z]/.test(t) && segments.length < 3) continue;
    out.add(t);
  }
  return [...out];
}

export function isDeniedPath(p) {
  return /^\/(v2\/)?(unauthorized|forbidden)(\/|$|\?)/.test(p ?? "");
}

export function isLoginPath(p) {
  return /^\/(v2\/)?(platform\/)?login(\/|$|\?)/.test(p ?? "");
}

/**
 * @param rec enregistrement de visite (voir demo-sweep.mjs)
 * @param env { menuLinks:Set<string>, account:{role,tenant} }
 */
export function analyzePage(rec, env) {
  const f = [];
  const add = (severity, code, message, evidence = "") => f.push({ severity, code, message, evidence: String(evidence).slice(0, 400) });
  const path = rec.url.split("?")[0];
  const finalPath = (rec.finalUrl ?? "").split("?")[0];
  const inMenu = Boolean(rec.isMenuLink) || env.menuLinks.has(path);
  const body = rec.body ?? "";
  const main = rec.main ?? "";
  const redirected = finalPath !== "" && finalPath !== path && finalPath !== path + "/";

  if (rec.error) {
    add("bloquant", "nav-error", /ERR_TOO_MANY_REDIRECTS|redirect/i.test(rec.error) ? "Boucle de redirection" : `Navigation en echec : ${rec.error}`, rec.error);
  }
  if (rec.navStatus && rec.navStatus >= 500) add("bloquant", "http-5xx", `La page repond ${rec.navStatus}`, rec.navStatus);
  if (rec.navStatus === 404 || (!rec.error && NOT_FOUND.test(rec.h1 ?? "") && body.length < 300)) {
    add(inMenu ? "bloquant" : "majeur", "http-404", inMenu ? "Lien de menu mort (404)" : "Page introuvable (404)", `${rec.navStatus} ${rec.h1 ?? ""}`);
  }
  if (rec.devToast) add("majeur", "dev-toast", "Indicateur d'erreur Next.js (probleme signale en console)", rec.devToast);
  if (rec.overlay) add("bloquant", "dev-overlay", "Ecran d'erreur Next.js (overlay)", rec.overlay);
  if (!rec.error && ERROR_SCREEN.test(main) && !(rec.navStatus === 404)) {
    add("bloquant", "error-screen", "Ecran d'erreur affiche", snippet(main, ERROR_SCREEN));
  }
  if (rec.pageErrors?.length) add("majeur", "page-error", "Exception JavaScript non interceptee", rec.pageErrors[0]);

  if (redirected) {
    if (isDeniedPath(finalPath)) {
      add(inMenu ? "majeur" : "mineur", "denied-redirect", inMenu ? "Entree de menu qui mene a un acces refuse (/unauthorized)" : "Acces refuse (redirection /unauthorized), attendu hors menu", `${path} -> ${finalPath}`);
    } else if (isLoginPath(finalPath) && !isLoginPath(path)) {
      add("majeur", "session-lost", "Redirection vers la connexion : session perdue ou page non protegee correctement", `${path} -> ${finalPath}`);
    } else if (inMenu) {
      add("mineur", "menu-redirect", "Entree de menu qui redirige ailleurs", `${path} -> ${finalPath}`);
    }
  }
  if (rec.redirects >= 4) add("majeur", "many-redirects", `${rec.redirects} redirections successives`, `${path} -> ${finalPath}`);

  // Ecran blanc : rien d'utile dans le contenu principal apres chargement.
  if (!rec.error && !redirected && rec.navStatus && rec.navStatus < 400 && body.replace(/\s+/g, "").length < 20) {
    add("bloquant", "blank-page", "Ecran blanc (aucun texte rendu)", "");
  }

  // Requetes API.
  const seenApi = new Set();
  for (const a of rec.apiFailures ?? []) {
    const key = `${a.method} ${a.path.split("?")[0]} ${a.status}`;
    if (seenApi.has(key)) continue;
    seenApi.add(key);
    const msg = `${a.method} ${a.path} -> ${a.status}`;
    const ev = `${msg} ${a.body}`;
    if (a.status >= 500) add("bloquant", "api-5xx", `Erreur serveur API : ${msg}`, ev);
    else if (a.status === 429) add("mineur", "api-429", `Limitation de debit : ${msg}`, ev);
    else if (a.status === 403) add(inMenu ? "majeur" : "mineur", "api-403", inMenu ? `Appel refuse (403) depuis une page du menu : ${msg}` : `Appel refuse (403, attendu hors menu) : ${msg}`, ev);
    else if (a.status === 401) add("majeur", "api-401", `Appel non authentifie : ${msg}`, ev);
    else if (a.status === 404) add(inMenu ? "majeur" : "mineur", "api-404", `Ressource ou route API introuvable : ${msg}`, ev);
    else add("majeur", `api-${a.status}`, `Requete rejetee : ${msg}`, ev);
  }
  for (const r of rec.requestFailures ?? []) add("mineur", "request-failed", `Requete en echec reseau : ${r.url}`, r.error);

  // Console.
  const seenConsole = new Set();
  for (const c of rec.consoleErrors ?? []) {
    const t = c.text;
    if (/Failed to load resource: the server responded with a status of (4|5)\d\d/.test(t)) continue; // deja compte via l'API
    if (/favicon|ERR_BLOCKED_BY_CLIENT/i.test(t)) continue;
    const key = t.slice(0, 120);
    if (seenConsole.has(key)) continue;
    seenConsole.add(key);
    if (/MISSING_MESSAGE|Could not resolve .* in messages/i.test(t)) add("majeur", "i18n-missing", "Cle de traduction manquante (next-intl)", t);
    else if (/hydrat|Minified React error|TypeError|ReferenceError|Cannot read prop/i.test(t)) add("majeur", "console-js", "Erreur JavaScript en console", t);
    else add("mineur", "console-error", "Erreur en console", t);
  }

  // Texte.
  if (!rec.error && rec.navStatus && rec.navStatus < 400 && !isLoginPath(finalPath)) {
    for (const tk of SUSPECT_TOKENS) {
      if (tk.re.test(main)) add(tk.severity, "suspect-text", `Texte suspect « ${tk.label} » affiche`, snippet(main, tk.re));
    }
    const keys = rawI18nKeys(main);
    if (keys.length) add("majeur", "raw-i18n-key", `Cle(s) i18n brute(s) affichee(s) : ${keys.slice(0, 5).join(", ")}`, keys.slice(0, 5).join(" | "));
    if (/Non inscrit/i.test(main) && /^(parent|eleve)$/.test(env.account.role)) {
      add("majeur", "label-not-enrolled", "Libelle « Non inscrit » pour un compte parent/eleve de la demo (eleve inscrit ?)", snippet(main, /Non inscrit/i, 80));
    }
    if (rec.alerts?.length && !(rec.apiFailures ?? []).length) {
      const err = rec.alerts.find((a) => /impossible|erreur|échec|echec|indisponible|n'a pas pu|refus/i.test(a));
      if (err) add("majeur", "alert-without-api-failure", "Message d'erreur affiche sans requete API en echec", err);
    } else if (rec.alerts?.length) {
      const err = rec.alerts.find((a) => /impossible|erreur|échec|echec|indisponible|n'a pas pu/i.test(a));
      if (err && !(rec.apiFailures ?? []).some((a) => a.status >= 500)) add("mineur", "alert-shown", "Message d'erreur affiche", err);
    }
    // Etat vide a revoir (information, pas un defaut) : page de liste dont le contenu est seulement un etat vide.
    const emptyHit = /(^|\n)\s*(Aucun(e)?s? [^\n]{0,80}|Pas encore de [^\n]{0,60}|Rien à afficher[^\n]{0,40})/i.exec(main);
    if (emptyHit && main.length < 700) add("mineur", "empty-state", "Etat vide (a confronter aux donnees de demo)", emptyHit[0].trim());
  }
  return f;
}

export const SEVERITY_ORDER = { bloquant: 0, majeur: 1, mineur: 2 };
