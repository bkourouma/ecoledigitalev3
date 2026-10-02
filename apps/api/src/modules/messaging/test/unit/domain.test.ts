/**
 * Domaine pur et contrats : texte, curseurs, annonces (cibles, états, droits), pièces jointes, gabarits, schémas Zod.
 */
import { describe, expect, it } from "vitest";
import {
  messagingCreateAnnouncementBodySchema,
  messagingCreateConversationBodySchema,
  messagingDecideReportBodySchema,
  messagingEventPayloadSchemas,
  messagingTargetSchema,
} from "@ecoledigitale/contracts/src/v2/messaging";
import { canPublishTo, isExpired, normalizeAudiences, normalizeTargets, publicationOutcome, visibleToRecipient } from "../../domain/announcements";
import { ALL_MESSAGING_EVENT_TYPES } from "../../domain/events";
import { detectMimeType, extensionFor, sanitizeFileName } from "../../domain/magic-bytes";
import { DEFAULT_SYSTEM_TEMPLATES } from "../../domain/system-templates";
import { decodeCursor, directKey, encodeCursor, normalizeText, previewOf, renderTemplate, systemKey, templateVariables } from "../../domain/text";
import { snippetOf } from "../../application/conversations";
import { formatDateFr, readRecordedEvent } from "../../application/consumers";
import { IDS } from "../support/world";

const U1 = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const U2 = "0192f0a4-7b1e-7c3a-8d2e-0000000000b2";

describe("texte", () => {
  it("normalise sans accents ni casse", () => {
    expect(normalizeText("  Réunion   des PARENTS ")).toBe("reunion des parents");
  });
  it("aperçu : espaces réduits, tronqué à 160", () => {
    expect(previewOf("a\n\n b")).toBe("a b");
    expect(previewOf("x".repeat(500)).length).toBe(160);
    expect(previewOf("x".repeat(500)).endsWith("…")).toBe(true);
  });
  it("clé de fil direct symétrique, sensible à l'élève et à l'objet", () => {
    expect(directKey(U1, U2, null, "Notes")).toBe(directKey(U2, U1, null, "notes"));
    expect(directKey(U1, U2, IDS.S1, "Notes")).not.toBe(directKey(U1, U2, null, "Notes"));
    expect(directKey(U1, U2, null, "Notes")).not.toBe(directKey(U1, U2, null, "Absences"));
    expect(systemKey(U1)).toBe(`system:${U1}`);
  });
  it("rend un gabarit : variables inconnues vides, jamais de HTML interprété", () => {
    expect(renderTemplate("Bonjour {{ name }} {{ missing }}!", { name: "<b>Awa</b>" })).toBe("Bonjour <b>Awa</b> !");
    expect(templateVariables("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });
  it("extrait : centré sur l'occurrence, insensible aux accents", () => {
    const body = `${"début ".repeat(40)}réunion de rentrée${" fin".repeat(40)}`;
    const s = snippetOf(body, "REUNION");
    expect(s).toContain("réunion de rentrée");
    expect(s.length).toBeLessThan(200);
  });
});

describe("curseurs", () => {
  it("aller-retour et rejet d'un curseur forgé", () => {
    const c = { t: "2026-10-02T10:00:00.000Z", id: U1 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(undefined)).toBeNull();
    expect(() => decodeCursor("pas-un-curseur")).toThrow();
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ t: "x", id: "pas-un-uuid" })).toString("base64url"))).toThrow();
  });
});

