/**
 * Opérations de PLATEFORME (tables globales, acteur `system`) : gabarits fournis par la plateforme, clés publiques de
 * signature, catalogue des clés publié pour la vérification hors ligne. Toutes passent par `SystemDb.run(raison, …)`.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import type { SystemDb } from "@ecoledigitale/database";
import { canonicalJson, sha256Hex } from "../domain/canonical";
import { PARTIAL_NAMES } from "../domain/document-html";
import { ReportcardsCode, conflict, internal, invalid, portUnavailable } from "../domain/errors";
import { validateOptionsSchema } from "../domain/options-schema";
import { publicKeyFingerprint } from "../domain/signing";
import { validateTemplate } from "../domain/template-validation";
import type { PlatformTemplate, SignatureSlot } from "../domain/types";
import { ALL_PLATFORM_TEMPLATES } from "../templates/builtin";
import * as platformRepo from "../infrastructure/platform-repository";
import { listPlatformTemplates } from "../infrastructure/reference-repository";
import type { ReportcardsDeps } from "./deps";

const keyCache = new WeakMap<SystemDb, Set<string>>();

/**
 * Enregistre la clé PUBLIQUE de la clé de signature active (idempotent). Refuse une collision d'identifiant avec une clé
 * publique différente : un `keyId` ne désigne jamais deux clés. À appeler avant toute émission (clé étrangère de `report_cards`).
 */
export async function ensureSigningKeyRegistered(deps: ReportcardsDeps): Promise<Result<{ keyId: string }, AppError>> {
  const keys = deps.keys;
  if (!keys) return err(internal("Aucune clé de signature n'est configurée sur ce serveur.", ReportcardsCode.SIGNING_KEY_MISSING));
  const system = deps.systemDb;
  if (!system) return err(portUnavailable("SystemDb"));
  const cacheKey = `${keys.keyId}:${keys.publicKey}`;
  const seen = keyCache.get(system) ?? new Set<string>();
  keyCache.set(system, seen);
  if (seen.has(cacheKey)) return ok({ keyId: keys.keyId });
  const result = await system.run("reportcards.register-signing-key", async (tx) => {
    const existing = await platformRepo.getSigningKey(tx, keys.keyId);
    if (existing) {
      if (existing.publicKey !== keys.publicKey) {
        return err(conflict("Cet identifiant de clé de signature désigne déjà une autre clé publique.", ReportcardsCode.SIGNING_KEY_CONFLICT, { keyId: keys.keyId }));
      }
      if (existing.status === "RETIRED") {
        return err(conflict("Cette clé de signature est retirée : configurez une nouvelle clé.", ReportcardsCode.SIGNING_KEY_CONFLICT, { keyId: keys.keyId }));
      }
      return ok(undefined);
    }
    await platformRepo.insertSigningKey(tx, { keyId: keys.keyId, publicKey: keys.publicKey, now: deps.clock.now() });
    return ok(undefined);
  });
  if (!result.ok) return result;
  seen.add(cacheKey);
  return ok({ keyId: keys.keyId });
}

export async function retireSigningKey(deps: ReportcardsDeps, input: { keyId: string; actorId: string }): Promise<Result<{ retired: boolean }, AppError>> {
  const system = deps.systemDb;
  if (!system) return err(portUnavailable("SystemDb"));
  const retired = await system.run("reportcards.retire-signing-key", async (tx) => {
    const done = await platformRepo.retireSigningKey(tx, input.keyId, deps.clock.now());
    if (done) await deps.audit.recordPlatform?.(tx, { action: "reportcards.signing_key.retired", resourceType: "signing_key", resourceId: input.keyId, sensitive: true, actorId: input.actorId });
    return done;
  });
  keyCache.delete(system);
  return ok({ retired });
}

export interface PublicKeyView {
  keyId: string;
  algorithm: "Ed25519";
  publicKey: string;
  fingerprint: string;
  status: "ACTIVE" | "RETIRED";
  createdAt: Date;
  retiredAt: Date | null;
}

/** Clés publiques (actives ET retirées : un document signé par une clé retirée reste vérifiable, AC4.6). */
export async function listPublicKeys(deps: ReportcardsDeps): Promise<Result<PublicKeyView[], AppError>> {
  const system = deps.systemDb;
  if (!system) return err(portUnavailable("SystemDb"));
  const rows = await system.run("reportcards.public-keys", (tx) => platformRepo.listSigningKeys(tx), { readOnly: true });
  return ok(rows.map((k) => ({ ...k, fingerprint: publicKeyFingerprint(k.publicKey) })));
}

/** Tous les gabarits plateforme (publiés et retirés) pour la console opérateur. */
export async function listAllPlatformTemplates(deps: ReportcardsDeps): Promise<Result<PlatformTemplate[], AppError>> {
  const system = deps.systemDb;
  if (!system) return err(portUnavailable("SystemDb"));
  return ok(await system.run("reportcards.list-platform-templates", (tx) => listPlatformTemplates(tx), { readOnly: true }));
}

export interface PublishTemplateInput {
  key: string;
  documentKind: PlatformTemplate["documentKind"];
  pack: PlatformTemplate["pack"];
  title: string;
  body: string;
  css: string;
  optionsSchema: Record<string, unknown>;
  signatureSlots: readonly SignatureSlot[];
  snapshotSchema?: string;
}

