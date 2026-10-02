/**
 * Monde de test : deux tenants A et B sur une base réelle, des comptes aux capacités RBAC connues (la politique d'accès les
 * reçoit en entrée : le test n'a pas besoin du module rbac), un annuaire en mémoire cloisonné par tenant, un stockage et un
 * antivirus simulés (EICAR), une horloge réglable.
 */
import { createRequestContext, type Clock, type RequestContext } from "@ecoledigitale/kernel";
import type { DocumentCreateFields } from "@ecoledigitale/contracts/src/v2/documents";
import { createDocumentsDeps, type DocumentsDeps } from "../../application/deps";
import { RecordingAudit, type DocumentConverter } from "../../application/ports";
import { createDocument } from "../../application/uploads";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";
import type { ActorCaps } from "../../domain/types";
import { createModuleTestDb, type ModuleTestDb } from "./db";
import { uniquePdf } from "./files";

export const uuid = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${String(n).padStart(12, "0")}`;

export const USERS = {
  manager: uuid(0x101),
  secretary: uuid(0x102),
  teacher: uuid(0x103),
  parent: uuid(0x104),
  parent2: uuid(0x105),
  pupil: uuid(0x106),
  staffUser: uuid(0x107),
  doctor: uuid(0x108),
  stranger: uuid(0x109),
  econome: uuid(0x10a),
} as const;

export const PEOPLE = {
  pupil: uuid(0x201), // élève, compte USERS.pupil
  child: uuid(0x202), // enfant de USERS.parent
  other: uuid(0x203), // enfant de USERS.parent2
  staffA: uuid(0x204), // fiche du personnel de USERS.staffUser
  staffB: uuid(0x205),
} as const;

export const CAPS = {
  manager: { manage: true, read: true, readRestricted: true, readConfidential: true, upload: true, share: true, archive: true, historyRead: true, categoryManage: true, settingsManage: true, quarantineManage: true } satisfies ActorCaps,
  secretary: { read: true, readRestricted: true, upload: true, share: true, historyRead: true } satisfies ActorCaps,
  directeurEtudes: { read: true, readRestricted: true, upload: true, share: true, archive: true, historyRead: true } satisfies ActorCaps,
  teacher: { read: true, ownRead: true, ownUpload: true } satisfies ActorCaps,
  econome: { read: true, readRestricted: true, upload: true } satisfies ActorCaps,
  parent: { childRead: true, childUpload: true } satisfies ActorCaps,
  pupil: { selfRead: true, selfUpload: true } satisfies ActorCaps,
  staffOwn: { ownRead: true, ownUpload: true } satisfies ActorCaps,
  none: {} satisfies ActorCaps,
} as const;

export interface MutableClock extends Clock {
  set(d: Date): void;
  advanceDays(n: number): void;
  advanceSeconds(n: number): void;
}

export function mutableClock(start = new Date("2026-10-02T09:00:00Z")): MutableClock {
  let current = start;
  return {
    now: () => current,
    set: (d) => {
      current = d;
    },
    advanceDays: (n) => {
      current = new Date(current.getTime() + n * 86_400_000);
    },
    advanceSeconds: (n) => {
      current = new Date(current.getTime() + n * 1000);
    },
  };
}

export interface World {
  db: ModuleTestDb;
  tenantA: string;
  tenantB: string;
  clock: MutableClock;
  audit: RecordingAudit;
  ports: ReturnType<typeof inMemoryPorts>;
  deps: DocumentsDeps;
  ctxA(userId: string, tenant?: string): RequestContext;
  ctxB(userId: string): RequestContext;
  /** Identifiant de catégorie par code, pour un tenant (jeu de départ créé à la première lecture). */
  category(tenantId: string, code: string): Promise<string>;
  /** Dépose un document de test (par un acteur autorisé, par défaut la secrétaire). */
  seedDocument(over?: Partial<{ tenantId: string; userId: string; caps: ActorCaps; code: string; fields: Partial<DocumentCreateFields>; fileName: string; bytes: Uint8Array }>): Promise<string>;
  drop(): Promise<void>;
}

export async function createWorld(options: { converter?: DocumentConverter } = {}): Promise<World> {
  const db = await createModuleTestDb();
  const tenantA = await db.createTenant("tenant-a");
  const tenantB = await db.createTenant("tenant-b");
  const clock = mutableClock();
  const audit = new RecordingAudit();
  const ports = inMemoryPorts({ now: () => clock.now() });
  if (options.converter) (ports as { converter: DocumentConverter }).converter = options.converter;
  for (const [tenant, label] of [[tenantA, "A"], [tenantB, "B"]] as const) {
    ports.owners
      .addStudent(tenant, PEOPLE.pupil, `Élève ${label}`)
      .addStudent(tenant, PEOPLE.child, `Enfant ${label}`)
      .addStudent(tenant, PEOPLE.other, `Autre ${label}`)
      .addStaff(tenant, PEOPLE.staffA, `Personnel ${label}`)
      .addStaff(tenant, PEOPLE.staffB, `Autre personnel ${label}`)
      .setGuardians(tenant, PEOPLE.child, [USERS.parent])
      .setLinks(tenant, USERS.pupil, { studentId: PEOPLE.pupil })
      .setLinks(tenant, USERS.parent, { childStudentIds: [PEOPLE.child] })
      .setLinks(tenant, USERS.parent2, { childStudentIds: [PEOPLE.other] })
      .setLinks(tenant, USERS.staffUser, { staffId: PEOPLE.staffA });
    for (const [name, id] of Object.entries(USERS)) ports.owners.addUser(tenant, id, `${name} ${label}`);
  }
  const deps = createDocumentsDeps({ db: db.tenantDb, clock, audit, ports });
  const world: World = {
    db, tenantA, tenantB, clock, audit, ports, deps,
    ctxA: (userId, tenant = tenantA) => createRequestContext({ tenantId: tenant, userId }),
    ctxB: (userId) => createRequestContext({ tenantId: tenantB, userId }),
    async category(tenantId, code) {
      const r = await db.admin.query("SELECT id FROM documents.categories WHERE tenant_id = $1 AND code = $2", [tenantId, code]);
      if (r.rows[0]) return r.rows[0].id as string;
      // premier accès du tenant : le jeu de départ est créé à la première lecture
      const { listCategories } = await import("../../application/categories");
      const res = await listCategories(deps, createRequestContext({ tenantId, userId: USERS.manager }), { caps: CAPS.manager });
      if (!res.ok) throw res.error;
      const found = res.value.find((c) => c.code === code);
      if (!found) throw new Error(`catégorie inconnue : ${code}`);
      return found.id;
    },
    async seedDocument(over = {}) {
      const tenantId = over.tenantId ?? tenantA;
      const code = over.code ?? "STUDENT_IDENTITY";
      const categoryId = await world.category(tenantId, code);
      const kind = code.startsWith("STAFF") ? "STAFF" : code.startsWith("STUDENT") ? "STUDENT" : "NONE";
      const fields: DocumentCreateFields = {
        categoryId,
        title: "Document de test",
        ownerType: kind === "STAFF" ? "STAFF" : kind === "STUDENT" ? "STUDENT" : "NONE",
        ownerId: kind === "STAFF" ? PEOPLE.staffA : kind === "STUDENT" ? PEOPLE.child : null,
        visibility: "INHERIT",
        tags: [],
        metadata: {},
        ...over.fields,
      };
      const res = await createDocument(deps, createRequestContext({ tenantId, userId: over.userId ?? USERS.secretary }), {
        caps: over.caps ?? CAPS.secretary,
        fields,
        file: { fileName: over.fileName ?? "piece.pdf", bytes: over.bytes ?? uniquePdf() },
      });
      if (!res.ok) throw res.error;
      return res.value.id;
    },
    drop: () => db.drop(),
  };
  return world;
}
