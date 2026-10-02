/** Résolution de noms par lots : règles pures et validations qui précèdent toute lecture en base (sans Postgres). */
import { describe, expect, it } from "vitest";
import { createRequestContext, newId } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { PEOPLE_LOOKUP_MAX_IDS, peopleLookupQuerySchema, peopleStaffLookupResponseSchema, peopleStudentLookupResponseSchema } from "@ecoledigitale/contracts/src/v2/people";
import { createPeopleDeps } from "../../application/deps";
import { LOOKUP_MAX_IDS, dedupeIds, getDisplayNamesOfStaff, getDisplayNamesOfStudents, lookupStaff, lookupStudents } from "../../application/lookup";
import * as publicApi from "../../index";

// une base qui échoue si on la touche : les refus de validation ne doivent JAMAIS atteindre le SQL
let touched = 0;
const noDb = {
  run: async () => {
    touched += 1;
    return { rows: [] };
  },
} as unknown as TenantDb;
const deps = createPeopleDeps({ db: noDb });
const ctx = createRequestContext({ tenantId: newId(), userId: newId(), roles: [] });

describe("dedupeIds", () => {
  it("conserve l'ordre de première apparition", () => {
    expect(dedupeIds(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
    expect(dedupeIds([])).toEqual([]);
  });
});

describe("validations avant lecture", () => {
  it("plafond de l'API publique : au-delà de 500 distincts → 400 `too_many`, sans toucher la base (les doublons ne comptent pas : voir dedupeIds et le test d'intégration)", async () => {
    touched = 0;
    const many = Array.from({ length: LOOKUP_MAX_IDS + 1 }, () => newId());
    for (const fn of [lookupStudents, lookupStaff]) {
      const res = await fn(deps, ctx, many);
      expect(res.ok).toBe(false);
      expect(!res.ok && res.error.httpStatus).toBe(400);
    }
    expect(touched).toBe(0);
  });

  it("un identifiant mal formé est refusé (400) AVANT la base : un UUID invalide ferait échouer toute la requête SQL", async () => {
    touched = 0;
    const res = await lookupStudents(deps, ctx, [newId(), "'; DROP TABLE people.students; --"]);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.httpStatus).toBe(400);
    expect(touched).toBe(0);
  });

  it("`getDisplayNamesOf*` ignore les identifiants invalides au lieu d'échouer, et ne lit rien s'il n'y a rien de valide", async () => {
    touched = 0;
    expect((await getDisplayNamesOfStudents(deps, ctx, ["x", "", "pas-un-uuid"])).size).toBe(0);
    expect((await getDisplayNamesOfStaff(deps, ctx, [])).size).toBe(0);
    expect(touched).toBe(0);
  });
});

describe("contrat d'entrée et de sortie", () => {
  const a = newId();
  const b = newId();
  it("ids : virgules ou paramètre répété, doublons retirés, espaces tolérés", () => {
    expect(peopleLookupQuerySchema.parse({ ids: `${a},${b},${a}` }).ids).toEqual([a, b]);
    expect(peopleLookupQuerySchema.parse({ ids: [a, b, a] }).ids).toEqual([a, b]);
    expect(peopleLookupQuerySchema.parse({ ids: ` ${a} , ${b} ` }).ids).toEqual([a, b]);
  });
  it("refuse : vide, segment vide, UUID invalide, champ inconnu, trop d'identifiants distincts", () => {
    for (const bad of [{ ids: "" }, { ids: `${a},` }, { ids: `${a},,${b}` }, { ids: "x" }, { ids: a, extra: "1" }, {}, { ids: Array.from({ length: PEOPLE_LOOKUP_MAX_IDS + 1 }, () => newId()).join(",") }]) {
      expect(peopleLookupQuerySchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
    expect(peopleLookupQuerySchema.safeParse({ ids: Array.from({ length: PEOPLE_LOOKUP_MAX_IDS }, () => newId()).join(",") }).success).toBe(true);
  });
  it("les réponses sont minimales : toute clé supplémentaire (donnée personnelle) est rejetée par un schéma strict", () => {
    const student = { id: a, displayName: "KONE Awa", studentNumber: "2025-001", status: "ACTIVE" };
    expect(peopleStudentLookupResponseSchema.safeParse({ items: [student], missing: [b] }).success).toBe(true);
    expect(Object.keys(peopleStudentLookupResponseSchema.shape.items.element.shape).sort()).toEqual(["displayName", "id", "status", "studentNumber"]);
    expect(Object.keys(peopleStaffLookupResponseSchema.shape.items.element.shape).sort()).toEqual(["displayName", "id", "staffNumber", "status"]);
    expect(peopleStudentLookupResponseSchema.safeParse({ items: [{ ...student, status: "INCONNU" }], missing: [] }).success).toBe(false);
  });
});

describe("API publique", () => {
  it("expose les lectures par lots pour les autres modules", () => {
    for (const name of ["lookupStudents", "lookupStaff", "getDisplayNamesOfStudents", "getDisplayNamesOfStaff", "resolveStudentLookupScope", "resolveStaffLookupScope", "LOOKUP_MAX_IDS"]) {
      expect(publicApi, name).toHaveProperty(name);
    }
  });
});
