/** Simulacres des ports `AccountProvisioner` (iam) et `StoragePort`. */
import { err, newId, ok, ConflictError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AccountProvisioner, InviteInput, StoragePort } from "../../application/ports";

export class FakeAccounts implements AccountProvisioner {
  readonly invites: Array<{ email: string; roles: readonly string[]; identityId: string }> = [];
  readonly grants: Array<{ identityId: string; role: string }> = [];
  /** E-mails qui ont déjà un accès dans le tenant (conflit `iam.membership_exists`). */
  readonly existing = new Set<string>();
  failGrantWith: AppError | null = null;

  async invite(_ctx: RequestContext, input: InviteInput): Promise<Result<{ identityId: string; membershipId: string }, AppError>> {
    if (this.existing.has(input.email)) return err(new ConflictError("Cette personne a déjà un accès dans cet établissement.", { code: "iam.membership_exists" }));
    const identityId = newId();
    this.invites.push({ email: input.email, roles: input.roles, identityId });
    return ok({ identityId, membershipId: newId() });
  }

  async grantRole(_ctx: RequestContext, input: { identityId: string; role: string }): Promise<Result<void, AppError>> {
    if (this.failGrantWith) return err(this.failGrantWith);
    this.grants.push(input);
    return ok(undefined);
  }
}

export class FakeStorage implements StoragePort {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<void> {
    this.objects.set(key, { bytes, contentType: options.contentType });
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async signedUrl(key: string, options: { ttlSec: number }): Promise<string> {
    return `https://storage.example.test/${key}?ttl=${options.ttlSec}&sig=abc`;
  }
}

/** Contenus binaires minimaux reconnus par octets magiques. */
export const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
