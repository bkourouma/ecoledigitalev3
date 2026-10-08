# Jeux de données du guide de test : fichiers d'import (chapitre 05)

Ce dossier contient les vrais fichiers d'exemple du chapitre `docs/guide-test/05-imports.md` (fichiers préfixés `01-` à `08-`, dossier `imports-cas-limites/`). Les fichiers des autres chapitres (préfixes `04-piece-`, `17-`, `20-`, `ged-`, `justificatif-`, etc.) sont décrits dans leurs chapitres.

Toutes les données sont fictives : noms suffixés "test guide", e-mails en `@exemple.test`, téléphones factices, matricules d'origine préfixés `TG-`. Format des CSV : UTF-8 avec BOM, séparateur `;`, fins de ligne CRLF, en-têtes identiques aux modèles de l'application. Les numéros de ligne cités sont ceux du tableur (en-têtes = ligne 1).

Régénération : `node docs/guide-test/jeux-de-donnees/generer-fichiers-imports.mjs` (réécrit tous les fichiers de ce tableau, y compris `.xlsx`, `.xls`, `.ods`, avec la bibliothèque `xlsx` du dépôt ; aucune installation). Option `--gros` : écrit dans `imports-gros/` (non versionné) le fichier de 300 lignes (annulation) et un fichier de 5,8 Mo (taille) ; option `--enorme` : fichier de 22 Mo (limite absolue du produit).

Validation : tous ces fichiers ont été lus par le vrai lecteur de fichiers et le vrai validateur du module (`apps/api/src/modules/imports`), hors base de données ; les contrôles contre l'existant (classes, élèves, doublons probables) sont décrits dans le chapitre.

## Ordre d'utilisation (secondaire, Collège Le Baobab)

`01-students-valide-secondaire` > `01-students-erreurs-secondaire` > `01-students-sans-classe-secondaire` > `02-guardians-valide-secondaire` > `04-classrooms-valide-secondaire` > `06-enrollments-valide-secondaire` > `03-staff-valide-secondaire` > `08-opening-balances-valide-secondaire`. Les notes (`07-`) exigent une évaluation en brouillon.

## Index

