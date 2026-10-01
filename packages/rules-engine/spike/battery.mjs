// Batterie de tests du spike ADR-003.
// Chaque cas fournit une expression par famille : 'cel' (flottants), 'cel-dec' (type Decimal), 'jsonata', 'custom'.
// expr === null  => non exprimable dans ce langage (c'est une information : par construction).
// expr peut être une fonction (génère les entrées pathologiques dans le worker).

export const CTX = {
  devoirs: 11.25,
  examen: 9,
  s1: 12.5,
  s2: 14.1,
  period: { S1: { average: 12.5 }, S2: { average: 14.1 } },
  a: { b: 1 },
  s: 'x',
};

const nest = (n, open, close, core) => open.repeat(n) + core + close.repeat(n);
const chain = (n) => Array.from({ length: n }, () => '1').join('+');

const ten = '[1,2,3,4,5,6,7,8,9,10]';
// 10^9 itérations imbriquées : doit être arrêté par un budget, sinon « hang »
const celBlowup = () => {
  let e = 'a+b+c+d+e+f+g+h+i';
  const vars = ['i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
  for (const v of vars) e = `${ten}.map(${v}, ${e})`;
  return e;
};
const jsonataBlowup = () => {
  let e = '$a+$b+$c+$d+$e+$f+$g+$h+$i';
  const vars = ['i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
  for (const v of vars) e = `$map([1,2,3,4,5,6,7,8,9,10], function($${v}){ ${e} })`;
  return e;
};

export const CASES = [
  /* ---------- F : formules réelles (exactitude) ---------- */
  {
    id: 'F1', cat: 'F', desc: 'Note ECUE = devoirs*0,4 + examen*0,6  (attendu 9.9)', expect: '9.9',
    expr: {
      cel: 'devoirs * 0.4 + examen * 0.6',
      'cel-dec': 'dec("0.4") * devoirs + dec("0.6") * examen',
      jsonata: 'devoirs * 0.4 + examen * 0.6',
      custom: 'devoirs * 0.4 + examen * 0.6',
    },
  },
  {
    id: 'F2', cat: 'F', desc: 'Moyenne annuelle arrondie = round_half_up((S1+2*S2)/3, 2)  (attendu 13.57)', expect: '13.57',
    expr: {
      cel: 'round_half_up((period.S1.average + 2.0 * period.S2.average) / 3.0, 2)',
      'cel-dec': 'round_half_up((period.S1.average + dec(2) * period.S2.average) / dec(3), 2)',
      jsonata: '$round_half_up((period.S1.average + 2 * period.S2.average) / 3, 2)',
      custom: 'round_half_up((period("S1").average + 2 * period("S2").average) / 3, 2)',
    },
  },

  /* ---------- D : arithmétique décimale ---------- */
  {
    id: 'D1', cat: 'D', desc: '0.1 + 0.2 == 0.3  (attendu true)', expect: 'true',
    expr: { cel: '0.1 + 0.2 == 0.3', 'cel-dec': 'dec("0.1") + dec("0.2") == dec("0.3")', jsonata: '0.1 + 0.2 = 0.3', custom: '0.1 + 0.2 == 0.3' },
  },
  {
    id: 'D2', cat: 'D', desc: 'round_half_up(9.995, 2)  (attendu 10)', expect: '10',
    expr: {
      cel: 'round_half_up(9.995, 2)', 'cel-dec': 'round_half_up(dec("9.995"), 2)',
      jsonata: '$round_half_up(9.995, 2)', custom: 'round_half_up(9.995, 2)',
    },
  },
  {
    id: 'D3', cat: 'D', desc: 'Seuil : 0.7 + 0.1 >= 0.8  (attendu true)', expect: 'true',
    expr: { cel: '0.7 + 0.1 >= 0.8', 'cel-dec': 'dec("0.7") + dec("0.1") >= dec("0.8")', jsonata: '0.7 + 0.1 >= 0.8', custom: '0.7 + 0.1 >= 0.8' },
  },
  {
    id: 'D4', cat: 'D', desc: 'Calcul calculé puis arrondi : round_half_up(1.1*1.1*1.1*1.1*1.1*1.1*1.1*1.1, 4)  (attendu 2.1436)', expect: '2.1436',
    expr: {
      cel: 'round_half_up(1.1*1.1*1.1*1.1*1.1*1.1*1.1*1.1, 4)',
      'cel-dec': 'round_half_up(dec("1.1")*dec("1.1")*dec("1.1")*dec("1.1")*dec("1.1")*dec("1.1")*dec("1.1")*dec("1.1"), 4)',
      jsonata: '$round_half_up(1.1*1.1*1.1*1.1*1.1*1.1*1.1*1.1, 4)',
      custom: 'round_half_up(1.1*1.1*1.1*1.1*1.1*1.1*1.1*1.1, 4)',
    },
  },
  {
    id: 'D5', cat: 'D', desc: 'Seuil de validation sur valeur non arrondie : 9.995 >= 10  (attendu false)', expect: 'false',
    expr: { cel: '9.995 >= 10.0', 'cel-dec': 'dec("9.995") >= dec(10)', jsonata: '9.995 >= 10', custom: '9.995 >= 10' },
  },
  {
    id: 'D6', cat: 'D', desc: 'Seuil exact : 0.4*12.5 + 0.6*8.3333333333333333 >= 10 ? (exact = 9.99999999999999998 => false)', expect: 'false',
    expr: {
      cel: '0.4 * 12.5 + 0.6 * 8.3333333333333333 >= 10.0',
      'cel-dec': 'dec("0.4") * dec("12.5") + dec("0.6") * dec("8.3333333333333333") >= dec(10)',
      jsonata: '0.4 * 12.5 + 0.6 * 8.3333333333333333 >= 10',
      custom: '0.4 * 12.5 + 0.6 * 8.3333333333333333 >= 10',
    },
  },

  /* ---------- T : terminaison / déni de service ---------- */
  {
    id: 'T1', cat: 'T', desc: 'Récursion infinie  f() = f()',
    expr: { cel: null, 'cel-dec': null, jsonata: '($f := function(){ $f() }; $f())', custom: null },
  },
  {
    id: 'T2', cat: 'T', desc: 'Boucle récursive terminale de 10^9 itérations (récursion « bornée » mais énorme)',
    expr: { cel: null, 'cel-dec': null, jsonata: '($l := function($n){ $n = 0 ? 0 : $l($n-1) }; $l(1000000000))', custom: null },
  },
  {
    id: 'T3', cat: 'T', desc: 'Imbrication de 5 000 parenthèses',
    expr: { cel: () => nest(5000, '(', ')', '1'), 'cel-dec': () => nest(5000, '(', ')', '1'), jsonata: () => nest(5000, '(', ')', '1'), custom: () => nest(5000, '(', ')', '1') },
  },
  {
    id: 'T4', cat: 'T', desc: 'Imbrication de 200 000 parenthèses (pile du parseur)',
    expr: { cel: () => nest(200000, '(', ')', '1'), 'cel-dec': () => nest(200000, '(', ')', '1'), jsonata: () => nest(200000, '(', ')', '1'), custom: () => nest(200000, '(', ')', '1') },
  },
  {
    id: 'T5', cat: 'T', desc: 'Chaîne de 200 000 additions 1+1+1+…',
    expr: { cel: () => chain(200000), 'cel-dec': () => chain(200000).replace(/1/g, 'dec(1)'), jsonata: () => chain(200000), custom: () => chain(200000) },
  },
  {
    id: 'T6', cat: 'T', desc: '9 comprehensions imbriquées de 10 éléments (10^9 évaluations)',
    expr: { cel: celBlowup, 'cel-dec': null, jsonata: jsonataBlowup, custom: null },
  },
  {
    id: 'T7', cat: 'T', desc: 'ReDoS : (a+)+$ sur « aaaa…ab » (38 a)', ctx: { s: 'a'.repeat(38) + 'b' },
    expr: { cel: 's.matches("(a+)+$")', 'cel-dec': 's.matches("(a+)+$")', jsonata: '$match(s, /(a+)+$/)', custom: null },
  },

  /* ---------- E : évasions / isolation ---------- */
  { id: 'E1', cat: 'E', desc: 'a.constructor', expr: { cel: 'a.constructor', 'cel-dec': 'a.constructor', jsonata: 'a.constructor', custom: 'a.constructor' } },
  { id: 'E2', cat: 'E', desc: 'a.__proto__', expr: { cel: 'a.__proto__', 'cel-dec': 'a.__proto__', jsonata: 'a.__proto__', custom: 'a.__proto__' } },
  {
    id: 'E3', cat: 'E', desc: 'a.constructor.constructor("return process")()',
    expr: {
      cel: 'a.constructor.constructor("return process")()', 'cel-dec': 'a.constructor.constructor("return process")()',
      jsonata: 'a.constructor.constructor("return process")()', custom: 'a.constructor.constructor("return process")()',
    },
  },
  { id: 'E4', cat: 'E', desc: 'process.versions (nom global)', expr: { cel: 'process.versions', 'cel-dec': 'process.versions', jsonata: 'process.versions', custom: 'process.versions' } },
  { id: 'E5', cat: 'E', desc: 'globalThis', expr: { cel: 'globalThis', 'cel-dec': 'globalThis', jsonata: 'globalThis', custom: 'globalThis' } },
  { id: 'E6', cat: 'E', desc: 'a.hasOwnProperty / a.toString (méthodes héritées)', expr: { cel: 'a.toString', 'cel-dec': 'a.toString', jsonata: 'a.toString', custom: 'a.toString' } },
  {
    id: 'E7', cat: 'E', desc: 'Pollution de prototype : {"__proto__": {"polluted": 1}}',
    expr: {
      cel: '{"__proto__": {"polluted": 1}}', 'cel-dec': '{"__proto__": {"polluted": 1}}',
      jsonata: '{"__proto__": {"polluted": 1}}', custom: null,
    },
  },
  { id: 'E8', cat: 'E', desc: 'Évaluation dynamique de chaîne ($eval)', expr: { cel: null, 'cel-dec': null, jsonata: '$eval("1+1")', custom: null } },
  { id: 'E9', cat: 'E', desc: '$lookup(a, "constructor")', expr: { cel: null, 'cel-dec': null, jsonata: '$lookup(a, "constructor")', custom: null } },

  /* ---------- N : déterminisme ---------- */
  { id: 'N1', cat: 'N', desc: 'Horloge : now() / $now() / $millis()', expr: { cel: 'now()', 'cel-dec': 'now()', jsonata: '$now()', custom: 'now()' } },
  { id: 'N2', cat: 'N', desc: 'Aléa : $random() / random()', expr: { cel: 'random()', 'cel-dec': 'random()', jsonata: '$random()', custom: 'random()' } },

  /* ---------- V : vérification à la publication ---------- */
  { id: 'V1', cat: 'V', desc: 'Nom inconnu : inconnue + 1', expr: { cel: 'inconnue + 1.0', 'cel-dec': 'inconnue + dec(1)', jsonata: 'inconnue + 1', custom: 'inconnue + 1' } },
  { id: 'V2', cat: 'V', desc: 'Erreur de type : devoirs + "abc"', expr: { cel: 'devoirs + "abc"', 'cel-dec': 'devoirs + "abc"', jsonata: 'devoirs + "abc"', custom: 'devoirs + "abc"' } },
  { id: 'V3', cat: 'V', desc: 'Fonction inconnue : foo(1)', expr: { cel: 'foo(1.0)', 'cel-dec': 'foo(dec(1))', jsonata: '$foo(1)', custom: 'foo(1)' } },
  { id: 'V4', cat: 'V', desc: 'Arité : clamp(1)', expr: { cel: 'clamp(1.0)', 'cel-dec': 'clamp(dec(1))', jsonata: '$clamp(1)', custom: 'clamp(1)' } },
  { id: 'V5', cat: 'V', desc: 'Syntaxe : (1 +', expr: { cel: '(1 +', 'cel-dec': '(1 +', jsonata: '(1 +', custom: '(1 +' } },
  { id: 'V6', cat: 'V', desc: 'Faute de frappe de champ : period.S1.averge', expr: { cel: 'period.S1.averge', 'cel-dec': 'period.S1.averge', jsonata: 'period.S1.averge', custom: 'period("S1").averge' } },
  { id: 'V7', cat: 'V', desc: 'Division par zéro : 1 / 0', expr: { cel: '1.0 / 0.0', 'cel-dec': 'dec(1) / dec(0)', jsonata: '1 / 0', custom: '1 / 0' } },
];

export function resolveExpr(testCase, adapter) {
  const e = testCase.expr[adapter.family];
  if (e === undefined) return undefined;
  if (e === null) return null;
  return typeof e === 'function' ? e() : e;
}
