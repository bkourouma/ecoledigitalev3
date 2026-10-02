# Textes officiels et exemples à obtenir — Primaire (005-primary)

**Statut** : liste de collecte, à transmettre au propriétaire du produit (plan §8, point ouvert n°5 ; complète `specs/v2/012-rules-engine/regulatory-sources-needed.md` §2, dont elle reprend la numérotation 2.1 à 2.7). **Aucune règle officielle n'est inventée dans les specs** : le pack Primary livre un mécanisme et un jeu fictif (`source.kind = placeholder`). Tant que les éléments ci-dessous ne sont pas fournis, **aucun RuleSet « réglementaire » du primaire ne sera publié**.

Pour chaque ligne : le texte exact (ou à défaut la description de la pratique), sa **date** et son **autorité émettrice**, et si possible **3 à 10 situations réelles** (bulletins ou fiches anonymisés) avec le calcul complet et le résultat attendu. Sans exemple chiffré, un RuleSet reste une interprétation.

## 1. Comment répondre (sans connaissance technique)

- Une photo ou un scan lisible du texte suffit ; indiquer d'où il vient (ministère, direction régionale, inspection, établissement) et sa date.
- Si le texte n'existe pas et que **la pratique de l'établissement** s'applique, le dire : la plateforme saura distinguer « règle officielle » et « règle de l'établissement ».
- Si deux établissements font différemment, c'est une **bonne nouvelle** : cela confirme que la règle doit être un réglage, pas une constante. Décrire les deux.
- Les noms d'élèves doivent être masqués (initiales ou numéros) ; garder les notes, les coefficients, les rangs et les décisions.

## 2. Primaire — textes et exemples

