import { describe, expect, it } from "vitest";
import { AcademicPackTemplateSchema, type AcademicPackTemplate } from "../../domain/template";
import { buildAcademicTemplates, defaultAcademicTemplates, getAcademicTemplate, templateKey } from "../../templates";

const all = [...defaultAcademicTemplates().values()];
const get = (pack: string): AcademicPackTemplate => getAcademicTemplate("CI", pack) as AcademicPackTemplate;

describe("modèles de pack CI (données, jamais de code)", () => {
  it("un modèle par pack, tous valides", () => {
    expect(all.map((t) => t.pack).sort()).toEqual(["HIGHER", "PRIMARY", "SECONDARY", "VIRTUAL"]);
    for (const t of all) {
      expect(t.section).toBe("academic");
      expect(t.educationSystem).toBe("CI");
      expect(t.templateVersion).toBeGreaterThanOrEqual(1);
    }
    expect(templateKey("CI", "HIGHER")).toBe("CI:HIGHER");
    expect(getAcademicTemplate("FR", "HIGHER")).toBeUndefined();
  });

  it("cohérence inter-packs : la définition d'un même type de nœud, de période, de financement ou d'issue est IDENTIQUE", () => {
    const sameByCode = <T extends { code: string }>(pick: (t: AcademicPackTemplate) => T[]): void => {
      const seen = new Map<string, string>();
      for (const t of all) {
        for (const item of pick(t)) {
          const json = JSON.stringify(item);
          const prev = seen.get(item.code);
          if (prev !== undefined) expect(json, `${item.code} diffère entre packs`).toBe(prev);
          seen.set(item.code, json);
        }
      }
    };
    sameByCode((t) => t.nodeTypes);
    sameByCode((t) => t.periodTypes);
    sameByCode((t) => t.fundingTypes);
    sameByCode((t) => t.enrollmentOutcomes);
    sameByCode((t) => t.periodPlans);
    // les codes de cycles et de niveaux propres à un pack ne sont jamais partagés avec un autre pack
    const levelCodes = all.flatMap((t) => t.educationLevels.map((l) => l.code));
    expect(new Set(levelCodes).size).toBe(levelCodes.length);
    const gradeCodes = all.flatMap((t) => t.gradeLevels.map((g) => g.code));
    expect(new Set(gradeCodes).size).toBe(gradeCodes.length);
  });

  it("les quatre packs expriment leur arbre avec la MÊME grammaire (types système LEVEL, PERIOD, GROUP, UE, ECUE, SUBJECT)", () => {
    for (const t of all) {
      expect(t.nodeTypes.map((n) => n.code)).toEqual(["LEVEL", "PERIOD", "GROUP", "UE", "ECUE", "SUBJECT"]);
      expect(t.nodeTypes.every((n) => n.system === true)).toBe(true);
    }
    const ue = get("HIGHER").nodeTypes.find((n) => n.code === "UE")!;
    expect(ue).toMatchObject({ creditsMustEqualChildren: true, allowsCredits: true, enrollable: true });
    const level = get("PRIMARY").nodeTypes.find((n) => n.code === "LEVEL")!;
    expect(level).toMatchObject({ allowedParents: ["ROOT"], requiresGradeLevel: true });
  });

  it("niveaux : chaînage cohérent, fin de parcours déclarée, aucun cycle", () => {
    for (const t of all) {
      const byCode = new Map(t.gradeLevels.map((g) => [g.code, g]));
      for (const g of t.gradeLevels) {
        const seen = new Set<string>([g.code]);
        let cursor = g.next;
        while (cursor) {
          expect(seen.has(cursor), `cycle sur ${g.code}`).toBe(false);
          seen.add(cursor);
          cursor = byCode.get(cursor)?.next ?? null;
        }
        if (g.isFinal) expect(g.next).toBeNull();
      }
    }
    expect(get("HIGHER").gradeLevels.map((g) => g.code)).toEqual(["L1", "L2", "L3", "M1", "M2", "BTS1", "BTS2"]);
    expect(get("SECONDARY").gradeLevels.map((g) => g.code)).toEqual(["6E", "5E", "4E", "3E", "2NDE", "1ERE", "TLE"]);
    expect(get("PRIMARY").gradeLevels.map((g) => g.code)).toEqual(["PS", "MS", "GS", "CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]);
  });

  it("types de financement : STATE_ASSIGNED exige une référence ; boursier et entreprise un financeur", () => {
    const f = new Map(get("SECONDARY").fundingTypes.map((x) => [x.code, x]));
    expect(f.get("STATE_ASSIGNED")?.requiresReference).toBe(true);
    expect(f.get("SCHOLARSHIP")?.requiresFunder).toBe(true);
    expect(f.get("COMPANY")?.requiresFunder).toBe(true);
    expect(f.get("PRIVATE")?.requiresReference).toBeUndefined();
  });

  it("décision métier : le supérieur confirme après paiement des frais d'inscription, un cours une fois sa ligne soldée", () => {
    expect(get("HIGHER").settings).toMatchObject({ enrollmentConfirmationPolicy: "ON_REGISTRATION_FEE_PAID", courseConfirmationPolicy: "ON_LINE_PAID" });
    expect(get("PRIMARY").settings.enrollmentConfirmationPolicy).toBe("AUTO");
  });

  it("AUCUNE donnée réglementaire inventée : pas de coefficient, pas de crédit, pas de matière dans les modèles", () => {
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/"coefficient"|"credits"(?!MustEqual)|"subjects"/);
    for (const t of all) expect(Object.keys(t)).not.toContain("subjects");
  });

  it("contrats de calcul par cycle (specs 005 et 006) : maternelle par compétences, primaire par périodes pondérées, secondaire annuel", () => {
    const contractOf = (pack: string, level: string): string | undefined => get(pack).educationLevels.find((l) => l.code === level)?.calculationContract;
    expect(contractOf("PRIMARY", "PRESCHOOL")).toBe("competency-period@1");
    expect(contractOf("PRIMARY", "PRIMARY")).toBe("coef-period@1");
    expect(contractOf("SECONDARY", "LOWER_SECONDARY")).toBe("secondary-annual@1");
    expect(contractOf("SECONDARY", "UPPER_SECONDARY")).toBe("secondary-annual@1");
    // le supérieur est inchangé
    expect(contractOf("HIGHER", "LICENCE")).toBe("credit-semester@1");
    expect(contractOf("HIGHER", "BTS")).toBe("coef-semester@1");
  });

  it("examen terminal : informatif, uniquement 3e (BEPC) et Terminale (BAC) ; jamais CM2 (question Q-P09) ni un niveau du supérieur", () => {
    const terminal = all.flatMap((t) => t.gradeLevels.filter((g) => g.terminalExamRequired === true).map((g) => `${t.pack}:${g.code}`)).sort();
    expect(terminal).toEqual(["SECONDARY:3E", "SECONDARY:TLE"]);
    expect(get("PRIMARY").gradeLevels.find((g) => g.code === "CM2")?.terminalExamRequired ?? false).toBe(false);
  });

  it("niveaux : PS/MS/GS puis CP1..CM2 ; 6e..3e puis 2nde..Tle ; les niveaux se chaînent d'un cycle à l'autre", () => {
    const p = get("PRIMARY");
    expect(p.gradeLevels.filter((g) => g.educationLevel === "PRESCHOOL").map((g) => g.code)).toEqual(["PS", "MS", "GS"]);
    expect(p.gradeLevels.filter((g) => g.educationLevel === "PRIMARY").map((g) => g.code)).toEqual(["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]);
    expect(p.gradeLevels.find((g) => g.code === "GS")?.next).toBe("CP1");
    const s = get("SECONDARY");
    expect(s.gradeLevels.filter((g) => g.educationLevel === "LOWER_SECONDARY").map((g) => g.code)).toEqual(["6E", "5E", "4E", "3E"]);
    expect(s.gradeLevels.filter((g) => g.educationLevel === "UPPER_SECONDARY").map((g) => g.code)).toEqual(["2NDE", "1ERE", "TLE"]);
  });

  it("séries, options et langues ne sont JAMAIS livrées : aucun programme au-delà des cycles génériques, aucune matière", () => {
    expect(get("SECONDARY").programs.map((x) => x.code)).toEqual(["COLLEGE", "LYCEE"]);
    expect(get("PRIMARY").programs.map((x) => x.code)).toEqual(["MATERNELLE", "PRIMAIRE"]);
    for (const t of all) for (const x of t.programs) expect(x.kindCode ?? "PROGRAM").toBe("PROGRAM");
  });

  it("plans de périodes : TRIMESTER et SEMESTER, poids de créneau neutres (1) pour coef-period@1", () => {
    for (const t of all) {
      const three = t.periodPlans.find((p) => p.code === "THREE_TERMS")!;
      const two = t.periodPlans.find((p) => p.code === "TWO_SEMESTERS")!;
      expect(three.slots.map((s) => s.type)).toEqual(["TRIMESTER", "TRIMESTER", "TRIMESTER"]);
      expect(two.slots.map((s) => s.type)).toEqual(["SEMESTER", "SEMESTER"]);
      for (const slot of [...three.slots, ...two.slots]) expect(slot.weight).toBe(1);
    }
  });

  it("cohérence des modèles : toute valeur non sourcée est MARQUÉE (neutral ou placeholder) ; regulation exige une référence et aucun modèle n'en contient", () => {
    const problems: string[] = [];
    for (const t of all) {
      for (const l of t.educationLevels) if (l.calculationContract && !l.sourceKind) problems.push(`${t.pack}/${l.code} : contrat de calcul sans sourceKind`);
      for (const g of t.gradeLevels) if (g.terminalExamRequired === true && !g.sourceKind) problems.push(`${t.pack}/${g.code} : terminalExamRequired sans sourceKind`);
      for (const p of t.periodPlans) if (p.slots.some((s) => s.weight !== undefined) && !p.sourceKind) problems.push(`${t.pack}/${p.code} : poids sans sourceKind`);
      for (const item of [...t.educationLevels, ...t.gradeLevels, ...t.periodPlans]) {
        expect(item.sourceKind, `${t.pack}/${item.code}`).not.toBe("regulation");
        expect(item.sourceReference, `${t.pack}/${item.code}`).toBeUndefined();
      }
    }
    expect(problems).toEqual([]);
  });

  it("le schéma refuse une valeur « regulation » sans référence, et une référence sans « regulation »", () => {
    const withMutation = (mutate: (t: Record<string, any>) => void): boolean => {
      const copy = structuredClone(get("SECONDARY")) as Record<string, any>;
      mutate(copy);
      return AcademicPackTemplateSchema.safeParse(copy).success;
    };
    expect(withMutation((t) => (t.gradeLevels[3].sourceKind = "regulation"))).toBe(false);
    expect(withMutation((t) => ((t.gradeLevels[3].sourceKind = "regulation"), (t.gradeLevels[3].sourceReference = "Arrêté n° (fictif)")))).toBe(true);
    expect(withMutation((t) => (t.gradeLevels[3].sourceReference = "Arrêté n° (fictif)"))).toBe(false);
    expect(withMutation((t) => (t.educationLevels[0].sourceKind = "officiel"))).toBe(false);
  });

  it("le schéma refuse un modèle incohérent", () => {
    const base = structuredClone(get("PRIMARY"));
    const bad = (mutate: (t: Record<string, any>) => void): boolean => {
      const copy = structuredClone(base) as Record<string, any>;
      mutate(copy);
      return AcademicPackTemplateSchema.safeParse(copy).success;
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((t) => (t.gradeLevels[0].educationLevel = "INCONNU"))).toBe(false);
    expect(bad((t) => (t.gradeLevels[0].next = "INCONNU"))).toBe(false);
    expect(bad((t) => (t.gradeLevels[8].isFinal = true, (t.gradeLevels[0].isFinal = true)))).toBe(false); // final avec suivant
    expect(bad((t) => t.gradeLevels.push({ ...t.gradeLevels[0] }))).toBe(false); // niveau en double
    expect(bad((t) => (t.periodPlans[0].slots[0].type = "INCONNU"))).toBe(false);
    expect(bad((t) => (t.programs[0].gradeLevels = ["INCONNU"]))).toBe(false);
    expect(bad((t) => (t.nodeTypes[1].allowedParents = ["INCONNU"]))).toBe(false);
    expect(bad((t) => (t.nodeTypes[0].requiresPeriodSlot = true))).toBe(false); // niveau et période s'excluent
    expect(bad((t) => (t.settings.registrationNumberPattern = "{PREFIX}-{STUDENT_SEQ:4}"))).toBe(false); // {PREFIX} sans préfixe
    expect(bad((t) => (t.extra = 1))).toBe(false); // schéma strict
  });

  it("deux modèles du même (système, pack) sont refusés ; un modèle illisible lève", () => {
    expect(() => buildAcademicTemplates([get("PRIMARY"), get("PRIMARY")])).toThrow(/double/);
    expect(() => buildAcademicTemplates([{ section: "autre" }])).toThrow();
    expect(buildAcademicTemplates([get("PRIMARY")]).size).toBe(1);
  });
});
