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

/** Gabarits de BULLETINS et relevés (snapshot de résultats). Les gabarits de documents officiels d'autres modules ont leur propre jeu. */
export const ALL_BUILTIN_KEYS = [...new Set(BUILTIN_TEMPLATES.filter((t) => t.documentKind === "REPORT_CARD" || t.documentKind === "TRANSCRIPT").map((t) => t.key))];
export const OFFICIAL_BUILTIN_KEYS = BUILTIN_TEMPLATES.filter((t) => t.documentKind === "RECEIPT" || t.documentKind === "PAYSLIP").map((t) => t.key);

/** Contexte d'impression d'un document officiel d'un autre module (reçu, bulletin de paie) + identité de l'établissement. */
export function officialContext(key: string, options: { hostile?: boolean } = {}): Record<string, unknown> {
  const name = options.hostile ? `<b>"O'Brien"</b><script>alert(1)</script>` : "KOUASSI Aya Fictive";
  const institution = {
    legalName: "Établissement de Démonstration", shortName: "", headerLeft: ["Ministère exemple"], headerRight: ["République exemple"],
    contactLine: "1 rue de l'Exemple", address: "1 rue de l'Exemple", phone: "", email: "", website: "", registrationRef: "", footerText: "Pied de page de démonstration.",
  };
  const common = { institution, provisional: false, meta: { code: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", verifyUrl: "https://verif.example.test/v/ABCDEFGHIJKLMNOPQRSTUVWXYZ", hasQr: true, issuedAt: "2026-02-03T10:00:00.000Z" } };
  if (key === "receipt-standard") {
    return {
      ...common,
      title: "Reçu de paiement REC-2026-000042",
      receipt: {
        number: "REC-2026-000042", issuedOn: "2026-02-03T10:00:00.000Z", learnerName: name, learnerRegistration: "MAT-0042", payerName: "Parent Fictif", methodLabel: "Espèces", reference: "",
        amountText: "25 000 F CFA", allocations: [{ invoiceNumber: "FAC-2026-000007", label: "1re tranche", amountText: "25 000 F CFA" }], unallocatedText: "", balanceAfterText: "75 000 F CFA",
      },
    };
  }
  return {
    ...common,
    title: "Bulletin de paie — Septembre 2025",
    payslip: {
      staffName: name, matricule: "ENS-007", periodName: "Septembre 2025", startDate: "2025-09-01", endDate: "2025-09-30", paidOn: "2025-10-05",
      lines: [{ date: "2025-09-08", label: "Mathématiques — 6e A", durationText: "2 h", rateText: "5 000 F CFA", amountText: "10 000 F CFA" }],
      adjustments: [{ kindLabel: "Prime", label: "Prime d'assiduité", reason: "", amountText: "5 000 F CFA" }], salaryText: "", regularHoursText: "265 000 F CFA", regularDurationText: "53 h",
      overtimeText: "10 000 F CFA", overtimeDurationText: "2 h", bonusText: "5 000 F CFA", deductionText: "0 F CFA", totalText: "280 000 F CFA",
    },
  };
}