| # | Sujet | Ce que le mécanisme attend | Documents / exemples à obtenir | Pourquoi c'est bloquant |
|---|---|---|---|---|
| 2.1 | **Évaluation en cours d'année** (interrogations, devoirs, compositions) | Types d'évaluation, nombre et périodicité, pondération entre types, barème (sur 10 ? sur 20 ?), traitement d'un élève absent à une composition | Texte sur les modalités d'évaluation du primaire ; un cahier de notes ou une fiche de composition type | Règle `moyenne_matiere` (`poids_par_type`, barème) |
| 2.2 | **MGA** (moyenne générale annuelle) | Comment les périodes se combinent (simple moyenne ? pondérée ?), arrondi, traitement d'une période manquante | Texte définissant la MGA ; **au moins 5 exemples chiffrés** (CP1 à CM2) avec les moyennes de période et la MGA obtenue | Règle `moyenne_generale_annuelle` (contrat `coef-period@1`) ; si un autre paramètre apparaît, il faudra un `coef-period@2` |
| 2.3 | **Passage et redoublement** | Seuil ou critères de passage, **rôle du conseil des maîtres** (décide-t-il seul ? confirme-t-il ? peut-il déroger ?), nombre maximal de redoublements, cas particuliers (maladie, arrivée en cours d'année) | Texte sur le passage en classe supérieure ; 3 procès-verbaux de conseil types ; liste des dérogations connues | Règles `decision_fin_annee`, `cas_a_examiner`, `cas_deja_redoublant` |
| 2.4 | **Classement et rangs** | Rang par matière, par période, annuel ; convention d'ex æquo ; effectif de référence ; affichage ou non sur le bulletin | Modèle officiel de bulletin ; une classe complète anonymisée avec les rangs (y compris des ex æquo) | Règles `rang_*` ; réglage d'affichage du gabarit |
| 2.5 | **Maternelle (PS, MS, GS)** | Évaluation chiffrée ou par compétences ? échelle d'appréciation ? référentiel de compétences par section ? règle d'admission en CP1 (âge, maturité) | Texte ou guide sur l'évaluation en maternelle ; **référentiel officiel de compétences** (domaines et compétences) ; modèle de livret ou de carnet | Remplace le référentiel et l'échelle **fictifs** ; contrat `competency-period@1` |
| 2.6 | **Bulletin et livret scolaire** | Rubriques obligatoires, mentions, devise, signatures et cachets, périodicité d'édition, existence d'un livret cumulatif | **Modèle officiel de bulletin** et **de livret** (un exemplaire rempli, anonymisé) | Gabarits `report-primary` et `annual-review-primary` |
| 2.7 | **CEPE** | Voir `specs/v2/018-examinations/regulatory-sources-needed.md` | Idem | Spec 018 |
| 2.8 | **Conseil des maîtres** | Composition, qui préside, fréquence, **quorum**, décisions possibles, contenu et conservation du procès-verbal | Texte sur le conseil des maîtres ; un PV signé type | Règle `quorum_conseil` ; gabarit `council-minutes` |
| 2.9 | **Calendrier scolaire** | Début et fin d'année, nombre de périodes, dates des compositions, vacances et jours fériés (jours ouverts) | Calendrier officiel des trois dernières années | Plans de périodes, règle `cas_absences` (jours ouverts) |
| 2.10 | **Disciplines, programmes, coefficients, volumes horaires** | Liste des disciplines par niveau, coefficients éventuels, matières transversales (conduite ?), volumes horaires | Programmes officiels ; tableau des disciplines et coefficients par niveau | Curriculum du pack (aujourd'hui **vide** et fictif) |
| 2.11 | **États et statistiques à transmettre** (par exemple à la direction régionale ou à l'inspection — à confirmer) | Quels états, quelle périodicité, quelles colonnes, quel support | Un exemplaire de chaque état et sa consigne de remplissage | Rapport R8 (formats d'export configurables) |
| 2.12 | **Conservation des archives et données personnelles des enfants** | Durée de conservation des bulletins, bilans, listes ; règles de consentement des parents ; droits de rectification | Texte applicable (conservation des documents scolaires ; protection des données personnelles) ; avis juridique si disponible | `archive_retention_years` ; consentements ; purge |
| 2.13 | **Identifiants des élèves** | Existe-t-il un numéro national d'élève ? format, qui l'attribue, quand | Texte ou note de service ; exemple de format | Champ `people` (008) et exports officiels |
| 2.14 | **Organisation pédagogique** | Classes à plusieurs niveaux (multigrades), double flux (classes du matin et de l'après-midi), demi-journées | Description ; textes éventuels | Questions Q-P10 et Q-P17 |

## 3. Exemples chiffrés attendus (« cas d'or »)

Ce sont les **tests de conformité** du futur RuleSet officiel (le jeu fictif n'en a pas). Pour chacun : notes de chaque matière (avec coefficients et barème), moyennes de période, MGA, rang, décision attendue, et — pour la décision — qui l'a prise (règle ou conseil) et pourquoi.

| Cas | Pourquoi il est utile |
|---|---|
| Un élève nettement au-dessus du seuil de passage | Cas nominal |
| Un élève nettement au-dessous | Cas nominal |
| Un élève **à un dixième près** du seuil (au-dessus puis au-dessous) | Arrondi, comparaison, rôle du conseil |
| Un élève avec une période **manquante** (arrivée en cours d'année, maladie) | Traitement d'une valeur absente |
| Un élève **déjà redoublant** | Plafond de redoublements |
| Un élève de **CM2** et son lien avec le CEPE | Fin de cycle |
| Une classe avec **ex æquo** | Convention de classement |
| Un élève de **maternelle** (une fiche de compétences complète) | Évaluation sans note |

## 4. Processus de réception d'un texte

Identique à `012/regulatory-sources-needed.md` §8 : dépôt hors dépôt de code → note d'interprétation d'une page signée du validateur désigné → RuleSet brouillon et golden tests **avant** simulation → revue croisée → publication nationale → archivage du texte et de l'empreinte de la RuleVersion.

## 5. Questions non techniques correspondantes

Voir `open-questions.md` partie B (Q-P01 à Q-P20) : chaque question propose des options et indique la **valeur par défaut** appliquée tant qu'elle n'est pas tranchée.
