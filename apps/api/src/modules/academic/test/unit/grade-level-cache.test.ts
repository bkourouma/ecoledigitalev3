import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestContext, runWithContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { GRADE_LEVEL_CACHE_TTL_MS, noteGradeLevelWrite } from "../../infrastructure/grade-level-cache";
import { getGradeLevel, upsertGradeLevel } from "../../infrastructure/reference-repository";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";
const G1 = "44444444-4444-4444-8444-444444444441";
const EL = "55555555-5555-4555-8555-555555555555";

const ctxOf = (tenantId: string) => createRequestContext({ tenantId, userId: U, roles: ["admin"], requestId: "r-1" });

/** Faux Tx : compte les lectures de niveaux et sert une ligne dépendant du tenant (comme la RLS). */
function fakeTx(tenantLabel: string, state: { reads: number; label?: string }): Tx {
  const row = () => ({
    id: G1,
    education_level_id: EL,
    code: "CP1",
    label: state.label ?? `Niveau ${tenantLabel}`,
    short_label: null,
    ordinal: 1,
    next_grade_level_id: null,
    is_final: false,
    terminal_exam_required: false,
    active: true,
  });
  const q = async (sql: string) => {
    if (/FROM academic\.grade_levels WHERE id/.test(sql)) {
      state.reads += 1;
      return { rows: [row()], rowCount: 1 };
    }
    return { rows: [{ inserted: true }], rowCount: 1 };
  };
  return {
    query: q,
    queryOne: async (sql: string) => (await q(sql)).rows[0] ?? null,
    many: async (sql: string) => (await q(sql)).rows,
    transaction: async (fn: (t: Tx) => Promise<unknown>) => fn({} as Tx),
  } as unknown as Tx;
}

describe("getGradeLevel : mémoïsation par contexte de requête", () => {
  beforeEach(() => {
    delete process.env.ACADEMIC_REQUEST_CACHE;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ACADEMIC_REQUEST_CACHE;
  });

  it("un même contexte lit un niveau une seule fois, même à travers plusieurs transactions", async () => {
    const ctx = ctxOf(A);
    const s = { reads: 0 };
    for (let i = 0; i < 50; i++) {
      await runWithContext(ctx, async () => {
        const g = await getGradeLevel(fakeTx("A", s), G1);
        expect(g?.label).toBe("Niveau A");
      });
    }
    expect(s.reads).toBe(1);
  });

  it("deux contextes (deux requêtes) ne partagent RIEN, même tenant et même utilisateur", async () => {
    const s = { reads: 0 };
    await runWithContext(ctxOf(A), () => getGradeLevel(fakeTx("A", s), G1));
    await runWithContext(ctxOf(A), () => getGradeLevel(fakeTx("A", s), G1));
    expect(s.reads).toBe(2);
  });

  it("deux tenants ne partagent jamais de valeur (A puis B pour le même identifiant)", async () => {
    const sa = { reads: 0 };
    const sb = { reads: 0 };
    const ga = await runWithContext(ctxOf(A), () => getGradeLevel(fakeTx("A", sa), G1));
    const gb = await runWithContext(ctxOf(B), () => getGradeLevel(fakeTx("B", sb), G1));
    expect(ga?.label).toBe("Niveau A");
    expect(gb?.label).toBe("Niveau B");
    expect(sb.reads).toBe(1);
  });

  it("sans contexte ambiant, ou avec ACADEMIC_REQUEST_CACHE=off : toujours la base", async () => {
    const s = { reads: 0 };
    await getGradeLevel(fakeTx("A", s), G1);
    await getGradeLevel(fakeTx("A", s), G1);
    expect(s.reads).toBe(2);
    process.env.ACADEMIC_REQUEST_CACHE = "off";
    const ctx = ctxOf(A);
    await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    expect(s.reads).toBe(4);
  });

  it("la valeur mémorisée expire (durée de vie absolue courte)", async () => {
    vi.useFakeTimers();
    const ctx = ctxOf(A);
    const s = { reads: 0 };
    await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    vi.advanceTimersByTime(GRADE_LEVEL_CACHE_TTL_MS - 1000);
    await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    expect(s.reads).toBe(1);
    vi.advanceTimersByTime(2000);
    await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    expect(s.reads).toBe(2);
  });

  it("une écriture sur les niveaux invalide : la lecture suivante voit la nouvelle valeur, et le contexte ne remet plus rien en cache", async () => {
    const ctx = ctxOf(A);
    const s: { reads: number; label?: string } = { reads: 0 };
    const first = await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    expect(first?.label).toBe("Niveau A");
    await runWithContext(ctx, async () => {
      const tx = fakeTx("A", s);
      await upsertGradeLevel(tx, G1, { code: "CP1", label: "Renommé", shortLabel: null, educationLevelId: EL, ordinal: 1, isFinal: false, active: true });
      s.label = "Renommé";
      // dans la transaction qui a écrit : relecture directe (donnée non validée jamais mise en cache)
      expect((await getGradeLevel(tx, G1))?.label).toBe("Renommé");
      expect((await getGradeLevel(tx, G1))?.label).toBe("Renommé");
    });
    const reads = s.reads;
    const after = await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    expect(after?.label).toBe("Renommé");
    await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    expect(s.reads).toBe(reads + 2); // contexte désactivé pour le reste de sa vie : plus de cache
  });

  it("une transaction qui a écrit ne remplit jamais le cache d'un autre contexte (ROLLBACK possible)", async () => {
    const writer = ctxOf(A);
    const s: { reads: number; label?: string } = { reads: 0, label: "Brouillon non validé" };
    await runWithContext(writer, async () => {
      const tx = fakeTx("A", s);
      noteGradeLevelWrite(tx);
      await getGradeLevel(tx, G1);
    });
    const other = ctxOf(A);
    s.label = "Valeur validée";
    const g = await runWithContext(other, () => getGradeLevel(fakeTx("A", s), G1));
    expect(g?.label).toBe("Valeur validée");
  });

  it("renvoie des copies : modifier le résultat ne corrompt pas le cache", async () => {
    const ctx = ctxOf(A);
    const s = { reads: 0 };
    const g1 = await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    (g1 as { label: string }).label = "MUTÉ";
    const g2 = await runWithContext(ctx, () => getGradeLevel(fakeTx("A", s), G1));
    expect(g2?.label).toBe("Niveau A");
  });
});
