#!/usr/bin/env node
/**
 * Vérifie que la stack locale répond (sans JWT) :
 *   - API : GET /api/v1/health
 *   - Web : GET /annee-academique/moyennes-semestre (page Next)
 *
 * Variables :
 *   MOYENNES_API_URL  — défaut http://localhost:4000
 *   MOYENNES_WEB_URL  — défaut http://localhost:3000
 */

const API = process.env.MOYENNES_API_URL || "http://localhost:4000";
const WEB = process.env.MOYENNES_WEB_URL || "http://localhost:3000";

async function check(name, url, okWhen) {
  const res = await fetch(url, { redirect: "manual" });
  const ok = okWhen(res);
  if (!ok) {
    throw new Error(`${name}: ${url} → ${res.status} ${res.statusText}`);
  }
  console.log(`✓ ${name} (${res.status})`);
}

async function main() {
  await check("API health", `${API}/api/v1/health`, (r) => r.status === 200);

  await check(
    "Page moyennes-semestre",
    `${WEB}/annee-academique/moyennes-semestre`,
    (r) => r.status === 200 || r.status === 307 || r.status === 302 || r.status === 308
  );

  console.log("✅ Stack locale joignable (complétez avec verify-moyennes-semestre.mjs + JWT pour l’API métier).");
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
