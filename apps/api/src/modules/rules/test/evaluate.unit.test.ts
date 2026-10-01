/**
 * Évaluation : valeurs, trace, déterminisme (1 000 exécutions), empreintes, paramètres bornés et de mode (décisions métier du
 * 2026-10-01), codes de sortie du contrat, budget, isolation des erreurs d'un lot.
 */
import { describe, expect, it } from "vitest";
import { evaluate, evaluateMany } from "../application/evaluate";
import { RuleRunner, compiledSeed } from "./support/runner";

const lmd = compiledSeed("CI-HIGHER-LMD");
const run = new RuleRunner(lmd);

describe("évaluation d'une règle", () => {
  it("renvoie valeur exacte, trace post-ordre, nombre de nœuds, version du moteur et empreintes", () => {
    const r = evaluate(lmd, { ruleKey: "note_ecue", context: { variables: { moyenne_devoirs: 12, note_examen: 14 } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ ruleKey: "note_ecue", type: "number", value: "13.2", definitionHash: lmd.definitionHash, engineVersion: "0.1.0" });
    expect(r.value.ruleVersionId).toBe(lmd.version.id);
    expect(r.value.nodesEvaluated).toBeGreaterThan(0);
    expect(r.value.trace.length).toBeGreaterThan(0);
    expect(r.value.trace[0]!.seq).toBe(1);
    expect(r.value.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.value.outputsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sans trace sur demande", () => {
    const r = evaluate(lmd, { ruleKey: "note_ecue", context: { variables: { moyenne_devoirs: 12, note_examen: 14 } }, trace: false });
    expect(r.ok && r.value.trace).toEqual([]);
  });

  it("DÉTERMINISME : mêmes (version, hash, moteur, entrées) => sorties strictement identiques sur 1 000 exécutions", () => {
    const outputs = new Set<string>();
    const inputs = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const r = evaluate(lmd, { ruleKey: "moyenne_ue", context: { variables: { ecues: [{ note: 9.995, credits: 3, validation_manuelle: false }, { note: 14.25, credits: 2, validation_manuelle: false }, { note: null, credits: 4, validation_manuelle: false }] } } });
      if (!r.ok) throw r.error;
      outputs.add(`${r.value.value}|${r.value.outputsHash}`);
      inputs.add(r.value.inputsHash);
    }
    expect(outputs.size).toBe(1);
    expect(inputs.size).toBe(1);
  });

  it("l'empreinte des entrées est indépendante de la représentation des nombres", () => {
    const a = evaluate(lmd, { ruleKey: "note_ecue", context: { variables: { moyenne_devoirs: 12, note_examen: 14 } } });
    const b = evaluate(lmd, { ruleKey: "note_ecue", context: { variables: { moyenne_devoirs: "12.0", note_examen: "14.00" } } });
    expect(a.ok && b.ok && a.value.inputsHash === b.value.inputsHash && a.value.outputsHash === b.value.outputsHash).toBe(true);
  });

  it("règle inconnue : rules.rule_not_found (404) ; donnée manquante : rules.evaluation_failed avec clé et position", () => {
    const unknown = evaluate(lmd, { ruleKey: "inexistante", context: { variables: {} } });
    expect(unknown.ok === false && unknown.error.code).toBe("rules.rule_not_found");
    const missing = evaluate(lmd, { ruleKey: "credits_total", context: { variables: {} } });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("rules.evaluation_failed");
      expect(missing.error.message).toMatch(/absente|obligatoire/i);
      expect(missing.error.details).toMatchObject({ ruleKey: "credits_total", engineCode: "DONNEE_MANQUANTE", position: expect.objectContaining({ line: 1 }) });
    }
  });

  it("budget dépassé : rules.budget_exceeded, jamais un résultat silencieux (R-RUL-11)", () => {
    const ecues = Array.from({ length: 200 }, () => ({ note: 10, credits: 1, validation_manuelle: false }));
    const r = evaluate(lmd, { ruleKey: "moyenne_ue", context: { variables: { ecues } } }, { budget: { maxNodes: 50 } });
    expect(r.ok === false && r.error.code).toBe("rules.budget_exceeded");
    expect(evaluate(lmd, { ruleKey: "moyenne_ue", context: { variables: { ecues } } }).ok).toBe(true);
  });

  it("lot : une erreur par appel, les autres résultats sont rendus sans masquer l'échec", () => {
    const results = evaluateMany(lmd, [
      { ruleKey: "ecue_validee", context: { variables: { note: 10, validation_manuelle: false } } },
      { ruleKey: "credits_total", context: { variables: {} } },
      { ruleKey: "ecue_eliminee", context: { variables: { note: 4, validation_manuelle: false } } },
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[0]!.ok && results[0]!.value.value).toBe(true);
    expect(results[2]!.ok && results[2]!.value.value).toBe(true);
  });
});

describe("paramètres bornés et paramètres de mode", () => {
  it("refuse une surcharge hors bornes avec le message du moteur (AC1.2, R-RUL-07)", () => {
    const r = evaluate(lmd, { ruleKey: "note_ecue", context: { variables: { moyenne_devoirs: 10, note_examen: 10 } }, overrides: { poids_devoirs: 1.5 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/hors de l'intervalle autorisé/);
  });

  it("refuse une surcharge qui ne correspond à aucun paramètre, ou hors énumération du contrat", () => {
    const unknown = evaluate(lmd, { ruleKey: "note_ecue", context: { variables: { moyenne_devoirs: 10, note_examen: 10 } }, overrides: { poids_secret: 1 } });
    expect(unknown.ok === false && unknown.error.code).toBe("rules.invalid_input");
    const bad = evaluate(lmd, { ruleKey: "note_examen_retenue", context: { variables: { note_s1: 5, note_s2: 8 } }, overrides: { mode_session2: "AU_HASARD" } });
    expect(bad.ok === false && bad.error.code).toBe("rules.invalid_input");
  });

  it("DÉCISION MÉTIER : la note de session 2 REMPLACE toujours celle de session 1, même plus faible (mode REPLACE)", () => {
    expect(run.num("note_examen_retenue", { note_s1: 12, note_s2: 4 })).toBe(4);
    expect(run.num("session_examen_retenue", { note_s1: 12, note_s2: 4 })).toBe(2);
    expect(run.num("note_examen_retenue", { note_s1: 12, note_s2: null })).toBe(12);
    expect(run.num("session_examen_retenue", { note_s1: 12, note_s2: null })).toBe(1);
    expect(run.num("note_examen_retenue", { note_s1: null, note_s2: 9 })).toBe(9);
    expect(run.num("note_examen_retenue", { note_s1: null, note_s2: null })).toBeNull();
  });

  it("le mode BEST (autre établissement) garde la meilleure des deux et reste cohérent avec la session retenue", () => {
    const best = { mode_session2: "BEST" } as const;
    expect(run.num("note_examen_retenue", { note_s1: 12, note_s2: 4 }, best)).toBe(12);
    expect(run.num("session_examen_retenue", { note_s1: 12, note_s2: 4 }, best)).toBe(1);
    expect(run.num("note_examen_retenue", { note_s1: 8, note_s2: 15 }, best)).toBe(15);
    expect(run.num("session_examen_retenue", { note_s1: 8, note_s2: 15 }, best)).toBe(2);
    expect(run.num("note_examen_retenue", { note_s1: null, note_s2: 7 }, best)).toBe(7);
  });

  it("DÉCISION MÉTIER : un semestre est validé si TOUTES ses UE sont validées, sans compensation entre UE", () => {
    const ues = (flags: boolean[]) => flags.map((validee) => ({ validee, credits: 6 }));
    expect(run.bool("semestre_valide", { ues: ues([true, true, true]) })).toBe(true);
    expect(run.bool("semestre_valide", { ues: ues([true, true, false]) })).toBe(false);
    expect(run.bool("semestre_valide", { ues: [] })).toBe(false); // un semestre sans UE n'est pas validé
    // 30 crédits acquis sur 36 : au-dessus de l'ancien seuil de 20 crédits, mais le semestre n'est PAS validé.
    expect(run.bool("semestre_valide", { ues: [{ validee: true, credits: 30 }, { validee: false, credits: 6 }] })).toBe(false);
  });

  it("modes alternatifs configurables : CREDITS (seuil) et ALL_UE_OR_CREDITS ; l'année suit la même décision", () => {
    const mixed = [{ validee: true, credits: 24 }, { validee: false, credits: 6 }];
    expect(run.bool("semestre_valide", { ues: mixed }, { mode_validation: "CREDITS" })).toBe(true);
    expect(run.bool("semestre_valide", { ues: mixed }, { mode_validation: "CREDITS", credits_requis: 25 })).toBe(false);
    expect(run.bool("semestre_valide", { ues: mixed }, { mode_validation: "ALL_UE_OR_CREDITS" })).toBe(true);
    expect(run.bool("semestre_valide", { ues: [{ validee: true, credits: 3 }] }, { mode_validation: "ALL_UE_OR_CREDITS" })).toBe(true);
    // Année : toutes les UE des deux semestres.
    expect(run.bool("annee_validee", { ues: [{ validee: true, credits: 20 }, { validee: true, credits: 36 }] })).toBe(true);
    expect(run.bool("annee_validee", { ues: [{ validee: true, credits: 50 }, { validee: false, credits: 6 }] })).toBe(false);
    expect(run.bool("annee_validee", { ues: [{ validee: true, credits: 49 }] }, { mode_validation: "CREDITS" })).toBe(true);
    expect(run.bool("annee_validee", { ues: [{ validee: true, credits: 48 }] }, { mode_validation: "CREDITS" })).toBe(false);
  });
});

describe("codes de sortie du contrat", () => {
  it("une règle à code renvoie un code de son contrat ; le libellé français vient de label_map", () => {
    expect(run.str("mention_releve", { moyenne: 13.99 })).toBe("FAIRLY_GOOD");
    expect(run.str("mention_releve", { moyenne: 14 })).toBe("GOOD");
    expect(run.str("mention_releve", { moyenne: null })).toBe("PENDING");
    expect(run.label("mention_releve", "FAIRLY_GOOD")).toBe("Assez Bien");
    expect(run.str("decision_semestre", { semestre_valide: false, ue_en_rattrapage: 2 })).toBe("RESIT");
    expect(run.str("etat_ue", { validee: false, session2_tentee: true })).toBe("DEBT");
  });

  it("une expression qui produit un code inconnu du contrat est refusée à l'exécution (rules.contract_violation)", () => {
    const rogue = new RuleRunner(compiledSeed("CI-HIGHER-LMD", (rs) => rs.map((r) => (r.key === "mention_releve" ? { ...r, expression: '"SUPER_BIEN"' } : r))));
    const r = rogue.result("mention_releve", { moyenne: 15 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("rules.contract_violation");
  });
});

describe("règles de départ : valeurs de référence", () => {
  it("ECUE exactement à 10 ou à 5 (arithmétique décimale exacte, régression des 24 + 8 couples)", () => {
    expect(run.bool("ecue_validee", { note: run.num("note_ecue", { moyenne_devoirs: 0.4, note_examen: 16.4 }), validation_manuelle: false })).toBe(true);
    expect(run.bool("ecue_eliminee", { note: run.num("note_ecue", { moyenne_devoirs: 0.2, note_examen: 8.2 }), validation_manuelle: false })).toBe(false);
    expect(run.num("moyenne_ue", { ecues: [{ note: 6.4, credits: 1, validation_manuelle: false }, { note: 11.2, credits: 3, validation_manuelle: false }] })).toBe(10);
  });

  it("l'arrondi d'affichage est un demi-supérieur DÉCIMAL (1,005 -> 1,01 ; 9,995 -> 10)", () => {
    expect(run.num("arrondi_affichage", { valeur: 1.005 })).toBe(1.01);
    expect(run.num("arrondi_affichage", { valeur: 9.995 })).toBe(10);
    expect(run.num("arrondi_affichage", { valeur: null })).toBeNull();
  });

  it("le classement partage le meilleur rang des ex æquo à 4 décimales (compétition)", () => {
    const cohorte = [16, 16, 15.99, 14];
    expect(run.num("rang", { moyenne: 16, cohorte })).toBe(1);
    expect(run.num("rang", { moyenne: 15.99, cohorte })).toBe(3);
    expect(run.num("rang", { moyenne: 14, cohorte })).toBe(4);
    expect(run.num("rang", { moyenne: null, cohorte })).toBeNull();
    // Égalité à 4 décimales : 15,99999 et 16 sont ex æquo.
    expect(run.num("rang", { moyenne: 15.99999, cohorte: [16, 15.99999] })).toBe(1);
  });

  it("éligibilité au diplôme : exigences obligatoires validées ET total d'UV suffisant", () => {
    const ex = (valide: boolean, obligatoire: boolean, uv: number) => ({ valide, obligatoire, uv });
    expect(run.bool("diplome_eligible", { exigences: [ex(true, true, 30), ex(true, false, 30)], uv_requises: 60 })).toBe(true);
    expect(run.bool("diplome_eligible", { exigences: [ex(false, true, 30), ex(true, false, 60)], uv_requises: 60 })).toBe(false);
    expect(run.bool("diplome_eligible", { exigences: [ex(true, true, 30), ex(false, false, 30)], uv_requises: 60 })).toBe(false);
  });

  it("statut d'ECUE, session de validation d'UE et distinction", () => {
    expect(run.str("statut_ecue", { note: 7, ue_validee: true })).toBe("COMPENSATED");
    expect(run.str("statut_ecue", { note: 7, ue_validee: false })).toBe("INSUFFICIENT");
    expect(run.str("statut_ecue", { note: 4.99, ue_validee: true })).toBe("ELIMINATORY");
    expect(run.num("session_validation_ue", { validee: true, sessions: [1, 2] })).toBe(2);
    expect(run.num("session_validation_ue", { validee: true, sessions: [] })).toBe(1);
    expect(run.num("session_validation_ue", { validee: false, sessions: [2] })).toBeNull();
    expect(run.str("distinction_semestre", { moyenne: 15 })).toBe("HONOR_ROLL_ENCOURAGEMENT");
    expect(run.str("distinction_semestre", { moyenne: 12 })).toBe("HONOR_ROLL");
    expect(run.str("distinction_semestre", { moyenne: 9.99 })).toBe("WARNING");
    expect(run.str("distinction_semestre", { moyenne: 11 })).toBe("NONE");
  });
});
