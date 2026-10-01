import { describe, expect, it } from 'vitest';
import {
  RuleDefinitionSchema,
  RuleEvaluationError,
  RuleSchemaError,
  RuleSetSchema,
  RuleVersionSchema,
  assertTransition,
  canTransition,
  compileRule,
  contextWithParameters,
  effectiveRuleSchema,
  evaluate,
  findEffectiveOverlaps,
  isEffectiveOn,
  isValidIsoDate,
  nextStatuses,
  resolveRuleSet,
  type RuleDefinition,
  type RuleSet,
  type RuleStatus,
  type RuleVersion,
} from '../src';
import { makeVersion } from './fixtures/rulesets';

const rule = (over: Partial<RuleDefinition> = {}): RuleDefinition => ({
  key: 'moyenne',
  type: 'period_average',
  expression: 'wavg(notes, coefs)',
  inputSchema: { variables: { notes: { list: 'number?' }, coefs: { list: 'number' } } },
  ...over,
});

const ver = (id: string, over: Partial<RuleVersion> = {}, setId = 'rs'): RuleVersion =>
  makeVersion({ id, ruleSetId: setId, rules: [rule()], ...over });

const set = (over: Partial<RuleSet> & { id: string; versions: RuleVersion[] }): RuleSet =>
  RuleSetSchema.parse({ code: 'BTS_LMD', name: 'Jeu', scope: { kind: 'national' }, countryCode: 'CI', ...over });

describe('dates calendaires', () => {
  it('valide AAAA-MM-JJ avec jours réels', () => {
    for (const d of ['2024-09-01', '2024-02-29', '2000-02-29', '2023-12-31']) expect(isValidIsoDate(d)).toBe(true);
    for (const d of ['2023-02-29', '1900-02-29', '2024-13-01', '2024-00-10', '2024-04-31', '2024-9-1', '01/09/2024', '', '2024-01-00'])
      expect(isValidIsoDate(d)).toBe(false);
  });
});

describe('schémas Zod du modèle', () => {
  it('RuleVersion valide : statuts, dates d\'effet, source', () => {
    const v = ver('v1', { status: 'draft', effectiveTo: '2025-08-31' });
    expect(v.status).toBe('draft');
    for (const status of ['draft', 'simulated', 'proposed', 'approved', 'published', 'retired'] as const) {
      expect(RuleVersionSchema.safeParse({ ...v, status }).success).toBe(true);
    }
    expect(RuleVersionSchema.safeParse({ ...v, status: 'active' }).success).toBe(false);
  });

  it('refuse effectiveTo avant effectiveFrom, dates invalides et clés de règle en double', () => {
    const v = ver('v1');
    expect(RuleVersionSchema.safeParse({ ...v, effectiveFrom: '2025-01-01', effectiveTo: '2024-12-31' }).success).toBe(false);
    expect(RuleVersionSchema.safeParse({ ...v, effectiveFrom: '2025-02-30' }).success).toBe(false);
    expect(RuleVersionSchema.safeParse({ ...v, rules: [rule(), rule()] }).success).toBe(false);
    expect(RuleVersionSchema.safeParse({ ...v, version: 0 }).success).toBe(false);
    expect(RuleVersionSchema.safeParse({ ...v, source: { kind: 'inconnue' } }).success).toBe(false);
    expect(RuleVersionSchema.safeParse({ ...v, unknownField: 1 }).success).toBe(false);
  });

  it('RuleSet : portée nationale ou établissement, pays ISO, cohérence des versions', () => {
    expect(RuleSetSchema.safeParse({ id: 's', code: 'X', name: 'n', scope: { kind: 'tenant', tenantId: 't1' }, countryCode: 'CI', versions: [] }).success).toBe(true);
    expect(RuleSetSchema.safeParse({ id: 's', code: 'X', name: 'n', scope: { kind: 'tenant' }, countryCode: 'CI', versions: [] }).success).toBe(false);
    expect(RuleSetSchema.safeParse({ id: 's', code: 'X', name: 'n', scope: { kind: 'national' }, countryCode: 'civ', versions: [] }).success).toBe(false);
    const v = ver('v1', {}, 'autre');
    expect(RuleSetSchema.safeParse({ id: 'rs', code: 'X', name: 'n', scope: { kind: 'national' }, countryCode: 'CI', versions: [v] }).success).toBe(false);
    const dup = [ver('a'), ver('b')];
    expect(RuleSetSchema.safeParse({ id: 'rs', code: 'X', name: 'n', scope: { kind: 'national' }, countryCode: 'CI', versions: dup }).success).toBe(false);
  });

  it('RuleDefinition : clé, type, paramètres cohérents', () => {
    expect(RuleDefinitionSchema.safeParse(rule()).success).toBe(true);
    expect(RuleDefinitionSchema.safeParse(rule({ key: 'Moyenne' })).success).toBe(false);
    expect(RuleDefinitionSchema.safeParse({ ...rule(), type: 'autre' }).success).toBe(false);
    const p = (parameters: unknown) => RuleDefinitionSchema.safeParse({ ...rule(), parameters }).success;
    expect(p({ seuil: { type: 'number', default: 10, min: 0, max: 20 } })).toBe(true);
    expect(p({ seuil: { type: 'number', default: '10' } })).toBe(false);
    expect(p({ seuil: { type: 'number', default: 30, max: 20 } })).toBe(false);
    expect(p({ seuil: { type: 'number', default: -1, min: 0 } })).toBe(false);
    expect(p({ nom: { type: 'string', default: 'a', min: 0 } })).toBe(false);
    expect(p({ actif: { type: 'boolean', default: true } })).toBe(true);
  });
});

