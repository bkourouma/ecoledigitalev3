#!/usr/bin/env node
/**
 * Génère les fichiers d'exemple du chapitre « Imports » du guide de test (docs/guide-test/05-imports.md).
 *
 *   node docs/guide-test/jeux-de-donnees/generer-fichiers-imports.mjs                 écrit les fichiers dans ce dossier
 *   node docs/guide-test/jeux-de-donnees/generer-fichiers-imports.mjs --gros           écrit en plus ./imports-gros/ (fichiers volumineux, NON versionnés)
 *   node docs/guide-test/jeux-de-donnees/generer-fichiers-imports.mjs --enorme         écrit en plus imports-gros/enorme-21mo.csv (21 Mo)
 *   node docs/guide-test/jeux-de-donnees/generer-fichiers-imports.mjs --sortie <dossier>   autre dossier de sortie
 *
 * Les CSV reprennent le format des modèles téléchargés dans l'application : UTF-8 avec BOM, séparateur « ; », fin de
 * ligne CRLF, en-têtes = libellés EXACTS des colonnes (voir apps/api/src/modules/imports/importers/*.ts).
 * Les classeurs .xlsx / .xls / .ods sont écrits avec la bibliothèque `xlsx` (0.18.5) déjà présente dans le dépôt
 * (apps/api/node_modules) ; aucune installation n'est nécessaire.
 * Toutes les données sont FICTIVES : noms suffixés « test guide », e-mails en @exemple.test, téléphones factices,
 * matricules d'origine préfixés « TG- ». Le script n'écrit rien en dehors du dossier de sortie et ne contacte aucun service.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BOM = String.fromCharCode(0xfeff);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const args = process.argv.slice(2);
const OUT = args.includes("--sortie") ? resolve(args[args.indexOf("--sortie") + 1]) : HERE;
const GROS = args.includes("--gros") || args.includes("--enorme");
const ENORME = args.includes("--enorme");

const require = createRequire(join(REPO, "apps", "api", "package.json"));
const XLSX = require("xlsx");
const JSZip = require("jszip");

mkdirSync(OUT, { recursive: true });
const out = (rel) => {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  return p;
};

// ---------------------------------------------------------------------------------------------------------------------
// Écriture CSV (même format que les modèles de l'application)
// ---------------------------------------------------------------------------------------------------------------------
const field = (v, sep) => {
  const s = String(v ?? "");
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvText = (rows, sep = ";") => rows.map((r) => r.map((c) => field(c, sep)).join(sep)).join("\r\n") + "\r\n";
const csv = (rel, rows) => writeFileSync(out(rel), Buffer.from(BOM + "" + csvText(rows), "utf8"));

// ---------------------------------------------------------------------------------------------------------------------
// En-têtes EXACTS (libellés des colonnes de chaque importeur)
// ---------------------------------------------------------------------------------------------------------------------
const H_STUDENTS = ["Matricule d'origine", "Nom", "Prénoms", "Sexe", "Date de naissance", "Lieu de naissance", "Nationalité (code pays)", "N° national", "N° acte de naissance", "E-mail", "Téléphone", "Téléphone secondaire", "Adresse", "Ville", "Résidence", "Classe (code)", "Financement (code)", "Référence d'affectation"];
const H_GUARDIANS = ["Matricule de l'élève", "Nom du tuteur", "Prénoms du tuteur", "Sexe du tuteur", "Téléphone", "Téléphone secondaire", "E-mail", "Adresse", "Ville", "Profession", "Employeur", "Lien de parenté", "Contact principal", "Contact d'urgence", "Répondant financier", "Autorité parentale", "Autorisé à récupérer l'enfant", "Accès au portail"];
const H_STAFF = ["Matricule d'origine", "Nom", "Prénoms", "Sexe", "Date de naissance", "Lieu de naissance", "Nationalité (code pays)", "E-mail", "Téléphone", "Adresse", "Ville", "Catégorie", "Poste", "Date d'embauche"];
const H_CLASSROOMS = ["Code de la classe", "Nom de la classe", "Programme (code)", "Niveau (code)", "Effectif maximal", "Début", "Fin"];
const H_CURRICULUM = ["Code du noeud", "Libellé", "Type de noeud (code)", "Code du parent", "Code de la matière", "Niveau (code)", "Coefficient", "Crédits", "Type de période (code)", "N° de période", "Ordre d'affichage", "Obligatoire", "Volume horaire total"];
const H_ENROLLMENTS = ["Matricule de l'élève", "Classe (code)", "Financement (code)", "Référence d'affectation", "Date d'inscription"];
const H_GRADES = ["Matricule de l'élève", "Note ou code", "Observation"];
const H_BALANCES = ["Référence", "Matricule de l'élève", "Type", "Montant (FCFA)", "Libellé", "Année scolaire", "Échéance", "Facture visée (avoir)", "Motif de l'avoir"];

// ---------------------------------------------------------------------------------------------------------------------
// 01 — Élèves
// ---------------------------------------------------------------------------------------------------------------------
/** Ligne d'élève : [ref, nom, prénoms, sexe, naissance, lieu, nat, nationalId, acte, email, tel, tel2, adresse, ville, résidence, classe, financement, affectation] */
const stu = (ref, nom, prenoms, sexe, naiss, lieu, o = {}) => [
  ref, nom, prenoms, sexe, naiss, lieu, o.nat ?? "CI", o.nationalId ?? "", o.acte ?? "", o.email ?? "", o.tel ?? "", o.tel2 ?? "",
  o.adresse ?? "", o.ville ?? "", o.residence ?? "", o.classe ?? "", o.fin ?? "", o.aff ?? "",
];

const STUDENTS_SEC = [
  stu("TG-ELV-S01", "KOUASSI", "Aïcha test guide", "F", "12/03/2014", "Abidjan", { acte: "TG-ACTE-2014-0101", email: "aicha.kouassi.tg@exemple.test", adresse: "Cocody, Riviera 3", ville: "Abidjan", residence: "Riviera 3", classe: "6E-A", fin: "PRIVATE" }),
  stu("TG-ELV-S02", "KOUASSI", "Yves test guide", "M", "05/08/2013", "Abidjan", { adresse: "Cocody, Riviera 3", ville: "Abidjan", residence: "Riviera 3", classe: "6E-A", fin: "PRIVATE" }),
  stu("TG-ELV-S03", "KONÉ", "Fanta test guide", "Fille", "21/11/2013", "Bouaké", { adresse: "Bouaké, quartier Commerce", ville: "Bouaké", residence: "Commerce", classe: "6E-A" }),
  stu("TG-ELV-S04", "TRAORE", "Mamadou test guide", "M", "2014-02-14", "Yamoussoukro", { tel: "07 00 00 10 04", adresse: "Yamoussoukro, Habitat", ville: "Yamoussoukro", residence: "Habitat", classe: "6E-A", fin: "PRIVATE" }),
  stu("TG-ELV-S05", "YAO", "Adjoua test guide", "F", "30/06/2014", "Daloa", { adresse: "Daloa, Lobia", ville: "Daloa", residence: "Lobia", classe: "6E-A", fin: "PRIVATE" }),
  stu("TG-ELV-S06", "BAMBA", "Ismaël test guide", "Masculin", "09/09/2013", "Korhogo", { ville: "Korhogo", classe: "6E-A", fin: "PRIVATE" }),
  stu("TG-ELV-S07", "COULIBALY", "Awa test guide", "F", "17/01/2014", "Abidjan", { adresse: "Yopougon, Niangon Nord", ville: "Abidjan", residence: "Niangon Nord", classe: "6E-A", fin: "PRIVATE" }),
  stu("TG-ELV-S08", "DIABATE", "Seydou test guide", "M", "25/05/2013", "Abidjan", { adresse: "Abobo, Samaké", ville: "Abidjan", residence: "Samaké", classe: "6E-A", fin: "PRIVATE" }),
  stu("TG-ELV-S09", "BROU", "Esther test guide", "F", "02/12/2013", "San-Pédro", { ville: "San-Pédro", classe: "6E-A", fin: "PRIVATE" }),
  stu("TG-ELV-S10", "OUATTARA", "Souleymane test guide", "M", "11/10/2014", "Bouaké", { ville: "Bouaké", classe: "6E-A", fin: "PRIVATE" }),
];

