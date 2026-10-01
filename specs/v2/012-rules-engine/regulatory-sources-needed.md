# Textes officiels et exemples à obtenir — QUESTION MÉTIER (012-rules-engine)

**Statut** : liste de collecte, à transmettre au propriétaire du produit (plan §8, point ouvert n°5). **Aucune règle réglementaire ivoirienne officielle n'est écrite dans les specs** (MGA primaire, CEPE, BEPC, BAC, passage, redoublement, orientation, LMD, BTS…) : le moteur livre un **mécanisme** ; les valeurs viendront de textes que ni l'équipe technique ni cette spec ne détiennent.

Pour chaque ligne : le texte exact, sa date de publication et de validité, son numéro, l'autorité émettrice, et si possible un **exemple chiffré** (bulletin réel anonymisé avec le résultat attendu) servant de **cas d'or** aux tests (`golden tests`). Sans exemple chiffré, aucun RuleSet « officiel » ne sera publié : il resterait une interprétation.

> Désignation : le PRD (§51) cite l'autorité « MENAET » pour l'enseignement général ; l'appellation et les compétences exactes du ministère en charge de chaque ordre d'enseignement à la date de chaque texte sont à confirmer par le propriétaire.

## 1. Principes de collecte

1. **Texte, puis exemple** : pour chaque règle, le texte (arrêté, décret, circulaire, note de service) *et* 3 à 10 situations réelles avec le calcul complet et le résultat attendu.
2. **Version et date** : chaque texte fixe une période d'application ; les RuleVersions portent `effective_from/to` et `source.reference` = référence du texte.
3. **Personne de référence** : une personne désignée par le propriétaire (inspection, directeur des études d'un établissement pilote) valide chaque RuleSet avant publication nationale (D5).
4. **Rien d'implicite** : si un texte est muet (arrondi, égalité, note absente), la décision est posée comme **question** (`open-questions.md` §B), pas comme défaut caché.
5. **Traçabilité** : les documents sont archivés avec leur référence ; les golden tests citent la référence.

## 2. Enseignement primaire (spec 005 — Phase 4)

| # | Sujet à couvrir par RuleSet | Ce que le mécanisme attend | Documents / exemples à obtenir |
|---|---|---|---|
| 2.1 | Évaluation en cours d'année (compositions, interrogations) et calcul de la moyenne de période | Types d'évaluation, pondérations, barème, arrondi, traitement des absences | Texte sur les modalités d'évaluation au primaire ; bulletins officiels (modèle) |
| 2.2 | **MGA** (moyenne générale annuelle) et son mode de calcul | Formule, pondération des périodes, arrondi | Texte définissant la MGA ; exemples chiffrés d'élèves de CP1 à CM2 |
| 2.3 | Passage / redoublement | Seuils, rôle du conseil des maîtres, dérogations, nombre de redoublements autorisés | Texte sur le passage en classe supérieure ; PV types |
| 2.4 | Classement et rangs | Convention d'ex æquo, rang par matière / général, effectif de référence | Modèle officiel de bulletin et règle de classement |
| 2.5 | Maternelle (PS/MS/GS) | Évaluation par compétences ou appréciations (si non chiffrée) | Texte sur l'évaluation en maternelle |
| 2.6 | Bulletin / livret scolaire | Rubriques obligatoires, mentions, signatures, cachets | Modèle officiel de bulletin et de livret |
| 2.7 | CEPE (espace CM2) | Voir §4 | Voir §4 |

## 3. Enseignement secondaire (spec 006 — Phase 5)

| # | Sujet | Ce que le mécanisme attend | Documents / exemples à obtenir |
|---|---|---|---|
| 3.1 | Calcul des moyennes (note → moyenne matière → période → annuelle) | Types d'évaluation, coefficients par matière et par série, pondération des périodes, arrondi | Texte sur l'évaluation au collège et au lycée ; tableau officiel des coefficients par série |
| 3.2 | Formule de **moyenne générale / MGA secondaire** | Formule, éventuels malus/bonus | Texte de référence et exemples chiffrés |
| 3.3 | Passage, redoublement, orientation, réorientation, exclusion | Seuils, rôle du conseil de classe, cas particuliers | Textes sur le passage et l'orientation ; PV de conseil de classe types |
| 3.4 | Séries, options, langues | Liste des séries, matières par série, volumes horaires | Arrêtés / tableaux officiels |
| 3.5 | Conseil de classe | Composition, quorum, décisions possibles, contenu du PV | Texte sur le conseil de classe ; modèle de PV |
| 3.6 | Discipline et vie scolaire (impact sur le bulletin) | Conduite, absences, sanctions et leur place dans la moyenne | Règlement officiel |
| 3.7 | Mentions / distinctions (tableau d'honneur…) | Seuils, appellations | Texte ou règlement type |
| 3.8 | Bulletin | Rubriques, signatures, cachets | Modèle officiel |

## 4. Examens nationaux (spec 018)

| # | Examen | Ce que le moteur d'examens attend | Documents / exemples à obtenir |
|---|---|---|---|
| 4.1 | **CEPE** | Conditions d'éligibilité, numéro de candidat, centres, épreuves et coefficients, seuil d'admission, délibération, mentions | Textes d'organisation de l'examen ; modèle de relevé / attestation |
| 4.2 | **BEPC** | Idem + prise en compte éventuelle de la moyenne de classe | Idem |
| 4.3 | **BAC** (séries) | Idem + épreuves de rattrapage / second groupe | Idem |
| 4.4 | **BTS** | Admissibilité, examen, stage, soutenance, jury (spec 020/021) | Textes d'organisation du BTS ; modèle de relevé de notes et de diplôme |
| 4.5 | Examens blancs | Règles propres à l'établissement (pas de texte officiel attendu) | — |

## 5. Enseignement supérieur (spec 019)

| # | Sujet | Ce que le mécanisme attend | Documents / exemples à obtenir |
|---|---|---|---|
| 5.1 | Organisation **LMD** : crédits par semestre / année / diplôme, UE, ECUE | Nombre de crédits requis par niveau, définitions officielles | Textes sur l'architecture LMD applicable aux établissements privés |
| 5.2 | Validation des UE, **compensation**, note éliminatoire | Seuils (10 ? 5 ?), compensation interne à l'UE / entre UE / entre semestres | Textes d'évaluation et de validation ; règlement des études type |
| 5.3 | Sessions (normale, rattrapage) | Nombre de sessions, note retenue, plafonnement éventuel | Idem |
| 5.4 | Capitalisation et durée de validité des UE | Durée, conséquences d'un changement de programme | Idem |
| 5.5 | Mentions de diplôme (échelles) | Seuils par grade | Textes sur la délivrance des diplômes |
| 5.6 | **BTS** (formation, 2 années) | Voir §4.4 | Voir §4.4 |
| 5.7 | Diplômes, attestations, relevés | Mentions obligatoires, signataires, numérotation, authenticité | Modèles officiels ; règles de délivrance des duplicata |

> Les valeurs aujourd'hui en production (10 pour la validation, 5 pour l'élimination, mentions 10/12/14/16/18, 20 crédits par semestre non appliqués…) sont des **pratiques d'établissement** portées dans les RuleSets de départ ; leur conformité à un texte officiel n'est pas établie.

## 6. Documents officiels et identité (spec 013, 019)

| # | Sujet | Documents / exemples à obtenir |
|---|---|---|
| 6.1 | Mentions légales obligatoires sur un bulletin / relevé (en-tête, devise nationale, immatriculation de l'établissement) | Modèles officiels pour chaque ordre d'enseignement |
| 6.2 | Signataires habilités par type de document | Règlement ou instruction précisant qui signe |
| 6.3 | Durée de conservation et valeur probante d'un document numérique (QR de vérification) | Avis juridique (documents électroniques, protection des données) |
| 6.4 | Calendrier scolaire (début/fin d'année, périodes) — données du `CountryProfile` | Calendrier officiel de chaque année |

## 7. Paie des enseignants (spec 032) — optionnel

| # | Sujet | Documents à obtenir |
|---|---|---|
| 7.1 | Statut et rémunération des enseignants vacataires/permanents du privé (heures supplémentaires, majorations) | Convention collective applicable / code du travail (conseil juridique) |
| 7.2 | Retenues et cotisations légales sur les bulletins de paie | Barèmes en vigueur (non couverts par le legacy ; voir Q-28) |

## 8. Processus de réception d'un texte

1. Dépôt du texte et des exemples dans un dossier partagé hors dépôt de code (données potentiellement personnelles à anonymiser).
2. Rédaction d'une **note d'interprétation** (une page) signée du validateur désigné : formules, arrondis, égalités, absences.
3. Rédaction du RuleSet (brouillon) et des golden tests *avant* simulation.
4. Revue croisée par le validateur ; publication nationale par le super-admin.
5. Archivage du texte, de la note et du hash de la RuleVersion publiée.