describe("pièces jointes : type RÉEL sur les octets", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it("détecte PDF, JPEG, PNG, WebP", () => {
    expect(detectMimeType(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(detectMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectMimeType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("refuse un exécutable, un script, du texte (quelle que soit l'extension annoncée)", () => {
    expect(detectMimeType(Buffer.from("MZ\x90\x00"))).toBeNull(); // exécutable Windows
    expect(detectMimeType(Buffer.from("#!/bin/sh\nrm -rf /"))).toBeNull();
    expect(detectMimeType(Buffer.from("<html><script>"))).toBeNull();
    expect(detectMimeType(new Uint8Array())).toBeNull();
  });
  it("assainit le nom et choisit l'extension du type détecté", () => {
    expect(sanitizeFileName("..\\..\\etc/passwd\u0000.pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName("   ")).toBe("piece-jointe");
    expect(sanitizeFileName("a".repeat(400)).length).toBe(255);
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});

describe("annonces : cibles et audiences", () => {
  it("normalise, dédoublonne et trie ; « tout l'établissement » écarte les autres cibles (rôles conservés)", () => {
    const t = normalizeTargets([
      { kind: "CLASSROOM", ref: IDS.C6B },
      { kind: "CLASSROOM", ref: IDS.C6A },
      { kind: "CLASSROOM", ref: IDS.C6A.toUpperCase() },
    ]);
    expect(t.map((x) => x.ref)).toEqual([IDS.C6A, IDS.C6B]);
    expect(normalizeTargets([{ kind: "TENANT" }, { kind: "CLASSROOM", ref: IDS.C6A }, { kind: "ROLE", ref: "enseignant" }])).toEqual([
      { kind: "TENANT", ref: "" },
      { kind: "ROLE", ref: "enseignant" },
    ]);
    expect(normalizeAudiences(["STAFF", "STUDENTS"])).toEqual(["STUDENTS", "STAFF"]);
  });
  it("valide la forme d'une cible", () => {
    expect(messagingTargetSchema.safeParse({ kind: "TENANT" }).success).toBe(true);
    expect(messagingTargetSchema.safeParse({ kind: "TENANT", ref: IDS.C6A }).success).toBe(false);
    expect(messagingTargetSchema.safeParse({ kind: "CLASSROOM" }).success).toBe(false);
    expect(messagingTargetSchema.safeParse({ kind: "CLASSROOM", ref: "pas-un-uuid" }).success).toBe(false);
    expect(messagingTargetSchema.safeParse({ kind: "ROLE", ref: "enseignant" }).success).toBe(true);
    expect(messagingTargetSchema.safeParse({ kind: "ROLE", ref: "Pas Un Role" }).success).toBe(false);
  });
  it("expiration dérivée et visibilité d'un destinataire", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const past = new Date("2026-10-01T12:00:00Z");
    const future = new Date("2026-10-03T12:00:00Z");
    expect(isExpired(past, now)).toBe(true);
    expect(isExpired(now, now)).toBe(true);
    expect(isExpired(future, now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
    expect(visibleToRecipient({ status: "PUBLISHED", expiresAt: future }, now, false)).toBe(true);
    expect(visibleToRecipient({ status: "PUBLISHED", expiresAt: past }, now, false)).toBe(false);
    expect(visibleToRecipient({ status: "PUBLISHED", expiresAt: past }, now, true)).toBe(true);
    for (const status of ["DRAFT", "SCHEDULED", "WITHDRAWN"] as const) expect(visibleToRecipient({ status, expiresAt: null }, now, true)).toBe(false);
  });
  it("programmée seulement si la date est dans le futur", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    expect(publicationOutcome(null, now)).toBe("PUBLISHED");
    expect(publicationOutcome(new Date("2026-10-01T00:00:00Z"), now)).toBe("PUBLISHED");
    expect(publicationOutcome(new Date("2026-10-05T00:00:00Z"), now)).toBe("SCHEDULED");
  });
  it("droits de publication : toute cible / SES classes (élèves, tuteurs) / rien", () => {
    const classes = normalizeTargets([{ kind: "CLASSROOM", ref: IDS.C6A }]);
    expect(canPublishTo({ announcementPublish: true }, [], normalizeTargets([{ kind: "TENANT" }]), ["STAFF"]).ok).toBe(true);
    expect(canPublishTo({ announcementPublishClass: true }, [IDS.C6A], classes, ["GUARDIANS"]).ok).toBe(true);
    expect(canPublishTo({ announcementPublishClass: true }, [IDS.C6B], classes, ["GUARDIANS"])).toEqual({ ok: false, reason: "TARGET_NOT_ALLOWED" });
    expect(canPublishTo({ announcementPublishClass: true }, [IDS.C6A], normalizeTargets([{ kind: "LEVEL", ref: IDS.LEVEL_6 }]), ["GUARDIANS"])).toEqual({ ok: false, reason: "TARGET_NOT_ALLOWED" });
    expect(canPublishTo({ announcementPublishClass: true }, [IDS.C6A], classes, ["STAFF"])).toEqual({ ok: false, reason: "AUDIENCE_NOT_ALLOWED" });
    expect(canPublishTo({}, [], classes, ["STUDENTS"])).toEqual({ ok: false, reason: "NO_PERMISSION" });
  });
});

describe("messages système", () => {
  it("gabarits par défaut : absence active, retard désactivé, variables cohérentes", () => {
    const absence = DEFAULT_SYSTEM_TEMPLATES.find((t) => t.code === "attendance.absence")!;
    const late = DEFAULT_SYSTEM_TEMPLATES.find((t) => t.code === "attendance.late")!;
    expect(absence.enabledByDefault).toBe(true);
    expect(late.enabledByDefault).toBe(false);
    for (const t of DEFAULT_SYSTEM_TEMPLATES) {
      for (const v of [...templateVariables(t.title), ...templateVariables(t.body)]) expect(t.variables).toContain(v);
    }
  });
  it("lit le payload du producteur et refuse un payload illisible", () => {
    const ok = readRecordedEvent({ studentId: IDS.S1, date: "2026-10-02", excused: false, correction: false, recordId: IDS.S2 });
    expect(ok).toEqual({ studentId: IDS.S1, date: "2026-10-02", excused: false, correction: false, recordId: IDS.S2 });
    expect(readRecordedEvent({ studentId: "x", date: "2026-10-02" })).toBeNull();
    expect(readRecordedEvent({ studentId: IDS.S1, date: "demain" })).toBeNull();
    expect(readRecordedEvent(null)).toBeNull();
    expect(formatDateFr("2026-10-02")).toBe("02/10/2026");
  });
});

describe("contrats Zod", () => {
  const base = { subject: "Réunion", body: "Bonjour", recipients: { userIds: [U1], classrooms: [], toAdministration: false } };
  it("DIRECT : exactement un destinataire explicite", () => {
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "DIRECT", ...base }).success).toBe(true);
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "DIRECT", ...base, recipients: { userIds: [U1, U2], classrooms: [] } }).success).toBe(false);
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "DIRECT", ...base, recipients: { userIds: [], classrooms: [{ classroomId: IDS.C6A, include: ["STUDENTS"] }] } }).success).toBe(false);
  });
  it("GROUP et BROADCAST exigent un objet ; « à l'administration » ne se diffuse pas", () => {
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "GROUP", body: "x", recipients: { userIds: [U1, U2] } }).success).toBe(false);
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "GROUP", ...base, recipients: { userIds: [U1, U2] } }).success).toBe(true);
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "BROADCAST", ...base, recipients: { userIds: [], toAdministration: true } }).success).toBe(false);
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "GROUP", ...base, recipients: { userIds: [], classrooms: [], toAdministration: true } }).success).toBe(true);
  });
  it("refuse un destinataire absent, un corps vide et des champs inconnus", () => {
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "GROUP", ...base, recipients: {} }).success).toBe(false);
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "DIRECT", ...base, body: "   " }).success).toBe(false);
    expect(messagingCreateConversationBodySchema.safeParse({ kind: "DIRECT", ...base, surprise: 1 }).success).toBe(false);
  });
  it("annonce : l'expiration doit suivre la publication", () => {
    const body = { title: "Rentrée", body: "…", audience: { targets: [{ kind: "TENANT" }] }, publishAt: "2026-10-10T08:00:00Z", expiresAt: "2026-10-09T08:00:00Z" };
    expect(messagingCreateAnnouncementBodySchema.safeParse(body).success).toBe(false);
    expect(messagingCreateAnnouncementBodySchema.safeParse({ ...body, expiresAt: "2026-10-11T08:00:00Z" }).success).toBe(true);
  });
  it("décision de modération : cohérence rejet / action", () => {
    expect(messagingDecideReportBodySchema.safeParse({ decision: "DISMISS", note: "RAS" }).success).toBe(true);
    expect(messagingDecideReportBodySchema.safeParse({ decision: "DISMISS", note: "RAS", removeMessage: true }).success).toBe(false);
    expect(messagingDecideReportBodySchema.safeParse({ decision: "ACTION", note: "Injures" }).success).toBe(false);
    expect(messagingDecideReportBodySchema.safeParse({ decision: "ACTION", note: "Injures", removeMessage: true }).success).toBe(true);
    expect(messagingDecideReportBodySchema.safeParse({ decision: "ACTION", note: "Injures", restrictSender: { untilDays: 7 } }).success).toBe(true);
  });
  it("événements : un schéma par événement publié, aucun texte de message dans les payloads", () => {
    expect(Object.keys(messagingEventPayloadSchemas).sort()).toEqual([...ALL_MESSAGING_EVENT_TYPES].sort());
    for (const schema of Object.values(messagingEventPayloadSchemas)) {
      for (const key of Object.keys(schema.shape)) expect(["body", "title", "text", "content", "subject"]).not.toContain(key);
    }
  });
});