/** Validation d'un gabarit AVANT publication (pure) : balises, attributs, URLs, CSS, composants, schéma d'options, emplacements. */
export function validatePlatformTemplate(input: Pick<PublishTemplateInput, "body" | "css" | "optionsSchema" | "signatureSlots">): string[] {
  const problems: string[] = [];
  const check = validateTemplate({ body: input.body, css: input.css, partialNames: PARTIAL_NAMES });
  problems.push(...check.problems.map((p) => `${p.code} : ${p.message}`));
  problems.push(...validateOptionsSchema(input.optionsSchema).map((p) => `options ${p.path} : ${p.message}`));
  const slots = new Set<string>();
  for (const s of input.signatureSlots) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(s.slot)) problems.push(`emplacement de signature invalide « ${s.slot} »`);
    if (slots.has(s.slot)) problems.push(`emplacement de signature dupliqué « ${s.slot} »`);
    slots.add(s.slot);
  }
  return problems;
}

const contentHashOf = (t: Pick<PlatformTemplate, "key" | "documentKind" | "pack" | "snapshotSchema" | "title" | "body" | "css" | "optionsSchema" | "signatureSlots">): string =>
  sha256Hex(canonicalJson({ ...t, signatureSlots: [...t.signatureSlots] }));

/** Publie une NOUVELLE version d'un gabarit plateforme (immuable ensuite). Refus si la validation de sécurité échoue. */
export async function publishPlatformTemplate(
  deps: ReportcardsDeps,
  input: PublishTemplateInput & { actorId?: string },
): Promise<Result<PlatformTemplate, AppError>> {
  const system = deps.systemDb;
  if (!system) return err(portUnavailable("SystemDb"));
  const problems = validatePlatformTemplate(input);
  if (problems.length) return err(invalid("Gabarit refusé à la publication.", ReportcardsCode.INVALID_TEMPLATE, { problems }));
  const published = await system.run("reportcards.publish-template", async (tx) => {
    const version = await platformRepo.nextTemplateVersion(tx, input.key);
    const snapshotSchema = input.snapshotSchema ?? "reportcard/1";
    const template = await platformRepo.insertPublishedTemplate(tx, {
      key: input.key,
      version,
      documentKind: input.documentKind,
      pack: input.pack,
      snapshotSchema,
      title: input.title,
      body: input.body,
      css: input.css,
      optionsSchema: input.optionsSchema,
      signatureSlots: input.signatureSlots,
      contentHash: contentHashOf({ ...input, snapshotSchema }),
      publishedAt: deps.clock.now(),
    });
    if (input.actorId) {
      await deps.audit.recordPlatform?.(tx, { action: "reportcards.template.published", resourceType: "platform_template", resourceId: `${input.key}@${version}`, sensitive: true, actorId: input.actorId });
    }
    return template;
  });
  return ok(published);
}

/**
 * Amorçage idempotent : publie les gabarits livrés par la plateforme qui ne sont pas encore en base. Une version existante
 * n'est JAMAIS modifiée (immuable) ; une évolution d'un gabarit livré = un numéro de version supérieur dans `builtin.ts`.
 */
export async function ensureBuiltinTemplates(deps: ReportcardsDeps): Promise<Result<{ published: string[] }, AppError>> {
  const system = deps.systemDb;
  if (!system) return err(portUnavailable("SystemDb"));
  const published: string[] = [];
  for (const t of ALL_PLATFORM_TEMPLATES) {
    const problems = validatePlatformTemplate(t);
    if (problems.length) return err(invalid(`Le gabarit livré ${t.key} est invalide.`, ReportcardsCode.INVALID_TEMPLATE, { problems }));
  }
  await system.run("reportcards.seed-builtin-templates", async (tx) => {
    for (const t of ALL_PLATFORM_TEMPLATES) {
      if (await platformRepo.getTemplateVersion(tx, t.key, t.version)) continue;
      await platformRepo.insertPublishedTemplate(tx, {
        key: t.key,
        version: t.version,
        documentKind: t.documentKind,
        pack: t.pack,
        snapshotSchema: "reportcard/1",
        title: t.title,
        body: t.body,
        css: t.css,
        optionsSchema: t.optionsSchema,
        signatureSlots: t.signatureSlots,
        contentHash: contentHashOf({ ...t, snapshotSchema: "reportcard/1" }),
        publishedAt: deps.clock.now(),
      });
      published.push(`${t.key}@${t.version}`);
    }
  });
  return ok({ published });
}

export async function retirePlatformTemplate(deps: ReportcardsDeps, input: { key: string; version: number; actorId: string }): Promise<Result<{ retired: boolean }, AppError>> {
  const system = deps.systemDb;
  if (!system) return err(portUnavailable("SystemDb"));
  const retired = await system.run("reportcards.retire-template", async (tx) => {
    const done = await platformRepo.retireTemplate(tx, input.key, input.version);
    if (done) await deps.audit.recordPlatform?.(tx, { action: "reportcards.template.retired", resourceType: "platform_template", resourceId: `${input.key}@${input.version}`, sensitive: true, actorId: input.actorId });
    return done;
  });
  return ok({ retired });
}
