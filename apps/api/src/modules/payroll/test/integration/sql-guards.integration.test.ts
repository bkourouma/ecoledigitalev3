/**
 * Contraintes et déclencheurs de la base (migrations 1500-1504), éprouvés en SQL direct (superuser : les
 * déclencheurs et CHECK s'appliquent à TOUT écrivain). Une heure ne se paie qu'une fois ; formule exacte des
 * lignes ; transitions imposées ; gel hors CALCULATED ; annulation sans résurrection ; journal append-only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { TEST_DATABASE_URL, adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";

const U = newId(); // acteur
const STAFF = newId();

describeIntegration("contraintes et déclencheurs SQL du module payroll", () => {
  let db: PayrollTestDb;
  let tenant: string;
  let year: string;

  const q = (sql: string, params: unknown[] = []) => db.admin.query(sql, params);
  const expectPg = async (p: Promise<unknown>, pattern: RegExp) => {
    await expect(p).rejects.toThrow(pattern);
  };

  beforeAll(async () => {
    db = await createPayrollTestDb(4);
    tenant = await db.createTenant();
    year = newId();
  });
  afterAll(async () => {
    await db.drop();
  });

  // ---- fabriques ----------------------------------------------------------------------------------
  async function period(start = "2026-01-05", end = "2026-01-31"): Promise<string> {
    const id = newId();
    await q("INSERT INTO payroll.pay_periods (id, tenant_id, name, start_date, end_date, academic_year_id, created_by, awaiting_calculation) VALUES ($1,$2,$3,$4,$5,$6,$7,false)", [id, tenant, `P ${id.slice(-6)}`, start, end, year, U]);
    return id;
  }
  async function config(staff = STAFF, from = "2025-01-01", to: string | null = null): Promise<string> {
    const id = newId();
    await q(
      `INSERT INTO payroll.pay_configs (id, tenant_id, staff_id, config_type, default_hourly_rate, overtime_threshold_minutes, overtime_multiplier_permille, effective_from, effective_to, created_by)
       VALUES ($1,$2,$3,'HOURLY',10000,2400,1500,$4,$5,$6)`,
      [id, tenant, staff, from, to, U],
    );
    return id;
  }
  interface LineSpec {
    ref?: string;
    minutes: number;
    rate?: number;
    permille?: number;
    overtime?: boolean;
    kind?: "SESSION" | "ATTENDANCE";
  }
  /** Bulletin horaire COHÉRENT (lignes + réclamations + totaux) créé dans UNE transaction. */
  async function payslip(opts: { period: string; config: string; staff?: string; lines: LineSpec[]; status?: string; id?: string; calculatedBy?: string }): Promise<{ id: string; refs: string[] }> {
    const id = opts.id ?? newId();
    const staff = opts.staff ?? STAFF;
    const prepared = opts.lines.map((l) => {
      const rate = l.rate ?? 10000;
      const permille = l.permille ?? (l.overtime ? 1500 : 1000);
      const amount = Math.floor((l.minutes * rate * permille + 30000) / 60000);
      return { ref: l.ref ?? newId(), kind: l.kind ?? "SESSION", ...l, rate, permille, amount, overtime: Boolean(l.overtime) };
    });
    const reg = prepared.filter((l) => !l.overtime).reduce((s, l) => s + l.amount, 0);
    const ot = prepared.filter((l) => l.overtime).reduce((s, l) => s + l.amount, 0);
    const regMin = prepared.filter((l) => !l.overtime).reduce((s, l) => s + l.minutes, 0);
    const otMin = prepared.filter((l) => l.overtime).reduce((s, l) => s + l.minutes, 0);
    await q("BEGIN");
    try {
      await q(
        `INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, salary_amount, base_amount, overtime_amount, total_amount, currency, regular_minutes, overtime_minutes,
                                       calc_details, config_snapshot, calculated_by, calculated_by_name)
         VALUES ($1,$2,$3,$4,$5,'HOURLY',0,$6,$7,$8,'XOF',$9,$10,'{"salaryMonths":[]}','{}',$11,'Comptable')`,
        [id, tenant, opts.period, staff, opts.config, reg, ot, reg + ot, regMin, otMin, opts.calculatedBy ?? U],
      );
      for (const [i, l] of prepared.entries()) {
        await q(
          `INSERT INTO payroll.payslip_lines (id, tenant_id, payslip_id, source_kind, source_ref_id, staff_id, session_date, minutes, rate, multiplier_permille, amount, is_overtime, rate_origin, position)
           VALUES ($1,$2,$3,$4,$5,$6,'2026-01-12',$7,$8,$9,$10,$11,'CONFIG_DEFAULT',$12)`,
          [newId(), tenant, id, l.kind, l.ref, staff, l.minutes, l.rate, l.permille, l.amount, l.overtime, i],
        );
      }
      const perRef = new Map<string, { kind: string; minutes: number }>();
      for (const l of prepared) perRef.set(l.ref, { kind: l.kind, minutes: (perRef.get(l.ref)?.minutes ?? 0) + l.minutes });
      for (const [ref, v] of perRef) {
        await q("INSERT INTO payroll.hour_claims (tenant_id, source_kind, source_ref_id, staff_id, payslip_id, minutes) VALUES ($1,$2,$3,$4,$5,$6)", [tenant, v.kind, ref, staff, id, v.minutes]);
      }
      await q("COMMIT");
    } catch (e) {
      await q("ROLLBACK");
      throw e;
    }
    return { id, refs: [...new Set(prepared.map((l) => l.ref))] };
  }
  const approve = (id: string, by = newId()) =>
    q(`UPDATE payroll.payslips SET status='APPROVED', approved_at=now(), approved_by=$2, approved_by_name='Directeur', snapshot='{"v":1}', snapshot_hash=repeat('a',64) WHERE id=$1`, [id, by]);
  const status = async (id: string) => (await adminRows<{ status: string }>(db, "SELECT status FROM payroll.payslips WHERE id=$1", [id]))[0]?.status;

  // ---- une heure ne se paie qu'une fois ------------------------------------------------------------
  it("hour_claims : la clé primaire interdit qu'une même heure figure sur deux bulletins (périodes qui se chevauchent)", async () => {
    const c = await config();
    const p1 = await period();
    const p2 = await period("2026-01-12", "2026-02-10"); // chevauche p1
    const shared = newId();
    const a = await payslip({ period: p1, config: c, lines: [{ ref: shared, minutes: 120 }] });
    expect(a.refs).toEqual([shared]);
    await expectPg(payslip({ period: p2, config: c, lines: [{ ref: shared, minutes: 120 }] }), /duplicate key value violates unique constraint "hour_claims_pkey"/);
    // le bulletin refusé n'a rien laissé derrière lui
    expect((await adminRows(db, "SELECT 1 FROM payroll.payslips WHERE period_id=$1", [p2])).length).toBe(0);
    // une AUTRE heure du même enseignant passe sur la période chevauchante
    await payslip({ period: p2, config: c, lines: [{ minutes: 60 }] });
  });

  it("deux écrivains concurrents réclamant la même heure : exactement un gagne", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const p1 = await period();
    const p2 = await period();
    const ref = newId();
    const { Client } = await import("pg");
    const mk = async () => {
      const u = new URL(TEST_DATABASE_URL as string);
      u.pathname = `/${db.name}`;
      const cl = new Client({ connectionString: u.toString() });
      await cl.connect();
      return cl;
    };
    const [c1, c2] = [await mk(), await mk()];
    const run = async (cl: InstanceType<typeof Client>, per: string) => {
      const id = newId();
      try {
        await cl.query("BEGIN");
        await cl.query(
          `INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, base_amount, total_amount, currency, regular_minutes, calc_details, config_snapshot, calculated_by, calculated_by_name)
           VALUES ($1,$2,$3,$4,$5,'HOURLY',10000,10000,'XOF',60,'{"salaryMonths":[]}','{}',$6,'X')`,
          [id, tenant, per, staff, c, U],
        );
        await cl.query(
          `INSERT INTO payroll.payslip_lines (id, tenant_id, payslip_id, source_kind, source_ref_id, staff_id, session_date, minutes, rate, multiplier_permille, amount, is_overtime, rate_origin)
           VALUES ($1,$2,$3,'SESSION',$4,$5,'2026-01-12',60,10000,1000,10000,false,'CONFIG_DEFAULT')`,
          [newId(), tenant, id, ref, staff],
        );
        await cl.query("INSERT INTO payroll.hour_claims (tenant_id, source_kind, source_ref_id, staff_id, payslip_id, minutes) VALUES ($1,'SESSION',$2,$3,$4,60)", [tenant, ref, staff, id]);
        await new Promise((r) => setTimeout(r, 150));
        await cl.query("COMMIT");
        return "ok";
      } catch (e) {
        await cl.query("ROLLBACK").catch(() => undefined);
        return (e as { code?: string }).code ?? "erreur";
      }
    };
    const results = await Promise.all([run(c1, p1), run(c2, p2)]);
    await c1.end();
    await c2.end();
    expect(results.sort()).toEqual(["23505", "ok"]);
    expect((await adminRows(db, "SELECT 1 FROM payroll.hour_claims WHERE source_ref_id=$1", [ref])).length).toBe(1);
  });

  it("annuler un bulletin relâche ses heures : un autre bulletin peut alors les réclamer", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const p1 = await period();
    const p2 = await period();
    const ref = newId();
    const a = await payslip({ period: p1, config: c, staff, lines: [{ ref, minutes: 90 }] });
    await q("UPDATE payroll.payslips SET status='CANCELLED', cancelled_at=now(), cancelled_by=$2, cancelled_by_name='Comptable', cancel_reason='Erreur de saisie' WHERE id=$1", [a.id, U]);
    expect((await adminRows(db, "SELECT 1 FROM payroll.hour_claims WHERE payslip_id=$1", [a.id])).length).toBe(0);
    await payslip({ period: p2, config: c, staff, lines: [{ ref, minutes: 90 }] });
    // un bulletin approuvé, lui, NE relâche rien
    const b = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 30 }] });
    await approve(b.id);
    expect((await adminRows(db, "SELECT 1 FROM payroll.hour_claims WHERE payslip_id=$1", [b.id])).length).toBe(1);
  });

  // ---- formule exacte des lignes ------------------------------------------------------------------
  it("payslip_lines : la formule floor((minutes×taux×‰+30 000)/60 000) est vérifiée par CHECK (demi-supérieur)", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const per = await period();
    // 1 h à 3 333 × 1,5 = 4 999,5 → 5 000 : le helper calcule la valeur correcte, le CHECK l'accepte
    await payslip({ period: per, config: c, staff, lines: [{ minutes: 60, rate: 3333, permille: 1500, overtime: true }] });
    // 4 h à 3 333 × 1,5 = 19 998 exactement ; 19 999,98 (valeur du legacy) est refusée
    const id = newId();
    await q("BEGIN");
    await q(
      `INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, base_amount, overtime_amount, total_amount, currency, overtime_minutes, calc_details, config_snapshot, calculated_by, calculated_by_name)
       VALUES ($1,$2,$3,$4,$5,'HOURLY',0,19998,19998,'XOF',240,'{"salaryMonths":[]}','{}',$6,'X')`,
      [id, tenant, await period(), staff, c, U],
    );
    const bad = (amount: number) =>
      q(
        `INSERT INTO payroll.payslip_lines (id, tenant_id, payslip_id, source_kind, source_ref_id, staff_id, session_date, minutes, rate, multiplier_permille, amount, is_overtime, rate_origin)
         VALUES ($1,$2,$3,'SESSION',$4,$5,'2026-01-12',240,3333,1500,$6,true,'CONFIG_DEFAULT')`,
        [newId(), tenant, id, newId(), staff, amount],
      );
    await expectPg(bad(19999), /payslip_lines_amount_formula/);
    await q("ROLLBACK");
    // ligne normale avec multiplicateur ≠ 1000 refusée (le CHECK suit le déclencheur : il faut un bulletin CALCULATED existant)
    const host = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 60 }] });
    await expectPg(
      q(
        `INSERT INTO payroll.payslip_lines (id, tenant_id, payslip_id, source_kind, source_ref_id, staff_id, session_date, minutes, rate, multiplier_permille, amount, is_overtime, rate_origin)
         VALUES ($1,$2,$3,'SESSION',$4,$5,'2026-01-12',60,1000,1500,1500,false,'CONFIG_DEFAULT')`,
        [newId(), tenant, host.id, newId(), staff],
      ),
      /payslip_lines_multiplier/,
    );
  });

  it("une séance à cheval sur le seuil : deux lignes (normale + majorée) pour la même source sont ACCEPTÉES, une troisième non", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const ref = newId();
    const per = await period();
    const p = await payslip({ period: per, config: c, staff, lines: [{ ref, minutes: 120 }, { ref, minutes: 120, overtime: true }] });
    expect(p.refs).toEqual([ref]);
    const claim = await adminRows<{ minutes: number }>(db, "SELECT minutes FROM payroll.hour_claims WHERE source_ref_id=$1", [ref]);
    expect(claim).toEqual([{ minutes: 240 }]);
  });

  // ---- intégrité différée -------------------------------------------------------------------------
  it("au COMMIT : une ligne sans réclamation, ou des totaux qui ne suivent pas les lignes, sont refusés", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const per = await period();
    const ins = (id: string, base: number, mins = 60) =>
      q(
        `INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, base_amount, total_amount, currency, regular_minutes, calc_details, config_snapshot, calculated_by, calculated_by_name)
         VALUES ($1,$2,$3,$4,$5,'HOURLY',$6,$6,'XOF',$7,'{"salaryMonths":[]}','{}',$8,'X')`,
        [id, tenant, per, staff, c, base, mins, U],
      );
    const line = (pid: string, ref: string) =>
      q(
        `INSERT INTO payroll.payslip_lines (id, tenant_id, payslip_id, source_kind, source_ref_id, staff_id, session_date, minutes, rate, multiplier_permille, amount, is_overtime, rate_origin)
         VALUES ($1,$2,$3,'SESSION',$4,$5,'2026-01-12',60,10000,1000,10000,false,'CONFIG_DEFAULT')`,
        [newId(), tenant, pid, ref, staff],
      );
    // ligne SANS réclamation
    let id = newId();
    await q("BEGIN");
    await ins(id, 10000);
    await line(id, newId());
    await expectPg(q("COMMIT"), /payroll\.integrity_violation: les lignes et les réclamations/);
    await q("ROLLBACK").catch(() => undefined);
    // réclamation SANS ligne
    id = newId();
    await q("BEGIN");
    await ins(id, 0, 0);
    await q("INSERT INTO payroll.hour_claims (tenant_id, source_kind, source_ref_id, staff_id, payslip_id, minutes) VALUES ($1,'SESSION',$2,$3,$4,60)", [tenant, newId(), staff, id]);
    await expectPg(q("COMMIT"), /payroll\.integrity_violation/);
    await q("ROLLBACK").catch(() => undefined);
    // totaux ≠ somme des lignes (base 9 999 pour une ligne de 10 000)
    id = newId();
    const ref = newId();
    await q("BEGIN");
    await ins(id, 9999);
    await line(id, ref);
    await q("INSERT INTO payroll.hour_claims (tenant_id, source_kind, source_ref_id, staff_id, payslip_id, minutes) VALUES ($1,'SESSION',$2,$3,$4,60)", [tenant, ref, staff, id]);
    await expectPg(q("COMMIT"), /payroll\.integrity_violation: base_amount/);
    await q("ROLLBACK").catch(() => undefined);
  });

  it("CHECK : total = base + heures sup + primes − retenues", async () => {
    const c = await config(newId());
    await expectPg(
      q(
        `INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, base_amount, bonus_amount, total_amount, currency, calc_details, config_snapshot, calculated_by, calculated_by_name)
         VALUES ($1,$2,$3,$4,$5,'HOURLY',100,10,111,'XOF','{}','{}',$6,'X')`,
        [newId(), tenant, await period(), newId(), c, U],
      ),
      /payslips_total_formula/,
    );
  });

  // ---- machine d'états ----------------------------------------------------------------------------
  it("transitions : calculé → payé, annulé → payé, payé → annulé, approuvé → calculé sont REFUSÉES par la base", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const pay = (id: string) => q(`UPDATE payroll.payslips SET status='PAID', paid_at=now(), paid_by=$2, paid_by_name='Comptable', payment_method='CASH' WHERE id=$1`, [id, U]);

    const a = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 60 }] });
    await expectPg(pay(a.id), /payroll\.invalid_transition: CALCULATED -> PAID/);

    await q("UPDATE payroll.payslips SET status='CANCELLED', cancelled_at=now(), cancelled_by=$2, cancelled_by_name='C', cancel_reason='Doublon' WHERE id=$1", [a.id, U]);
    await expectPg(pay(a.id), /payroll\.invalid_transition: CANCELLED -> PAID/);
    await expectPg(q("UPDATE payroll.payslips SET status='CALCULATED' WHERE id=$1", [a.id]), /payroll\.invalid_transition: CANCELLED -> CALCULATED/);
    expect(await status(a.id)).toBe("CANCELLED"); // sans résurrection

    const b = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 60 }] });
    await approve(b.id);
    await expectPg(q("UPDATE payroll.payslips SET status='CALCULATED', approved_at=NULL, approved_by=NULL, approved_by_name=NULL, snapshot=NULL, snapshot_hash=NULL WHERE id=$1", [b.id]), /payroll\.invalid_transition: APPROVED -> CALCULATED/);
    await pay(b.id);
    expect(await status(b.id)).toBe("PAID");
    await expectPg(q("UPDATE payroll.payslips SET status='CANCELLED', cancelled_at=now(), cancelled_by=$2, cancelled_by_name='C', cancel_reason='Trop tard' WHERE id=$1", [b.id, U]), /payroll\.invalid_transition: PAID -> CANCELLED/);
    await expectPg(q("UPDATE payroll.payslips SET status='DISPUTED', disputed_at=now(), dispute_reason='x' WHERE id=$1", [b.id]), /payroll\.invalid_transition: PAID -> DISPUTED/);
  });

  it("l'archivage ne vaut jamais versement : arrêter ne renseigne pas paid_at ; paid_at sans PAID est refusé", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const a = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 60 }] });
    await approve(a.id);
    const row = (await adminRows<{ status: string; paid_at: Date | null }>(db, "SELECT status, paid_at FROM payroll.payslips WHERE id=$1", [a.id]))[0];
    expect(row).toMatchObject({ status: "APPROVED", paid_at: null });
    await expectPg(q("UPDATE payroll.payslips SET paid_at=now() WHERE id=$1", [a.id]), /payslip_locked|payslips_paid_trail/);
    // snapshot obligatoire à l'arrêt
    const b = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 60 }] });
    await expectPg(q(`UPDATE payroll.payslips SET status='APPROVED', approved_at=now(), approved_by=$2, approved_by_name='D' WHERE id=$1`, [b.id, U]), /payslips_approved_trail/);
  });

  it("gel : montants, lignes, réclamations et ajustements d'un bulletin arrêté ne bougent plus (et le snapshot est immuable)", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const a = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 60 }] });
    await approve(a.id);
    await expectPg(q("UPDATE payroll.payslips SET base_amount=1, total_amount=1 WHERE id=$1", [a.id]), /payroll\.payslip_locked/);
    await expectPg(q("UPDATE payroll.payslips SET snapshot='{\"v\":2}' WHERE id=$1", [a.id]), /payroll\.payslip_locked/);
    await expectPg(q("DELETE FROM payroll.payslip_lines WHERE payslip_id=$1", [a.id]), /payroll\.payslip_locked/);
    await expectPg(q("DELETE FROM payroll.hour_claims WHERE payslip_id=$1", [a.id]), /payroll\.payslip_locked/);
    await expectPg(
      q(
        `INSERT INTO payroll.payslip_lines (id, tenant_id, payslip_id, source_kind, source_ref_id, staff_id, session_date, minutes, rate, multiplier_permille, amount, is_overtime, rate_origin)
         VALUES ($1,$2,$3,'SESSION',$4,$5,'2026-01-12',60,10000,1000,10000,false,'CONFIG_DEFAULT')`,
        [newId(), tenant, a.id, newId(), staff],
      ),
      /payroll\.payslip_locked/,
    );
    await expectPg(q("INSERT INTO payroll.payslip_adjustments (id, tenant_id, payslip_id, kind, amount, label, created_by, created_by_name) VALUES ($1,$2,$3,'BONUS',100,'Prime',$4,'X')", [newId(), tenant, a.id, U]), /payroll\.payslip_locked/);
    await expectPg(q("UPDATE payroll.payslip_lines SET minutes=minutes WHERE payslip_id=$1", [a.id]), /payroll\.immutable/);
    await expectPg(q("UPDATE payroll.hour_claims SET minutes=minutes WHERE payslip_id=$1", [a.id]), /payroll\.immutable/);
  });

  it("séparation des tâches (réglable) et seuil propriétaire imposés par la base", async () => {
    await q("INSERT INTO payroll.settings (tenant_id, require_separate_approver, owner_approval_threshold) VALUES ($1, true, 15000) ON CONFLICT (tenant_id) DO UPDATE SET require_separate_approver=true, owner_approval_threshold=15000", [tenant]);
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const calculator = newId();
    const small = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 60 }], calculatedBy: calculator }); // 10 000 < seuil
    await expectPg(approve(small.id, calculator), /payroll\.separation_of_duties/);
    await approve(small.id, newId()); // un autre : ok
    const big = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 120 }] }); // 20 000 ≥ seuil
    await expectPg(approve(big.id, newId()), /payroll\.owner_approval_required/);
    await q("BEGIN");
    await q("SELECT set_config('payroll.actor_owner', 'true', true)");
    await approve(big.id, newId());
    await q("COMMIT");
    expect(await status(big.id)).toBe("APPROVED");
    await q("UPDATE payroll.settings SET require_separate_approver=false, owner_approval_threshold=NULL WHERE tenant_id=$1", [tenant]);
  });

  it("DISPUTED → APPROVED permis (ré-arrêt) ; DISPUTED → PAID refusé", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const a = await payslip({ period: await period(), config: c, staff, lines: [{ minutes: 60 }] });
    await approve(a.id);
    await q("UPDATE payroll.payslips SET status='DISPUTED', disputed_at=now(), dispute_reason='Heures contestées' WHERE id=$1", [a.id]);
    await expectPg(q(`UPDATE payroll.payslips SET status='PAID', paid_at=now(), paid_by=$2, paid_by_name='C', payment_method='CASH' WHERE id=$1`, [a.id, U]), /payroll\.invalid_transition: DISPUTED -> PAID/);
    await q(`UPDATE payroll.payslips SET status='APPROVED', approved_at=now(), approved_by=$2, approved_by_name='D2' WHERE id=$1`, [a.id, newId()]);
    expect(await status(a.id)).toBe("APPROVED");
  });

  // ---- unicité du bulletin vivant ------------------------------------------------------------------
  it("un seul bulletin non annulé par (enseignant, période) ; un nouveau est permis après annulation (ancien conservé)", async () => {
    const c = await config(newId());
    const staff = (await adminRows<{ staff_id: string }>(db, "SELECT staff_id FROM payroll.pay_configs WHERE id=$1", [c]))[0]?.staff_id as string;
    const per = await period();
    const a = await payslip({ period: per, config: c, staff, lines: [{ minutes: 60 }] });
    await expectPg(payslip({ period: per, config: c, staff, lines: [{ minutes: 30 }] }), /payslips_live_uq/);
    await q("UPDATE payroll.payslips SET status='CANCELLED', cancelled_at=now(), cancelled_by=$2, cancelled_by_name='C', cancel_reason='Refaire' WHERE id=$1", [a.id, U]);
    const b = await payslip({ period: per, config: c, staff, lines: [{ minutes: 30 }] });
    expect(b.id).not.toBe(a.id);
    expect((await adminRows(db, "SELECT 1 FROM payroll.payslips WHERE period_id=$1 AND staff_id=$2", [per, staff])).length).toBe(2);
  });

  // ---- journal -------------------------------------------------------------------------------------
  it("payslip_events : append-only (ni UPDATE ni DELETE) ; l'acteur est figé", async () => {
    const id = newId();
    await q("INSERT INTO payroll.payslip_events (id, tenant_id, payslip_id, action, actor_id, actor_name) VALUES ($1,$2,$3,'CALCULATED',$4,'Awa Comptable')", [id, tenant, newId(), U]);
    await expectPg(q("UPDATE payroll.payslip_events SET actor_name='Autre' WHERE id=$1", [id]), /payroll\.immutable/);
    await expectPg(q("DELETE FROM payroll.payslip_events WHERE id=$1", [id]), /payroll\.immutable/);
  });

  // ---- exclusions ----------------------------------------------------------------------------------
  it("EXCLUDE : deux configurations d'un même enseignant ne se chevauchent pas ; deux tarifs du même couple non plus", async () => {
    const staff = newId();
    await config(staff, "2026-01-01", "2026-06-30");
    await expectPg(config(staff, "2026-06-30", null), /pay_configs_no_overlap/);
    await config(staff, "2026-07-01", null); // adjacente : ok
    await expectPg(config(staff, "2027-01-01", null), /pay_configs_no_overlap/); // la précédente est ouverte

    const node = newId();
    const rate = (staffId: string | null, from: string, to: string | null) =>
      q("INSERT INTO payroll.hourly_rates (id, tenant_id, curriculum_node_id, staff_id, rate, valid_from, valid_to, created_by) VALUES ($1,$2,$3,$4,9000,$5,$6,$7)", [newId(), tenant, node, staffId, from, to, U]);
    await rate(null, "2026-01-01", "2026-06-30");
    await expectPg(rate(null, "2026-06-30", null), /hourly_rates_no_overlap/);
    await rate(null, "2026-07-01", null);
    await rate(staff, "2026-01-01", null); // le nominatif est un autre couple
    await expectPg(rate(staff, "2026-03-01", "2026-03-31"), /hourly_rates_no_overlap/);
    await expectPg(q("INSERT INTO payroll.hourly_rates (id, tenant_id, curriculum_node_id, rate, valid_from, created_by) VALUES ($1,$2,$3,-1,'2026-01-01',$4)", [newId(), tenant, newId(), U]), /hourly_rates_rate_check/);
  });

  it("configuration : 0 est une valeur ; HOURLY sans salaire ; SALARY/MIXED avec salaire", async () => {
    const mk = (type: string, monthly: number | null, rate: number | null) =>
      q("INSERT INTO payroll.pay_configs (id, tenant_id, staff_id, config_type, monthly_salary, default_hourly_rate, overtime_threshold_minutes, overtime_multiplier_permille, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,$6,2400,1500,'2026-01-01',$7)", [newId(), tenant, newId(), type, monthly, rate, U]);
    await mk("HOURLY", null, 0);
    await expectPg(mk("HOURLY", 100000, 1000), /pay_configs_check/);
    await expectPg(mk("SALARY", null, null), /pay_configs_check/);
    await mk("MIXED", 100000, 0);
  });

  // ---- salaire : un jour ne se paie qu'une fois -----------------------------------------------------
  it("salary_day_claims : un jour de salaire d'un enseignant ne figure que sur un bulletin non annulé", async () => {
    const staff = newId();
    const c = await config(staff);
    const p1 = await period();
    const p2 = await period();
    const mk = async (per: string, days: string[], amount: number) => {
      const id = newId();
      await q("BEGIN");
      try {
        await q(
          `INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, salary_amount, base_amount, total_amount, currency, calc_details, config_snapshot, calculated_by, calculated_by_name)
           VALUES ($1,$2,$3,$4,$5,'SALARY',$6,$6,$6,'XOF',$7,'{}',$8,'X')`,
          [id, tenant, per, staff, c, amount, JSON.stringify({ salaryMonths: [{ month: "2026-01", daysDue: days.length }] }), U],
        );
        for (const d of days) await q("INSERT INTO payroll.salary_day_claims (tenant_id, staff_id, work_date, payslip_id) VALUES ($1,$2,$3,$4)", [tenant, staff, d, id]);
        await q("COMMIT");
      } catch (e) {
        await q("ROLLBACK");
        throw e;
      }
      return id;
    };
    const first = await mk(p1, ["2026-01-05", "2026-01-06"], 36000);
    await expectPg(mk(p2, ["2026-01-06", "2026-01-07"], 36000), /salary_day_claims_pkey/);
    await mk(p2, ["2026-01-07"], 18000);
    // les jours réclamés doivent correspondre aux jours dus déclarés par le calcul
    const per3 = await period();
    const liar = newId();
    await q("BEGIN");
    await q(
      `INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, salary_amount, base_amount, total_amount, currency, calc_details, config_snapshot, calculated_by, calculated_by_name)
       VALUES ($1,$2,$3,$4,$5,'SALARY',100,100,100,'XOF',$6,'{}',$7,'X')`,
      [liar, tenant, per3, staff, c, JSON.stringify({ salaryMonths: [{ month: "2026-01", daysDue: 2 }] }), U],
    );
    await q("INSERT INTO payroll.salary_day_claims (tenant_id, staff_id, work_date, payslip_id) VALUES ($1,$2,'2026-01-12',$3)", [tenant, staff, liar]);
    await expectPg(q("COMMIT"), /payroll\.integrity_violation: 1 jour\(s\) de salaire réclamé\(s\) pour 2/);
    await q("ROLLBACK").catch(() => undefined);
    // l'annulation du premier relâche ses jours
    await q("UPDATE payroll.payslips SET status='CANCELLED', cancelled_at=now(), cancelled_by=$2, cancelled_by_name='C', cancel_reason='Annulé' WHERE id=$1", [first, U]);
    expect((await adminRows(db, "SELECT 1 FROM payroll.salary_day_claims WHERE payslip_id=$1", [first])).length).toBe(0);
  });

  // ---- périodes ------------------------------------------------------------------------------------
  it("périodes : une seule « en attente de calcul » par tenant ; dates figées avec bulletins ; archivée = terminale ; le premier bulletin la sort de l'attente", async () => {
    const t2 = await db.createTenant();
    const mk = (start = "2026-01-05") => q("INSERT INTO payroll.pay_periods (id, tenant_id, name, start_date, end_date, academic_year_id, created_by) VALUES ($1,$2,'P',$3,'2026-01-31',$4,$5)", [newId(), t2, start, year, U]);
    await mk();
    await expectPg(mk(), /pay_periods_one_awaiting_uq/);
    const pid = (await adminRows<{ id: string }>(db, "SELECT id FROM payroll.pay_periods WHERE tenant_id=$1", [t2]))[0]?.id as string;
    // le premier bulletin libère l'attente
    const staff = newId();
    const cfg = newId();
    await q("INSERT INTO payroll.pay_configs (id, tenant_id, staff_id, config_type, default_hourly_rate, overtime_threshold_minutes, overtime_multiplier_permille, effective_from, created_by) VALUES ($1,$2,$3,'HOURLY',1000,2400,1500,'2025-01-01',$4)", [cfg, t2, staff, U]);
    await q("BEGIN");
    await q(`INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, total_amount, currency, calc_details, config_snapshot, calculated_by, calculated_by_name) VALUES ($1,$2,$3,$4,$5,'HOURLY',0,'XOF','{"salaryMonths":[]}','{}',$6,'X')`, [newId(), t2, pid, staff, cfg, U]);
    await q("COMMIT");
    expect((await adminRows<{ awaiting_calculation: boolean }>(db, "SELECT awaiting_calculation FROM payroll.pay_periods WHERE id=$1", [pid]))[0]?.awaiting_calculation).toBe(false);
    await mk(); // une nouvelle période peut maintenant exister
    await expectPg(q("UPDATE payroll.pay_periods SET end_date='2026-02-28' WHERE id=$1", [pid]), /payroll\.period_has_payslips/);
    await q("UPDATE payroll.pay_periods SET status='ACTIVE' WHERE id=$1", [pid]);
    await q("UPDATE payroll.pay_periods SET status='ARCHIVED' WHERE id=$1", [pid]);
    await expectPg(q("UPDATE payroll.pay_periods SET status='ACTIVE' WHERE id=$1", [pid]), /payroll\.period_closed/);
    await expectPg(q("UPDATE payroll.pay_periods SET name='X' WHERE id=$1", [pid]), /payroll\.period_closed/);
  });

  it("pay_period_targets : un enseignant ciblé ayant un bulletin ne peut plus être retiré (pas de cascade)", async () => {
    const t3 = await db.createTenant();
    const per = newId();
    const staff = newId();
    await q("INSERT INTO payroll.pay_periods (id, tenant_id, name, start_date, end_date, academic_year_id, created_by, awaiting_calculation) VALUES ($1,$2,'P','2026-01-05','2026-01-31',$3,$4,false)", [per, t3, year, U]);
    await q("INSERT INTO payroll.pay_period_targets (tenant_id, period_id, staff_id) VALUES ($1,$2,$3)", [t3, per, staff]);
    const cfg = newId();
    await q("INSERT INTO payroll.pay_configs (id, tenant_id, staff_id, config_type, default_hourly_rate, overtime_threshold_minutes, overtime_multiplier_permille, effective_from, created_by) VALUES ($1,$2,$3,'HOURLY',1000,2400,1500,'2025-01-01',$4)", [cfg, t3, staff, U]);
    await q(`INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, total_amount, currency, calc_details, config_snapshot, calculated_by, calculated_by_name) VALUES ($1,$2,$3,$4,$5,'HOURLY',0,'XOF','{"salaryMonths":[]}','{}',$6,'X')`, [newId(), t3, per, staff, cfg, U]);
    await expectPg(q("DELETE FROM payroll.pay_period_targets WHERE period_id=$1", [per]), /payroll\.period_has_payslips/);
  });

  it("calculation_runs : un seul calcul RUNNING (hors aperçu) par période", async () => {
    const per = await period();
    const run = (dry: boolean) => q("INSERT INTO payroll.calculation_runs (id, tenant_id, period_id, scope, recalculate, dry_run, requested_by) VALUES ($1,$2,$3,'ALL',false,$4,$5)", [newId(), tenant, per, dry, U]);
    await run(false);
    await expectPg(run(false), /calculation_runs_running_uq/);
    await run(true);
    await run(true);
  });

  it("droits de l'application : jamais de DELETE sur payslips, pay_periods, pay_configs ; pas d'UPDATE sur les lignes", async () => {
    const rows = await adminRows<{ table_name: string; privilege_type: string }>(
      db,
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'app_user' AND table_schema = 'payroll' AND privilege_type IN ('DELETE','UPDATE')`,
    );
    const has = (t: string, p: string) => rows.some((r) => r.table_name === t && r.privilege_type === p);
    for (const t of ["payslips", "pay_periods", "pay_configs", "payslip_events", "calculation_run_items"]) expect(has(t, "DELETE"), `DELETE ${t}`).toBe(false);
    for (const t of ["payslip_lines", "hour_claims", "salary_day_claims", "payslip_events", "payslip_adjustments"]) expect(has(t, "UPDATE"), `UPDATE ${t}`).toBe(false);
  });
});
