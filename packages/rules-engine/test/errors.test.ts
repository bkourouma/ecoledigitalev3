import { describe, expect, it } from 'vitest';
import {
  RuleCheckError,
  RuleError,
  RuleEvaluationError,
  RuleSchemaError,
  RuleSyntaxError,
  compile,
  evaluate,
  validate,
  type Diagnostic,
  type EvalContext,
  type RuleSchemaSpec,
} from '../src';

const SCHEMA: RuleSchemaSpec = {
  variables: {
    devoirs: 'number?',
    examen: 'number',
    titre: 'string',
    actif: 'boolean',
    notes: { list: 'number?' },
    ecue: { object: { note: 'number?', credits: 'number' } },
    optObj: { object: { v: 'number' }, nullable: true },
    optList: { list: 'number', nullable: true },
  },
  lookups: { period: { keys: ['S1', 'S2'], value: { object: { average: 'number?' } } } },
};

function diagnostics(src: string, schema: RuleSchemaSpec = SCHEMA): Diagnostic[] {
  return validate(src, schema).diagnostics;
}
const first = (src: string): Diagnostic => diagnostics(src)[0] as Diagnostic;

describe('erreurs de syntaxe (en français, avec position)', () => {
  it('fin inattendue', () => {
    const d = first('(1 +');
    expect(d.code).toBe('SYNTAXE_FIN_INATTENDUE');
    expect(d.message).toContain('Fin d\'expression inattendue');
    expect(d.position?.line).toBe(1);
  });

  it('parenthèse jamais refermée : mentionne l\'ouverture', () => {
    const d = first('(1 + 2');
    expect(d.code).toBe('SYNTAXE_FIN_INATTENDUE');
    expect(d.message).toMatch(/« \( » ouverte \(ligne 1, colonne 1\) sans « \) » correspondante/);
  });

  it('parenthèse en trop, jeton inattendu', () => {
    const d = first('1 + 2)');
    expect(d.code).toBe('SYNTAXE_JETON_INATTENDU');
    expect(d.message).toContain('« ) »');
    expect(d.position?.column).toBe(6);
  });

  it('expression vide', () => {
    expect(first('   ').message).toBe('Expression vide.');
  });

  it('caractère inattendu avec conseils', () => {
    expect(first('devoirs = 3').hint).toMatch(/==/);
    expect(first('a & b').hint).toMatch(/&&/);
    expect(first('{}').hint).toMatch(/objets littéraux/);
    expect(first('1 @ 2').code).toBe('SYNTAXE_CARACTERE_INATTENDU');
    expect(first('é').message).toContain('Caractère inattendu');
    expect(first('1 + \u0001').message).toContain('caractère de contrôle');
  });

  it('nombres invalides', () => {
    expect(first('1e5').code).toBe('SYNTAXE_NOMBRE_INVALIDE');
    expect(first('12abc').code).toBe('SYNTAXE_NOMBRE_INVALIDE');
    expect(first('1.2.3').code).toBe('SYNTAXE_NOMBRE_INVALIDE');
    expect(first('0x10').code).toBe('SYNTAXE_NOMBRE_INVALIDE');
    expect(first('1'.repeat(41)).message).toContain('Nombre trop long');
  });

  it('textes mal formés', () => {
    expect(first('"abc').code).toBe('SYNTAXE_TEXTE_NON_TERMINE');
    expect(first('"a\nb"').code).toBe('SYNTAXE_TEXTE_NON_TERMINE');
    expect(first('"a\\qb"').code).toBe('SYNTAXE_ECHAPPEMENT_INVALIDE');
    expect(first(`"${'x'.repeat(250)}"`).message).toContain('Texte trop long');
    expect(first('"a\u0001b"').message).toContain('Caractère de contrôle interdit');
  });

  it('appels et indexations interdits', () => {
    expect(first('avg(1)(2)').code).toBe('SYNTAXE_APPEL_NON_AUTORISE');
    expect(first('ecue.note()').code).toBe('SYNTAXE_APPEL_NON_AUTORISE');
    expect(first('notes[0]').code).toBe('SYNTAXE_NON_SUPPORTE');
    expect(first('notes.').code).toBe('SYNTAXE_FIN_INATTENDUE');
    expect(first('notes.1').code).toBe('SYNTAXE_JETON_INATTENDU');
  });

  it('position multi-lignes', () => {
    const d = first('1 +\n  2 +\n  )');
    expect(d.position).toMatchObject({ line: 3, column: 3 });
  });

  it('trop d\'arguments / d\'éléments', () => {
    const args = Array.from({ length: 17 }, () => '1').join(', ');
    expect(first(`avg(${args})`).code).toBe('LIMITE_NOMBRE_DE_NOEUDS');
    const items = Array.from({ length: 201 }, () => '1').join(', ');
    expect(first(`avg([${items}])`).message).toContain('Trop d\'éléments dans une liste');
  });
});

