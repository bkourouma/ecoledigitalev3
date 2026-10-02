/**
 * Jeu de données de démonstration : une FONCTION PURE de (pack, graine, début d'année, slug).
 * Aucune horloge, aucun aléa non seedé : deux appels avec les mêmes paramètres rendent exactement le même objet.
 * Les noms sont fictifs (combinaisons ivoiriennes courantes) ; les e-mails sont sous `.test` (domaine réservé).
 */
import type { SeedPack } from "./guards";

/** PRNG mulberry32 : suite déterministe à partir d'un entier 32 bits. */
export function createPrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAST_NAMES = ["KOUASSI", "KONE", "TRAORE", "YAO", "KOFFI", "OUATTARA", "BAMBA", "DIALLO", "N'GUESSAN", "COULIBALY", "TOURE", "AKA", "DIABATE", "SANGARE", "GBAGBO", "ZADI", "BROU", "KOUAME", "SORO", "YEO"];
const FEMALE = ["Awa", "Mariam", "Aminata", "Fatou", "Adjoua", "Affoué", "Nadia", "Salimata", "Esther", "Rokia", "Aya", "Ruth"];
const MALE = ["Koffi", "Issa", "Yao", "Moussa", "Ibrahim", "Kouadio", "Séka", "Mamadou", "Elie", "Jean-Marc", "Seydou", "Franck"];

export interface PersonSeed {
  lastName: string;
  firstName: string;
  sex: "F" | "M";
  birthDate: string;
  birthPlace: string;
}
export interface StudentSeed extends PersonSeed {
  /** Index du tuteur (dans `guardians`). */
  guardian: number;
}
export interface GuardianSeed {
  lastName: string;
  firstName: string;
  sex: "F" | "M";
  email: string;
  phone: string;
}
export interface TeacherSeed {
  lastName: string;
  firstName: string;
  sex: "F" | "M";
  birthDate: string;
  email: string;
}
export interface SubjectSeed {
  code: string;
  label: string;
  coefficient: string;
  credits: string;
}

export interface SeedDataset {
  pack: SeedPack;
  seed: number;
  slug: string;
  tenantName: string;
  yearStart: string;
  yearEnd: string;
  yearCode: string;
  /** Plan de périodes de l'année. */
  periodPlan: "TWO_SEMESTERS" | "THREE_TERMS";
  /** Frais (XOF) : inscription (condition de confirmation) et scolarité. */
  registrationFee: number;
  tuitionFee: number;
  /** Codes de référence : niveau d'enseignement, niveau de classe, programme (null = programme créé par le seed). */
  educationLevelCode: string;
  gradeLevelCode: string;
  programCode: string;
  programLabel: string;
  classroomCode: string;
  classroomName: string;
  /** Matières ; en HIGHER, regroupées en deux UE de deux ECUE. */
  subjects: SubjectSeed[];
  students: StudentSeed[];
  guardians: GuardianSeed[];
  teachers: TeacherSeed[];
  /** Combien d'élèves (les premiers) règlent l'inscription : leur inscription est confirmée par l'événement de paiement. */
  paidCount: number;
  /** Comptes de test (e-mails) : le mot de passe est généré À L'EXÉCUTION, jamais ici. */
  accounts: { owner: string; directeur: string; pedagogie: string; enseignant: string; parent: string; eleve: string };
}

const day = 86_400_000;
export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * day).toISOString().slice(0, 10);
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Début d'année par défaut : le 1er septembre de l'année scolaire qui contient `today`. */
export function defaultYearStart(today: Date): string {
  const y = today.getUTCMonth() >= 7 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return `${y}-09-01`;
}

export interface BuildDatasetInput {
  pack: SeedPack;
  seed: number;
  slug: string;
  yearStart: string;
}

const PACK_PROFILE: Record<
  SeedPack,
  Pick<SeedDataset, "tenantName" | "periodPlan" | "registrationFee" | "tuitionFee" | "educationLevelCode" | "gradeLevelCode" | "programCode" | "programLabel" | "classroomCode" | "classroomName"> & { birthYear: number; birthSpread: number }
