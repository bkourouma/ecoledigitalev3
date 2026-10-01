import { student } from "./helpers";
import { defineScenario, type ClassicSetup, type ClassicStep } from "./types";

/**
 * (c, quirks) La pile classique devine le « deuxième semestre » d'après le NOM de la période et la « 2e année de BTS » d'après le
 * NOM de la classe. Ce scénario fige ce qui se passe quand les noms ne suivent pas la convention attendue.
 *
 *   Périodes : « S1 » et « S2 » (le deuxième semestre n'est pas reconnu -> pas de formule (S1+2·S2)/3) ;
 *              « Deuxième semestre » (reconnu, mais le premier semestre est alors cherché par nom « SEMESTRE 1 », absent, puis
 *              remplacé par la période PRÉCÉDENTE dans l'ordre chronologique : ici « S2 », pas « S1 »).
 *   Classes   : « BTS 2 Gestion » et « BTS Deuxième année Compta » sont reconnues ; « BTS2 Info » ne l'est pas (pas de frontière de mot) ;
 *              « BTS 1 Gestion » est la 1re année.
 */

type Avg = ClassicSetup["averages"][number];
const CLASSES = ["bts2g", "bts2c", "bts2i", "bts1g"] as const;

function twoStudents(cls: string, a: string, b: string): Avg[] {
  const rows: [string, string, number][] = [
    // [période, élève, moyenne]
    ["S1", a, 14], ["S2", a, 16], ["D2", a, 12],
    ["S1", b, 6], ["S2", b, 7], ["D2", b, 5],
  ];
  return rows.flatMap(([period, who, value]) => [
    { class: cls, student: who, course: "MAT", period, value },
    { class: cls, student: who, course: "FRA", period, value },
  ]);
}

const setup: ClassicSetup = {
  academicYear: { name: "2025-2026", start: "2025-09-15", end: "2026-07-31" },
  programme: { key: "nom", name: "Programme nommage", code: "NOM" },
  periods: [
    { key: "S1", name: "S1", start: "2025-09-15", end: "2026-01-31", role: "first-semester" },
    { key: "S2", name: "S2", start: "2026-02-01", end: "2026-02-28", role: "second-semester" },
    { key: "D2", name: "Deuxième semestre", start: "2026-03-01", end: "2026-07-31", role: "second-semester" },
  ],
  courses: [
    { key: "MAT", code: "MAT", name: "Mathématiques", coefficient: 2, section: "Bilan" },
    { key: "FRA", code: "FRA", name: "Français", coefficient: 1, section: "Bilan" },
  ],
  classes: [
    { key: "bts2g", name: "BTS 2 Gestion", students: ["g1", "g2"], finalYearBts: true },
    { key: "bts2c", name: "BTS Deuxième année Compta", students: ["c1", "c2"], finalYearBts: true },
    { key: "bts2i", name: "BTS2 Info", students: ["i1", "i2"], finalYearBts: true },
    { key: "bts1g", name: "BTS 1 Gestion", students: ["p1", "p2"], finalYearBts: false },
  ],
  averages: [
    ...twoStudents("bts2g", "g1", "g2"),
    ...twoStudents("bts2c", "c1", "c2"),
    ...twoStudents("bts2i", "i1", "i2"),
    ...twoStudents("bts1g", "p1", "p2"),
  ],
};

const steps: ClassicStep[] = CLASSES.flatMap((cls) => [
  { do: "report", class: cls, period: "S2", label: `${cls} période « S2 »` } as ClassicStep,
  { do: "report", class: cls, period: "D2", label: `${cls} période « Deuxième semestre »` } as ClassicStep,
]);

export default defineScenario({
  meta: {
    name: "classique-nommage-periodes",
    title: "Pile classique : détection du 2e semestre et du BTS 2 par le nom (S1/S2, BTS2, Deuxième année)",
    description:
      "Quatre classes de deux élèves (un admis, un en échec) et trois périodes nommées « S1 », « S2 », « Deuxième semestre ». Montre que la formule " +
      "(S1+2·S2)/3, le premier semestre de référence et la décision « Redouble en cas d'échec au BTS » dépendent de l'orthographe des noms.",
    slices: ["2.1", "2.4"],
    rules: [
      "Deuxième semestre = nom de période contenant « semestre 2 » ou « deuxième semestre » (accents et casse ignorés)",
      "Premier semestre = période dont le nom contient « semestre 1 », à défaut la période chronologiquement précédente",
      "BTS 2 = nom de classe contenant « BTS » et un « 2 » isolé ou « deuxième » ; au 2e semestre : « Redouble en cas d'échec au BTS » (le redoublement est alors signalé)",
    ],
  },
  tenant: { slug: "char-nommage", name: "Établissement de test nommage" },
  students: ["g1", "g2", "c1", "c2", "i1", "i2", "p1", "p2"].map((k) => student(k, k.toUpperCase(), "Nom")),
  teachers: [],
  classic: { setup, steps },
});
