/**
 * Régénère les icônes PNG de la PWA à partir de public/icons/icon.svg.
 *
 *   node apps/web/scripts/generate-pwa-icons.mjs
 *
 * Nécessite `sharp` (présent dans le dépôt via Next ; sinon `pnpm dlx sharp-cli` ou tout autre rasteriseur).
 * Les PNG générés sont versionnés : ce script n'est PAS exécuté au build.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
// Variante « plein cadre » (sans coins arrondis) pour les icônes maskable et Apple.
// Le motif est réduit à 88 % pour rester dans la « zone de sécurité » circulaire des icônes maskable.
const fullBleed = svg.replace(' rx="104"', "").replace("<g fill=", '<g transform="translate(30.72 30.72) scale(0.88)" fill=');

const targets = [
  ["icon-192.png", svg, 192],
  ["icon-512.png", svg, 512],
  ["icon-maskable-512.png", fullBleed, 512],
  ["apple-touch-icon.png", fullBleed, 180],
];

for (const [name, source, size] of targets) {
  const png = await sharp(Buffer.from(source), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(dir, name), png);
  console.log(`${name} (${size}x${size}, ${png.length} octets)`);
}
