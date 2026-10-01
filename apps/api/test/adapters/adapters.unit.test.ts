/**
 * Adaptateurs de plateforme — tests SANS base : traductions pures, stockage d'objets (S3 / disque), complétude des ports.
 * Les chaînes de bout en bout (Postgres réel) sont dans `chain.integration.test.ts` et `finance-academic.integration.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { ManualClock, noopLogger } from "@ecoledigitale/kernel";
import type { SystemDb, TenantDb } from "@ecoledigitale/database";
import { unavailablePorts as unavailableAttendancePorts } from "../../src/modules/attendance";
import { unavailablePorts as unavailableHigherPorts } from "../../src/modules/higher";
import { unavailableAssessPorts } from "../../src/modules/assess";
import { unavailableResultsPorts } from "../../src/modules/results";
import { toClassStructure } from "../../src/platform/adapters/academic-results";
import { hoursToMinutes } from "../../src/platform/adapters/academic-scheduling";
import { buildPlatformPorts, createAdapterKit } from "../../src/platform/adapters";
import { emailLocalPart } from "../../src/platform/adapters/people-lookups";
import { fitDecimal } from "../../src/platform/adapters/results-reportcards";
import { toOccurrenceInfo } from "../../src/platform/adapters/scheduling-attendance";
import { DiskStorage, asAttendanceStorage, asPeopleStorage, createObjectStorage, registerDiskStorageRoute, s3EnvFrom, assertSafeKey } from "../../src/platform/adapters/storage";
import type { ResultsStructure } from "../../src/modules/academic";

describe("academic -> results : structure de calcul", () => {
  const period = { id: "p1", typeCode: "SEMESTER", rankInYear: 2, countInYear: 2, isLast: true, startsOn: "2027-02-01", endsOn: "2027-07-31" };
  const facts: ResultsStructure = {
    classroomId: "c1",
    academicYearId: "y1",
    institutionId: "i1",
    programId: "pr1",
    educationLevelCode: "LICENCE",
    gradeLevelCode: "L1",
    calculationContract: "credit-semester@1",
    terminalExamRequired: true,
    period,
    firstPeriodId: "p0",
    yearPeriods: [{ ...period, id: "p0", rankInYear: 1, isLast: false }, period],
    nodes: [
      { id: "u1", lineageId: "lu1", parentId: null, kind: "UE", code: "UE1", label: "UE 1", position: 0, credits: "6", coefficient: null, gradingMode: "COMPOSED", resitAllowed: false, countsInAverage: true, sectionKey: null, categoryCode: "FOND", isTransversal: false },
      { id: "e1", lineageId: "le1", parentId: "u1", kind: "ECUE", code: "E11", label: "ECUE 11", position: 1, credits: "3", coefficient: "2", gradingMode: "DIRECT", resitAllowed: true, countsInAverage: false, sectionKey: "SCI", categoryCode: null, isTransversal: true },
    ],
  };

  it("traduit les faits d'academic sans rien deviner (second semestre = dernière période, examen terminal = donnée)", () => {
    const s = toClassStructure(facts)!;
    expect(s).toMatchObject({ classroomId: "c1", academicYearId: "y1", institutionId: "i1", levelCode: "L1", contractId: "credit-semester@1", firstPeriodId: "p0", terminalExamRequired: true });
    expect(s.period).toEqual({ id: "p1", rankInYear: 2, countInYear: 2, isSecondSemester: true, startsOn: "2027-02-01", endsOn: "2027-07-31" });
    expect(s.yearPeriods.map((p) => [p.id, p.isSecondSemester])).toEqual([["p0", false], ["p1", true]]);
    expect(s.nodes[1]).toMatchObject({ id: "e1", parentId: "u1", kind: "ECUE", ordinal: 1, credits: "3", coefficient: "2", gradingMode: "DIRECT", resitAllowed: true, countsInAverage: false, sectionKey: "SCI", category: null });
    expect(s.nodes[0]).toMatchObject({ category: "FOND" });
  });

  it("sans contrat de calcul : aucune structure (results échoue fermé, jamais de contrat par défaut)", () => {
    expect(toClassStructure({ ...facts, calculationContract: null })).toBeNull();
  });
});

describe("conversions", () => {
  it("heures décimales -> minutes entières", () => {
    expect(hoursToMinutes("1.5")).toBe(90);
    expect(hoursToMinutes("0")).toBe(0);
    expect(hoursToMinutes("20.25")).toBe(1215);
    expect(hoursToMinutes(null)).toBeNull();
    expect(hoursToMinutes("abc")).toBeNull();
  });

  it("décimaux du snapshot : au plus 6 décimales, demi supérieur, sans flottant", () => {
    expect(fitDecimal("12.375")).toBe("12.375");
    expect(fitDecimal("12.3333333333")).toBe("12.333333");
    expect(fitDecimal("12.9999995")).toBe("13");
    expect(fitDecimal("0.0000005")).toBe("0.000001");
    expect(fitDecimal("0.0000004")).toBe("0");
    expect(fitDecimal("-3.1234565")).toBe("-3.123457");
    expect(fitDecimal("007.50")).toBe("7.5"); // forme canonique : sans zéros de fin
    expect(fitDecimal(null)).toBeNull();
    expect(fitDecimal("pas un nombre")).toBeNull();
  });

  it("repli de nom d'affichage : partie locale de l'e-mail, jamais le domaine", () => {
    expect(emailLocalPart("prenom.nom@ecole.example")).toBe("prenom.nom");
    expect(emailLocalPart("sans-arobase")).toBe("sans-arobase");
  });

  it("séance -> séance d'appel : durée en minutes, statut, intervenants ; une séance sans classe ne porte pas d'appel", () => {
    const base = {
      id: "o1",
      classroomId: "c1",
      institutionId: "i1",
      academicYearId: "y1",
      curriculumNodeId: "n1",
      offeringId: null,
      occursOn: "2026-10-05",
      startsAt: new Date("2026-10-05T08:00:00Z"),
      endsAt: new Date("2026-10-05T09:30:00Z"),
      status: "PLANNED" as const,
      staff: [{ staffId: "s1", role: "LEAD" }],
    };
    expect(toOccurrenceInfo(base)).toMatchObject({ occurrenceId: "o1", date: "2026-10-05", durationMinutes: 90, status: "PLANNED", staff: [{ staffId: "s1", role: "LEAD" }] });
    expect(toOccurrenceInfo({ ...base, classroomId: null })).toBeNull();
  });
});

describe("stockage d'objets : choix de l'adaptateur par l'environnement", () => {
  it("S3 / MinIO quand un bucket est configuré (STORAGE_S3_*, repli REPORTCARDS_S3_*)", () => {
    expect(s3EnvFrom({ STORAGE_S3_BUCKET: "b", REPORTCARDS_S3_BUCKET: "ancien", STORAGE_S3_ENDPOINT: "http://minio:9000", REPORTCARDS_S3_REGION: "eu-west-1" })).toMatchObject({
      REPORTCARDS_S3_BUCKET: "b",
      REPORTCARDS_S3_ENDPOINT: "http://minio:9000",
      REPORTCARDS_S3_REGION: "eu-west-1",
    });
    const s = createObjectStorage({ STORAGE_S3_BUCKET: "bulletins", STORAGE_S3_ENDPOINT: "http://127.0.0.1:9000", STORAGE_S3_ACCESS_KEY_ID: "a", STORAGE_S3_SECRET_ACCESS_KEY: "b" });
    expect(s?.driver).toBe("s3");
    expect(createObjectStorage({ REPORTCARDS_S3_BUCKET: "historique" })?.driver).toBe("s3");
  });

  it("repli disque en développement (avertissement), jamais implicite en production", () => {
    const warnings: string[] = [];
    const dev = createObjectStorage({ NODE_ENV: "development", STORAGE_DISK_DIR: join(tmpdir(), "ed-test-objets") }, { warn: (m) => warnings.push(m) });
    expect(dev?.driver).toBe("disk");
    expect(warnings.join(" ")).toContain("repli DISQUE");
    expect(createObjectStorage({ NODE_ENV: "production" })).toBeNull();
    expect(createObjectStorage({ NODE_ENV: "production", STORAGE_DISK_DIR: join(tmpdir(), "ed-test-objets"), STORAGE_SIGNING_SECRET: "x".repeat(20) })?.driver).toBe("disk");
    expect(() => createObjectStorage({ NODE_ENV: "production", STORAGE_DISK_DIR: join(tmpdir(), "ed-test-objets"), STORAGE_SIGNING_SECRET: "court" })).toThrow(/16/);
  });

  it("aucun secret journalisé : l'avertissement du repli ne contient ni secret ni identifiant", () => {
    const warnings: string[] = [];
    createObjectStorage({ NODE_ENV: "development", STORAGE_DISK_DIR: join(tmpdir(), "ed-test-objets"), STORAGE_SIGNING_SECRET: "secret-de-test-0123456789" }, { warn: (m) => warnings.push(m) });
    expect(warnings.join(" ")).not.toContain("secret-de-test");
  });
});

describe("repli disque : objets, URL signées, confinement des clés", () => {
  const root = mkdtempSync(join(tmpdir(), "ed-disk-"));
  const clock = new ManualClock("2026-10-01T10:00:00.000Z");
  const store = new DiskStorage({ rootDir: root, publicBaseUrl: "http://localhost:3001/", signingSecret: "s".repeat(32), now: () => clock.now() });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("écrit, relit, vérifie l'existence et supprime (empreinte SHA-256 retournée)", async () => {
    const bytes = new TextEncoder().encode("contenu du bulletin");
    const put = await store.put("reportcards/t1/a.pdf", bytes, { contentType: "application/pdf" });
    expect(put).toEqual({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/), size: bytes.length });
    expect(await store.exists("reportcards/t1/a.pdf")).toBe(true);
    const got = await store.get("reportcards/t1/a.pdf");
    expect(Buffer.from(got!.bytes).toString("utf8")).toBe("contenu du bulletin");
    expect(got!.contentType).toBe("application/pdf");
    expect(await store.get("reportcards/t1/absent.pdf")).toBeNull();
    await store.delete("reportcards/t1/a.pdf");
    expect(await store.exists("reportcards/t1/a.pdf")).toBe(false);
  });

  it("refuse toute clé qui sort du dossier racine ou vise les métadonnées", async () => {
    for (const key of ["../evasion", "a/../../b", "/absolu", "a\\b", "", "x/y.meta.json", "a b"]) {
      expect(() => assertSafeKey(key), key).toThrow();
    }
    await expect(store.put("../evasion.txt", new Uint8Array([1]), { contentType: "text/plain" })).rejects.toThrow();
    await expect(store.get("../../etc/passwd")).rejects.toThrow();
  });

  it("URL signée : durée plafonnée à 5 min, jeton vérifié (signature, expiration) ; un jeton altéré ou expiré est refusé", async () => {
    const { url, expiresAt } = await store.signedUrl("reportcards/t1/b.pdf", { ttlSeconds: 9_999, fileName: "Bulletin 1.pdf", contentType: "application/pdf" });
    expect(url.startsWith("http://localhost:3001/api/v1/storage/object?token=")).toBe(true);
    expect(expiresAt.getTime() - clock.now().getTime()).toBe(300_000);
    const token = new URL(url).searchParams.get("token")!;
    expect(store.verifyToken(token)).toMatchObject({ k: "reportcards/t1/b.pdf", f: "Bulletin 1.pdf" });
    expect(store.verifyToken(`${token.split(".")[0]}.${"A".repeat(43)}`)).toBeNull();
    expect(store.verifyToken("n'importe quoi")).toBeNull();
    const forged = Buffer.from(JSON.stringify({ k: "../secret", e: Date.now() + 60_000 })).toString("base64url");
    expect(store.verifyToken(`${forged}.${token.split(".")[1]}`)).toBeNull();
    clock.advance(301_000);
    expect(store.verifyToken(token)).toBeNull();
  });

  it("route publique : sert l'objet avec en-têtes de téléchargement sûrs ; 404 pour un jeton invalide ou expiré", async () => {
    const t0 = new ManualClock("2026-10-01T10:00:00.000Z");
    const s = new DiskStorage({ rootDir: root, publicBaseUrl: "http://localhost", signingSecret: "k".repeat(32), now: () => t0.now() });
    await s.put("docs/lettre.txt", new TextEncoder().encode("bonjour"), { contentType: "text/plain" });
    const app = Fastify();
    registerDiskStorageRoute(app, s);
    const { url } = await s.signedUrl("docs/lettre.txt", { ttlSeconds: 60, fileName: "lettre?.txt" });
    const ok = await app.inject({ method: "GET", url: url.replace("http://localhost", "") });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("bonjour");
    expect(ok.headers["content-disposition"]).toBe('attachment; filename="lettre_.txt"');
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    expect((await app.inject({ method: "GET", url: "/api/v1/storage/object?token=xx.yy" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/storage/object" })).statusCode).toBe(404);
    t0.advance(61_000);
    expect((await app.inject({ method: "GET", url: url.replace("http://localhost", "") })).statusCode).toBe(404);
    await app.close();
  });

  it("vues pour attendance (secondes) et people (chaîne) sur le même stockage", async () => {
    const a = asAttendanceStorage(store);
    await a.put("attendance/t/x.png", new Uint8Array([1, 2, 3]), { contentType: "image/png" });
    expect((await a.signedUrl("attendance/t/x.png", 60)).url).toContain("token=");
    await a.delete("attendance/t/x.png");
    const p = asPeopleStorage(store);
    await p.put("people/t/photo.jpg", new Uint8Array([9]), { contentType: "image/jpeg" });
    expect(await p.signedUrl("people/t/photo.jpg", { ttlSec: 60 })).toContain("token=");
    await p.delete("people/t/photo.jpg");
    expect(await store.exists("people/t/photo.jpg")).toBe(false);
  });
});

describe("complétude des ports branchés par la plateforme", () => {
  const kit = createAdapterKit({ tenantDb: {} as TenantDb, systemDb: {} as SystemDb, logger: noopLogger });
  const withStorage = buildPlatformPorts(kit, new DiskStorage({ rootDir: tmpdir(), publicBaseUrl: "http://localhost", signingSecret: "s".repeat(32) }));
  const keys = (o: object): string[] => Object.keys(o).sort();

  it("chaque port que ses modules déclarent indisponible est fourni (sinon `*.port_unavailable` en production)", () => {
    expect(keys(withStorage.results)).toEqual(keys(unavailableResultsPorts()).filter((k) => !["assess", "rules"].includes(k)));
    expect(keys(withStorage.assess)).toEqual(keys(unavailableAssessPorts()));
    expect(keys(withStorage.attendance)).toEqual(keys(unavailableAttendancePorts()).filter((k) => k !== "alertPolicy"));
    // higher : le port des règles est branché par défaut sur le module rules.
    expect(keys(withStorage.higher)).toEqual(keys(unavailableHigherPorts()).filter((k) => k !== "rules"));
    expect(keys(withStorage.payroll)).toEqual(["attendanceHours", "curriculum", "sessionHours", "staff"]);
    expect(keys(withStorage.scheduling)).toEqual(["academic", "attendance", "people"]);
    expect(keys(withStorage.finance)).toEqual(["enrollments", "learners"]);
    expect(keys(withStorage.people)).toEqual(["academic", "storage"]);
    expect(keys(withStorage.reportcards)).toEqual(["attendance", "directory", "guardianship", "results", "standing", "storage"]);
    expect(keys(withStorage.academic)).toEqual(["completion", "guardianship", "invoiceFacts", "readiness", "registrationFee", "schedule", "students", "usageGuard"]);
  });

  it("sans stockage d'objets configuré, aucun port de stockage n'est branché (échec fermé, pas de disque implicite)", () => {
    const none = buildPlatformPorts(kit, null);
    expect(keys(none.people)).toEqual(["academic"]);
    expect(none.attendance).not.toHaveProperty("storage");
    expect(none.reportcards).not.toHaveProperty("storage");
  });
});
