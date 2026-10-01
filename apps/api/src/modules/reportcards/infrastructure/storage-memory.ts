/**
 * Adaptateur MÉMOIRE du `StoragePort` (tests, développement sans stockage objet). Les URL signées sont des URL `memory://`
 * portant une expiration et une signature HMAC : `verifySignedUrl` les contrôle (un lien expiré ou altéré est refusé).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Clock } from "@ecoledigitale/kernel";
import { systemClock } from "@ecoledigitale/kernel";
import { sha256Hex } from "../domain/canonical";
import type { StorageObject, StoragePort } from "../application/ports";

export class InMemoryStorage implements StoragePort {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly puts: string[] = [];
  private readonly secret = randomBytes(32);

  constructor(private readonly clock: Clock = systemClock) {}

  async put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<{ sha256: string; size: number }> {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.contentType });
    this.puts.push(key);
    return { sha256: sha256Hex(bytes), size: bytes.length };
  }

  async get(key: string): Promise<StorageObject | null> {
    const o = this.objects.get(key);
    return o ? { bytes: o.bytes, contentType: o.contentType } : null;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async signedUrl(key: string, options: { ttlSeconds: number; fileName?: string; contentType?: string }): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(this.clock.now().getTime() + options.ttlSeconds * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    const sig = this.sign(key, exp);
    return { url: `memory://${key}?exp=${exp}&sig=${sig}`, expiresAt };
  }

  async signedUploadUrl(key: string, options: { ttlSeconds: number; contentType: string; maxBytes: number }): Promise<{ url: string; expiresAt: Date; headers: Record<string, string> }> {
    const expiresAt = new Date(this.clock.now().getTime() + options.ttlSeconds * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    return { url: `memory://${key}?exp=${exp}&sig=${this.sign(`PUT:${key}`, exp)}`, expiresAt, headers: { "Content-Type": options.contentType } };
  }

  /** Simule le PUT du client sur une URL de dépôt (tests) : refuse un lien expiré ou altéré. */
  acceptUpload(url: string, bytes: Uint8Array, contentType: string): boolean {
    const m = /^memory:\/\/(.+)\?exp=(\d+)&sig=([0-9a-f]{64})$/.exec(url);
    if (!m) return false;
    const [, key, exp, sig] = m as unknown as [string, string, string, string];
    if (!timingSafeEqual(Buffer.from(this.sign(`PUT:${key}`, Number(exp)), "hex"), Buffer.from(sig, "hex")) || Number(exp) * 1000 < this.clock.now().getTime()) return false;
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
    return true;
  }

  private sign(key: string, exp: number): string {
    return createHmac("sha256", this.secret).update(`${key}\n${exp}`).digest("hex");
  }

  /** Contrôle une URL produite par `signedUrl` : retourne la clé de l'objet si elle est valide et non expirée. */
  verifySignedUrl(url: string): { ok: true; key: string } | { ok: false; reason: "malformed" | "expired" | "bad_signature" } {
    const m = /^memory:\/\/(.+)\?exp=(\d+)&sig=([0-9a-f]{64})$/.exec(url);
    if (!m) return { ok: false, reason: "malformed" };
    const [, key, exp, sig] = m as unknown as [string, string, string, string];
    const expected = Buffer.from(this.sign(key, Number(exp)), "hex");
    if (!timingSafeEqual(expected, Buffer.from(sig, "hex"))) return { ok: false, reason: "bad_signature" };
    if (Number(exp) * 1000 < this.clock.now().getTime()) return { ok: false, reason: "expired" };
    return { ok: true, key };
  }
}
