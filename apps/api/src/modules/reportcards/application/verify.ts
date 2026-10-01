/**
 * Vérification PUBLIQUE d'authenticité (spec 013 US4) — sans authentification, sans donnée personnelle.
 *
 * Chemin : `SystemDb.run("public-verification")` lit l'index global (code -> tenant, document), puis
 * `SystemDb.runForTenant` lit le document sous la RLS de son tenant. Le QR ne porte que le code.
 *
 *  - réponse MINIMALE : statut, nature, établissement, intitulé, date d'émission (+ mention si le tenant l'a activée, Q-31) ;
 *    ni notes, ni date de naissance, ni adresse, ni nom d'élève ;
 *  - UNIFORMITÉ : un code inexistant, mal formé, provisoire ou d'une nature inconnue reçoit EXACTEMENT la même réponse ;
 *  - le hash du snapshot est RECALCULÉ et la signature Ed25519 REVÉRIFIÉE à chaque consultation (contre la clé publique de la
 *    ligne, y compris une clé retirée) ; tout écart ⇒ `INVALID` + événement `reportcards.integrity.mismatch` ;
 *  - chaque consultation aboutie est journalisée (IP tronquée, résultat) ; 24 mois de rétention.
 */
import { createDomainEvent, createSystemContext, err, newId, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { PgOutboxWriter } from "@ecoledigitale/database";
import { snapshotHash, sha256Hex } from "../domain/canonical";
import { MAX_UPLOAD_BYTES } from "../domain/constants";
import { ReportcardsCode, invalid, portUnavailable } from "../domain/errors";
import { ReportcardsEvents } from "../domain/events";
import { isVerificationCode, publicKeyFingerprint, verifyDocumentSignature } from "../domain/signing";
import { formatDateFr } from "../domain/template-engine";
import type { ReportCardRecord } from "../domain/types";
import * as cardsRepo from "../infrastructure/cards-repository";
import * as platformRepo from "../infrastructure/platform-repository";
import { getSettings } from "../infrastructure/reference-repository";
import type { ReportcardsDeps } from "./deps";

export type VerificationStatus = "AUTHENTIC" | "SUPERSEDED" | "REVOKED" | "INVALID" | "UNKNOWN";

export interface PublicVerification {
  status: VerificationStatus;
  documentKind: string | null;
  institutionName: string | null;
  title: string | null;
  issuedAt: Date | null;
  mention: string | null;
  supersededByIssuedAt: Date | null;
  revokedAt: Date | null;
  keyId: string | null;
  keyFingerprint: string | null;
  snapshotHash: string | null;
  signature: string | null;
  message: string;
}

export const UNKNOWN_VERIFICATION: PublicVerification = Object.freeze({
  status: "UNKNOWN",
  documentKind: null,
  institutionName: null,
  title: null,
  issuedAt: null,
  mention: null,
  supersededByIssuedAt: null,
  revokedAt: null,
  keyId: null,
  keyFingerprint: null,
  snapshotHash: null,
  signature: null,
  message: "Aucun document ne correspond à ce code.",
});

/** Tronque l'adresse IP pour le journal : /24 (IPv4) ou /48 (IPv6). Jamais l'adresse complète. */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip.replace(/^::ffff:/, ""));
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) {
    const groups = ip.split(":").slice(0, 3);
    return groups.length === 3 ? `${groups.join(":")}::/48` : null;
  }
  return null;
}

const MESSAGES = {
  AUTHENTIC: "Document authentique, émis par l'établissement indiqué.",
  REVOKED: "Document révoqué par l'établissement : il ne doit plus être considéré comme valable.",
  INVALID: "Ce document ne passe pas le contrôle d'intégrité. Contactez l'établissement.",
} as const;

interface Resolved {
  card: ReportCardRecord;
  institutionName: string;
  mention: string | null;
  supersededByIssuedAt: Date | null;
  signatureValid: boolean;
  hashValid: boolean;
  keyId: string;
  keyFingerprint: string | null;
}

