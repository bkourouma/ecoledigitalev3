// Régénère packages/contracts/src/v2/index.ts à partir des fichiers présents (évite les conflits de fusion).
import { readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "contracts", "src", "v2");
const names = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts").map((f) => f.slice(0, -3)).sort();
writeFileSync(join(dir, "index.ts"), names.map((n) => `export * from "./${n}";`).join("\n") + "\n");
console.log(`contracts v2 index : ${names.length} modules`);
