/**
 * Monde de test : dépendances branchées sur des ports en mémoire (results, tutelle, stockage…) + une école complète prête à
 * émettre (identité, signataire, gabarit configuré, période clôturée, inscriptions avec résultats FINAL).
 */
import { ManualClock, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createReportcardsDeps, type ReportcardsDeps } from "../../application/deps";
import { ensureBuiltinTemplates } from "../../application/platform";
import { RecordingAudit } from "../../application/ports";
import { createSignatory, putBranding, putTemplateConfig } from "../../application/reference";
import {
  FakePdfRenderer,
  InMemoryAttendance,
  InMemoryDirectory,
  InMemoryGuardianship,
  InMemoryResults,
  InMemoryStanding,
  makeSampleBundle,
} from "../../infrastructure/in-memory-ports";
import { StaticKeyProvider, generateSigningKeyPair } from "../../infrastructure/key-provider";
import { PdfLibMerger } from "../../infrastructure/pdf-merger";
import { InMemoryStorage } from "../../infrastructure/storage-memory";
import type { FinalResultBundle, Pack } from "../../domain/types";
import { ctxFor, type ReportcardsTestDb } from "./db";

export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
export const VERIFICATION_BASE = "https://verif.example.test";

export interface TestWorld {
  db: ReportcardsTestDb;
  clock: ManualClock;
  results: InMemoryResults;
  guardianship: InMemoryGuardianship;
  attendance: InMemoryAttendance;
  standing: InMemoryStanding;
  directory: InMemoryDirectory;
  storage: InMemoryStorage;
  renderer: FakePdfRenderer;
  audit: RecordingAudit;
  keys: StaticKeyProvider;
  deps: ReportcardsDeps;
  /** Nouvelles dépendances partageant les mêmes ports (autre clé de signature, autre horloge…). */
  depsWith(overrides: Partial<Parameters<typeof createReportcardsDeps>[0]>): ReportcardsDeps;
}

export function makeWorld(db: ReportcardsTestDb, now = "2026-02-03T10:00:00.000Z"): TestWorld {
  const clock = new ManualClock(now);
  const results = new InMemoryResults();
  const guardianship = new InMemoryGuardianship();
  const attendance = new InMemoryAttendance();
  const standing = new InMemoryStanding();
  const directory = new InMemoryDirectory();
  const storage = new InMemoryStorage(clock);
  const renderer = new FakePdfRenderer();
  const audit = new RecordingAudit();
  const keys = new StaticKeyProvider(generateSigningKeyPair().privateKey, "test-key-2026");
  const base = {
    db: db.tenantDb,
    systemDb: db.systemDb,
    clock,
    audit,
    keys,
    ports: { results, guardianship, attendance, standing, directory, storage, renderer, merger: new PdfLibMerger() },
    config: { verificationBaseUrl: VERIFICATION_BASE },
  };
  return {
    db, clock, results, guardianship, attendance, standing, directory, storage, renderer, audit, keys,
    deps: createReportcardsDeps(base),
    depsWith: (overrides) => createReportcardsDeps({ ...base, ...overrides }),
  };
}

export interface Actor {
  userId: string;
  ctx: RequestContext;
}

export interface SchoolStudent {
  studentId: string;
  enrollmentId: string;
  bundle: FinalResultBundle;
}

export interface School {
  tenantId: string;
  pack: Pack;
  admin: Actor;
  classroomId: string;
  periodId: string;
  yearId: string;
  stateId: string;
  ruleVersionId: string;
  signatoryId: string;
  students: SchoolStudent[];
  logoKey: string;
}

const actor = (tenantId: string, mfa = true): Actor => {
  const ctx = ctxFor(tenantId, newId(), ["reportcards"], mfa);
  return { userId: ctx.userId!, ctx };
};

export interface SeedOptions {
  students?: number;
  pack?: Pack;
  /** Période clôturée (défaut oui). */
  closed?: boolean;
  /** Identité + gabarit + signataire configurés (défaut oui). */
  configured?: boolean;
  resultsVersion?: number;
  deliberationHeld?: boolean;
}

export async function seedSchool(world: TestWorld, tenantId: string, options: SeedOptions = {}): Promise<School> {
  const pack = options.pack ?? "SECONDARY";
  const admin = actor(tenantId);
  const classroomId = newId();
  const periodId = newId();
  const yearId = newId();
  const stateId = newId();
  const ruleVersionId = newId();
  const logoKey = `reportcards/${tenantId}/assets/logo/${newId()}.png`;
  const resultsVersion = options.resultsVersion ?? 1;
  const students: SchoolStudent[] = [];
  const n = options.students ?? 3;
  for (let i = 0; i < n; i += 1) {
    const studentId = newId();
    const enrollmentId = newId();
    const bundle = makeSampleBundle({
      studentId, enrollmentId, classroomId, periodId, yearId, stateId, ruleVersionId, pack, resultsVersion,
      lastName: `ELEVE${i + 1}`, firstNames: `Prénom${i + 1}`,
    });
    students.push({ studentId, enrollmentId, bundle });
    world.results.setBundle(enrollmentId, periodId, bundle);
  }
  world.results
    .setState({
      classroomId, academicPeriodId: periodId, pack, institutionId: null, stateId,
      status: options.closed === false ? "LOCKED" : "CLOSED", resultsVersion, closureHash: "c".repeat(64),
      deliberationHeld: options.deliberationHeld ?? true, deliberationDate: "2026-01-15",
    })
    .setRoster(classroomId, periodId, students.map((s) => ({ enrollmentId: s.enrollmentId, studentId: s.studentId, outcome: "FINAL" as const })));

  unwrap(await ensureBuiltinTemplates(world.deps));
  await world.storage.put(logoKey, PNG_1X1, { contentType: "image/png" });

  let signatoryId = "";
  if (options.configured !== false) {
    unwrap(await putBranding(world.deps, admin.ctx, { legalName: "Établissement de Démonstration", headerLeft: ["Ministère exemple"], headerRight: ["République exemple"], address: "1 rue de l'Exemple", logoObjectKey: logoKey, primaryColor: "#14532D" }));
    signatoryId = unwrap(await createSignatory(world.deps, admin.ctx, { fullName: "Personne Fictive Une", title: "Directeur", jobFunction: "Direction générale" })).id;
    const templateKey = pack === "PRIMARY" ? "primary-bulletin" : pack === "HIGHER" ? "higher-bulletin-credits" : "secondary-bulletin";
    const slot = pack === "HIGHER" ? "director-studies" : "director";
    unwrap(await putTemplateConfig(world.deps, admin.ctx, { documentKind: "REPORT_CARD", pack, templateKey, options: {}, signatureAssignments: [{ slot, signatoryId }] }));
  }
  return { tenantId, pack, admin, classroomId, periodId, yearId, stateId, ruleVersionId, signatoryId, students, logoKey };
}

/** Acteur supplémentaire du tenant (secrétariat, parent, élève…). */
export const newActor = actor;
