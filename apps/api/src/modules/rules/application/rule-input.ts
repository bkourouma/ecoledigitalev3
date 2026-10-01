/**
 * Entrée d'un jeu de règles (création d'une version nationale) -> enregistrements persistables. Valide la forme avec
 * les schémas du moteur (paramètres bornés, schéma d'entrée, type de résultat) ; la compilation et le contrat sont
 * vérifiés plus tard, à la transition `draft → simulated`.
 */
import { err, ok, ValidationError, type AppError, type Result } from "@ecoledigitale/kernel";
import { RuleDefinitionSchema, type ResultTypeSpec, type RuleSchemaSpec, type RuleType } from "../engine";
import { RulesCode } from "../domain/errors";
import type { LabelMap, RuleDefinitionRecord } from "../domain/types";

export interface RuleInput {
  readonly key: string;
  readonly type: RuleType;
  readonly expression: string;
  readonly description?: string | undefined;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
  readonly inputSchema?: Readonly<Record<string, unknown>> | undefined;
  readonly resultType?: ResultTypeSpec | undefined;
  readonly labelMap?: LabelMap | undefined;
  readonly isOptional?: boolean | undefined;
}

export function ruleInputsToRecords(inputs: readonly RuleInput[]): Result<RuleDefinitionRecord[], AppError> {
  const seen = new Set<string>();
  const out: RuleDefinitionRecord[] = [];
  for (const [index, input] of inputs.entries()) {
    if (seen.has(input.key)) {
      return err(new ValidationError(`Clé de règle en double : « ${input.key} ».`, [{ path: ["rules", index, "key"], message: "Clé en double." }], { code: RulesCode.DUPLICATE }));
    }
    seen.add(input.key);
    const parsed = RuleDefinitionSchema.safeParse({
      key: input.key,
      type: input.type,
      expression: input.expression,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.parameters !== undefined ? { parameters: input.parameters } : {}),
      ...(input.inputSchema !== undefined ? { inputSchema: input.inputSchema } : {}),
      ...(input.resultType !== undefined ? { result: input.resultType } : {}),
    });
    if (!parsed.success) {
      return err(
        new ValidationError(
          `Règle « ${input.key} » invalide : ${parsed.error.issues[0]?.message ?? "structure inattendue"}`,
          parsed.error.issues.map((i) => ({ path: ["rules", index, ...i.path], message: i.message, code: i.code })),
          { code: RulesCode.INVALID_INPUT },
        ),
      );
    }
    const def = parsed.data;
    out.push({
      key: def.key,
      type: def.type,
      position: index,
      expression: def.expression,
      description: def.description ?? null,
      parameters: def.parameters ?? {},
      inputSchema: (def.inputSchema as RuleSchemaSpec | undefined) ?? null,
      resultType: def.result ?? null,
      labelMap: input.labelMap ?? {},
      isOptional: input.isOptional ?? false,
    });
  }
  return ok(out);
}