> = {
  HIGHER: {
    tenantName: "Université Horizon (démonstration)",
    periodPlan: "TWO_SEMESTERS",
    registrationFee: 50000,
    tuitionFee: 600000,
    educationLevelCode: "LICENCE",
    gradeLevelCode: "L1",
    programCode: "INFO",
    programLabel: "Informatique",
    classroomCode: "L1-A",
    classroomName: "Licence 1 A",
    birthYear: 2005,
    birthSpread: 2,
  },
  PRIMARY: {
    tenantName: "École primaire Les Palmiers (démonstration)",
    periodPlan: "THREE_TERMS",
    registrationFee: 15000,
    tuitionFee: 120000,
    educationLevelCode: "PRIMARY",
    gradeLevelCode: "CP1",
    programCode: "PRIMAIRE",
    programLabel: "Primaire",
    classroomCode: "CP1-A",
    classroomName: "CP1 A",
    birthYear: 2019,
    birthSpread: 1,
  },
  SECONDARY: {
    tenantName: "Collège Le Baobab (démonstration)",
    periodPlan: "THREE_TERMS",
    registrationFee: 25000,
    tuitionFee: 200000,
    educationLevelCode: "LOWER_SECONDARY",
    gradeLevelCode: "6E",
    programCode: "COLLEGE",
    programLabel: "Collège",
    classroomCode: "6E-A",
    classroomName: "6e A",
    birthYear: 2014,
    birthSpread: 1,
  },
};

const SUBJECTS: Record<SeedPack, SubjectSeed[]> = {
  HIGHER: [
    { code: "ALGO", label: "Algorithmique", coefficient: "2", credits: "3" },
    { code: "PROG", label: "Programmation", coefficient: "1.5", credits: "3" },
    { code: "MATH", label: "Mathématiques", coefficient: "2", credits: "4" },
    { code: "STAT", label: "Statistiques", coefficient: "1", credits: "2" },
  ],
  PRIMARY: [
    { code: "FRAN", label: "Français", coefficient: "3", credits: "0" },
    { code: "MATH", label: "Mathématiques", coefficient: "3", credits: "0" },
    { code: "EVEI", label: "Éveil", coefficient: "1", credits: "0" },
    { code: "EPS", label: "Éducation physique", coefficient: "1", credits: "0" },
  ],
  SECONDARY: [
    { code: "FRAN", label: "Français", coefficient: "3", credits: "0" },
    { code: "MATH", label: "Mathématiques", coefficient: "3", credits: "0" },
    { code: "ANG", label: "Anglais", coefficient: "2", credits: "0" },
    { code: "HG", label: "Histoire-Géographie", coefficient: "2", credits: "0" },
  ],
};

export const STUDENT_COUNT = 12;
export const TEACHER_COUNT = 3;