const STUDENTS_PRI = [
  stu("TG-ELV-P01", "KOFFI", "Amenan test guide", "F", "14/03/2019", "Abidjan", { adresse: "Yopougon, Selmer", ville: "Abidjan", classe: "CP1-A", fin: "PRIVATE" }),
  stu("TG-ELV-P02", "KOUAMÉ", "Junior test guide", "M", "22/07/2018", "Bouaké", { ville: "Bouaké", classe: "CP1-A", fin: "PRIVATE" }),
  stu("TG-ELV-P03", "DOSSO", "Mariam test guide", "F", "03/11/2019", "Korhogo", { ville: "Korhogo", classe: "CP1-A", fin: "PRIVATE" }),
  stu("TG-ELV-P04", "ADJOUMANI", "Kévin test guide", "M", "18/01/2019", "Abidjan", { adresse: "Abobo, Avocatier", ville: "Abidjan", classe: "CP1-A", fin: "PRIVATE" }),
  stu("TG-ELV-P05", "TANOH", "Rosine test guide", "F", "29/09/2018", "Daloa", { ville: "Daloa", classe: "CP1-A", fin: "PRIVATE" }),
  stu("TG-ELV-P06", "SANGARE", "Ibrahim test guide", "M", "07/05/2019", "Man", { ville: "Man", classe: "CP1-A", fin: "PRIVATE" }),
  stu("TG-ELV-P07", "GNAMIEN", "Léa test guide", "F", "25/12/2018", "Yamoussoukro", { ville: "Yamoussoukro", classe: "CP1-A", fin: "PRIVATE" }),
  stu("TG-ELV-P08", "LOBA", "Emmanuel test guide", "M", "11/06/2019", "Gagnoa", { ville: "Gagnoa", classe: "CP1-A", fin: "PRIVATE" }),
  stu("TG-ELV-P09", "N'DRI", "Chantal test guide", "F", "2019-02-02", "Abengourou", { ville: "Abengourou", classe: "CP1-A", fin: "PRIVATE" }),
  stu("TG-ELV-P10", "TAPE", "Josué test guide", "M", "19/08/2018", "San-Pédro", { ville: "San-Pédro", classe: "CP1-A", fin: "PRIVATE" }),
];

const STUDENTS_SUP = [
  stu("TG-ELV-U01", "KOUADIO", "Jean-Baptiste test guide", "M", "08/04/2005", "Abidjan", { email: "jean-baptiste.kouadio.tg@exemple.test", tel: "05 00 00 20 01", ville: "Abidjan", classe: "L1-A", fin: "PRIVATE" }),
  stu("TG-ELV-U02", "SORO", "Fatoumata test guide", "F", "16/09/2004", "Korhogo", { email: "fatoumata.soro.tg@exemple.test", tel: "05 00 00 20 02", ville: "Korhogo", classe: "L1-A", fin: "PRIVATE" }),
  stu("TG-ELV-U03", "AKA", "Christelle test guide", "F", "23/01/2005", "Bouaké", { tel: "05 00 00 20 03", ville: "Bouaké", classe: "L1-A", fin: "PRIVATE" }),
  stu("TG-ELV-U04", "YEO", "Lassina test guide", "M", "30/10/2004", "Odienné", { tel: "05 00 00 20 04", ville: "Odienné", classe: "L1-A", fin: "PRIVATE" }),
  stu("TG-ELV-U05", "ZADI", "Marie-Laure test guide", "F", "05/06/2003", "Gagnoa", { ville: "Gagnoa", classe: "L1-A", fin: "PRIVATE" }),
  stu("TG-ELV-U06", "BROU", "Axel test guide", "M", "2004-12-12", "Yamoussoukro", { ville: "Yamoussoukro", classe: "L1-A", fin: "PRIVATE" }),
  stu("TG-ELV-U07", "TOURÉ", "Mariame test guide", "F", "27/03/2005", "Man", { ville: "Man", classe: "L1-A", fin: "PRIVATE" }),
  stu("TG-ELV-U08", "GBAGBO", "Landry test guide", "M", "01/07/2004", "Daloa", { ville: "Daloa", classe: "L1-A", fin: "PRIVATE" }),
  stu("TG-ELV-U09", "OUATTARA", "Aïcha test guide", "F", "19/11/2003", "Bouna", { ville: "Bouna", classe: "L1-A", fin: "PRIVATE" }),
  stu("TG-ELV-U10", "KONAN", "Franck test guide", "M", "14/02/2005", "Abidjan", { tel: "05 00 00 20 10", ville: "Abidjan", classe: "L1-A", fin: "PRIVATE" }),
];

const STUDENTS_ERR = [
  stu("TG-ERR-01", "SANGARE", "Mariam test guide", "F", "10/10/2013", "Bouaké", { ville: "Bouaké", classe: "6E-A", fin: "PRIVATE" }), // ligne 2 : valide
  stu("TG-ERR-02", "DOUMBIA", "Salif test guide", "", "04/04/2014", "Korhogo", { classe: "6E-A", fin: "PRIVATE" }), // 3 : sexe vide
  stu("TG-ERR-03", "GNANKOU", "Rita test guide", "X", "15/06/2014", "Daloa", { classe: "6E-A", fin: "PRIVATE" }), // 4 : sexe non reconnu
  stu("TG-ERR-04", "LATH", "Gilbert test guide", "M", "31/02/2014", "Abidjan", { classe: "6E-A", fin: "PRIVATE" }), // 5 : date impossible
  stu("TG-ERR-05", "SIDIBE", "Kady test guide", "F", "01/01/2099", "Abidjan", { classe: "6E-A", fin: "PRIVATE" }), // 6 : naissance dans le futur
  stu("TG-ERR-06", "", "Josiane test guide", "F", "20/02/2014", "Man", { classe: "6E-A", fin: "PRIVATE" }), // 7 : nom vide
  stu("TG-ERR-07", "ASSAMOI", "Paul test guide", "M", "08/08/2013", "Abidjan", { classe: "6E-Z", fin: "PRIVATE" }), // 8 : classe inconnue
  stu("TG-ERR-08", "MEL", "Estelle test guide", "F", "13/03/2014", "Abidjan", { classe: "6E-A", fin: "XYZ" }), // 9 : financement inconnu
  stu("TG-ERR-09", "TIÉMOKO", "Ange test guide", "M", "27/07/2013", "Abidjan", { email: "ange.tiemoko.exemple.test", classe: "6E-A", fin: "PRIVATE" }), // 10 : e-mail invalide
  stu("TG-ERR-10", "KOUTOUAN", "Délice test guide", "F", "09/05/2014", "Abidjan", { tel: "12", classe: "6E-A", fin: "PRIVATE" }), // 11 : téléphone invalide
  stu("TG-ERR-11", "BOGUI", "Cédric test guide", "M", "16/10/2013", "Abidjan", { nat: "CIV", classe: "6E-A", fin: "PRIVATE" }), // 12 : nationalité à 3 lettres
  stu("TG-ERR-01", "SANGARE", "Mariam test guide (bis)", "F", "10/10/2013", "Bouaké", { ville: "Bouaké", classe: "6E-A", fin: "PRIVATE" }), // 13 : même matricule que la ligne 2
  stu("TG-ERR-12", "DIABATE", "Nadia", "F", "19/01/2014", "Daloa", { classe: "6E-A", fin: "PRIVATE" }), // 14 : doublon probable avec l'élève DIABATE Nadia de la graine (secondaire)
  stu("TG-ERR-13", "ZOKORA", "Léonie test guide", "F", "03/03/2014", "Gagnoa", { classe: "6E-A", fin: "PRIVATE" }), // 15 : valide
  stu("", "LOROUGNON", "Dominique test guide", "M", "19/09/2013", "Abidjan", { classe: "6E-A", fin: "PRIVATE" }), // 16 : sans matricule d'origine (avertissement)
];