describe('paramètres de règle', () => {
  const r1 = rule({
    key: 'seuil',
    expression: 'x >= params.seuil && params.actif',
    inputSchema: { variables: { x: 'number' } },
    parameters: {
      seuil: { type: 'number', default: 10, min: 0, max: 20 },
      actif: { type: 'boolean', default: true },
    },
    result: 'boolean',
  });

  it('expose params dans le schéma et fusionne les valeurs par défaut', () => {
    const spec = effectiveRuleSchema(r1);
    expect(spec.variables?.params).toEqual({ object: { seuil: 'number', actif: 'boolean' } });
    const c = compileRule(r1);
    expect(evaluate(c, contextWithParameters(r1, { variables: { x: 10 } })).json).toBe(true);
    expect(evaluate(c, contextWithParameters(r1, { variables: { x: 9.99 } })).json).toBe(false);
    expect(evaluate(c, contextWithParameters(r1, { variables: { x: 9.99 } }, { seuil: 9 })).json).toBe(true);
    expect(evaluate(c, contextWithParameters(r1, { variables: { x: 15 } }, { actif: false })).json).toBe(false);
  });

  it('ne modifie jamais le contexte fourni', () => {
    const ctx = Object.freeze({ variables: Object.freeze({ x: 1 }) });
    const merged = contextWithParameters(r1, ctx);
    expect(merged).not.toBe(ctx);
    expect((ctx.variables as Record<string, unknown>).params).toBeUndefined();
  });

  it('valide type et intervalle des surcharges', () => {
    expect(() => contextWithParameters(r1, {}, { seuil: 'dix' })).toThrowError(/doit être de type number/);
    expect(() => contextWithParameters(r1, {}, { seuil: 25 })).toThrowError(/hors de l'intervalle autorisé \[0 ; 20\]/);
    expect(() => contextWithParameters(r1, {}, { seuil: -1 })).toThrowError(RuleEvaluationError);
    const noMin = rule({ parameters: { p: { type: 'number', default: 1 } } });
    expect(() => contextWithParameters(noMin, {}, { p: 5 })).not.toThrow();
  });

  it('sans paramètre : contexte inchangé ; noms de paramètres interdits refusés', () => {
    const ctx = { variables: {} };
    expect(contextWithParameters(rule(), ctx)).toBe(ctx);
    expect(() => effectiveRuleSchema(rule({ parameters: JSON.parse('{"constructor": {"type": "number", "default": 1}}') as RuleDefinition['parameters'] }))).toThrowError(RuleSchemaError);
    expect(effectiveRuleSchema(rule(), { variables: { z: 'number' } }).variables).toEqual({ notes: { list: 'number?' }, coefs: { list: 'number' } });
    expect(effectiveRuleSchema({ ...rule(), inputSchema: undefined }, { variables: { z: 'number' } }).variables).toEqual({ z: 'number' });
    expect(effectiveRuleSchema({ ...rule(), inputSchema: undefined }).variables).toEqual({});
  });

  it('compileRule applique le type de résultat attendu', () => {
    expect(() => compileRule(rule({ result: 'string' }))).toThrowError(/devrait être de type texte/);
    expect(compileRule(rule({ result: 'number?' })).resultType.nullable).toBe(true);
  });
});

describe('resolveRuleSet : variante d\'établissement approuvée > national, selon la date d\'effet', () => {
  const national = set({
    id: 'nat',
    versions: [
      ver('nat-v1', { version: 1, status: 'published', effectiveFrom: '2023-09-01', effectiveTo: '2024-08-31' }, 'nat'),
      ver('nat-v2', { version: 2, status: 'published', effectiveFrom: '2024-09-01' }, 'nat'),
      ver('nat-v3', { version: 3, status: 'draft', effectiveFrom: '2025-09-01' }, 'nat'),
    ],
  });
  const variante = set({
    id: 'var-t1',
    scope: { kind: 'tenant', tenantId: 't1' },
    versions: [
      ver('var-v1', { version: 1, status: 'approved', effectiveFrom: '2024-10-01', effectiveTo: '2025-01-31' }, 'var-t1'),
      ver('var-v2', { version: 2, status: 'proposed', effectiveFrom: '2025-02-01' }, 'var-t1'),
    ],
  });
  const autreTenant = set({
    id: 'var-t2',
    scope: { kind: 'tenant', tenantId: 't2' },
    versions: [ver('t2-v1', { status: 'approved', effectiveFrom: '2024-01-01' }, 'var-t2')],
  });
  const all = [national, variante, autreTenant];
  const q = (date: string, extra: object = {}) => ({ tenantId: 't1', countryCode: 'CI', date, ...extra });

  it('la variante approuvée de l\'établissement l\'emporte pendant sa période', () => {
    const res = resolveRuleSet(all, q('2024-11-15'));
    expect(res?.origin).toBe('tenant');
    expect(res?.version.id).toBe('var-v1');
  });

  it('hors période de la variante : retour au national en vigueur', () => {
    expect(resolveRuleSet(all, q('2024-09-15'))?.version.id).toBe('nat-v2');
    expect(resolveRuleSet(all, q('2025-03-01'))?.version.id).toBe('nat-v2'); // var-v2 seulement « proposed »
    expect(resolveRuleSet(all, q('2024-02-01'))?.version.id).toBe('nat-v1');
  });

  it('bornes de période inclusives', () => {
    expect(resolveRuleSet(all, q('2024-10-01'))?.version.id).toBe('var-v1');
    expect(resolveRuleSet(all, q('2025-01-31'))?.version.id).toBe('var-v1');
    expect(resolveRuleSet(all, q('2025-02-01'))?.version.id).toBe('nat-v2');
    expect(resolveRuleSet(all, q('2024-08-31'))?.version.id).toBe('nat-v1');
    expect(resolveRuleSet(all, q('2024-09-01'))?.version.id).toBe('nat-v2');
  });

  it('une variante d\'un autre établissement n\'est jamais candidate', () => {
    const res = resolveRuleSet(all, q('2024-06-01', { tenantId: 't3' }));
    expect(res?.origin).toBe('national');
    expect(res?.considered.every((c) => c.ruleSetId !== 'var-t2')).toBe(true);
    expect(resolveRuleSet(all, { countryCode: 'CI', date: '2024-11-15' })?.origin).toBe('national');
  });

  it('aucune version applicable : null', () => {
    expect(resolveRuleSet(all, q('2020-01-01'))).toBeNull();
    expect(resolveRuleSet(all, q('2024-11-15', { countryCode: 'SN' }))).toBeNull();
    expect(resolveRuleSet([], q('2024-11-15'))).toBeNull();
  });

  it('un national seulement « approved » n\'est pas actif ; un tenant « published » l\'est', () => {
    const nat = set({ id: 'n2', versions: [ver('n2-v1', { status: 'approved' }, 'n2')] });
    expect(resolveRuleSet([nat], q('2025-01-01'))).toBeNull();
    expect(resolveRuleSet([nat], q('2025-01-01'), { nationalActiveStatuses: ['approved', 'published'] })?.version.id).toBe('n2-v1');
    const ten = set({ id: 't9', scope: { kind: 'tenant', tenantId: 't1' }, versions: [ver('t9-v1', { status: 'published' }, 't9')] });
    expect(resolveRuleSet([ten], q('2025-01-01'))?.origin).toBe('tenant');
    expect(resolveRuleSet([ten], q('2025-01-01'), { tenantActiveStatuses: ['approved'] })).toBeNull();
  });

  it('explicabilité : liste des versions examinées avec la raison des écarts', () => {
    const res = resolveRuleSet(all, q('2024-11-15'));
    const byId = Object.fromEntries((res?.considered ?? []).map((c) => [c.versionId, c]));
    expect(byId['var-v1']?.eligible).toBe(true);
    expect(byId['var-v2']?.reason).toBe('statut « proposed » non actif');
    expect(byId['nat-v1']?.reason).toMatch(/hors période d'effet \(2023-09-01 → 2024-08-31\)/);
    expect(byId['nat-v3']?.reason).toBe('statut « draft » non actif');
    expect(byId['nat-v2']?.reason).toBeUndefined();
    expect(byId['nat-v2']?.eligible).toBe(true);
  });

  it('date invalide : erreur typée', () => {
    expect(() => resolveRuleSet(all, q('2024-02-30'))).toThrowError(RuleEvaluationError);
    expect(() => resolveRuleSet(all, q('hier'))).toThrowError(/Date d'effet invalide/);
  });

  it('critères pays / système éducatif / niveau / code, spécificité et départage déterministe', () => {
    const generic = set({ id: 'g', versions: [ver('g-v1', { status: 'published' }, 'g')] });
    const l1 = set({ id: 'l1', level: 'L1', educationSystem: 'HIGHER', versions: [ver('l1-v1', { status: 'published' }, 'l1')] });
    const l2 = set({ id: 'l2', level: 'L2', educationSystem: 'HIGHER', versions: [ver('l2-v1', { status: 'published' }, 'l2')] });
    const other = set({ id: 'o', code: 'CLASSIQUE', versions: [ver('o-v1', { status: 'published' }, 'o')] });
    const sets = [generic, l1, l2, other];
    const base = { countryCode: 'CI', date: '2025-01-01' };
    expect(resolveRuleSet(sets, { ...base, level: 'L1', educationSystem: 'HIGHER' })?.ruleSet.id).toBe('l1'); // plus spécifique
    expect(resolveRuleSet(sets, { ...base, level: 'L2', educationSystem: 'HIGHER' })?.ruleSet.id).toBe('l2');
    expect(resolveRuleSet(sets, { ...base, level: 'L3', educationSystem: 'HIGHER' })?.ruleSet.id).toBe('g'); // repli générique
    expect(resolveRuleSet(sets, { ...base, code: 'CLASSIQUE' })?.ruleSet.id).toBe('o');
    const info = resolveRuleSet(sets, { ...base, level: 'L1', educationSystem: 'HIGHER' })?.considered ?? [];
    expect(info.find((c) => c.versionId === 'l2-v1')?.reason).toBe('niveau différent');
    expect(info.find((c) => c.versionId === 'o-v1')?.eligible).toBe(true);
    const nope = resolveRuleSet(sets, { ...base, code: 'AUTRE' });
    expect(nope).toBeNull();
    const otherSys = set({ id: 'x', educationSystem: 'PRIMARY', versions: [ver('x-v1', { status: 'published' }, 'x')] });
    expect(resolveRuleSet([otherSys], { ...base, educationSystem: 'HIGHER' })).toBeNull();
  });

  it('départage : date d\'effet la plus récente, puis version la plus haute, puis id — indépendamment de l\'ordre d\'entrée', () => {
    const a = ver('aaa', { version: 1, effectiveFrom: '2024-01-01' }, 's');
    const b = ver('bbb', { version: 2, effectiveFrom: '2024-01-01' }, 's');
    const c = ver('ccc', { version: 3, effectiveFrom: '2023-01-01' }, 's');
    const s1 = set({ id: 's', versions: [a, b, c] });
    const s2 = set({ id: 's', versions: [c, b, a] });
    const query = { countryCode: 'CI', date: '2025-01-01' };
    expect(resolveRuleSet([s1], query)?.version.id).toBe('bbb');
    expect(resolveRuleSet([s2], query)?.version.id).toBe('bbb');
    // deux RuleSets, même version et même date : l'id le plus petit gagne
    const t1 = set({ id: 'z', versions: [ver('zzz', { version: 1 }, 'z')] });
    const t2 = set({ id: 'y', versions: [ver('yyy', { version: 1 }, 'y')] });
    expect(resolveRuleSet([t1, t2], query)?.version.id).toBe('yyy');
    expect(resolveRuleSet([t2, t1], query)?.version.id).toBe('yyy');
    // même date, version plus haute dans un autre RuleSet
    const t3 = set({ id: 'w', versions: [ver('www', { version: 5 }, 'w')] });
    expect(resolveRuleSet([t1, t3], query)?.version.id).toBe('www');
  });

  it('isEffectiveOn', () => {
    expect(isEffectiveOn({ effectiveFrom: '2024-01-01', effectiveTo: null }, '2030-01-01')).toBe(true);
    expect(isEffectiveOn({ effectiveFrom: '2024-01-01' }, '2023-12-31')).toBe(false);
    expect(isEffectiveOn({ effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' }, '2024-12-31')).toBe(true);
    expect(isEffectiveOn({ effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' }, '2025-01-01')).toBe(false);
  });
});

describe('findEffectiveOverlaps', () => {
  const mk = (id: string, version: number, from: string, to: string | null, status: RuleStatus = 'published') =>
    ver(id, { version, effectiveFrom: from, effectiveTo: to, status });

  it('détecte les chevauchements entre versions actives, fin incluse, périodes ouvertes comprises', () => {
    const s = set({
      id: 'rs',
      versions: [
        mk('a', 1, '2024-01-01', '2024-06-30'),
        mk('b', 2, '2024-06-30', '2024-12-31'), // chevauche a le 30/06
        mk('c', 3, '2025-01-01', null),
        mk('d', 4, '2026-01-01', null), // chevauche c, période ouverte
        mk('e', 5, '2024-03-01', '2024-04-01', 'draft'), // statut inactif : ignorée
      ],
    });
    const o = findEffectiveOverlaps(s);
    expect(o).toEqual([
      { a: { id: 'a', version: 1 }, b: { id: 'b', version: 2 }, from: '2024-06-30', to: '2024-06-30' },
      { a: { id: 'c', version: 3 }, b: { id: 'd', version: 4 }, from: '2026-01-01', to: null },
    ]);
  });

  it('aucune alerte pour des périodes jointives et pour des statuts inactifs', () => {
    const s = set({ id: 'rs', versions: [mk('a', 1, '2024-01-01', '2024-06-30'), mk('b', 2, '2024-07-01', null)] });
    expect(findEffectiveOverlaps(s)).toEqual([]);
    const s2 = set({ id: 'rs', versions: [mk('a', 1, '2024-01-01', null), mk('b', 2, '2024-02-01', null, 'proposed')] });
    expect(findEffectiveOverlaps(s2)).toEqual([]);
    expect(findEffectiveOverlaps(s2, ['published', 'proposed']).length).toBe(1);
    const s3 = set({ id: 'rs', versions: [mk('a', 1, '2024-01-01', '2024-12-31'), mk('b', 2, '2024-06-01', null)] });
    expect(findEffectiveOverlaps(s3)[0]?.to).toBe('2024-12-31');
  });
});

describe('gouvernance (D5) : draft → simulated → proposed → approved → published → retired', () => {
  const tenant = { kind: 'tenant', tenantId: 't1' } as const;
  const national = { kind: 'national' } as const;

  it('chaîne nominale d\'une variante d\'établissement', () => {
    expect(canTransition({ from: 'draft', to: 'simulated', scope: tenant, actor: 'tenant_admin' })).toEqual({ ok: true });
    expect(canTransition({ from: 'simulated', to: 'proposed', scope: tenant, actor: 'tenant_admin' })).toEqual({ ok: true });
    expect(canTransition({ from: 'proposed', to: 'approved', scope: tenant, actor: 'super_admin' })).toEqual({ ok: true });
    expect(canTransition({ from: 'approved', to: 'published', scope: tenant, actor: 'super_admin' })).toEqual({ ok: true });
    expect(canTransition({ from: 'published', to: 'retired', scope: tenant, actor: 'super_admin' })).toEqual({ ok: true });
  });

  it('on ne peut pas proposer sans simulation préalable', () => {
    const d = canTransition({ from: 'draft', to: 'proposed', scope: tenant, actor: 'tenant_admin' });
    expect(d).toEqual({ ok: false, reason: 'Transition interdite : draft -> proposed.' });
    expect(canTransition({ from: 'draft', to: 'approved', scope: tenant, actor: 'super_admin' }).ok).toBe(false);
    expect(canTransition({ from: 'draft', to: 'published', scope: national, actor: 'super_admin' }).ok).toBe(false);
  });

  it('l\'admin d\'établissement ne valide ni ne publie, et ne touche pas au national', () => {
    expect(canTransition({ from: 'proposed', to: 'approved', scope: tenant, actor: 'tenant_admin' })).toEqual({
      ok: false,
      reason: 'Seul le super-admin peut passer de proposed à approved.',
    });
    expect(canTransition({ from: 'approved', to: 'published', scope: tenant, actor: 'tenant_admin' }).ok).toBe(false);
    expect(canTransition({ from: 'draft', to: 'simulated', scope: national, actor: 'tenant_admin' })).toEqual({
      ok: false,
      reason: 'Un admin d\'établissement ne peut pas modifier un RuleSet national.',
    });
  });

  it('le super-admin publie le national ; rejet/retrait vers draft ; retired est terminal', () => {
    expect(canTransition({ from: 'draft', to: 'simulated', scope: national, actor: 'super_admin' }).ok).toBe(true);
    expect(canTransition({ from: 'proposed', to: 'draft', scope: tenant, actor: 'super_admin' }).ok).toBe(true);
    expect(canTransition({ from: 'proposed', to: 'draft', scope: tenant, actor: 'tenant_admin' }).ok).toBe(true);
    expect(canTransition({ from: 'simulated', to: 'draft', scope: tenant, actor: 'tenant_admin' }).ok).toBe(true);
    expect(canTransition({ from: 'approved', to: 'retired', scope: national, actor: 'super_admin' }).ok).toBe(true);
    expect(nextStatuses('retired')).toEqual([]);
    expect(nextStatuses('draft')).toEqual(['simulated']);
    expect(nextStatuses('published')).toEqual(['retired']);
    expect(canTransition({ from: 'retired', to: 'published', scope: national, actor: 'super_admin' }).ok).toBe(false);
  });

  it('assertTransition lève une erreur explicite', () => {
    expect(() => assertTransition({ from: 'draft', to: 'published', scope: tenant, actor: 'super_admin' })).toThrowError(/Transition interdite/);
    expect(() => assertTransition({ from: 'draft', to: 'simulated', scope: tenant, actor: 'tenant_admin' })).not.toThrow();
  });
});
