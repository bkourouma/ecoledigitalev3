/**
 * Contrôle d'intégrité nocturne (AC2.2) : pour chaque bulletin, le hash recalculé depuis le contenu stocké doit égaler le hash
 * stocké, et la signature Ed25519 doit se vérifier avec la clé publique de la ligne. Tout écart ⇒ événement
 * `reportcards.integrity.mismatch` (alerte d'exploitation) et entrée de rapport. Lecture seule, idempotent, par pages.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { snapshotHash } from "../domain/canonical";
import { ReportcardsEvents } from "../domain/events";
import { verifyDocumentSignature } from "../domain/signing";
import * as cardsRepo from "../infrastructure/cards-repository";
import * as platformRepo from "../infrastructure/platform-repository";
import { EventBuffer, inTx, type ReportcardsDeps } from "./deps";
import { notFound } from "../domain/errors";

export interface IntegrityReport {
  checked: number;
  mismatches: Array<{ reportCardId: string; reason: "HASH" | "SIGNATURE"; expectedHash: string; actualHash: string }>;
  nextAfterId: string | null;
}

export async function checkIntegrity(deps: ReportcardsDeps, ctx: RequestContext, input: { afterId?: string; limit?: number } = {}): Promise<Result<IntegrityReport, AppError>> {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);
  return inTx(deps, ctx, async (tx) => {
    const rows = await tx.many<{ id: string; snapshot_hash: string; snapshot: unknown; explain: unknown; signature: string; verification_code: string; issued_at: Date; signing_key_id: string }>(
      `SELECT id, snapshot_hash, snapshot, explain, signature, verification_code, issued_at, signing_key_id
         FROM reportcards.report_cards WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`,
      [input.afterId ?? null, limit],
    );
    const events = new EventBuffer(deps, ctx);
    const keys = new Map<string, string | null>();
    const report: IntegrityReport = { checked: rows.length, mismatches: [], nextAfterId: rows.length === limit ? rows[rows.length - 1]!.id : null };
    for (const row of rows) {
      const actual = snapshotHash(row.snapshot, row.explain);
      if (actual !== row.snapshot_hash) {
        report.mismatches.push({ reportCardId: row.id, reason: "HASH", expectedHash: row.snapshot_hash, actualHash: actual });
        continue;
      }
      if (!keys.has(row.signing_key_id)) keys.set(row.signing_key_id, (await platformRepo.getSigningKey(tx, row.signing_key_id))?.publicKey ?? null);
      const publicKey = keys.get(row.signing_key_id);
      const signatureOk = publicKey ? verifyDocumentSignature(publicKey, { snapshotHash: row.snapshot_hash, verificationCode: row.verification_code, issuedAt: row.issued_at }, row.signature) : false;
      if (!signatureOk) report.mismatches.push({ reportCardId: row.id, reason: "SIGNATURE", expectedHash: row.snapshot_hash, actualHash: actual });
    }
    for (const m of report.mismatches) {
      events.add(ReportcardsEvents.INTEGRITY_MISMATCH, { v: 1, reportCardId: m.reportCardId, expectedHash: m.expectedHash, actualHash: m.actualHash, reason: m.reason }, { type: "report_card", id: m.reportCardId });
      events.audit({ action: "reportcards.integrity.mismatch", resourceType: "report_card", resourceId: m.reportCardId, sensitive: true, metadata: { reason: m.reason } });
    }
    await events.flush(tx);
    return ok(report);
  });
}

/** Vérifie UN bulletin (outil d'exploitation). */
export async function checkOne(deps: ReportcardsDeps, ctx: RequestContext, reportCardId: string): Promise<Result<IntegrityReport, AppError>> {
  const exists = await inTx(deps, ctx, async (tx) => ((await cardsRepo.getCard(tx, reportCardId)) ? ok(true) : err(notFound("Bulletin", reportCardId))), { readOnly: true });
  if (!exists.ok) return exists;
  return checkIntegrity(deps, ctx, { limit: 1000 }).then((r) => (r.ok ? ok({ ...r.value, mismatches: r.value.mismatches.filter((m) => m.reportCardId === reportCardId) }) : r));
}
