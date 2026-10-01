/** Jeux de données purs pour les tests unitaires (aucun nom réel, aucune base). */
import { newId } from "@ecoledigitale/kernel";
import { resolveOptions } from "../../domain/options-schema";
import { buildSnapshot, type BuildSnapshotInput, type ResolvedSignatory } from "../../domain/snapshot";
import type { Branding, Pack } from "../../domain/types";
import { BUILTIN_TEMPLATES, builtinTemplate, type BuiltinTemplate } from "../../templates/builtin";
import { makeSampleBundle } from "../../infrastructure/in-memory-ports";

export const FIXED_ISSUED_AT = new Date("2026-02-03T10:20:30.000Z");

export function makeBranding(overrides: Partial<Branding> = {}): Branding {
  return {
    id: newId(),
    institutionId: null,
    version: 1,
    isCurrent: true,
    legalName: "Établissement de Démonstration",
    shortName: "EDD",
    headerLeft: ["Ministère exemple", "Direction exemple"],
    headerRight: ["République exemple", "Devise exemple"],
    address: "1 rue de l'Exemple",
    phone: "+000 00 00 00",
    email: "contact@etablissement.example",
    website: null,
    registrationRef: "Agrément n° 0000",
    logoObjectKey: null,
    emblemObjectKey: null,
    primaryColor: "#14532D",
    secondaryColor: "#2E7D4F",
    footerText: "Pied de page de démonstration.",
    createdAt: FIXED_ISSUED_AT,
    ...overrides,
  };
}

export const SIGNATORIES: ResolvedSignatory[] = [
  { slot: "director", slotLabel: "Le Directeur", name: "Personne Fictive Une", title: "Directeur", jobFunction: "Direction générale", signatureKey: null },
];

export function templateFor(key: string): BuiltinTemplate {
  const t = builtinTemplate(key);
  if (!t) throw new Error(`gabarit inconnu ${key}`);
  return t;
}

export function snapshotFor(
  templateKey: string,
  opts: { hostile?: boolean; provisional?: boolean; deliberationDate?: string | null; options?: Record<string, unknown>; signatories?: ResolvedSignatory[]; pack?: Pack } = {},
) {
  const template = templateFor(templateKey);
  const resolved = resolveOptions(template.optionsSchema, opts.options ?? {});
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.problems));
  const isTranscript = template.documentKind === "TRANSCRIPT";
  const bundle = makeSampleBundle({
    studentId: newId(),
    enrollmentId: isTranscript ? null : newId(),
    classroomId: isTranscript ? null : newId(),
    periodId: isTranscript ? null : newId(),
    yearId: newId(),
    stateId: newId(),
    ruleVersionId: newId(),
    pack: opts.pack ?? template.pack,
    ...(opts.hostile ? { hostile: true } : {}),
    ...(opts.deliberationDate !== undefined ? { deliberationDate: opts.deliberationDate } : {}),
  });
  const input: BuildSnapshotInput = {
    kind: template.documentKind === "TRANSCRIPT" ? "TRANSCRIPT" : "REPORT_CARD",
    scope: isTranscript ? "CUMULATIVE" : "PERIOD",
    version: 1,
    provisional: opts.provisional === true,
    issuedAt: FIXED_ISSUED_AT,
    issuedBy: { id: null, name: "Utilisateur de test" },
    bundle,
    branding: makeBranding(),
    signatories: opts.signatories ?? SIGNATORIES,
    template: { key: template.key, version: template.version, configVersion: 1, options: resolved.value },
  };
  const built = buildSnapshot(input);
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  return { ...built, template, input };
}

export const ALL_BUILTIN_KEYS = BUILTIN_TEMPLATES.map((t) => t.key);
