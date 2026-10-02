/**
 * Implémentations EN MÉMOIRE des ports (tests et assemblages sans plateforme) et ports « indisponibles » (échec fermé).
 * Jamais utilisées en production : le stockage est S3 / MinIO (ou disque en développement), l'annuaire vient de `people`.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { RequestContext } from "@ecoledigitale/kernel";
import { NO_CONVERTER, NO_SCANNER, NO_USAGE_REPORTER, type DocumentsPorts, type MalwareScanner, type OwnerDirectory, type PersonRef, type ScanVerdict, type StoragePort, type StoredObject } from "../application/ports";
import { portUnavailable } from "../domain/errors";
import { NO_LINKS, type ActorLinks, type DocumentOwnerType, type Uuid } from "../domain/types";

/** Chaîne de test EICAR (inoffensive, détectée par tout antivirus) : sert de « logiciel malveillant simulé ». */
export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export const eicarBytes = (): Uint8Array => new TextEncoder().encode(EICAR);

/** Stockage mémoire avec URL signées vérifiables (expiration simulée par l'horloge injectée). */
export class InMemoryStorage implements StoragePort {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly deleted: string[] = [];
  failPut = false;
  failDelete = false;
  private readonly secret = "memory-secret-0123456789";
  constructor(private readonly now: () => Date = () => new Date()) {}

