import { createHash } from "node:crypto";

/**
 * Identifiants déterministes : un UUID (version 5, SHA-1) dérivé de (scénario, nature, clé).
 *
 * Deux exécutions donnent exactement les mêmes UUID, donc le même ordre de tri SQL partout où le
 * legacy trie par `id` (ou ne trie pas du tout), et des snapshots où chaque UUID se traduit en alias
 * lisible (`student:amina`) grâce au registre inverse.
 */
export function deterministicUuid(namespace: string, kind: string, key: string): string {
  const hash = createHash("sha1").update(`${namespace}\u0000${kind}\u0000${key}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Registre bidirectionnel clé de scénario <-> UUID. */
export class IdRegistry {
  private readonly byAlias = new Map<string, string>();
  private readonly byId = new Map<string, string>();

  constructor(readonly namespace: string) {}

  /** UUID de l'objet `kind:key` (le crée au premier appel). */
  id(kind: string, key: string): string {
    const alias = `${kind}:${key}`;
    let id = this.byAlias.get(alias);
    if (!id) {
      id = deterministicUuid(this.namespace, kind, key);
      this.byAlias.set(alias, id);
      this.byId.set(id, alias);
    }
    return id;
  }

  /** Enregistre un objet créé PAR le legacy (identifiant généré par la base) sous un alias de scénario. */
  bind(kind: string, key: string, id: string): void {
    const alias = `${kind}:${key}`;
    this.byAlias.set(alias, id.toLowerCase());
    this.byId.set(id.toLowerCase(), alias);
  }

  /** Alias lisible d'un UUID, ou `undefined` si inconnu du scénario. */
  alias(id: string): string | undefined {
    return this.byId.get(id.toLowerCase());
  }

  /** Clé seule (sans la nature) : `student:amina` -> `amina`. */
  key(id: string): string | undefined {
    const a = this.alias(id);
    return a ? a.slice(a.indexOf(":") + 1) : undefined;
  }

  has(id: string): boolean {
    return this.byId.has(id.toLowerCase());
  }
}