describe('vérification statique (à la publication)', () => {
  it('nom inconnu + suggestion orthographique', () => {
    const d = first('devoir + 1');
    expect(d.code).toBe('NOM_INCONNU');
    expect(d.message).toBe('Nom inconnu « devoir ». (ligne 1, colonne 1)'.replace(' (ligne 1, colonne 1)', ''));
    expect(d.hint).toBe('Vouliez-vous dire « devoirs » ?');
  });

  it('nom inconnu sans suggestion : liste les variables', () => {
    expect(first('zzzzzzzz').hint).toMatch(/Variables disponibles : devoirs, examen/);
  });

  it('une recherche ou une fonction utilisée comme variable', () => {
    expect(first('period').hint).toMatch(/period\("clé"\)/);
    expect(first('avg + 1').hint).toMatch(/avg\(…\)/);
  });

  it('fonction inconnue', () => {
    const d = first('arrondi(1)');
    expect(d.code).toBe('FONCTION_INCONNUE');
    expect(first('round_half_upp(1, 2)').hint).toBe('Vouliez-vous dire « round_half_up » ?');
    expect(first('devoirs(1)').hint).toMatch(/variable, pas une fonction/);
    expect(first('zzzzzzzz(1)').hint).toMatch(/Fonctions disponibles/);
  });

  it('arité', () => {
    expect(first('clamp(1)').message).toBe('La fonction « clamp » attend 3 arguments, mais en reçoit 1.');
    expect(first('is_null()').message).toBe('La fonction « is_null » attend 1 argument, mais en reçoit 0.');
    expect(first('round_half_up(1, 2, 3)').message).toContain('entre 1 et 2 arguments');
    expect(first('avg()').message).toContain('au moins 1 argument');
    expect(first('period()').message).toContain('attend 1 argument');
  });

  it('types incompatibles', () => {
    expect(first('examen + titre').message).toContain('le côté droit est texte');
    expect(first('examen + titre').code).toBe('TYPE_INCOMPATIBLE');
    expect(first('titre + "a"').hint).toMatch(/concaténation/);
    expect(first('!examen').message).toContain('attend un booléen');
    expect(first('-titre').message).toContain('attend un nombre');
    expect(first('actif && examen').message).toContain('attend des booléens');
    expect(first('examen == titre').message).toContain('Impossible de comparer');
    expect(first('notes == notes').message).toContain('listes ni aux objets');
    expect(first('if(examen, 1, 2)').message).toContain('condition de « if » doit être un booléen');
    expect(first('if(actif, 1, "a")').message).toContain('même type');
    expect(first('coalesce(devoirs, "a")').message).toContain('même type');
    expect(first('avg(titre)').message).toContain('nombre ou une liste de nombres');
    expect(first('wavg(1, 2)').message).toContain('liste de nombres');
    expect(first('clamp("a", 0, 1)').message).toContain('doit être un nombre');
    expect(first('[1, "a"]').message).toContain('même type');
    expect(first('[notes]').message).toContain('valeurs simples');
    expect(first('[]').code).toBe('ARGUMENT_INVALIDE');
    expect(first('len(1)').message).toContain('doit être une liste');
    expect(first('round_half_up("a")').message).toContain('doit être un nombre');
    expect(first('round_half_up(1, titre)').message).toContain('2e argument');
  });

  it('valeurs pouvant être absentes : message + conseil coalesce/is_null', () => {
    const d = first('devoirs + 1');
    expect(d.code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(d.hint).toMatch(/coalesce\(valeur, défaut\)/);
    expect(first('devoirs >= 10').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('1 + devoirs').message).toContain('droit');
    expect(first('-devoirs').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('if(devoirs > 1, 1, 2)').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('ecue.note * 2').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('optObj.v').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('optList.v').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('clamp(1, devoirs, 2)').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('wavg(optList, [1])').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('any(optList, p => p > 1)').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('len(optList)').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('round_half_up(1, devoirs)').code).toBe('VALEUR_PEUT_ETRE_ABSENTE');
    expect(first('devoirs && true').code).toBe('TYPE_INCOMPATIBLE');
  });

  it('narrowing : is_null protège la valeur dans la bonne branche seulement', () => {
    expect(diagnostics('if(is_null(devoirs), 0, devoirs + 1)')).toEqual([]);
    expect(diagnostics('if(is_null(devoirs), devoirs + 1, 0)').length).toBe(1);
    expect(diagnostics('devoirs != null && devoirs > 3')).toEqual([]);
    expect(diagnostics('devoirs == null || devoirs > 3')).toEqual([]);
    expect(diagnostics('if(is_null(ecue.note), 0, ecue.note * 2)')).toEqual([]);
    expect(diagnostics('if(!(is_null(devoirs) || is_null(ecue.note)), devoirs + ecue.note, 0)')).toEqual([]);
    expect(diagnostics('if(is_null(devoirs) && true, 0, devoirs + 1)').length).toBe(1); // && ne prouve rien côté « faux »
    expect(diagnostics('if(is_null(period("S1").average), 0, period("S1").average + 1)')).toEqual([]);
    expect(diagnostics('if(devoirs == null, 0, -devoirs)')).toEqual([]);
  });

  it('champs et clés inconnus', () => {
    const d = first('ecue.notes');
    expect(d.code).toBe('CHAMP_INCONNU');
    expect(d.hint).toBe('Vouliez-vous dire « note » ?');
    expect(first('ecue.zzzzzzz').hint).toMatch(/Champs disponibles : note, credits/);
    expect(first('period("S3").average').code).toBe('CLE_INCONNUE');
    expect(first('period("S3").average').hint).toBe('Vouliez-vous dire « S1 » ?');
    expect(first('period("XYZ").average').hint).toMatch(/Clés disponibles : S1, S2/);
    expect(first('period("S11").average').hint).toBe('Vouliez-vous dire « S1 » ?');
    expect(first('period(1)').message).toContain('doit être un texte');
    expect(first('examen.x').message).toContain('Impossible de lire le champ');
    expect(first('notes.x').message).toContain('pas un objet');
    expect(first('period("S1").average.x').code).toBe('TYPE_INCOMPATIBLE');
  });

  it('constructor, __proto__, toString… ne sont pas des champs', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
      expect(first(`ecue.${name}`).code).toBe('CHAMP_INCONNU');
      expect(first(name).code).toBe('NOM_INCONNU');
    }
  });

  it('résultat : doit être un scalaire du type attendu', () => {
    expect(first('notes').code).toBe('TYPE_RESULTAT_INVALIDE');
    expect(first('ecue').code).toBe('TYPE_RESULTAT_INVALIDE');
    expect(first('null').code).toBe('TYPE_RESULTAT_INVALIDE');
    expect(() => compile('examen > 3', SCHEMA, { expect: 'number' })).toThrowError(/devrait être de type nombre/);
    expect(() => compile('avg(notes)', SCHEMA, { expect: 'number' })).toThrowError(/devrait être de type nombre, mais la règle produit : nombre \(peut être absent\)/);
    expect(validate('avg(notes)', SCHEMA, { expect: 'number' }).diagnostics[0]?.hint).toMatch(/Utilisez coalesce/);
    expect(compile('avg(notes)', SCHEMA, { expect: 'number?' }).resultType).toEqual({ type: 'number', nullable: true });
    expect(compile('"x"', SCHEMA, { expect: 'string' }).resultType.type).toBe('string');
    expect(compile('true', SCHEMA, { expect: 'boolean?' }).resultType.type).toBe('boolean');
    expect(() => compile('1', SCHEMA, { expect: 'string' })).toThrowError(RuleCheckError);
  });

  it('plusieurs erreurs sont remontées ensemble, avec le compteur dans le message', () => {
    const r = validate('inconnu1 + inconnu2 + foo(1)', SCHEMA);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.length).toBe(3);
    try {
      compile('inconnu1 + inconnu2', SCHEMA);
      throw new Error('devait lever');
    } catch (e) {
      expect(e).toBeInstanceOf(RuleCheckError);
      expect((e as RuleCheckError).diagnostics.length).toBe(2);
      expect((e as RuleCheckError).message).toContain('[+1 autre(s) erreur(s)]');
      expect((e as RuleError).toJSON()).toMatchObject({ name: 'RuleCheckError', code: 'NOM_INCONNU', phase: 'check' });
      expect((e as RuleError).toDiagnostic().message).toContain('[+1 autre(s) erreur(s)]');
    }
  });

  it('plafonne le nombre de diagnostics', () => {
    const src = Array.from({ length: 40 }, (_, i) => `zz${i}`).join(' + ');
    expect(validate(src, SCHEMA).diagnostics.length).toBe(20);
  });

  it('RuleCheckError exige au moins un diagnostic', () => {
    expect(() => new RuleCheckError([])).toThrowError(/au moins un diagnostic/);
  });
});