  async put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<void> {
    if (this.failPut) throw new Error("stockage indisponible");
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    const o = this.objects.get(key);
    return o ? { bytes: o.bytes, contentType: o.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error("suppression impossible");
    this.objects.delete(key);
    this.deleted.push(key);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  async signedUrl(key: string, options: { ttlSeconds: number; fileName: string; contentType: string }): Promise<{ url: string; expiresAt: Date }> {
    const ttl = Math.min(Math.max(Math.floor(options.ttlSeconds), 1), 300);
    const expiresAt = new Date(this.now().getTime() + ttl * 1000);
    const payload = Buffer.from(JSON.stringify({ k: key, e: expiresAt.getTime(), f: options.fileName, c: options.contentType })).toString("base64url");
    return { url: `memory://objects?token=${payload}.${this.sign(payload)}`, expiresAt };
  }

  /** Résout une URL signée : `null` si la signature est fausse ou l'URL expirée. */
  resolve(url: string): { key: string; fileName: string; contentType: string; bytes: Uint8Array } | null {
    const token = new URL(url).searchParams.get("token") ?? "";
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { k: string; e: number; f: string; c: string };
    if (t.e < this.now().getTime()) return null;
    const o = this.objects.get(t.k);
    return o ? { key: t.k, fileName: t.f, contentType: t.c, bytes: o.bytes } : null;
  }

  sha256Of(key: string): string | null {
    const o = this.objects.get(key);
    return o ? createHash("sha256").update(o.bytes).digest("hex") : null;
  }
}

/** Double de test du scanner : détecte EICAR ; `unavailable` simule un antivirus injoignable. */
export class FakeScanner implements MalwareScanner {
  readonly engine = "fake-scanner";
  unavailable = false;
  readonly scanned: string[] = [];
  async scan(bytes: Uint8Array, hints: { fileName: string }): Promise<ScanVerdict> {
    this.scanned.push(hints.fileName);
    if (this.unavailable) return { status: "ERROR", reason: "scanner injoignable" };
    const text = Buffer.from(bytes).toString("latin1");
    return text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") ? { status: "INFECTED", signature: "Eicar-Test-Signature" } : { status: "CLEAN" };
  }
}

export interface WorldPerson {
  readonly id: Uuid;
  readonly name: string;
}

/** Annuaire mémoire : fiches élèves / personnel / comptes, et les liens de chaque compte. */
export class InMemoryOwners implements OwnerDirectory {
  readonly students = new Map<Uuid, string>();
  readonly staff = new Map<Uuid, string>();
  readonly users = new Map<Uuid, string>();
  readonly links = new Map<Uuid, ActorLinks>();
  readonly guardians = new Map<Uuid, Uuid[]>();

  async resolveActorLinks(ctx: RequestContext): Promise<ActorLinks> {
    return (ctx.userId && this.links.get(ctx.userId)) || NO_LINKS;
  }
  private dir(type: Exclude<DocumentOwnerType, "NONE">): Map<Uuid, string> {
    return type === "STUDENT" ? this.students : this.staff;
  }
  async existingOwners(_ctx: RequestContext, type: Exclude<DocumentOwnerType, "NONE">, ids: readonly Uuid[]): Promise<ReadonlySet<Uuid>> {
    const d = this.dir(type);
    return new Set(ids.filter((id) => d.has(id)));
  }
  async ownerNames(_ctx: RequestContext, type: Exclude<DocumentOwnerType, "NONE">, ids: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>> {
    const d = this.dir(type);
    return new Map(ids.filter((id) => d.has(id)).map((id) => [id, d.get(id) as string] as [Uuid, string]));
  }
  async searchOwners(_ctx: RequestContext, type: Exclude<DocumentOwnerType, "NONE">, query: string, limit: number): Promise<readonly PersonRef[]> {
    const q = query.toLowerCase();
    return [...this.dir(type)].filter(([, n]) => n.toLowerCase().includes(q)).slice(0, limit).map(([id, name]) => ({ id, displayName: name, detail: null }));
  }
  async userNames(_ctx: RequestContext, userIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>> {
    return new Map(userIds.filter((id) => this.users.has(id)).map((id) => [id, this.users.get(id) as string] as [Uuid, string]));
  }
  async searchUsers(_ctx: RequestContext, query: string, limit: number): Promise<readonly PersonRef[]> {
    const q = query.toLowerCase();
    return [...this.users].filter(([, n]) => n.toLowerCase().includes(q)).slice(0, limit).map(([id, name]) => ({ id, displayName: name, detail: null }));
  }
  async guardianUsers(_ctx: RequestContext, studentId: Uuid): Promise<readonly PersonRef[]> {
    return (this.guardians.get(studentId) ?? []).map((id) => ({ id, displayName: this.users.get(id) ?? "Tuteur", detail: null }));
  }
}

export interface InMemoryPortsOptions {
  now?: () => Date;
  planQuotaBytes?: number;
}

export interface InMemoryWorld extends DocumentsPorts {
  readonly storage: InMemoryStorage;
  readonly owners: InMemoryOwners;
  readonly fakeScanner: FakeScanner;
}

/** Ports mémoire complets (scanner EICAR branché, fail-open) ; ajustables (`world.scan = {…}`) dans les tests. */
export function inMemoryPorts(options: InMemoryPortsOptions = {}): InMemoryWorld & { scan: DocumentsPorts["scan"] } {
  const storage = new InMemoryStorage(options.now);
  const owners = new InMemoryOwners();
  const fakeScanner = new FakeScanner();
  const quota = options.planQuotaBytes ?? 2 * 1024 * 1024 * 1024;
  return {
    storage,
    owners,
    fakeScanner,
    scan: { scanner: fakeScanner, failClosed: false },
    converter: NO_CONVERTER,
    usage: NO_USAGE_REPORTER,
    planQuota: async () => quota,
  };
}

/** Ports non branchés : stockage et annuaire échouent FERMÉ (`documents.port_unavailable`), pas d'antivirus, pas de conversion. */
export function unavailablePorts(): DocumentsPorts {
  const fail = (port: string) => async (): Promise<never> => {
    throw portUnavailable(port);
  };
  return {
    storage: { put: fail("storage"), get: fail("storage"), delete: fail("storage"), signedUrl: fail("storage") },
    owners: {
      resolveActorLinks: fail("owners"),
      existingOwners: fail("owners"),
      ownerNames: fail("owners"),
      searchOwners: fail("owners"),
      userNames: fail("owners"),
      searchUsers: fail("owners"),
      guardianUsers: fail("owners"),
    },
    scan: NO_SCANNER,
    converter: NO_CONVERTER,
    usage: NO_USAGE_REPORTER,
    planQuota: async () => 2 * 1024 * 1024 * 1024,
  };
}
