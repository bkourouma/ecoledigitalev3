/**
 * reportcards (+ stockage d'objets) -> councils : `DocumentsPort` — PV du conseil (nature `COUNCIL_MINUTES`) scellé, rendu par le worker
 * DEPUIS LE SNAPSHOT SEUL, vérifiable publiquement ; URL signée de lecture du PDF rendu (≤ 5 min).
 *
 * `councils` fournit le CONTENU figé (snapshot `council-minutes/1`, immuable, hash calculé par sa base) ; `reportcards` le scelle (empreinte, code,
 * signature Ed25519), le fait rendre et l'inscrit dans la vérification publique. Le contexte d'impression (chaînes déjà mises en forme pour le
 * gabarit de plateforme `council-minutes`) est DÉRIVÉ du snapshot : il ne contient rien d'autre. Sous un jeu de règles `placeholder`, le filigrane
 * et la mention « règles de démonstration » sont imposés par la provenance scellée (`ruleSourceKind`).
 * Échec FERMÉ : si la nature `COUNCIL_MINUTES` n'est pas livrée, ou sans stockage, l'adaptateur refuse (`councils.port_unavailable`) — jamais un
 * document sans gabarit, jamais un faux PDF.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { OFFICIAL_DOCUMENT_KINDS, getOfficialDocumentRecord, requestOfficialDocument, type ReportcardsDeps } from "../../modules/reportcards";
import { councilsPortUnavailable, type CouncilsDocumentsPort } from "../../modules/councils";
import type { ObjectStorage } from "./storage";

const PRESENCE_LABELS: Readonly<Record<string, string>> = { PRESENT: "Présent(e)", ABSENT: "Absent(e)", EXCUSED: "Excusé(e)", INVITED: "Invité(e)" };

interface Snapshot {
  council: { typeLabel: string; heldOn: string; location: string | null; quorumWaived: boolean; quorumWaiverReason: string | null };
  classroom: { name: string | null };
  period: { label: string | null };
  participants: Array<{ name: string; roleLabel?: string | null; roleCode: string; function: string | null; presence: string }>;
  students: Array<{ name: string; decisions: Array<{ decisionTypeCode: string; decisionTypeLabel?: string | null; justification: string | null; targetLabel: string | null }>; appreciation: string | null; distinctions: string[] }>;
}

/** Contexte d'impression du gabarit `council-minutes` : des chaînes mises en forme, dérivées du snapshot (rien d'autre n'est imprimé). */
export function minutesPrintContext(snapshot: Snapshot, title: string): Record<string, unknown> {
  const president = snapshot.participants.find((p) => p.function === "PRESIDENT");
  const secretary = snapshot.participants.find((p) => p.function === "SECRETARY");
  let n = 0;
  const decisions = snapshot.students.flatMap((s) => s.decisions.map((d) => ({ number: String((n += 1)), studentName: s.name, decisionLabel: `${d.decisionTypeLabel ?? d.decisionTypeCode}${d.targetLabel ? ` — ${d.targetLabel}` : ""}`, justification: d.justification ?? "" })));
  return {
    title,
    council: { kindLabel: snapshot.council.typeLabel, classroomLabel: snapshot.classroom.name ?? "", periodLabel: snapshot.period.label ?? "", academicYearLabel: "", heldOn: snapshot.council.heldOn, place: snapshot.council.location ?? "", presidentName: president?.name ?? "", secretaryName: secretary?.name ?? "" },
    quorum: { text: snapshot.council.quorumWaived ? `Séance ouverte sans quorum : ${snapshot.council.quorumWaiverReason ?? ""}`.trim() : "" },
    participants: snapshot.participants.map((p) => ({ name: p.name, roleLabel: p.roleLabel ?? p.roleCode, presenceLabel: PRESENCE_LABELS[p.presence] ?? p.presence, signedText: "" })),
    agenda: snapshot.students.map((s) => ({ title: s.name, summary: s.distinctions.length > 0 ? s.distinctions.join(", ") : "" })),
    decisions,
    remarks: snapshot.students.filter((s) => s.appreciation).map((s) => `${s.name} : ${s.appreciation}`).join(" ‖ "),
  };
}

export function createCouncilsDocumentsPort(reportcards: ReportcardsDeps, storage: ObjectStorage | null): CouncilsDocumentsPort {
  const supported = (OFFICIAL_DOCUMENT_KINDS as readonly string[]).includes("COUNCIL_MINUTES");
  const needs = (): void => {
    if (!supported) throw councilsPortUnavailable("documents officiels (COUNCIL_MINUTES)");
  };
  return {
    async requestMinutes(ctx: RequestContext, { minutesId, title, issuedAt, snapshot, ruleSourceKind, templateKey }) {
      needs();
      const r = await requestOfficialDocument(reportcards, ctx, {
        kind: "COUNCIL_MINUTES",
        sourceId: minutesId,
        title,
        issuedAt,
        content: snapshot,
        context: minutesPrintContext(snapshot as unknown as Snapshot, title),
        ...(templateKey ? { templateKey } : {}),
        ruleSourceKind,
      });
      if (!r.ok) throw r.error;
      return { documentId: r.value.record.id };
    },
    async getMinutesDocument(ctx, minutesId) {
      needs();
      const r = await getOfficialDocumentRecord(reportcards, ctx, { kind: "COUNCIL_MINUTES", sourceId: minutesId });
      if (!r.ok) throw r.error;
      const rec = r.value;
      return rec ? { documentId: rec.id, renderStatus: rec.renderStatus === "RENDERED" ? "RENDERED" : rec.renderStatus === "FAILED" ? "FAILED" : "PENDING", objectKey: rec.objectKey, pdfHash: rec.pdfHash } : null;
    },
    async signedReadUrl(_ctx, objectKey, ttlSeconds) {
      if (!storage) throw councilsPortUnavailable("stockage d'objets");
      return storage.signedUrl(objectKey, { ttlSeconds: Math.min(300, ttlSeconds), contentType: "application/pdf" });
    },
  };
}