export function buildDataset(input: BuildDatasetInput): SeedDataset {
  const profile = PACK_PROFILE[input.pack];
  // Une graine par rubrique : modifier le nombre d'élèves ne décale pas les noms des enseignants.
  const rngStudents = createPrng(input.seed ^ 0x51ed);
  const rngGuardians = createPrng(input.seed ^ 0x6a2d);
  const rngTeachers = createPrng(input.seed ^ 0x7ea5);
  const pickFrom = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;

  // Noms uniques par construction : le couple (nom, prénom, naissance) ne se répète jamais (le module `people` refuse un doublon probable).
  const lastNames = [...LAST_NAMES];
  for (let i = lastNames.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rngStudents() * (i + 1));
    [lastNames[i], lastNames[j]] = [lastNames[j] as string, lastNames[i] as string];
  }
  const guardianCount = STUDENT_COUNT / 2;
  const guardians: GuardianSeed[] = [];
  for (let g = 0; g < guardianCount; g += 1) {
    const sex = rngGuardians() < 0.5 ? "F" : "M";
    const lastName = lastNames[g] as string;
    const firstName = pickFrom(rngGuardians, sex === "F" ? FEMALE : MALE);
    guardians.push({
      lastName,
      firstName,
      sex,
      email: g === 0 ? `parent@${input.slug}.test` : `tuteur${g + 1}@${input.slug}.test`,
      phone: `+225 07 ${String(10 + g).padStart(2, "0")} ${String(20 + g * 3).padStart(2, "0")} ${String(30 + g * 5).padStart(2, "0")} ${String(40 + g).padStart(2, "0")}`,
    });
  }

  const usedNames = new Set<string>(guardians.map((g) => `${g.lastName}|${g.firstName}`));
  const students: StudentSeed[] = [];
  for (let i = 0; i < STUDENT_COUNT; i += 1) {
    const guardian = Math.floor(i / 2); // deux enfants par tuteur (fratrie)
    const sex = rngStudents() < 0.5 ? "F" : "M";
    // Le module `people` signale un « doublon probable » dès que nom et prénom coïncident : aucun couple (nom, prénom) n'est réutilisé
    // entre les personnes du jeu (un enfant ne porte pas le prénom de son tuteur ni celui de son frère ou de sa sœur).
    const pool = sex === "F" ? FEMALE : MALE;
    const lastName = (guardians[guardian] as GuardianSeed).lastName;
    let firstName = pickFrom(rngStudents, pool);
    for (let k = 0; usedNames.has(`${lastName}|${firstName}`) && k < pool.length; k += 1) firstName = pool[(pool.indexOf(firstName) + 1) % pool.length] as string;
    usedNames.add(`${lastName}|${firstName}`);
    const month = 1 + Math.floor(rngStudents() * 12);
    const dayOfMonth = 1 + Math.floor(rngStudents() * 28);
    const year = profile.birthYear - Math.floor(rngStudents() * (profile.birthSpread + 1));
    students.push({
      // Fratrie : même nom que le tuteur ; l'index garantit l'unicité du couple avec le prénom, la date l'unicité du doublon.
      lastName: (guardians[guardian] as GuardianSeed).lastName,
      firstName,
      sex,
      birthDate: `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`,
      birthPlace: pickFrom(rngStudents, ["Abidjan", "Bouaké", "Yamoussoukro", "Daloa", "Korhogo", "San-Pédro"]),
      guardian,
    });
  }
  // Doublons probables (même nom + prénom + date) : on décale la date du second d'un jour jusqu'à unicité.
  const seen = new Set<string>();
  for (const s of students) {
    let date = s.birthDate;
    while (seen.has(`${s.lastName}|${s.firstName}|${date}`)) date = addDays(date, 1);
    s.birthDate = date;
    seen.add(`${s.lastName}|${s.firstName}|${date}`);
  }

  const teachers: TeacherSeed[] = [];
  for (let t = 0; t < TEACHER_COUNT; t += 1) {
    const sex = rngTeachers() < 0.5 ? "F" : "M";
    teachers.push({
      lastName: lastNames[guardianCount + t] as string,
      firstName: pickFrom(rngTeachers, sex === "F" ? FEMALE : MALE),
      sex,
      birthDate: `${1978 + t * 3}-0${4 + t}-1${t}`,
      email: t === 0 ? `enseignant@${input.slug}.test` : `enseignant${t + 1}@${input.slug}.test`,
    });
  }

  const yearEnd = addDays(`${Number(input.yearStart.slice(0, 4)) + 1}${input.yearStart.slice(4)}`, -1);
  return {
    pack: input.pack,
    seed: input.seed,
    slug: input.slug,
    tenantName: profile.tenantName,
    yearStart: input.yearStart,
    yearEnd,
    yearCode: `${input.yearStart.slice(0, 4)}-${Number(input.yearStart.slice(0, 4)) + 1}`,
    periodPlan: profile.periodPlan,
    registrationFee: profile.registrationFee,
    tuitionFee: profile.tuitionFee,
    educationLevelCode: profile.educationLevelCode,
    gradeLevelCode: profile.gradeLevelCode,
    programCode: profile.programCode,
    programLabel: profile.programLabel,
    classroomCode: profile.classroomCode,
    classroomName: profile.classroomName,
    subjects: SUBJECTS[input.pack],
    students,
    guardians,
    teachers,
    paidCount: 8,
    accounts: {
      owner: `direction.generale@${input.slug}.test`,
      directeur: `directeur@${input.slug}.test`,
      pedagogie: `pedagogie@${input.slug}.test`,
      enseignant: (teachers[0] as TeacherSeed).email,
      parent: (guardians[0] as GuardianSeed).email,
      eleve: `eleve@${input.slug}.test`,
    },
  };
}

export { isoDate };