csv("01-students-valide-secondaire.csv", [H_STUDENTS, ...STUDENTS_SEC]);
csv("01-students-valide-primaire.csv", [H_STUDENTS, ...STUDENTS_PRI]);
csv("01-students-valide-superieur.csv", [H_STUDENTS, ...STUDENTS_SUP]);
csv("01-students-erreurs-secondaire.csv", [H_STUDENTS, ...STUDENTS_ERR]);

// Élèves SANS classe (identité seule) : à inscrire ensuite avec l'importeur « Inscriptions » (fichier 06).
const H_STUDENTS_IDENTITY = H_STUDENTS.slice(0, 15);
const STUDENTS_INS = [
  stu("TG-INS-01", "ABLE", "Rachel test guide", "F", "13/02/2014", "Abidjan", { adresse: "Marcory, Zone 4", ville: "Abidjan", residence: "Zone 4" }),
  stu("TG-INS-02", "BAH", "Moussa test guide", "M", "27/06/2013", "Abidjan", { ville: "Abidjan" }),
  stu("TG-INS-03", "CAMARA", "Hawa test guide", "F", "08/10/2013", "Odienné", { ville: "Odienné" }),
  stu("TG-INS-04", "DJÉ", "Armand test guide", "M", "21/03/2014", "Divo", { ville: "Divo" }),
  stu("TG-INS-05", "EHUI", "Sylvie test guide", "F", "15/12/2013", "Abidjan", { ville: "Abidjan" }),
  stu("TG-INS-06", "FOFANA", "Karim test guide", "M", "04/09/2014", "Séguéla", { ville: "Séguéla" }),
].map((r) => r.slice(0, 15));
csv("01-students-sans-classe-secondaire.csv", [H_STUDENTS_IDENTITY, ...STUDENTS_INS]);

// Mise à jour (politique « Mettre à jour les lignes déjà présentes ») : mêmes matricules que le fichier valide.
csv("01-students-maj-secondaire.csv", [
  ["Matricule d'origine", "Nom", "Prénoms", "Sexe", "Téléphone", "Adresse", "Ville"],
  ["TG-ELV-S01", "KOUASSI", "Aïcha test guide", "F", "07 00 00 10 01", "Cocody, Angré 8e tranche", "Abidjan"],
  ["TG-ELV-S02", "KOUASSI", "Yves test guide", "M", "07 00 00 10 02", "Cocody, Angré 8e tranche", "Abidjan"],
  ["TG-ELV-S03", "KONÉ", "Fanta test guide", "F", "05 00 00 10 03", "", "Bouaké"],
]);

// En-têtes libres : reconnus par leurs alias (détection automatique des colonnes).
csv("01-students-entetes-libres-secondaire.csv", [
  ["matricule", "nom", "prénom", "sexe", "date de naissance", "classe"],
  ["TG-ALI-01", "ASSOUMOU", "Bénédicte test guide", "F", "12/05/2014", "6E-A"],
  ["TG-ALI-02", "BLE", "Gaston test guide", "M", "30/01/2014", "6E-A"],
  ["TG-ALI-03", "COFFIE", "Nadège test guide", "F", "22/08/2013", "6E-A"],
  ["TG-ALI-04", "DAGO", "Hervé test guide", "M", "06/11/2013", "6E-A"],
  ["TG-ALI-05", "EKRA", "Prisca test guide", "F", "17/04/2014", "6E-A"],
]);

// En-têtes en double.
csv("imports-cas-limites/01-students-entetes-doubles-secondaire.csv", [
  ["Matricule d'origine", "Nom", "Nom", "Prénoms", "Sexe", "Date de naissance"],
  ["TG-DBL-01", "AMON", "AMON", "Judith test guide", "F", "14/04/2014"],
  ["TG-DBL-02", "BEDI", "BEDI", "Lucien test guide", "M", "02/07/2013"],
]);

// Fichier qui ne doit JAMAIS écrire : lignes volontairement refusées + contenus qui ressemblent à des formules.
csv("01-students-formules-erreurs-secondaire.csv", [
  H_STUDENTS.slice(0, 6),
  ["TG-FOR-01", "=2+2", "Piège test guide", "", "10/10/2013", "Abidjan"],
  ["TG-FOR-02", "+CMD", "Piège deux test guide", "", "11/10/2013", "Abidjan"],
  ["TG-FOR-03", "@SOMME(A1)", "Piège trois test guide", "", "12/10/2013", "Abidjan"],
]);

// Encodages et séparateurs.
const encRows = (p) => [
  [`TG-${p}-01`, "ABOUA", "Étienne test guide", "M", "10/05/2014", "Abidjan"],
  [`TG-${p}-02`, "BÉDIÉ", "Hélène test guide", "F", "21/09/2013", "Bouaké"],
  [`TG-${p}-03`, "CISSÉ", "Fadiga test guide", "M", "03/02/2014", "Korhogo"],
  [`TG-${p}-04`, "DÉGNY", "Séraphine test guide", "F", "28/12/2013", "Daloa"],
];
const encHeader = ["Matricule d'origine", "Nom", "Prénoms", "Sexe", "Date de naissance", "Lieu de naissance"];
// windows-1252 (« ANSI ») : tous les caractères utilisés sont dans la plage latin1.
writeFileSync(out("imports-cas-limites/01-students-encodage-ansi-secondaire.csv"), Buffer.from(csvText([encHeader, ...encRows("ANS")]), "latin1"));
// Virgule, UTF-8 sans BOM.
writeFileSync(out("imports-cas-limites/01-students-encodage-virgule-secondaire.csv"), Buffer.from(csvText([encHeader, ...encRows("VIR")], ","), "utf8"));
// Tabulation.
writeFileSync(out("imports-cas-limites/01-students-encodage-tabulation-secondaire.tsv"), Buffer.from(BOM + "" + csvText([encHeader, ...encRows("TAB")], "\t"), "utf8"));

// ---------------------------------------------------------------------------------------------------------------------
// 01 — Classeurs (4 formats) : 4 lignes valides + 1 ligne en erreur (date 31/02/2014) chacun
// ---------------------------------------------------------------------------------------------------------------------
const H_FORMAT = ["Matricule d'origine", "Nom", "Prénoms", "Sexe", "Date de naissance", "Lieu de naissance", "Classe (code)", "Financement (code)"];
const formatRows = (p, names) =>
  names.map(([nom, prenoms, sexe, naiss, lieu], i) => [`TG-${p}-0${i + 1}`, nom, prenoms, sexe, naiss, lieu, "6E-A", "PRIVATE"]);
const FORMATS = {
  FX: formatRows("FX", [["ADJA", "Clarisse test guide", "F", "06/01/2014", "Abidjan"], ["KOBENAN", "Yannick test guide", "M", "23/04/2013", "Bouaké"], ["GUIRIEOULOU", "Estelle test guide", "F", "11/07/2014", "Gagnoa"], ["LAGOU", "Ismaël test guide", "M", "28/10/2013", "Divo"], ["MIEZAN", "Patrick test guide", "M", "31/02/2014", "Aboisso"]]),
  FS: formatRows("FS", [["AMANI", "Rosalie test guide", "F", "15/03/2014", "Abidjan"], ["BOLOU", "Christian test guide", "M", "09/08/2013", "Yamoussoukro"], ["COMOE", "Nathalie test guide", "F", "24/11/2013", "Abengourou"], ["DOUA", "Régis test guide", "M", "02/05/2014", "Issia"], ["ESSY", "Ornella test guide", "F", "31/02/2014", "Bondoukou"]]),
  FO: formatRows("FO", [["AGNIMEL", "Solange test guide", "F", "19/06/2014", "Abidjan"], ["BEUGRÉ", "Alphonse test guide", "M", "13/12/2013", "Lakota"], ["CHEROU", "Bintou test guide", "F", "07/09/2013", "Touba"], ["DIOMANDÉ", "Vassiriki test guide", "M", "26/01/2014", "Odienné"], ["ETTE", "Mireille test guide", "F", "31/02/2014", "Adzopé"]]),
  FC: formatRows("FC", [["ABONOUAN", "Judicaël test guide", "M", "18/02/2014", "Abidjan"], ["BINI", "Francine test guide", "F", "05/10/2013", "Bouaflé"], ["COULIBALY", "Mamadou test guide", "M", "29/07/2014", "Ferkessédougou"], ["DADIÉ", "Annick test guide", "F", "14/11/2013", "Dabou"], ["EBROTIÉ", "Roméo test guide", "M", "31/02/2014", "Jacqueville"]]),
};
csv("01-students-formats-secondaire.csv", [H_FORMAT, ...FORMATS.FC]);

