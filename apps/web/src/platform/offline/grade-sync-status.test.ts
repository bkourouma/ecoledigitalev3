import { describe, expect, it } from "vitest";
import type { DraftView, GradeSyncStatus } from "./grade-sync-manager";
import { describeSync } from "./grade-sync-status";

const A = "a1";
const base: GradeSyncStatus = {
  ready: true,
  persistent: true,
  available: true,
  online: true,
  syncing: false,
  drafts: [],
  totals: { pending: 0, conflicts: 0, failed: 0, locked: 0 },
  failure: null,
  nextRetryAt: null,
  lastSyncAt: null,
  syncedAt: {},
  limitReached: false,
  storageFailed: false,
};
const draft = (over: Partial<DraftView> = {}): DraftView => ({ assessmentId: A, label: null, status: "PENDING", syncing: false, pending: 2, conflicts: [], blockedCode: null, inflight: false, ...over });
const status = (over: Partial<GradeSyncStatus> = {}): GradeSyncStatus => ({ ...base, ...over });
const kind = (s: GradeSyncStatus) => describeSync(s, A).kind;

describe("describeSync : un seul statut annoncé, l'action avant l'attente", () => {
  it("rien en attente -> à jour ; après un envoi -> synchronisé", () => {
    expect(kind(status())).toBe("idle");
    expect(describeSync(status({ syncedAt: { [A]: "2026-10-01T08:00:00.000Z" } }), A)).toMatchObject({ kind: "synced", syncedAt: "2026-10-01T08:00:00.000Z", tone: "ok" });
  });

  it("en attente (en ligne) propose d'envoyer ; hors ligne annonce que tout est gardé sur l'appareil", () => {
    expect(describeSync(status({ drafts: [draft()] }), A)).toMatchObject({ kind: "pending", count: 2, action: "sync" });
    expect(describeSync(status({ online: false, drafts: [draft()] }), A)).toMatchObject({ kind: "offline", count: 2, tone: "warn" });
  });

  it("envoi en cours", () => {
    expect(kind(status({ syncing: true, drafts: [draft({ syncing: true })] }))).toBe("syncing");
  });

  it("conflit, verrouillage et échec priment sur l'attente et le hors ligne", () => {
    const conflict = { enrollmentId: "e1", mine: { entryStatus: "ENTERED" as const, score: "1", comment: null, editedAt: "x" }, server: null, detectedAt: "x" };
    expect(kind(status({ online: false, drafts: [draft({ status: "CONFLICT", conflicts: [conflict] })] }))).toBe("conflict");
    expect(kind(status({ online: false, drafts: [draft({ status: "LOCKED", blockedCode: "assess.grade_frozen" })] }))).toBe("locked");
    expect(describeSync(status({ drafts: [draft({ status: "FAILED", blockedCode: "assess.not_assigned" })] }), A)).toMatchObject({ kind: "failed", action: "retry" });
  });

  it("échec réseau/serveur avec essai prévu ; session expirée distincte, sans action d'envoi", () => {
    expect(describeSync(status({ failure: "server", nextRetryAt: 123, drafts: [draft()] }), A)).toMatchObject({ kind: "failed", nextRetryAt: 123, action: "retry", tone: "bad" });
    expect(describeSync(status({ failure: "auth", drafts: [draft()] }), A)).toMatchObject({ kind: "auth", action: null });
  });

  it("file locale pleine ou stockage refusé : alerte prioritaire (la saisie n'est PAS gardée)", () => {
    expect(kind(status({ limitReached: true, drafts: [draft()] }))).toBe("limit");
    expect(kind(status({ storageFailed: true }))).toBe("storage");
  });

  it("ne mélange pas les évaluations", () => {
    expect(describeSync(status({ drafts: [draft({ assessmentId: "autre", status: "CONFLICT" })] }), A).kind).toBe("idle");
  });
});