describe('schéma invalide', () => {
  const bad = (schema: unknown, re: RegExp) => {
    expect(() => compile('1', schema)).toThrowError(RuleSchemaError);
    expect(() => compile('1', schema)).toThrowError(re);
    const r = validate('1', schema);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe('SCHEMA_INVALIDE');
  };

  it('refuse les noms interdits et mal formés', () => {
    bad({ variables: { constructor: 'number' } }, /interdit/);
    bad({ variables: { prototype: 'number' } }, /interdit/);
    bad({ variables: { __x: 'number' } }, /interdit/);
    bad({ variables: { '1abc': 'number' } }, /identifiant valide/);
    bad({ variables: { true: 'number' } }, /mot réservé/);
    bad({ variables: { o: { object: { toString: 'number' } } } }, /interdit/);
    bad({ variables: JSON.parse('{"__proto__": "number"}') }, /__proto__/);
    bad({ variables: { o: { object: JSON.parse('{"__proto__": "number"}') } } }, /__proto__/);
    bad({ variables: {}, lookups: { avg: { value: 'number' } } }, /nom d'une fonction/);
    bad({ variables: {}, lookups: { constructor: { value: 'number' } } }, /interdit/);
  });

  it('refuse les structures inattendues', () => {
    bad({ variables: { a: 'integer' } }, /./);
    bad({ variables: {}, extra: 1 }, /./);
    bad('pas un objet', /./);
    bad({ variables: { a: { list: 'number', foo: 1 } } }, /./);
  });

  it('refuse les types trop imbriqués', () => {
    let t: unknown = 'number';
    for (let i = 0; i < 12; i++) t = { list: t };
    bad({ variables: { a: t } }, /trop profonde/);
  });

  it('refuse un objet à trop de champs', () => {
    const fields: Record<string, string> = {};
    for (let i = 0; i < 201; i++) fields[`f${i}`] = 'number';
    bad({ variables: { o: { object: fields } } }, /trop de champs/);
  });
});

describe('erreurs d\'évaluation (typées, avec position)', () => {
  const ctx = (variables: Record<string, unknown>, extra: Partial<EvalContext> = {}): EvalContext => ({ variables, ...extra });
  const base = { devoirs: 10, examen: 12, titre: 't', actif: true, notes: [1, 2], ecue: { note: 1, credits: 2 }, optObj: null, optList: null };

  it('division par zéro avec position du diviseur', () => {
    try {
      evaluate(compile('examen / (examen - 12)', SCHEMA, {}), ctx({ ...base }));
      throw new Error('devait lever');
    } catch (e) {
      expect(e).toBeInstanceOf(RuleEvaluationError);
      const err = e as RuleEvaluationError;
      expect(err.code).toBe('DIVISION_PAR_ZERO');
      expect(err.phase).toBe('evaluation');
      expect(err.position).toMatchObject({ line: 1, column: 11 });
      expect(err.hint).toMatch(/Testez le diviseur/);
    }
    expect(() => evaluate(compile('examen % 0', SCHEMA), ctx({ ...base }))).toThrowError(/Modulo par zéro/);
  });

  it('donnée manquante ou nulle pour une donnée obligatoire', () => {
    const c = compile('examen + 1', SCHEMA);
    expect(() => evaluate(c, ctx({}))).toThrowError(/La donnée « examen » est absente alors qu'elle est obligatoire/);
    expect(() => evaluate(c, ctx({ examen: null }))).toThrowError(/obligatoire/);
    expect(() => evaluate(c, {})).toThrowError(RuleEvaluationError);
    try {
      evaluate(c, ctx({}));
    } catch (e) {
      expect((e as RuleEvaluationError).code).toBe('DONNEE_MANQUANTE');
    }
    try {
      evaluate(c, ctx({ examen: null }));
    } catch (e) {
      expect((e as RuleEvaluationError).code).toBe('VALEUR_ABSENTE');
    }
  });

  it('donnée du mauvais type', () => {
    expect(() => evaluate(compile('examen', SCHEMA), ctx({ examen: 'abc' }))).toThrowError(/devrait être un nombre fini \(reçu : le texte "abc"\)/);
    expect(() => evaluate(compile('examen', SCHEMA), ctx({ examen: Infinity }))).toThrowError(/nombre fini/);
    expect(() => evaluate(compile('examen', SCHEMA), ctx({ examen: NaN }))).toThrowError(/nombre fini/);
    expect(() => evaluate(compile('examen', SCHEMA), ctx({ examen: '1e5' }))).toThrowError(/nombre fini/);
    expect(() => evaluate(compile('examen', SCHEMA), ctx({ examen: {} }))).toThrowError(/un objet/);
    expect(() => evaluate(compile('examen', SCHEMA), ctx({ examen: [1] }))).toThrowError(/une liste/);
    expect(() => evaluate(compile('examen', SCHEMA), ctx({ examen: true }))).toThrowError(/le booléen true/);
    expect(() => evaluate(compile('examen', SCHEMA), ctx({ examen: Symbol('x') }))).toThrowError(/symbol/);
    expect(() => evaluate(compile('titre', SCHEMA), ctx({ titre: 5 }))).toThrowError(/devrait être un texte/);
    expect(() => evaluate(compile('actif', SCHEMA), ctx({ actif: 'oui' }))).toThrowError(/devrait être un booléen/);
    expect(() => evaluate(compile('len(notes)', SCHEMA), ctx({ notes: 5 }))).toThrowError(/devrait être une liste/);
    expect(() => evaluate(compile('ecue.credits', SCHEMA), ctx({ ecue: 5 }))).toThrowError(/devrait être un objet/);
    expect(() => evaluate(compile('ecue.credits', SCHEMA), ctx({ ecue: [] }))).toThrowError(/devrait être un objet/);
    expect(() => evaluate(compile('examen', SCHEMA), ctx({ examen: 'x'.repeat(30) }))).toThrowError(/…/);
  });

  it('objet à prototype personnalisé ou accesseur refusés', () => {
    class Evil {
      credits = 1;
    }
    expect(() => evaluate(compile('ecue.credits', SCHEMA), ctx({ ecue: new Evil() }))).toThrowError(/objet simple/);
    const withGetter = {
      get credits() {
        throw new Error('getter exécuté !');
      },
    };
    expect(() => evaluate(compile('ecue.credits', SCHEMA), ctx({ ecue: withGetter }))).toThrowError(/accesseur/);
    const nullProto = Object.assign(Object.create(null) as object, { credits: 3 });
    expect(evaluate(compile('ecue.credits', SCHEMA), ctx({ ecue: nullProto })).json).toBe('3');
  });

  it('élément de liste du mauvais type ou absent', () => {
    expect(() => evaluate(compile('sum(notes)', SCHEMA), ctx({ notes: [1, 'x'] }))).toThrowError(/notes\[1\]/);
    const s2: RuleSchemaSpec = { variables: { n: { list: 'number' } } };
    expect(() => evaluate(compile('sum(n)', s2), ctx({ n: [1, null] }))).toThrowError(/n\[1\]/);
  });

  it('recherche sans donnée', () => {
    const c = compile('period("S1").average', { ...SCHEMA, lookups: { period: { keys: ['S1'], value: { object: { average: 'number' } } } } });
    expect(() => evaluate(c, {})).toThrowError(/period\("S1"\)/);
    expect(() => evaluate(c, { lookups: { period: {} } })).toThrowError(/absente/);
    expect(() => evaluate(c, { lookups: { period: 5 as unknown as Record<string, unknown> } })).toThrowError(/absente/);
    expect(evaluate(c, { lookups: { period: { S1: { average: 12 } } } }).json).toBe('12');
    // valeur nullable : renvoie null au lieu de lever
    const nullable = compile('is_null(period("S1"))', { variables: {}, lookups: { period: { value: { object: { average: 'number' }, nullable: true } } } });
    expect(evaluate(nullable, {}).json).toBe(true);
  });

  it('règle non produite par compile() refusée', () => {
    const fake = { source: '1', ast: { t: 'number', value: '1', start: 0, end: 1, height: 1 } } as never;
    expect(() => evaluate(fake, {})).toThrowError(/Règle non reconnue/);
  });

  it('budget invalide refusé', () => {
    const c = compile('1', SCHEMA);
    expect(() => evaluate(c, {}, { budget: { maxNodes: 0 } })).toThrowError(/maxNodes/);
    expect(() => evaluate(c, {}, { budget: { maxNodes: 1.5 } })).toThrowError(/maxNodes/);
    expect(() => evaluate(c, {}, { budget: { maxTraceEntries: -1 } })).toThrowError(/maxTraceEntries/);
    expect(() => evaluate(c, {}, { budget: { maxMillis: 0 } })).toThrowError(/maxMillis/);
  });

  it('les erreurs sont sérialisables', () => {
    try {
      evaluate(compile('1 / 0', SCHEMA), {});
    } catch (e) {
      const json = JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
      expect(json).toMatchObject({ name: 'RuleEvaluationError', code: 'DIVISION_PAR_ZERO', phase: 'evaluation' });
      expect(e).toBeInstanceOf(RuleError);
      expect((e as Error).name).toBe('RuleEvaluationError');
    }
    try {
      compile('(', SCHEMA);
    } catch (e) {
      expect(e).toBeInstanceOf(RuleSyntaxError);
    }
  });
});
