/**
 * Comportements du DDL (migrations 0950-0954) sans passer par l'application : ce que la BASE
 * impose, même à un écrivain qui contourne les cas d'usage. Reprend les 22 comportements du DDL
 * de référence (specs/v2/017-scheduling/data-model.md) adaptés aux ajouts (generated_for, jetons,
 * contrôle d'équipement au déplacement).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { createRequestContext, newId } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { adminRows, createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";

describeIntegration("DDL scheduling : garanties de la base", () => {
  let db: SchedulingTestDb;
  let tenantA: string;
  let tenantB: string;
  const institution = newId();
  const campus = newId();
  const year = newId();
  const user = newId();

  const ctxOf = (tenantId: string) => createRequestContext({ tenantId, userId: user, roles: [] });
  /** Exécute `fn` dans une transaction tenant, contrainte d'exclusion en mode IMMEDIATE (comme les cas d'usage). */
  const run = <T>(tenantId: string, fn: (tx: Tx) => Promise<T>, immediate = true): Promise<T> =>
    db.tenantDb.run(ctxOf(tenantId), async (tx) => {
      if (immediate) await tx.query("SET CONSTRAINTS scheduling.resource_claims_no_overlap IMMEDIATE");
      return fn(tx);
    });

  const T = (h: number, m = 0, day = 5): string => `2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;

  async function ensureRoomType(tx: Tx, tenantId: string): Promise<void> {
    await tx.query(`INSERT INTO scheduling.room_types (id, tenant_id, code, label) VALUES ($1,$2,'CLASSROOM','Salle') ON CONFLICT DO NOTHING`, [newId(), tenantId]);
  }
  async function insertRoom(tx: Tx, tenantId: string, code: string, status = "AVAILABLE"): Promise<string> {
    await ensureRoomType(tx, tenantId);
    const id = newId();
    await tx.query(
      `INSERT INTO scheduling.rooms (id, tenant_id, institution_id, campus_id, code, name, room_type_code, status) VALUES ($1,$2,$3,$4,$5,$5,'CLASSROOM',$6)`,
      [id, tenantId, institution, campus, code, status],
    );
    return id;
  }
  interface OccInput {
    start: string;
    end: string;
    classroom?: string | null;
    offering?: string | null;
    claimsClassroom?: boolean;
    room?: string | null;
    staff?: string[];
    status?: string;
    origin?: string;
    override?: boolean;
    kind?: string;
    entryGeneratedFor?: string;
  }
  async function insertOcc(tx: Tx, tenantId: string, o: OccInput): Promise<string> {
    const id = newId();
    const cancelled = o.status === "CANCELLED";
    await tx.query(
      `INSERT INTO scheduling.session_occurrences
         (id, tenant_id, institution_id, academic_year_id, kind, classroom_id, curriculum_node_id, offering_id, claims_classroom, room_id,
          starts_at, ends_at, occurs_on, status, origin, conflict_override, conflict_override_reason, conflict_override_by,
          cancelled_at, cancel_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,($11::timestamptz)::date,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        id, tenantId, institution, year, o.kind ?? "LESSON", o.classroom ?? newId(), newId(), o.offering ?? null, o.claimsClassroom ?? true, o.room ?? null,
        o.start, o.end, o.status === "HELD" ? "PLANNED" : (o.status ?? "PLANNED"), o.origin ?? "AD_HOC",
        o.override ?? false, o.override ? "motif de test" : null, o.override ? user : null,
        cancelled ? new Date().toISOString() : null, cancelled ? "motif" : null, user,
      ],
    );
    for (const s of o.staff ?? []) {
      await tx.query(`INSERT INTO scheduling.occurrence_staff (id, tenant_id, occurrence_id, staff_id) VALUES ($1,$2,$3,$4)`, [newId(), tenantId, id, s]);
    }
    return id;
  }
  async function hold(tx: Tx, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE scheduling.session_occurrences SET status='HELD', held_at=now(), held_source='ADMIN', held_by=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, id, user]);
  }
  async function validate(tx: Tx, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE scheduling.session_occurrences SET validated_at=now(), validated_by=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, id, user]);
  }
  const rejects = async (p: Promise<unknown>, pattern: RegExp): Promise<void> => {
    await expect(p).rejects.toThrow(pattern);
  };

  beforeAll(async () => {
    db = await createSchedulingTestDb();
    tenantA = await db.createTenant();
    tenantB = await db.createTenant();
  });
  afterAll(async () => {
    await db.drop();
  });

  describe("conflits imposés (resource_claims)", () => {
    it("enseignant : double réservation refusée ; bout à bout accepté", async () => {
      const teacher = newId();
      await run(tenantA, async (tx) => {
        await insertOcc(tx, tenantA, { start: T(8), end: T(10), staff: [teacher] });
      });
      await rejects(
        run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(9), end: T(11), staff: [teacher] })),
        /resource_claims_no_overlap/,
      );
      await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(10), end: T(12), staff: [teacher] }));
    });

    it("classe, salle : mêmes garanties ; deux classes dans deux salles : libre", async () => {
      const classroom = newId();
      const room = await run(tenantA, (tx) => insertRoom(tx, tenantA, "R1"));
      await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8), end: T(10), classroom, room, staff: [newId()] }));
      await rejects(run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(9), end: T(11), classroom, staff: [newId()] })), /resource_claims_no_overlap/);
      await rejects(run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(9), end: T(11), room, staff: [newId()] })), /resource_claims_no_overlap/);
      const room2 = await run(tenantA, (tx) => insertRoom(tx, tenantA, "R2"));
      await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(9), end: T(11), room: room2, staff: [newId()] }));
    });

    it("offre à la carte : même offre simultanée refusée, deux offres d'une même classe simultanées acceptées", async () => {
      const classroom = newId();
      const o1 = newId();
      const o2 = newId();
      await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(14), end: T(16), classroom, offering: o1, claimsClassroom: false }));
      await rejects(
        run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(15), end: T(17), classroom, offering: o1, claimsClassroom: false })),
        /resource_claims_no_overlap/,
      );
      await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(15), end: T(17), classroom, offering: o2, claimsClassroom: false }));
    });

    it("politique WARN : l'écriture passe et la réservation est non exclusive ; dépassement motivé idem", async () => {
      const teacher = newId();
      await run(tenantA, async (tx) => {
        await tx.query(
          `INSERT INTO scheduling.conflict_policies (tenant_id, institution_id, resource_kind, mode) VALUES ($1,$2,'STAFF','WARN')`,
          [tenantA, institution],
        );
        await insertOcc(tx, tenantA, { start: T(8, 0, 6), end: T(10, 0, 6), staff: [teacher] });
        await insertOcc(tx, tenantA, { start: T(9, 0, 6), end: T(11, 0, 6), staff: [teacher] });
        const claims = await tx.many<{ exclusive: boolean }>(`SELECT exclusive FROM scheduling.resource_claims WHERE resource_id = $1`, [teacher]);
        expect(claims).toHaveLength(2);
        expect(claims.every((c) => !c.exclusive)).toBe(true);
        await tx.query(`UPDATE scheduling.conflict_policies SET mode='BLOCK' WHERE tenant_id=$1`, [tenantA]);
      });
      // BLOCK de retour : un dépassement motivé (conflict_override) rend la réservation non exclusive.
      const other = newId();
      await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 7), end: T(10, 0, 7), staff: [other] }));
      await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(9, 0, 7), end: T(11, 0, 7), staff: [other], override: true }));
    });

    it("annulation libère les réservations ; la séance comptable ne réserve rien", async () => {
      const teacher = newId();
      const id = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 8), end: T(10, 0, 8), staff: [teacher] }));
      await run(tenantA, async (tx) => {
        await tx.query(`SET LOCAL scheduling.change_reason = 'erreur de saisie'`);
        await tx.query(`UPDATE scheduling.session_occurrences SET status='CANCELLED', cancelled_at=now(), cancel_reason='erreur de saisie' WHERE tenant_id=$1 AND id=$2`, [tenantA, id]);
        const left = await tx.many(`SELECT 1 FROM scheduling.resource_claims WHERE occurrence_id=$1`, [id]);
        expect(left).toHaveLength(0);
      });
      await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 8), end: T(10, 0, 8), staff: [teacher] }));
      // Comptable : fenêtre synthétique qui chevauche tout, aucune réservation.
      await run(tenantA, async (tx) => {
        const acc = await insertOcc(tx, tenantA, { start: T(8, 30, 8), end: T(9, 30, 8), staff: [teacher], origin: "ACCOUNTING", kind: "OTHER", classroom: null });
        const c = await tx.many(`SELECT 1 FROM scheduling.resource_claims WHERE occurrence_id=$1`, [acc]);
        expect(c).toHaveLength(0);
      });
    });

    it("échange de deux enseignants dans une même transaction : accepté (contrainte différée)", async () => {
      const a = newId();
      const b = newId();
      const o1 = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 9), end: T(10, 0, 9), staff: [a] }));
      const o2 = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 9), end: T(10, 0, 9), staff: [b] }));
      await run(
        tenantA,
        async (tx) => {
          await tx.query(`UPDATE scheduling.occurrence_staff SET staff_id=$3 WHERE tenant_id=$1 AND occurrence_id=$2`, [tenantA, o1, b]);
          await tx.query(`UPDATE scheduling.occurrence_staff SET staff_id=$3 WHERE tenant_id=$1 AND occurrence_id=$2`, [tenantA, o2, a]);
        },
        false,
      );
      const rows = await adminRows<{ occurrence_id: string; staff_id: string }>(db, `SELECT occurrence_id, staff_id FROM scheduling.occurrence_staff WHERE occurrence_id = ANY($1)`, [[o1, o2]]);
      expect(rows.find((r) => r.occurrence_id === o1)?.staff_id).toBe(b);
      expect(rows.find((r) => r.occurrence_id === o2)?.staff_id).toBe(a);
    });
  });

  describe("concurrence : la base arbitre", () => {
    async function openSession(tenantId: string): Promise<PoolClient> {
      // Connexion applicative : celle du pool (rôle membre de app_user) via un client dédié.
      const poolClient = await db.appPool.connect();
      await poolClient.query("BEGIN");
      await poolClient.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [tenantId, user]);
      return poolClient;
    }
    const insertRaw = async (c: PoolClient, tenantId: string, teacher: string, start: string, end: string): Promise<void> => {
      const id = newId();
      await c.query(
        `INSERT INTO scheduling.session_occurrences (id, tenant_id, institution_id, academic_year_id, kind, starts_at, ends_at, occurs_on, origin, created_by)
         VALUES ($1,$2,$3,$4,'MEETING',$5,$6,($5::timestamptz)::date,'AD_HOC',$7)`,
        [id, tenantId, institution, year, start, end, user],
      );
      await c.query(`INSERT INTO scheduling.occurrence_staff (id, tenant_id, occurrence_id, staff_id) VALUES ($1,$2,$3,$4)`, [newId(), tenantId, id, teacher]);
    };

    it("deux transactions plaçant le même enseignant sur des plages qui se chevauchent : exactement une réussit", async () => {
      const teacher = newId();
      const c1 = await openSession(tenantA);
      const c2 = await openSession(tenantA);
      try {
        await insertRaw(c1, tenantA, teacher, T(8, 0, 12), T(10, 0, 12));
        await insertRaw(c2, tenantA, teacher, T(9, 0, 12), T(11, 0, 12));
        // Les deux écritures ont réussi (contrainte différée) ; l'arbitrage se fait au COMMIT.
        const outcomes = await Promise.allSettled([c1.query("COMMIT"), c2.query("COMMIT")]);
        const ok = outcomes.filter((o) => o.status === "fulfilled").length;
        const failed = outcomes.filter((o) => o.status === "rejected") as PromiseRejectedResult[];
        expect(ok).toBe(1);
        expect(failed).toHaveLength(1);
        expect(String(failed[0]?.reason?.code)).toMatch(/23P01|40P01/);
      } finally {
        await c1.query("ROLLBACK").catch(() => undefined);
        await c2.query("ROLLBACK").catch(() => undefined);
        c1.release();
        c2.release();
      }
      const rows = await adminRows(db, `SELECT 1 FROM scheduling.resource_claims WHERE resource_id=$1`, [teacher]);
      expect(rows).toHaveLength(1);
    });

    it("plages disjointes en parallèle : les deux réussissent", async () => {
      const teacher = newId();
      const c1 = await openSession(tenantA);
      const c2 = await openSession(tenantA);
      try {
        await insertRaw(c1, tenantA, teacher, T(8, 0, 13), T(10, 0, 13));
        await insertRaw(c2, tenantA, teacher, T(10, 0, 13), T(12, 0, 13));
        await Promise.all([c1.query("COMMIT"), c2.query("COMMIT")]);
      } finally {
        c1.release();
        c2.release();
      }
    });
  });

  describe("équipement : stock", () => {
    it("la somme des quantités sur plages chevauchantes ne dépasse pas le stock ; au déplacement aussi", async () => {
      const item = newId();
      await run(tenantA, async (tx) => {
        await tx.query(`INSERT INTO scheduling.equipment_items (id, tenant_id, institution_id, campus_id, code, label, quantity) VALUES ($1,$2,$3,$4,'VP','Vidéoprojecteur',2)`, [item, tenantA, institution, campus]);
      });
      const o1 = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 14), end: T(10, 0, 14) }));
      const o2 = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(9, 0, 14), end: T(11, 0, 14) }));
      const o3 = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(9, 30, 14), end: T(10, 30, 14) }));
      await run(tenantA, (tx) => tx.query(`INSERT INTO scheduling.occurrence_equipment (tenant_id, occurrence_id, equipment_id, quantity) VALUES ($1,$2,$3,1)`, [tenantA, o1, item]));
      await run(tenantA, (tx) => tx.query(`INSERT INTO scheduling.occurrence_equipment (tenant_id, occurrence_id, equipment_id, quantity) VALUES ($1,$2,$3,1)`, [tenantA, o2, item]));
      await rejects(
        run(tenantA, (tx) => tx.query(`INSERT INTO scheduling.occurrence_equipment (tenant_id, occurrence_id, equipment_id, quantity) VALUES ($1,$2,$3,1)`, [tenantA, o3, item])),
        /scheduling\.equipment_conflict/,
      );
      // Déplacer une séance équipée sur une plage saturée est refusé aussi.
      const o4 = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(14, 0, 14), end: T(15, 0, 14) }));
      await run(tenantA, (tx) => tx.query(`INSERT INTO scheduling.occurrence_equipment (tenant_id, occurrence_id, equipment_id, quantity) VALUES ($1,$2,$3,1)`, [tenantA, o4, item]));
      await rejects(
        run(tenantA, (tx) => tx.query(`UPDATE scheduling.session_occurrences SET starts_at=$3, ends_at=$4 WHERE tenant_id=$1 AND id=$2`, [tenantA, o4, T(9, 15, 14), T(9, 45, 14)])),
        /scheduling\.equipment_conflict/,
      );
    });

    it("un article hors service ne se réserve plus", async () => {
      const item = newId();
      await run(tenantA, (tx) =>
        tx.query(`INSERT INTO scheduling.equipment_items (id, tenant_id, institution_id, campus_id, code, label, quantity, status) VALUES ($1,$2,$3,$4,'OOS','HS',1,'OUT_OF_SERVICE')`, [item, tenantA, institution, campus]),
      );
      const o = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 15), end: T(9, 0, 15) }));
      await rejects(
        run(tenantA, (tx) => tx.query(`INSERT INTO scheduling.occurrence_equipment (tenant_id, occurrence_id, equipment_id, quantity) VALUES ($1,$2,$3,1)`, [tenantA, o, item])),
        /scheduling\.equipment_unavailable/,
      );
    });
  });

  describe("salle, machine d'états, validation, verrous", () => {
    it("une salle hors service refuse toute nouvelle réservation", async () => {
      const room = await run(tenantA, (tx) => insertRoom(tx, tenantA, "OOS", "OUT_OF_SERVICE"));
      await rejects(run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 16), end: T(9, 0, 16), room })), /scheduling\.room_unavailable/);
    });

    it("transitions légales uniquement ; identité figée ; aucune suppression", async () => {
      const id = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 17), end: T(9, 0, 17), staff: [newId()] }));
      await run(tenantA, (tx) => hold(tx, tenantA, id));
      await run(tenantA, async (tx) => {
        await tx.query(`UPDATE scheduling.session_occurrences SET status='PLANNED' WHERE tenant_id=$1 AND id=$2`, [tenantA, id]);
        await tx.query(`UPDATE scheduling.session_occurrences SET status='CANCELLED', cancelled_at=now(), cancel_reason='x' WHERE tenant_id=$1 AND id=$2`, [tenantA, id]);
      });
      await rejects(
        run(tenantA, (tx) => tx.query(`UPDATE scheduling.session_occurrences SET status='HELD', held_at=now(), held_source='ADMIN' WHERE tenant_id=$1 AND id=$2`, [tenantA, id])),
        /scheduling\.occurrence_transition/,
      );
      await rejects(run(tenantA, (tx) => tx.query(`UPDATE scheduling.session_occurrences SET kind='EXAM' WHERE tenant_id=$1 AND id=$2`, [tenantA, id])), /occurrence_identity_immutable/);
      await expect(
        db.admin.query(`DELETE FROM scheduling.session_occurrences WHERE id=$1`, [id]),
      ).rejects.toThrow(/scheduling\.immutable/);
    });

    it("séance validée : horaire, statut, salle et intervenants figés ; dévalidation d'abord", async () => {
      const teacher = newId();
      const id = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 18), end: T(10, 0, 18), staff: [teacher] }));
      await run(tenantA, async (tx) => {
        await hold(tx, tenantA, id);
        await validate(tx, tenantA, id);
      });
      await rejects(run(tenantA, (tx) => tx.query(`UPDATE scheduling.session_occurrences SET ends_at=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, id, T(11, 0, 18)])), /scheduling\.occurrence_validated/);
      await rejects(run(tenantA, (tx) => tx.query(`UPDATE scheduling.session_occurrences SET status='CANCELLED' WHERE tenant_id=$1 AND id=$2`, [tenantA, id])), /check|occurrence_validated/i);
      await rejects(run(tenantA, (tx) => tx.query(`DELETE FROM scheduling.occurrence_staff WHERE tenant_id=$1 AND occurrence_id=$2`, [tenantA, id])), /scheduling\.occurrence_validated/);
      await rejects(
        run(tenantA, (tx) => tx.query(`INSERT INTO scheduling.occurrence_staff (id, tenant_id, occurrence_id, staff_id) VALUES ($1,$2,$3,$4)`, [newId(), tenantA, id, newId()])),
        /scheduling\.occurrence_validated/,
      );
      await rejects(
        run(tenantA, (tx) => tx.query(`UPDATE scheduling.occurrence_staff SET paid_minutes=30, paid_minutes_by=$3 WHERE tenant_id=$1 AND occurrence_id=$2`, [tenantA, id, user])),
        /scheduling\.occurrence_validated/,
      );
      await run(tenantA, (tx) => tx.query(`UPDATE scheduling.session_occurrences SET validated_at=NULL, validated_by=NULL WHERE tenant_id=$1 AND id=$2`, [tenantA, id]));
      await run(tenantA, (tx) => tx.query(`UPDATE scheduling.session_occurrences SET ends_at=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, id, T(11, 0, 18)]));
    });

    it("verrou de paie : ligne et séance gelées, dévalidation refusée, déverrouillage seulement par la voie dédiée", async () => {
      const teacher = newId();
      const lockRef = newId();
      const id = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 19), end: T(10, 0, 19), staff: [teacher] }));
      // Verrouiller une séance non validée : refusé.
      await rejects(
        run(tenantA, (tx) => tx.query(`UPDATE scheduling.occurrence_staff SET locked_at=now(), lock_ref=$3 WHERE tenant_id=$1 AND occurrence_id=$2`, [tenantA, id, lockRef])),
        /scheduling\.hours_not_payable/,
      );
      await run(tenantA, async (tx) => {
        await hold(tx, tenantA, id);
        await validate(tx, tenantA, id);
        await tx.query(`UPDATE scheduling.occurrence_staff SET locked_at=now(), lock_ref=$3 WHERE tenant_id=$1 AND occurrence_id=$2`, [tenantA, id, lockRef]);
      });
      await rejects(run(tenantA, (tx) => tx.query(`UPDATE scheduling.session_occurrences SET validated_at=NULL, validated_by=NULL WHERE tenant_id=$1 AND id=$2`, [tenantA, id])), /scheduling\.occurrence_locked/);
      await rejects(run(tenantA, (tx) => tx.query(`UPDATE scheduling.occurrence_staff SET locked_at=NULL, lock_ref=NULL WHERE tenant_id=$1 AND occurrence_id=$2`, [tenantA, id])), /scheduling\.hours_locked/);
      await rejects(run(tenantA, (tx) => tx.query(`DELETE FROM scheduling.occurrence_staff WHERE tenant_id=$1 AND occurrence_id=$2`, [tenantA, id])), /scheduling\.hours_locked/);
      await run(tenantA, async (tx) => {
        await tx.query(`SELECT set_config('scheduling.payroll_unlock', 'on', true)`);
        await tx.query(`UPDATE scheduling.occurrence_staff SET locked_at=NULL, lock_ref=NULL WHERE tenant_id=$1 AND occurrence_id=$2`, [tenantA, id]);
      });
      const kinds = await adminRows<{ kind: string }>(db, `SELECT kind FROM scheduling.occurrence_changes WHERE occurrence_id=$1 ORDER BY changed_at, kind`, [id]);
      expect(kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(["CREATED", "STAFF_CHANGED", "HELD", "VALIDATED", "LOCKED", "UNLOCKED"]));
    });

    it("heures payables : HELD + validée + rôle rémunéré ; dérogation de durée prioritaire", async () => {
      const paid = newId();
      const unpaid = newId();
      const id = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 20), end: T(10, 0, 20), staff: [paid] }));
      await run(tenantA, async (tx) => {
        await tx.query(`INSERT INTO scheduling.occurrence_staff (id, tenant_id, occurrence_id, staff_id, role, is_paid_role) VALUES ($1,$2,$3,$4,'SUPERVISOR',false)`, [newId(), tenantA, id, unpaid]);
        await tx.query(`UPDATE scheduling.occurrence_staff SET paid_minutes=90, paid_minutes_by=$4, paid_minutes_at=now() WHERE tenant_id=$1 AND occurrence_id=$2 AND staff_id=$3`, [tenantA, id, paid, user]);
      });
      const before = await run(tenantA, (tx) => tx.many(`SELECT * FROM scheduling.payable_hours('2026-10-20','2026-10-20')`));
      expect(before).toHaveLength(0);
      await run(tenantA, async (tx) => {
        await hold(tx, tenantA, id);
        await validate(tx, tenantA, id);
      });
      const lines = await run(tenantA, (tx) => tx.many<{ staff_id: string; minutes: number; locked: boolean }>(`SELECT * FROM scheduling.payable_hours('2026-10-20','2026-10-20')`));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ staff_id: paid, minutes: 90, locked: false });
    });

    it("génération idempotente : une occurrence par (patron, date de patron)", async () => {
      const timetable = newId();
      const entry = newId();
      await run(tenantA, async (tx) => {
        await tx.query(
          `INSERT INTO scheduling.timetables (id, tenant_id, institution_id, academic_year_id, name, valid_from, valid_to) VALUES ($1,$2,$3,$4,'EDT','2026-09-01','2027-06-30')`,
          [timetable, tenantA, institution, year],
        );
        await tx.query(
          `INSERT INTO scheduling.timetable_entries (id, tenant_id, timetable_id, kind, weekday, starts_time, ends_time) VALUES ($1,$2,$3,'MEETING',1,'08:00','09:00')`,
          [entry, tenantA, timetable],
        );
      });
      const insertGenerated = (start: string, end: string) =>
        run(tenantA, (tx) =>
          tx.query(
            `INSERT INTO scheduling.session_occurrences (id, tenant_id, institution_id, academic_year_id, timetable_entry_id, generated_for, kind, starts_at, ends_at, occurs_on, origin)
             VALUES ($1,$2,$3,$4,$5,'2026-10-26','MEETING',$6,$7,'2026-10-26','GENERATED')`,
            [newId(), tenantA, institution, year, entry, start, end],
          ),
        );
      await insertGenerated(T(8, 0, 26), T(9, 0, 26));
      await rejects(insertGenerated(T(10, 0, 26), T(11, 0, 26)), /occurrences_entry_generated_for/);
    });

    it("jeton iCalendar : empreinte SHA-256 uniquement, unique par tenant", async () => {
      const hash = "a".repeat(64);
      await run(tenantA, (tx) => tx.query(`INSERT INTO scheduling.ics_tokens (id, tenant_id, scope, subject_id, token_hash) VALUES ($1,$2,'CLASSROOM',$3,$4)`, [newId(), tenantA, newId(), hash]));
      await rejects(run(tenantA, (tx) => tx.query(`INSERT INTO scheduling.ics_tokens (id, tenant_id, scope, subject_id, token_hash) VALUES ($1,$2,'CLASSROOM',$3,$4)`, [newId(), tenantA, newId(), hash])), /ics_tokens/);
      await rejects(run(tenantA, (tx) => tx.query(`INSERT INTO scheduling.ics_tokens (id, tenant_id, scope, subject_id, token_hash) VALUES ($1,$2,'CLASSROOM',$3,'secret-en-clair')`, [newId(), tenantA, newId()])), /check/i);
    });
  });

  describe("isolation (RLS)", () => {
    it("un autre tenant ne voit, ne modifie et n'écrit rien chez le premier ; les réservations dérivées non plus", async () => {
      const teacher = newId();
      const id = await run(tenantA, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 21), end: T(9, 0, 21), staff: [teacher] }));
      await run(tenantB, async (tx) => {
        expect(await tx.many(`SELECT 1 FROM scheduling.session_occurrences WHERE id=$1`, [id])).toHaveLength(0);
        expect(await tx.many(`SELECT 1 FROM scheduling.resource_claims WHERE occurrence_id=$1`, [id])).toHaveLength(0);
        expect(await tx.many(`SELECT 1 FROM scheduling.occurrence_changes WHERE occurrence_id=$1`, [id])).toHaveLength(0);
        const updated = await tx.query(`UPDATE scheduling.session_occurrences SET title='x' WHERE id=$1`, [id]);
        expect(updated.rowCount).toBe(0);
      });
      // Un tenant B ne peut pas réserver l'enseignant de A (identifiant partagé par erreur) : pas de conflit inter-tenant.
      await run(tenantB, (tx) => insertOcc(tx, tenantB, { start: T(8, 0, 21), end: T(9, 0, 21), staff: [teacher] }));
      // Insertion portant le tenant de A depuis le contexte de B : refusée par la RLS.
      await rejects(run(tenantB, (tx) => insertOcc(tx, tenantA, { start: T(8, 0, 22), end: T(9, 0, 22) })), /row-level security|sécurité au niveau ligne/i);
    });
  });
});