async function describe(deps: ReportcardsDeps, tenantId: string, cardId: string, code: string): Promise<{ result: PublicVerification; card: ReportCardRecord } | null> {
  const system = deps.systemDb;
  if (!system) throw portUnavailable("SystemDb");
  // Feature `reportcard.public-verification` du tenant propriétaire : désactivée => réponse uniforme « inconnu ».
  if (deps.verificationEnabled && !(await deps.verificationEnabled(tenantId))) return null;
  return system.runForTenant("public-verification", tenantId, async (tx) => {
    const content = await cardsRepo.getCardContent(tx, cardId);
    if (!content || content.record.verificationCode !== code || content.record.provisional) return null;
    const { record, snapshot, explain } = content;
    const key = await platformRepo.getSigningKey(tx, record.signingKeyId);
    const hashValid = snapshotHash(snapshot, explain) === record.snapshotHash;
    const signatureValid = Boolean(key) && verifyDocumentSignature(key!.publicKey, { snapshotHash: record.snapshotHash, verificationCode: record.verificationCode, issuedAt: record.issuedAt }, record.signature);
    const settings = await getSettings(tx);
    let supersededByIssuedAt: Date | null = null;
    if (record.status === "SUPERSEDED" && record.supersededById) {
      const next = await cardsRepo.getCard(tx, record.supersededById);
      supersededByIssuedAt = next?.issuedAt ?? record.supersededAt;
    }
    const resolved: Resolved = {
      card: record,
      institutionName: snapshot.institution.legalName,
      mention: settings.verificationShowsMention && snapshot.results.summary.mention ? (snapshot.labels[snapshot.results.summary.mention] ?? snapshot.results.summary.mention) : null,
      supersededByIssuedAt,
      signatureValid,
      hashValid,
      keyId: record.signingKeyId,
      keyFingerprint: key ? publicKeyFingerprint(key.publicKey) : null,
    };
    const intact = resolved.hashValid && resolved.signatureValid;
    let status: VerificationStatus;
    let message: string;
    if (!intact) {
      status = "INVALID";
      message = MESSAGES.INVALID;
      const ctx = createSystemContext(tenantId);
      await new PgOutboxWriter(tx).append([
        createDomainEvent({
          type: ReportcardsEvents.INTEGRITY_MISMATCH,
          payload: { v: 1, reportCardId: record.id, expectedHash: record.snapshotHash, actualHash: snapshotHash(snapshot, explain), reason: resolved.hashValid ? "SIGNATURE" : "HASH" },
          ctx,
          aggregateType: "report_card",
          aggregateId: record.id,
          clock: deps.clock,
          id: newId(),
        }),
      ]);
    } else if (record.status === "REVOKED") {
      status = "REVOKED";
      message = MESSAGES.REVOKED;
    } else if (record.status === "SUPERSEDED") {
      status = "SUPERSEDED";
      message = `Document remplacé par une version plus récente émise le ${formatDateFr((supersededByIssuedAt ?? record.supersededAt ?? record.issuedAt).toISOString())}.`;
    } else {
      status = "AUTHENTIC";
      message = MESSAGES.AUTHENTIC;
    }
    const result: PublicVerification = {
      status,
      documentKind: record.documentKind,
      institutionName: resolved.institutionName,
      title: snapshot.meta.title,
      issuedAt: record.issuedAt,
      mention: status === "AUTHENTIC" ? resolved.mention : null,
      supersededByIssuedAt: status === "SUPERSEDED" ? supersededByIssuedAt : null,
      revokedAt: status === "REVOKED" ? record.revokedAt : null,
      keyId: resolved.keyId,
      keyFingerprint: resolved.keyFingerprint,
      snapshotHash: record.snapshotHash,
      signature: record.signature,
      message,
    };
    return { result, card: record };
  });
}

