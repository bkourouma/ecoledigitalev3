/** Tests de l'analyse du balayage QA : `node --test scripts/qa/analyze.test.mjs` (aucun navigateur requis). */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzePage, rawI18nKeys } from "./analyze.mjs";

const base = { url: "/v2/finance", finalUrl: "/v2/finance", navStatus: 200, redirects: 0, body: "Finance\nFactures du mois en cours", main: "Factures du mois en cours", consoleErrors: [], pageErrors: [], apiFailures: [], requestFailures: [], alerts: [] };
const env = (menu = []) => ({ menuLinks: new Set(menu), account: { role: "econome", tenant: "demo-secondaire" } });
const codes = (rec, e = env()) => analyzePage({ ...base, ...rec }, e).map((f) => `${f.severity}:${f.code}`);

test("page saine : aucun constat", () => {
  assert.deepEqual(codes({}), []);
});

test("5xx et ecran blanc sont bloquants", () => {
  assert.ok(codes({ navStatus: 500 }).includes("bloquant:http-5xx"));
  assert.ok(codes({ body: "", main: "" }).includes("bloquant:blank-page"));
});

test("404 : bloquant si lien de menu, majeur sinon", () => {
  assert.ok(codes({ navStatus: 404, h1: "404" }, env(["/v2/finance"])).includes("bloquant:http-404"));
  assert.ok(codes({ navStatus: 404, h1: "404" }).includes("majeur:http-404"));
});

test("403 API : majeur depuis le menu, mineur hors menu ; 5xx API bloquant", () => {
  const failure = { method: "GET", path: "/api/v1/x", status: 403, body: "" };
  assert.ok(codes({ apiFailures: [failure] }, env(["/v2/finance"])).includes("majeur:api-403"));
  assert.ok(codes({ apiFailures: [failure] }).includes("mineur:api-403"));
  assert.ok(codes({ apiFailures: [{ ...failure, status: 502 }] }).includes("bloquant:api-5xx"));
  assert.ok(codes({ apiFailures: [{ ...failure, status: 400 }] }).includes("majeur:api-400"));
});

test("redirection /unauthorized depuis le menu = majeur", () => {
  assert.ok(codes({ finalUrl: "/unauthorized" }, env(["/v2/finance"])).includes("majeur:denied-redirect"));
  assert.ok(codes({ finalUrl: "/unauthorized" }).includes("mineur:denied-redirect"));
  assert.ok(codes({ finalUrl: "/v2/login?expired=1" }).includes("majeur:session-lost"));
});

test("textes suspects et cles i18n brutes", () => {
  assert.ok(codes({ main: "Solde : undefined FCFA" }).includes("majeur:suspect-text"));
  assert.ok(codes({ main: "Total [object Object]" }).includes("majeur:suspect-text"));
  assert.ok(codes({ main: "Titre\nv2Finance.invoices.title\nAutre" }).includes("majeur:raw-i18n-key"));
  assert.deepEqual(rawI18nKeys("contact@ecole.test\nfichier.pdf\nv2.0\nadmin.shell.menu.settings"), ["admin.shell.menu.settings"]);
});

test("libelle Non inscrit pour un parent ou un eleve", () => {
  const e = { menuLinks: new Set(), account: { role: "parent", tenant: "demo-primaire" } };
  assert.ok(codes({ main: "Awa : Non inscrit" }, e).includes("majeur:label-not-enrolled"));
  assert.ok(!codes({ main: "Awa : Non inscrit" }).includes("majeur:label-not-enrolled"));
});

test("ecran /v2 sans deconnexion ou sans navigation globale = ecran sans coquille", () => {
  assert.ok(codes({ source: "landing", hasLogout: false }).includes("majeur:no-shell"));
  assert.ok(!codes({ source: "landing", hasLogout: true }).includes("majeur:no-shell"));
  // Tout ecran authentifie, plus seulement l'atterrissage.
  assert.ok(codes({ url: "/v2/finance/invoices", finalUrl: "/v2/finance/invoices", source: "crawl", hasLogout: false }).includes("majeur:no-shell"));
  assert.ok(codes({ url: "/v2/finance/invoices", finalUrl: "/v2/finance/invoices", source: "menu", hasLogout: true, hasNav: false }).includes("majeur:no-shell"));
  assert.ok(!codes({ url: "/v2/finance/invoices", finalUrl: "/v2/finance/invoices", source: "crawl", hasLogout: true, hasNav: true }).includes("majeur:no-shell"));
  // Ecrans publics ou a coque propre : exemptes.
  assert.ok(!codes({ url: "/v2/apply/ecole", finalUrl: "/v2/apply/ecole", source: "crawl", hasLogout: false }).includes("majeur:no-shell"));
  assert.ok(!codes({ url: "/v2/platform/tenants", finalUrl: "/v2/platform/tenants", source: "crawl", hasLogout: false }).includes("majeur:no-shell"));
  assert.ok(!codes({ url: "/v2/login", finalUrl: "/v2/login", source: "crawl", hasLogout: false }).includes("majeur:no-shell"));
});

test("erreurs console : cle i18n manquante majeure, bruit reseau ignore", () => {
  assert.ok(codes({ consoleErrors: [{ text: "MISSING_MESSAGE: Could not resolve `a.b` in messages for locale `fr-CI`" }] }).includes("majeur:i18n-missing"));
  assert.deepEqual(codes({ consoleErrors: [{ text: "Failed to load resource: the server responded with a status of 403 (Forbidden)" }] }), []);
});
