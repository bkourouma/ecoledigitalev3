#!/usr/bin/env node
/**
 * Appel GET (lecture seule) de l'API de demonstration avec le jeton d'un role : node scripts/qa/api-peek.mjs <tenant> <role> <chemin>...
 * Sert a confirmer un constat du balayage. Aucun secret n'est affiche.
 */
import { apiCall, apiLogin, loadCredentials } from "./lib.mjs";

const [tenant, role, ...paths] = process.argv.slice(2);
const account = loadCredentials().accounts.find((a) => a.tenant === tenant && a.role === role);
if (!account) throw new Error(`Compte introuvable : ${tenant}/${role}`);
const token = await apiLogin(account);
if (!token) throw new Error("Connexion API impossible");
for (const p of paths) {
  const r = await apiCall("GET", p, token);
  console.log(`GET ${p} -> ${r.status}\n${JSON.stringify(r.body).slice(0, 1200)}\n`);
}