| Fichier | Importeur | Établissement | Résultat attendu |
|---|---|---|---|
| `01-students-valide-secondaire.csv` | Élèves | Collège Le Baobab | 10 lignes, classe `6E-A` : 10 à créer, 0 erreur (option année obligatoire) |
| `01-students-valide-primaire.csv` | Élèves | École Les Palmiers | 10 lignes, classe `CP1-A` : 10 à créer |
| `01-students-valide-superieur.csv` | Élèves | Université Horizon | 10 lignes, classe `L1-A` : 10 à créer |
| `01-students-erreurs-secondaire.csv` | Élèves | Collège Le Baobab | 15 lignes : 3 à créer, 12 en erreur, 1 avertissement (détail 5.13) |
| `01-students-sans-classe-secondaire.csv` | Élèves | Collège Le Baobab | 6 lignes sans classe : 6 à créer (puis inscrits par `06-`) |
| `01-students-maj-secondaire.csv` | Élèves | Collège Le Baobab | 3 lignes, politique "mettre à jour" : 3 mises à jour |
| `01-students-entetes-libres-secondaire.csv` | Élèves | Collège Le Baobab | en-têtes `matricule;nom;prénom;sexe;date de naissance;classe` reconnus par alias : 5 à créer |
| `01-students-formats-secondaire.csv` / `.xlsx` / `.xls` / `.ods` | Élèves | Collège Le Baobab | 5 lignes chacun : 4 à créer, 1 en erreur (31/02/2014) ; n'en exécuter qu'un |
| `01-students-feuilles-secondaire.xlsx` | Élèves | Collège Le Baobab | feuilles "LISEZ-MOI" puis "Eleves" ; sans le nom de feuille : colonnes obligatoires manquantes ; avec `Eleves` : 4 à créer (dates Excel natives) |
| `01-students-formule-secondaire.xlsx` | Élèves | Collège Le Baobab | 3 à créer + avertissement "1 cellule(s) contiennent une formule" |
| `01-students-formules-erreurs-secondaire.csv` | Élèves | Collège Le Baobab | 3 lignes en erreur (sexe manquant), noms `=2+2`, `+CMD`, `@SOMME(A1)` : rapport d'erreurs neutralisé (apostrophe) |
| `02-guardians-valide-secondaire.csv` | Parents et tuteurs | Collège Le Baobab | 11 lignes (élèves `TG-ELV-S01` à `S10`) : 11 liens, 1 tuteur sur 2 lignes créé une fois |
| `02-guardians-erreurs-secondaire.csv` | Parents et tuteurs | Collège Le Baobab | 10 lignes : 2 à créer, 8 en erreur, 1 avertissement (détail 5.18) |
| `03-staff-valide-secondaire.csv` | Enseignants et personnel | Collège Le Baobab | 8 lignes : 8 à créer |
| `03-staff-erreurs-secondaire.csv` | Enseignants et personnel | Collège Le Baobab | 10 lignes : 2 à créer, 8 en erreur, 1 avertissement (détail 5.19) |
| `04-classrooms-valide-secondaire.csv` | Classes | Collège Le Baobab | 8 classes `TG-5EA` à `TG-3EC` : 8 à créer |
| `04-classrooms-valide-primaire.csv` | Classes | École Les Palmiers | 6 classes `TG-CP2A` à `TG-CM2A` : 6 à créer |
| `04-classrooms-valide-superieur.csv` | Classes | Université Horizon | 4 classes `TG-L1P` à `TG-L1S` : 4 à créer |
| `04-classrooms-erreurs-secondaire.csv` | Classes | Collège Le Baobab | 12 lignes : 2 à créer (dont 1 refusée à l'écriture), 1 ignorée, 9 en erreur (détail 5.20) |
| `04-classrooms-erreurs-superieur.csv` | Classes | Université Horizon | 4 lignes : `L2` dans `INFO` refusé à l'écriture, programme et niveau inconnus, `L1-A` ignorée |
| `04-classrooms-echec-ecriture-superieur.csv` | Classes | Université Horizon | 3 lignes sans erreur de lecture, 1 refusée à l'écriture : "Tout ou rien" = Échec sans écriture |
| `05-curriculum-valide-secondaire.csv` | Matières et curriculum | Collège Le Baobab | 6 noeuds (niveau `6E` + 5 matières) dans une version en brouillon |
| `05-curriculum-valide-superieur.csv` | Matières et curriculum | Université Horizon | 8 noeuds (niveau, semestre, 2 UE, 4 ECUE) dans une version en brouillon |
| `05-curriculum-erreurs-secondaire.csv` | Matières et curriculum | Collège Le Baobab | 13 lignes : 3 à créer, 10 en erreur (détail 5.21) |
| `06-enrollments-valide-secondaire.csv` | Inscriptions | Collège Le Baobab | 6 lignes (`TG-INS-01` à `06` vers `6E-A`) : 6 à créer |
| `06-enrollments-erreurs-secondaire.csv` | Inscriptions | Collège Le Baobab | 11 lignes : 2 à ignorer, 9 en erreur, rien à écrire (détail 5.22) |
| `07-grades-valide-secondaire.csv` | Notes / Notes de mes classes | Collège Le Baobab | 8 lignes (élèves `00001` à `00008`, notes, ABS, ABJ, DISP) : 8 à créer sur une évaluation en brouillon sur 20 |
| `07-grades-erreurs-secondaire.csv` | Notes | Collège Le Baobab | 11 lignes : 1 à créer, 10 en erreur (détail 5.23) |
| `08-opening-balances-valide-secondaire.csv` | Soldes financiers d'ouverture | Collège Le Baobab | 8 lignes (7 factures, 1 avoir) : 8 à créer, MFA au lancement |
| `08-opening-balances-erreurs-secondaire.csv` | Soldes financiers d'ouverture | Collège Le Baobab | 13 lignes : 2 à créer, 11 en erreur, 1 avertissement (détail 5.24) |
| `imports-cas-limites/vide.csv` | tout importeur | tous | refus : "Le fichier est vide." |
| `imports-cas-limites/entetes-seulement.csv` | tout importeur | tous | refus : "Le fichier ne contient aucune ligne de données sous les en-têtes." |
| `imports-cas-limites/faux-fichier-pdf.csv` | tout importeur | tous | refus : fichier PDF |
| `imports-cas-limites/faux-classeur-texte.xlsx` | tout importeur | tous | refus : texte renommé en `.xlsx` |
| `imports-cas-limites/faux-xlsx-document-word.xlsx` | tout importeur | tous | refus : archive qui n'est pas un classeur Excel |
| `imports-cas-limites/faux-ods-texte.ods` | tout importeur | tous | refus : pas un tableur OpenDocument |
| `imports-cas-limites/autre-extension.json` | tout importeur | tous | refus : extension non prise en charge |
| `imports-cas-limites/01-students-encodage-ansi-secondaire.csv` | Élèves | Collège Le Baobab | windows-1252, 4 à créer, accents corrects |
| `imports-cas-limites/01-students-encodage-virgule-secondaire.csv` | Élèves | Collège Le Baobab | séparateur `,`, UTF-8 sans BOM : 4 à créer |
| `imports-cas-limites/01-students-encodage-tabulation-secondaire.tsv` | Élèves | Collège Le Baobab | séparateur tabulation : 4 à créer |
| `imports-cas-limites/01-students-entetes-doubles-secondaire.csv` | Élèves | Collège Le Baobab | avertissement en-têtes en double renommés |
| `imports-gros/01-students-300-lignes-secondaire.csv` (généré, `--gros`) | Élèves | Collège Le Baobab | 300 élèves sans classe : de quoi annuler l'import en cours d'exécution |
| `imports-gros/trop-volumineux-5200-lignes.csv` (généré, `--gros`) | Élèves | tous | refus : taille supérieure à 5 Mio |
| `imports-gros/enorme-21mo.csv` (généré, `--enorme`) | Élèves | tous | refus avant lecture (plus de 20 Mio) |