export async function verifyByCode(deps: ReportcardsDeps, input: { code: string; ipPrefix?: string | null }): Promise<Result<PublicVerification, AppError>> {
  const system = deps.systemDb;
  if (!system) return err(portUnavailable("SystemDb"));
  if (!isVerificationCode(input.code)) return ok(UNKNOWN_VERIFICATION);
  const target = await system.run("public-verification", (tx) => cardsRepo.lookupVerification(tx, input.code), { readOnly: true });
  if (!target || (target.documentKind !== "REPORT_CARD" && target.documentKind !== "TRANSCRIPT")) return ok(UNKNOWN_VERIFICATION);
  const described = await describe(deps, target.tenantId, target.documentId, input.code);
  if (!described) return ok(UNKNOWN_VERIFICATION);
  await logResult(deps, target.tenantId, described.card, described.result.status, input.ipPrefix ?? null);
  return ok(described.result);
}

async function logResult(deps: ReportcardsDeps, tenantId: string, card: ReportCardRecord, result: string, ipPrefix: string | null): Promise<void> {
  try {
    await deps.systemDb!.runForTenant("public-verification-log", tenantId, (tx) =>
      cardsRepo.logVerification(tx, { id: deps.newId(), tenantId, reportCardId: card.id, documentKind: card.documentKind, result, ipPrefix }),
    );
  } catch (e) {
    // Le journal ne doit jamais empêcher une vérification légitime.
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "reportcards : journal de vérification indisponible");
  }
}

export interface FileVerification {
  match: boolean;
  status: VerificationStatus | null;
  institutionName: string | null;
  title: string | null;
  issuedAt: Date | null;
  message: string;
}

/** Compare le SHA-256 d'un PDF téléversé aux rendus émis : « identique à l'original » ou « ne correspond à aucun original » (AC4.4). */
export async function verifyByFile(deps: ReportcardsDeps, input: { bytes: Uint8Array; ipPrefix?: string | null }): Promise<Result<FileVerification, AppError>> {
  const system = deps.systemDb;
  if (!system) return err(portUnavailable("SystemDb"));
  if (input.bytes.length === 0) return err(invalid("Le fichier est vide.", ReportcardsCode.FILE_TOO_LARGE));
  if (input.bytes.length > MAX_UPLOAD_BYTES) return err(invalid("Le fichier dépasse 10 Mo.", ReportcardsCode.FILE_TOO_LARGE));
  const mismatch: FileVerification = { match: false, status: null, institutionName: null, title: null, issuedAt: null, message: "Ce fichier ne correspond à aucun original émis par un établissement." };
  const hash = sha256Hex(input.bytes);
  const found = await system.run("public-verification", (tx) => cardsRepo.lookupFileHash(tx, hash), { readOnly: true });
  if (!found) return ok(mismatch);
  const target = await system.run("public-verification", (tx) => cardsRepo.lookupVerification(tx, found.code), { readOnly: true });
  if (!target) return ok(mismatch);
  const described = await describe(deps, target.tenantId, target.documentId, found.code);
  if (!described) return ok(mismatch);
  await logResult(deps, target.tenantId, described.card, "FILE_MATCH", input.ipPrefix ?? null);
  const { result } = described;
  const note =
    result.status === "AUTHENTIC"
      ? `Ce fichier est identique à l'original émis le ${formatDateFr(result.issuedAt!.toISOString())}.`
      : result.status === "SUPERSEDED"
        ? `Ce fichier est identique à un original émis le ${formatDateFr(result.issuedAt!.toISOString())}, mais le document a été remplacé par une version plus récente.`
        : result.status === "REVOKED"
          ? "Ce fichier est identique à un original, mais le document a été révoqué."
          : MESSAGES.INVALID;
  return ok({ match: true, status: result.status, institutionName: result.institutionName, title: result.title, issuedAt: result.issuedAt, message: note });
}
