/**
 * Socle des TESTS DE CONTRAT d'événements (un fichier par module consommateur, voir `*.test.ts` voisins).
 *
 * Pour chaque événement consommé, on valide la charge RÉELLE du producteur (schéma Zod de
 * `packages/contracts/src/v2`, tenu par les tests du producteur) contre ce que le consommateur lit :
 *   (i)   le producteur a un schéma de charge, et il accepte l'échantillon généré (variantes `full` et `minimal`) ;
 *   (ii)  chaque champ lu par le consommateur existe dans la charge du producteur, sous le même nom et du même type ;
 *         un champ lu « obligatoirement » est OBLIGATOIRE et non nul côté producteur ;
 *   (iii) le lecteur du consommateur (fonction exportée de son code, ou schéma `...Consumed...Schema`) accepte l'échantillon.
 */
import { describe, expect, it } from "vitest";
import * as contracts from "@ecoledigitale/contracts/v2";
import type { ZodTypeAny } from "zod";
import { isNullableSchema, kindOf, objectShapeOf, sampleOf, type ZodKind } from "../helpers/zod-sample";

export type { ZodKind } from "../helpers/zod-sample";

/** Tous les schémas de charge publiés : `<module>EventPayloadSchemas` de packages/contracts/src/v2. */
export function producerSchemas(): Map<string, ZodTypeAny> {
  const out = new Map<string, ZodTypeAny>();
  for (const [exportName, value] of Object.entries(contracts as Record<string, unknown>)) {
    if (!/EventPayloadSchemas$/.test(exportName) || !value || typeof value !== "object") continue;
    for (const [type, schema] of Object.entries(value as Record<string, ZodTypeAny>)) out.set(type, schema);
  }
  return out;
}

/** Un champ de la charge lu par le consommateur. */
export interface FieldRead {
  /** Nom du champ, ou liste de noms équivalents (le consommateur lit le premier présent). */
  field: string | string[];
  kind: ZodKind;
  /**
   * `true` (défaut) : le consommateur ne fonctionne pas sans ce champ -> il doit être OBLIGATOIRE chez le producteur.
   * `false` : le consommateur tolère son absence (le champ doit néanmoins être déclaré, sauf `absentOk`).
   */
  required?: boolean;
  /** Le consommateur accepte `null` (sinon un champ `nullable` chez le producteur est refusé quand `required`). */
  nullable?: boolean;
  /** Le champ peut ne PAS exister encore chez le producteur (additif demandé, repli côté consommateur). */
  absentOk?: boolean;
}

export interface EventContract {
  consumer: string;
  /** Nom exact de l'événement publié. */
  event: string;
  /** Champs lus ; `[]` pour un consommateur qui ne lit que le type (amorçage, invalidation de cache). */
  reads: FieldRead[];
  /** Lecteur du consommateur ; doit accepter l'échantillon (retour non nul / non faux, sans exception). */
  reader?: (payload: unknown) => unknown;
  /** Contrôle supplémentaire du résultat du lecteur (sinon : « truthy »). */
  readerOk?: (result: unknown, payload: unknown) => boolean;
  /** Pair traitée par ailleurs (ex. assemblage) : on vérifie seulement ce qui est possible. */
  note?: string;
}

const names = (f: string | string[]): string[] => (Array.isArray(f) ? f : [f]);

export function describeContracts(consumer: string, contractsOfConsumer: readonly EventContract[]): void {
  const schemas = producerSchemas();
  describe(`contrats d'événements consommés par ${consumer}`, () => {
    for (const c of contractsOfConsumer) {
      describe(`${c.event}${c.note ? ` — ${c.note}` : ""}`, () => {
        it("(i) le producteur publie un schéma de charge qui accepte l'échantillon", () => {
          const schema = schemas.get(c.event);
          expect(schema, `aucun schéma de charge pour « ${c.event} » : l'ajouter dans packages/contracts/src/v2/<producteur>.ts (<module>EventPayloadSchemas)`).toBeDefined();
          expect(() => sampleOf(schema!, "full")).not.toThrow();
          expect(() => sampleOf(schema!, "minimal")).not.toThrow();
        });

        it("(ii) les champs lus existent chez le producteur, même nom et même type", () => {
          const schema = schemas.get(c.event);
          if (!schema) return expect(schema).toBeDefined();
          const shape = objectShapeOf(schema);
          expect(shape, `la charge de « ${c.event} » doit être un objet`).not.toBeNull();
          const problems: string[] = [];
          for (const r of c.reads) {
            const required = r.required !== false;
            const candidates = names(r.field);
            const declared = candidates.filter((n) => shape![n] !== undefined);
            if (declared.length === 0) {
              if (!r.absentOk) problems.push(`champ « ${candidates.join(" | ")} » lu par ${c.consumer} mais absent de la charge de ${c.event}`);
              continue;
            }
            const ok = declared.some((n) => {
              const s = shape![n]!;
              const kindMatches = kindOf(s) === r.kind || (r.kind === "string" && kindOf(s) === "uuid") || (r.kind === "uuid" && kindOf(s) === "string");
              if (!kindMatches) return false;
              if (!required) return true;
              if (s.isOptional()) return false;
              if (isNullableSchema(s) && !r.nullable) return false;
              return true;
            });
            if (!ok) {
              const detail = declared.map((n) => `${n}: ${kindOf(shape![n]!)}${shape![n]!.isOptional() ? " (facultatif)" : ""}${isNullableSchema(shape![n]!) ? " (nullable)" : ""}`).join(", ");
              problems.push(`champ « ${candidates.join(" | ")} » : ${c.consumer} attend ${r.kind}${required ? " obligatoire" + (r.nullable ? "" : " non nul") : ""}, le producteur déclare ${detail}`);
            }
          }
          expect(problems, `\n  - ${problems.join("\n  - ")}\n`).toEqual([]);
        });

        it("(iii) le lecteur du consommateur accepte l'échantillon du producteur", () => {
          if (!c.reader) return;
          const schema = schemas.get(c.event);
          if (!schema) return expect(schema).toBeDefined();
          for (const variant of ["full", "minimal"] as const) {
            const payload = sampleOf(schema, variant);
            const result = c.reader(payload);
            const accepted = c.readerOk ? c.readerOk(result, payload) : Boolean(result);
            expect(accepted, `le lecteur de ${c.consumer} refuse l'échantillon ${variant} de ${c.event} : ${JSON.stringify(payload).slice(0, 300)}`).toBe(true);
          }
        });
      });
    }
  });
}
