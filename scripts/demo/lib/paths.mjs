/** Chemins de la démonstration. Tout ce qui est généré vit sous `.demo/` (ignoré par git). */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const DEMO_DIR = resolve(ROOT, ".demo");
export const LOG_DIR = resolve(DEMO_DIR, "logs");
export const OBJECTS_DIR = resolve(DEMO_DIR, "objects");
export const IMPORT_DIR = resolve(DEMO_DIR, "import-templates");
export const SECRETS_FILE = resolve(DEMO_DIR, "secrets.json");
export const STATE_FILE = resolve(DEMO_DIR, "state.json");
export const PIDS_FILE = resolve(DEMO_DIR, "pids.json");
export const CREDENTIALS_MD = resolve(DEMO_DIR, "credentials.md");
export const CREDENTIALS_JSON = resolve(DEMO_DIR, "credentials.json");
export const MAILBOX_FILE = resolve(DEMO_DIR, "mailbox.jsonl");
export const API_TSCONFIG = resolve(ROOT, "apps", "api", "tsconfig.json");
export const TSX_CLI =resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