const aoaSheet = (rows) => XLSX.utils.aoa_to_sheet(rows, { cellDates: false });
const book = (sheets, extra = {}) => {
  const wb = XLSX.utils.book_new();
  for (const [name, sheet] of sheets) XLSX.utils.book_append_sheet(wb, sheet, name);
  return Object.assign(wb, extra);
};
/**
 * La bibliothèque déclare par défaut un type de contenu « binaire avec macros » (extension .bin) dans les .xlsx qu'elle écrit :
 * le lecteur de l'application y verrait un classeur à macros. On le retire pour produire des fichiers comparables à ceux d'Excel.
 */
async function withoutMacroContentType(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const ct = await zip.file("[Content_Types].xml").async("string");
  zip.file("[Content_Types].xml", ct.replace(/<Default Extension="bin" ContentType="[^"]*macroEnabled[^"]*"[ ]?[/]>/, ""));
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
const writeBook = async (rel, wb, bookType) => {
  const buffer = XLSX.write(wb, { bookType, type: "buffer", compression: true });
  writeFileSync(out(rel), bookType === "xlsx" ? await withoutMacroContentType(buffer) : buffer);
};
await writeBook("01-students-formats-secondaire.xlsx", book([["Eleves", aoaSheet([H_FORMAT, ...FORMATS.FX])]]), "xlsx");
await writeBook("01-students-formats-secondaire.xls", book([["Eleves", aoaSheet([H_FORMAT, ...FORMATS.FS])]]), "biff8");
await writeBook("01-students-formats-secondaire.ods", book([["Eleves", aoaSheet([H_FORMAT, ...FORMATS.FO])]]), "ods");

// Classeur à plusieurs feuilles, dates Excel natives (numéro de série + format JJ/MM/AAAA), matricules en texte.
const serial = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);
const dateCell = (iso) => ({ t: "n", v: serial(iso), z: "dd/mm/yyyy" });
{
  const notice = XLSX.utils.aoa_to_sheet([["LISEZ-MOI : cette feuille ne contient pas les élèves."], ["Les élèves sont sur la feuille « Eleves » : indiquez ce nom dans le champ « Feuille (facultatif) »."]]);
  const rows = [
    ["Matricule d'origine", "Nom", "Prénoms", "Sexe", "Date de naissance", "Classe (code)", "Financement (code)"],
    ["TG-FEU-01", "AMOAKON", "Sandrine test guide", "F", dateCell("2014-01-08"), "6E-A", "PRIVATE"],
    ["TG-FEU-02", "BAMBA", "Cheick test guide", "M", dateCell("2013-06-19"), "6E-A", "PRIVATE"],
    ["TG-FEU-03", "COULIBALY", "Nafissatou test guide", "F", dateCell("2014-03-27"), "6E-A", "PRIVATE"],
    ["TG-FEU-04", "DAKOURI", "Olivier test guide", "M", dateCell("2013-09-03"), "6E-A", "PRIVATE"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  await writeBook("01-students-feuilles-secondaire.xlsx", book([["LISEZ-MOI", notice], ["Eleves", ws]]), "xlsx");
}

// Classeur avec UNE cellule à formule (valeur enregistrée lue, jamais recalculée ; avertissement attendu).
{
  const ws = XLSX.utils.aoa_to_sheet([
    ["Matricule d'origine", "Nom", "Prénoms", "Sexe", "Date de naissance", "Lieu de naissance", "Classe (code)", "Financement (code)"],
    ["TG-FRM-01", "ATTA", "Clémence test guide", "F", "10/04/2014", "Abidjan", "6E-A", "PRIVATE"],
    ["TG-FRM-02", "BEDIAKON", "Rodrigue test guide", "M", "21/08/2013", "Abidjan", "6E-A", "PRIVATE"],
    ["TG-FRM-03", "CAMARA", "Dado test guide", "F", "05/12/2013", "Abidjan", "6E-A", "PRIVATE"],
  ]);
  ws["F3"] = { t: "s", v: "Abidjan", f: '"Abi"&"djan"' };
  await writeBook("01-students-formule-secondaire.xlsx", book([["Eleves", ws]]), "xlsx");
}

// ---------------------------------------------------------------------------------------------------------------------
// 02 — Parents et tuteurs (référence les élèves TG-ELV-S01 à S10 du fichier 01-students-valide-secondaire.csv)
// ---------------------------------------------------------------------------------------------------------------------
/** [élève, nom, prénoms, sexe, tel, tel2, email, adresse, ville, profession, employeur, lien, principal, urgence, financier, autorité, récupérer, portail] */
const gua = (eleve, nom, prenoms, sexe, tel, lien, o = {}) => [
  eleve, nom, prenoms, sexe, tel, "", o.email ?? "", o.adresse ?? "", o.ville ?? "", o.profession ?? "", o.employeur ?? "", lien,
  o.p ?? "oui", o.u ?? "oui", o.f ?? "oui", o.a ?? "oui", o.r ?? "oui", o.w ?? "non",
];
const KOUASSI_MC = ["KOUASSI", "Marie-Claire test guide", "F", "07 00 01 01 01"];
const GUARDIANS_SEC = [
  gua("TG-ELV-S01", ...KOUASSI_MC, "MERE", { email: "marie-claire.kouassi.tg@exemple.test", adresse: "Cocody, Riviera 3", ville: "Abidjan", profession: "Commerçante", w: "oui" }),
  gua("TG-ELV-S02", ...KOUASSI_MC, "MERE", { email: "marie-claire.kouassi.tg@exemple.test", adresse: "Cocody, Riviera 3", ville: "Abidjan", profession: "Commerçante", w: "oui" }),
  gua("TG-ELV-S02", "KOUASSI", "Bernard test guide", "M", "07 00 01 01 02", "PERE", { adresse: "Cocody, Riviera 3", ville: "Abidjan", profession: "Ingénieur", employeur: "Société Fictive SA", p: "non", u: "non", f: "non" }),
  gua("TG-ELV-S03", "KONÉ", "Salif test guide", "M", "05 00 01 03 03", "PERE", { adresse: "Bouaké, quartier Commerce", ville: "Bouaké", profession: "Chauffeur" }),
  gua("TG-ELV-S04", "TRAORE", "Hawa test guide", "F", "01 00 01 04 04", "MERE", { email: "hawa.traore.tg@exemple.test", adresse: "Yamoussoukro, Habitat", ville: "Yamoussoukro", profession: "Enseignante" }),
  gua("TG-ELV-S05", "YAO", "Kouadio Paul test guide", "M", "07 00 01 05 05", "Tuteur légal", { adresse: "Daloa, Lobia", ville: "Daloa", profession: "Agriculteur" }),
  gua("TG-ELV-S06", "BAMBA", "Aminata test guide", "F", "05 00 01 06 06", "Grand-parent", { ville: "Korhogo", profession: "Ménagère" }),
  gua("TG-ELV-S07", "COULIBALY", "Drissa test guide", "M", "07 00 01 07 07", "Oncle ou tante", { adresse: "Yopougon, Niangon Nord", ville: "Abidjan", profession: "Mécanicien" }),
  gua("TG-ELV-S08", "DIABATE", "Mariam test guide", "F", "01 00 01 08 08", "MOTHER", { adresse: "Abobo, Samaké", ville: "Abidjan", profession: "Couturière" }),
  gua("TG-ELV-S09", "BROU", "Akissi test guide", "F", "01 00 01 09 09", "MERE", { ville: "San-Pédro", profession: "Commerçante" }),
  gua("TG-ELV-S10", "OUATTARA", "Zoumana test guide", "M", "07 00 01 10 10", "FATHER", { ville: "Bouaké", profession: "Transporteur" }),
];
csv("02-guardians-valide-secondaire.csv", [H_GUARDIANS, ...GUARDIANS_SEC]);

const GUARDIANS_ERR = [
  gua("TG-ELV-S05", "GNAGNE", "Eugénie test guide", "F", "07 00 02 01 01", "Oncle ou tante", { ville: "Daloa", p: "non", u: "oui", f: "non", a: "non" }), // 2 : valide
  gua("TG-ELV-X99", "ABLE", "Nestor test guide", "M", "07 00 02 02 02", "PERE"), // 3 : élève inconnu
  gua("TG-ELV-S06", "BOKA", "Rosalie test guide", "F", "07 00 02 03 03", "Cousin"), // 4 : lien inconnu
  gua("TG-ELV-S07", "", "Anicet test guide", "M", "07 00 02 04 04", "PERE"), // 5 : nom vide
  gua("TG-ELV-S08", "CAMARA", "Fanta test guide", "F", "07-AB", "MERE"), // 6 : téléphone invalide
  gua("TG-ELV-S09", "DOH", "Simone test guide", "F", "07 00 02 06 06", "MERE", { email: "simone@@exemple" }), // 7 : e-mail invalide
  gua("TG-ELV-S10", "EBLIN", "Prosper test guide", "M", "07 00 02 07 07", "PERE", { p: "peut-être" }), // 8 : booléen invalide
  gua("TG-ELV-S06", "KRA", "Odette test guide", "F", "", "Grand-parent"), // 9 : ni téléphone ni e-mail (avertissement)
  gua("TG-ELV-S05", "GNAGNE", "Eugénie test guide", "F", "07 00 02 01 01", "Oncle ou tante", { ville: "Daloa", p: "non", u: "oui", f: "non", a: "non" }), // 10 : répète la ligne 2
  gua("TG-ELV-S04", "LASME", "Gisèle test guide", "Z", "07 00 02 09 09", "MERE"), // 11 : sexe du tuteur non reconnu
];
csv("02-guardians-erreurs-secondaire.csv", [H_GUARDIANS, ...GUARDIANS_ERR]);

// ---------------------------------------------------------------------------------------------------------------------
// 03 — Personnel (direction / propriétaire)
// ---------------------------------------------------------------------------------------------------------------------
/** [ref, nom, prénoms, sexe, naissance, lieu, nat, email, tel, adresse, ville, catégorie, poste, embauche] */
const stf = (ref, nom, prenoms, sexe, naiss, lieu, email, tel, adresse, ville, cat, poste, emb) => [ref, nom, prenoms, sexe, naiss, lieu, "CI", email, tel, adresse, ville, cat, poste, emb];
const STAFF_SEC = [
  stf("TG-ENS-001", "KOUADIO", "Brice test guide", "M", "12/03/1984", "Abidjan", "brice.kouadio.tg@exemple.test", "07 00 03 00 01", "Cocody, Angré", "Abidjan", "Enseignant", "Professeur de mathématiques", "01/09/2012"),
  stf("TG-ENS-002", "YAPI", "Nathalie test guide", "F", "1988-07-21", "Bouaké", "nathalie.yapi.tg@exemple.test", "07 00 03 00 02", "Yopougon, Niangon", "Abidjan", "TEACHER", "Professeure de français", "2015-09-01"),
  stf("TG-ENS-003", "ESSOH", "Armand test guide", "M", "03/05/1979", "Dabou", "", "05 00 03 00 03", "Abobo, Plateau Dokui", "Abidjan", "Éducateur", "Surveillant général", "15/09/2010"),
  stf("TG-ENS-004", "ADOU", "Clarisse test guide", "F", "25/11/1991", "Abidjan", "clarisse.adou.tg@exemple.test", "01 00 03 00 04", "Marcory, Zone 4", "Abidjan", "ADMIN", "Secrétaire comptable", "02/01/2019"),
  stf("TG-ENS-005", "GUEI", "Parfait test guide", "M", "14/01/1986", "Man", "parfait.guei.tg@exemple.test", "07 00 03 00 05", "Yamoussoukro, Millionnaire", "Yamoussoukro", "Enseignant", "Professeur d'histoire-géographie", "01/09/2014"),
  stf("TG-ENS-006", "DJE", "Mireille test guide", "F", "09/09/1990", "Daloa", "mireille.dje.tg@exemple.test", "07 00 03 00 06", "Daloa, Lobia", "Daloa", "TEACHER", "Professeure d'anglais", "01/09/2016"),
  stf("TG-ENS-007", "KRAGBE", "Joël test guide", "M", "30/06/1975", "Gagnoa", "", "05 00 03 00 07", "Gagnoa, Dioulabougou", "Gagnoa", "SUPPORT", "Agent d'entretien", "01/10/2008"),
  stf("TG-ENS-008", "BEUGRÉ", "Estelle test guide", "F", "18/02/1993", "Abidjan", "estelle.beugre.tg@exemple.test", "01 00 03 00 08", "Cocody, Riviera 2", "Abidjan", "Personnel administratif", "Bibliothécaire", "01/09/2021"),
];
csv("03-staff-valide-secondaire.csv", [H_STAFF, ...STAFF_SEC]);
const STAFF_ERR = [
  stf("TG-STE-01", "LOBA", "Fabrice test guide", "M", "10/10/1985", "Abidjan", "fabrice.loba.tg@exemple.test", "07 00 03 01 01", "", "Abidjan", "Enseignant", "Professeur de SVT", "01/09/2013"), // 2 : valide
  stf("TG-STE-02", "MEL", "Cuisinier test guide", "M", "11/11/1980", "Abidjan", "", "07 00 03 01 02", "", "Abidjan", "CUISINIER", "Cuisinier", "01/09/2013"), // 3 : catégorie inconnue
  stf("TG-STE-03", "NANAN", "", "F", "12/12/1987", "Abidjan", "", "07 00 03 01 03", "", "Abidjan", "Enseignant", "", "01/09/2013"), // 4 : prénoms vides
  stf("TG-STE-04", "OBOU", "Désiré test guide", "M", "1985-13-45", "Abidjan", "", "07 00 03 01 04", "", "Abidjan", "Enseignant", "", "01/09/2013"), // 5 : date de naissance impossible
  stf("TG-STE-05", "PAPI", "Rebecca test guide", "F", "01/01/2000", "Abidjan", "", "07 00 03 01 05", "", "Abidjan", "Enseignant", "", "01/09/1995"), // 6 : embauche avant la naissance
  stf("TG-STE-06", "QUENUM", "Thierry test guide", "M", "05/05/1982", "Abidjan", "", "07 00 03 01 06", "", "Abidjan", "ADMIN", "Comptable", "01/01/2099"), // 7 : embauche dans le futur (avertissement)
  stf("TG-STE-07", "ROUAMBA", "Sophie test guide", "F", "06/06/1984", "Abidjan", "sophie.rouamba.exemple.test", "07 00 03 01 07", "", "Abidjan", "Enseignant", "", "01/09/2013"), // 8 : e-mail invalide
  stf("TG-STE-01", "LOBA", "Fabrice test guide (bis)", "M", "10/10/1985", "Abidjan", "", "07 00 03 01 01", "", "Abidjan", "Enseignant", "Professeur de SVT", "01/09/2013"), // 9 : répète la ligne 2
  stf("TG-STE-08", "SERY", "Vieux test guide", "M", "01/01/1915", "Abidjan", "", "07 00 03 01 08", "", "Abidjan", "Enseignant", "", "01/09/2013"), // 10 : naissance avant 1920
  stf("TG-STE-09", "TRAORE", "Kouadio", "M", "10/04/1978", "Abidjan", "", "07 00 03 01 09", "", "Abidjan", "Enseignant", "Professeur", "01/09/2013"), // 11 : doublon probable avec la fiche TRAORE Kouadio de la graine
];
csv("03-staff-erreurs-secondaire.csv", [H_STAFF, ...STAFF_ERR]);

// ---------------------------------------------------------------------------------------------------------------------
// 04 — Classes
// ---------------------------------------------------------------------------------------------------------------------
csv("04-classrooms-valide-secondaire.csv", [
  H_CLASSROOMS,
  ["TG-5EA", "5e A test guide", "COLLEGE", "5E", "40", "", ""],
  ["TG-5EB", "5e B test guide", "COLLEGE", "5E", "40", "", ""],
  ["TG-4EA", "4e A test guide", "COLLEGE", "4E", "45", "", ""],
  ["TG-4EB", "4e B test guide", "COLLEGE", "4E", "45", "", ""],
  ["TG-3EA", "3e A test guide", "COLLEGE", "3E", "50", "", ""],
  ["TG-3EB", "3e B test guide", "COLLEGE", "3E", "50", "", ""],
  ["TG-6ED", "6e D test guide", "college", "6e", "40", "", ""],
  ["TG-3EC", "3e C test guide", "COLLEGE", "3E", "50", "14/09/2026", "30/06/2027"],
]);
csv("04-classrooms-valide-primaire.csv", [
  H_CLASSROOMS,
  ["TG-CP2A", "CP2 A test guide", "PRIMAIRE", "CP2", "35", "", ""],
  ["TG-CP2B", "CP2 B test guide", "PRIMAIRE", "CP2", "35", "", ""],
  ["TG-CE1A", "CE1 A test guide", "PRIMAIRE", "CE1", "40", "", ""],
  ["TG-CE2A", "CE2 A test guide", "PRIMAIRE", "CE2", "40", "", ""],
  ["TG-CM1A", "CM1 A test guide", "PRIMAIRE", "CM1", "45", "", ""],
  ["TG-CM2A", "CM2 A test guide", "PRIMAIRE", "CM2", "45", "", ""],
]);
csv("04-classrooms-valide-superieur.csv", [
  H_CLASSROOMS,
  ["TG-L1P", "Licence 1 Import P test guide", "INFO", "L1", "60", "", ""],
  ["TG-L1Q", "Licence 1 Import Q test guide", "INFO", "L1", "60", "", ""],
  ["TG-L1R", "Licence 1 Import R test guide", "INFO", "L1", "80", "", ""],
  ["TG-L1S", "Licence 1 Import S test guide", "INFO", "L1", "80", "", ""],
]);
csv("04-classrooms-erreurs-secondaire.csv", [
  H_CLASSROOMS,
  ["TG-E5A", "5e A erreurs test guide", "COLLEGE", "5E", "40", "", ""], // 2 : valide
  ["TG-E5B", "5e B erreurs test guide", "LYCEEX", "5E", "40", "", ""], // 3 : programme inconnu
  ["TG-E5C", "5e C erreurs test guide", "COLLEGE", "7E", "40", "", ""], // 4 : niveau inconnu
  ["TG-E2A", "2nde A erreurs test guide", "COLLEGE", "2NDE", "40", "", ""], // 5 : niveau du lycée dans le programme du collège (refus à l'écriture)
  ["", "Sans code test guide", "COLLEGE", "5E", "40", "", ""], // 6 : code vide
  ["TG-E5D", "5e D erreurs test guide", "COLLEGE", "5E", "0", "", ""], // 7 : effectif nul
  ["TG-E5E", "5e E erreurs test guide", "COLLEGE", "5E", "quarante", "", ""], // 8 : effectif non numérique
  ["TG-E5F", "5e F erreurs test guide", "COLLEGE", "5E", "40,5", "", ""], // 9 : effectif décimal
  ["TG-E5G", "5e G erreurs test guide", "COLLEGE", "5E", "40", "30/06/2027", "14/09/2026"], // 10 : fin avant début
  ["TG-E5A", "5e A erreurs test guide (bis)", "COLLEGE", "5E", "40", "", ""], // 11 : répète la ligne 2
  ["6E-A", "6e A (déjà existante)", "COLLEGE", "6E", "45", "", ""], // 12 : classe de la graine : ignorée
  ["TG-E5H", "", "COLLEGE", "5E", "40", "", ""], // 13 : nom vide
]);
csv("04-classrooms-erreurs-superieur.csv", [
  H_CLASSROOMS,
  ["TG-L2A", "Licence 2 A test guide", "INFO", "L2", "60", "", ""], // 2 : niveau L2 non couvert par le programme INFO de la graine (refus à l'écriture)
  ["TG-L1X", "Licence 1 X test guide", "MASTERX", "L1", "60", "", ""], // 3 : programme inconnu
  ["TG-L1Y", "Licence 1 Y test guide", "INFO", "L9", "60", "", ""], // 4 : niveau inconnu
  ["L1-A", "Licence 1 A (déjà existante)", "INFO", "L1", "100", "", ""], // 5 : classe de la graine : ignorée
]);

// Fichier SANS erreur de lecture, mais dont une ligne est refusée À L'ÉCRITURE (niveau L2 non couvert par le programme INFO de la graine).
csv("04-classrooms-echec-ecriture-superieur.csv", [
  H_CLASSROOMS,
  ["TG-L1T", "Licence 1 Import T test guide", "INFO", "L1", "60", "", ""],
  ["TG-L2X", "Licence 2 Import X test guide", "INFO", "L2", "60", "", ""],
  ["TG-L1U", "Licence 1 Import U test guide", "INFO", "L1", "60", "", ""],
]);

// ---------------------------------------------------------------------------------------------------------------------
// 05 — Matières et curriculum (version de curriculum en BROUILLON)
// ---------------------------------------------------------------------------------------------------------------------
/** [code, libellé, type, parent, matière, niveau, coef, crédits, typePériode, nPériode, ordre, obligatoire, heures] */
const cur = (code, libelle, type, parent, matiere, niveau, coef, credits, pType, pNo, ordre, oblig, heures) => [code, libelle, type, parent, matiere, niveau, coef, credits, pType, pNo, ordre, oblig, heures];
csv("05-curriculum-valide-secondaire.csv", [
  H_CURRICULUM,
  cur("6E", "6e", "LEVEL", "", "", "6E", "", "", "", "", "1", "", ""),
  cur("TG-ARTP", "Arts plastiques test guide", "SUBJECT", "6E", "TG-ARTP", "", "1", "", "", "", "11", "oui", "36"),
  cur("TG-MUS", "Éducation musicale test guide", "SUBJECT", "6E", "TG-MUS", "", "1", "", "", "", "12", "oui", "36"),
  cur("TG-INFO", "Informatique test guide", "SUBJECT", "6E", "TG-INFO", "", "2", "", "", "", "13", "non", "54"),
  cur("TG-SVT", "Sciences de la vie et de la terre test guide", "SUBJECT", "6E", "TG-SVT", "", "2", "", "", "", "14", "oui", "72"),
  cur("TG-EDHC", "Éducation aux droits de l'homme et à la citoyenneté test guide", "SUBJECT", "6E", "TG-EDHC", "", "1,5", "", "", "", "15", "oui", "36"),
]);
csv("05-curriculum-valide-superieur.csv", [
  H_CURRICULUM,
  cur("L1", "Licence 1", "LEVEL", "", "", "L1", "", "", "", "", "1", "", ""),
  cur("S1", "Semestre 1", "PERIOD", "L1", "", "", "", "", "SEMESTER", "1", "1", "", ""),
  cur("TG-IUE1", "UE Réseaux test guide", "UE", "S1", "", "", "", "6", "", "", "21", "oui", ""),
  cur("TG-IE11", "Introduction aux réseaux test guide", "ECUE", "TG-IUE1", "TG-RESEAU", "", "2", "3", "", "", "1", "oui", "30"),
  cur("TG-IE12", "Protocoles Internet test guide", "ECUE", "TG-IUE1", "TG-PROTO", "", "2", "3", "", "", "2", "oui", "30"),
  cur("TG-IUE2", "UE Bases de données test guide", "UE", "S1", "", "", "", "5", "", "", "22", "oui", ""),
  cur("TG-IE21", "Modélisation de données test guide", "ECUE", "TG-IUE2", "TG-MODEL", "", "1,5", "2", "", "", "1", "oui", "24"),
  cur("TG-IE22", "SQL test guide", "ECUE", "TG-IUE2", "TG-SQL", "", "2", "3", "", "", "2", "oui", "36"),
]);
csv("05-curriculum-erreurs-secondaire.csv", [
  H_CURRICULUM,
  cur("6E", "6e", "LEVEL", "", "", "6E", "", "", "", "", "1", "", ""), // 2 : niveau (ignoré s'il existe déjà dans la version)
  cur("TG-CE1", "Dessin technique test guide", "SUBJECT", "6E", "TG-CE1", "", "1", "", "", "", "31", "oui", "36"), // 3 : valide (matière créée : avertissement)
  cur("TG-CE2", "Parent inconnu test guide", "SUBJECT", "XYZ", "TG-CE2", "", "1", "", "", "", "32", "oui", ""), // 4 : parent inconnu
  cur("TG-CE3", "Son propre parent test guide", "SUBJECT", "TG-CE3", "TG-CE3", "", "1", "", "", "", "33", "oui", ""), // 5 : parent = lui-même
  cur("TG-CE4", "Type inconnu test guide", "MATIERE", "6E", "TG-CE4", "", "1", "", "", "", "34", "oui", ""), // 6 : type de noeud inconnu
  cur("TG-CE5", "Période sans rang test guide", "SUBJECT", "6E", "TG-CE5", "", "1", "", "TRIMESTER", "", "35", "oui", ""), // 7 : type de période sans n° de période
  cur("TG-CE6", "Coefficient négatif test guide", "SUBJECT", "6E", "TG-CE6", "", "-2", "", "", "", "36", "oui", ""), // 8 : coefficient négatif
  cur("TG-CE7", "Coefficient texte test guide", "SUBJECT", "6E", "TG-CE7", "", "abc", "", "", "", "37", "oui", ""), // 9 : coefficient non numérique
  cur("", "Sans code test guide", "SUBJECT", "6E", "TG-CE8", "", "1", "", "", "", "38", "oui", ""), // 10 : code vide
  cur("TG-CE1", "Dessin technique test guide (bis)", "SUBJECT", "6E", "TG-CE1", "", "1", "", "", "", "39", "oui", ""), // 11 : répète la ligne 3
  cur("TG-CE9", "Niveau inconnu test guide", "SUBJECT", "6E", "TG-CE9", "9E", "1", "", "", "", "40", "oui", ""), // 12 : niveau inconnu
  cur("TG-CE10", "Fils avant parent test guide", "SUBJECT", "TG-CE11", "TG-CE10", "", "1", "", "", "", "41", "oui", ""), // 13 : parent déclaré plus bas
  cur("TG-CE11", "Groupe déclaré trop tard test guide", "GROUP", "6E", "", "", "", "", "", "", "42", "", ""), // 14 : valide
]);

// ---------------------------------------------------------------------------------------------------------------------
// 06 — Inscriptions (élèves TG-INS-01 à 06 du fichier 01-students-sans-classe-secondaire.csv ; élèves TG-ELV-S01 et S02 déjà inscrits en 6E-A)
// ---------------------------------------------------------------------------------------------------------------------
csv("06-enrollments-valide-secondaire.csv", [
  H_ENROLLMENTS,
  ["TG-INS-01", "6E-A", "PRIVATE", "", ""],
  ["TG-INS-02", "6E-A", "PRIVATE", "", ""],
  ["TG-INS-03", "6E-A", "", "", ""],
  ["TG-INS-04", "6e-a", "PRIVATE", "", "15/09/2026"],
  ["TG-INS-05", "6E-A", "PRIVATE", "", ""],
  ["TG-INS-06", "6E-A", "PRIVATE", "", ""],
]);
csv("06-enrollments-erreurs-secondaire.csv", [
  H_ENROLLMENTS,
  ["TG-INS-99", "6E-A", "PRIVATE", "", ""], // 2 : élève inconnu
  ["TG-ELV-S03", "6E-Z", "PRIVATE", "", ""], // 3 : classe inconnue
  ["TG-ELV-S04", "6E-A", "XYZ", "", ""], // 4 : financement inconnu
  ["TG-ELV-S05", "6E-A", "PRIVATE", "", "31/02/2026"], // 5 : date impossible
  ["TG-ELV-S06", "6E-A", "PRIVATE", "", "01/01/1980"], // 6 : date invraisemblable
  ["TG-ELV-S01", "6E-A", "PRIVATE", "", ""], // 7 : déjà inscrit dans cette classe (ignorée)
  ["TG-ELV-S02", "TG-5EA", "PRIVATE", "", ""], // 8 : déjà inscrit dans une autre classe de l'année (refus)
  ["", "6E-A", "PRIVATE", "", ""], // 9 : matricule vide
  ["TG-ELV-S07", "", "PRIVATE", "", ""], // 10 : classe vide
  ["TG-ELV-S08", "6E-A", "PRIVATE", "", ""], // 11 : valide (déjà inscrit si le fichier 01 valide a été importé : ignorée)
  ["TG-ELV-S08", "6E-A", "PRIVATE", "", ""], // 12 : répète la ligne 11
]);

// ---------------------------------------------------------------------------------------------------------------------
// 07 — Notes (élèves de la graine 00001 à 00008 : inscriptions confirmées de la classe 6E-A ; évaluation EN BROUILLON à créer)
// ---------------------------------------------------------------------------------------------------------------------
csv("07-grades-valide-secondaire.csv", [
  H_GRADES,
  ["00001", "14,5", ""],
  ["00002", "12", ""],
  ["00003", "ABS", "Absent le jour du devoir (test guide)"],
  ["00004", "17,25", "Très bon travail"],
  ["00005", "ABJ", "Certificat médical (test guide)"],
  ["00006", "DISP", "Dispensé (test guide)"],
  ["00007", "9,5", ""],
  ["00008", "20", ""],
]);
csv("07-grades-erreurs-secondaire.csv", [
  H_GRADES,
  ["00001", "13", ""], // 2 : valide
  ["99999", "10", ""], // 3 : matricule inconnu
  ["00003", "21", ""], // 4 : note au-dessus du barème (/20)
  ["00004", "abc", ""], // 5 : note illisible
  ["00005", "-3", ""], // 6 : note négative
  ["00006", "14,555", ""], // 7 : trop de décimales
  ["00007", "", ""], // 8 : note vide
  ["", "12", ""], // 9 : matricule vide
  ["00001", "15", ""], // 10 : répète la ligne 2
  ["TG-ELV-S01", "11", ""], // 11 : élève importé dont l'inscription est encore « en attente » : pas encore dans la feuille de notes
  ["00008", "ABS", "x".repeat(501)], // 12 : observation de plus de 500 caractères
]);

// ---------------------------------------------------------------------------------------------------------------------
// 08 — Soldes financiers d'ouverture (élèves TG-ELV-S01 à S08 du fichier 01-students-valide-secondaire.csv)
// ---------------------------------------------------------------------------------------------------------------------
/** [référence, élève, type, montant, libellé, année, échéance, facture visée, motif] */
const bal = (ref, eleve, type, montant, libelle, annee, echeance, visee, motif) => [ref, eleve, type, montant, libelle, annee, echeance, visee, motif];
csv("08-opening-balances-valide-secondaire.csv", [
  H_BALANCES,
  bal("TG-REPRISE-001", "TG-ELV-S01", "FACTURE", "45000", "Solde scolarité 2025-2026 (test guide)", "2025-2026", "31/12/2026", "", ""),
  bal("TG-REPRISE-002", "TG-ELV-S02", "FACTURE", "120000", "Solde scolarité 2025-2026 (test guide)", "2025-2026", "31/12/2026", "", ""),
  bal("TG-REPRISE-003", "TG-ELV-S03", "FACTURE", "75 000", "Solde cantine 2025-2026 (test guide)", "2025-2026", "31/12/2026", "", ""),
  bal("TG-REPRISE-004", "TG-ELV-S04", "FACTURE", "30000", "Solde transport 2025-2026 (test guide)", "2025-2026", "2026-12-31", "", ""),
  bal("TG-REPRISE-005", "TG-ELV-S05", "", "60000", "Solde scolarité 2025-2026 (test guide)", "", "", "", ""),
  bal("TG-REPRISE-006", "TG-ELV-S06", "facture", "100000", "Solde scolarité 2025-2026 (test guide)", "2025-2026", "31/12/2026", "", ""),
  bal("TG-REPRISE-007", "TG-ELV-S02", "AVOIR", "20000", "Remise fratrie (test guide)", "2025-2026", "", "TG-REPRISE-002", "Remise fratrie (test guide)"),
  bal("TG-REPRISE-008", "TG-ELV-S07", "FACTURE", "85000", "Solde scolarité 2025-2026 (test guide)", "2025-2026", "31/12/2026", "", ""),
]);
csv("08-opening-balances-erreurs-secondaire.csv", [
  H_BALANCES,
  bal("TG-REPRISE-E01", "TG-ELV-S09", "FACTURE", "50000", "Solde scolarité (test guide)", "2025-2026", "", "", ""), // 2 : valide
  bal("TG-REPRISE-E02", "TG-ELV-S09", "FACTURE", "1500,5", "Montant décimal", "2025-2026", "", "", ""), // 3 : montant décimal
  bal("TG-REPRISE-E03", "TG-ELV-S09", "FACTURE", "abc", "Montant texte", "2025-2026", "", "", ""), // 4 : montant non numérique
  bal("TG-REPRISE-E04", "TG-ELV-S09", "FACTURE", "-5000", "Montant négatif", "2025-2026", "", "", ""), // 5 : montant négatif
  bal("TG-REPRISE-E05", "TG-ELV-S09", "FACTURE", "0", "Montant nul", "2025-2026", "", "", ""), // 6 : montant nul
  bal("", "TG-ELV-S09", "FACTURE", "20000", "Sans référence", "2025-2026", "", "", ""), // 7 : référence vide
  bal("TG-REPRISE-E06", "99999-TG", "FACTURE", "20000", "Élève inconnu", "2025-2026", "", "", ""), // 8 : élève inconnu
  bal("TG-REPRISE-E07", "TG-ELV-S09", "AVOIR", "5000", "Avoir sans facture", "2025-2026", "", "", ""), // 9 : avoir sans facture visée ni motif
  bal("TG-REPRISE-E08", "TG-ELV-S09", "AVOIR", "5000", "Avoir sur facture inconnue", "2025-2026", "", "TG-REPRISE-INCONNUE", "Motif (test guide)"), // 10 : facture visée inconnue
  bal("TG-REPRISE-E09", "TG-ELV-S09", "REMBOURSEMENT", "5000", "Type inconnu", "2025-2026", "", "", ""), // 11 : type non reconnu
  bal("TG-REPRISE-E01", "TG-ELV-S09", "FACTURE", "50000", "Répète la ligne 2", "2025-2026", "", "", ""), // 12 : répète la ligne 2
  bal("TG-REPRISE-E10", "TG-ELV-S09", "FACTURE", "10000", "Facture avec facture visée", "2025-2026", "", "TG-REPRISE-E01", ""), // 13 : « Facture visée » ignorée (avertissement)
  bal("TG-REPRISE-E11", "TG-ELV-S09", "FACTURE", "10000", "Échéance impossible", "2025-2026", "31/02/2027", "", ""), // 14 : échéance invalide
]);

// ---------------------------------------------------------------------------------------------------------------------
// Cas limites : faux fichiers, fichiers vides
// ---------------------------------------------------------------------------------------------------------------------
writeFileSync(out("imports-cas-limites/vide.csv"), Buffer.alloc(0));
csv("imports-cas-limites/entetes-seulement.csv", [H_STUDENTS]);
writeFileSync(out("imports-cas-limites/faux-fichier-pdf.csv"), Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "latin1"));
writeFileSync(out("imports-cas-limites/autre-extension.json"), Buffer.from('{"eleves":[{"nom":"KOUASSI","prenoms":"Test guide"}]}\n', "utf8"));
// Du texte CSV renommé en .xlsx
writeFileSync(out("imports-cas-limites/faux-classeur-texte.xlsx"), Buffer.from(BOM + "" + csvText([encHeader, ...encRows("FAK")]), "utf8"));
// Une archive ZIP qui n'est pas un classeur (type « Word ») renommée en .xlsx
{
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Document de test guide</w:t></w:r></w:p></w:body></w:document>');
  writeFileSync(out("imports-cas-limites/faux-xlsx-document-word.xlsx"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
// Un texte OpenDocument (.odt) renommé en .ods
{
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  zip.file("content.xml", '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Texte de test guide</text:p></office:text></office:body></office:document-content>');
  writeFileSync(out("imports-cas-limites/faux-ods-texte.ods"), await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Fichiers volumineux (NON versionnés) : --gros / --enorme
// ---------------------------------------------------------------------------------------------------------------------
if (GROS) {
  // 300 élèves sans classe : de quoi laisser le temps d'annuler l'import en cours d'exécution.
  const rows = [H_STUDENTS_IDENTITY];
  for (let i = 1; i <= 300; i += 1) {
    const n = String(i).padStart(4, "0");
    rows.push(stu(`TG-BIG-${n}`, `GROSLOT${n}`, `Élève ${n} test guide`, i % 2 ? "F" : "M", `${String(1 + (i % 28)).padStart(2, "0")}/${String(1 + (i % 12)).padStart(2, "0")}/${2013 + (i % 2)}`, "Abidjan", { ville: "Abidjan" }).slice(0, 15));
  }
  csv("imports-gros/01-students-300-lignes-secondaire.csv", rows);
  // 5 500 lignes : dépasse le plafond de 5 000 lignes ET (avec adresses longues) les 5 Mio.
  const pad = "Adresse très longue pour gonfler le fichier ".repeat(24).slice(0, 1000);
  const big = [H_STUDENTS_IDENTITY];
  for (let i = 1; i <= 5200; i += 1) big.push(stu(`TG-VOL-${i}`, `VOLUME${i}`, `Élève ${i} test guide`, "F", "10/10/2013", "Abidjan", { adresse: pad, ville: "Abidjan" }).slice(0, 15));
  csv("imports-gros/trop-volumineux-5200-lignes.csv", big);
}
if (ENORME) {
  // Plus que la limite absolue du produit (20 Mio + 64 Kio) : refus avant toute lecture (HTTP 413).
  const line = Buffer.from(`${"X".repeat(1022)}\r\n`);
  const chunks = [Buffer.from(BOM + "Nom;Prénoms\r\n")];
  for (let i = 0; i < 21 * 1024; i += 1) chunks.push(line);
  writeFileSync(out("imports-gros/enorme-21mo.csv"), Buffer.concat(chunks));
}

console.log(`Fichiers écrits dans ${OUT}`);
