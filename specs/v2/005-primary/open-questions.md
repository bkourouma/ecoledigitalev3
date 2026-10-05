# Décisions et questions ouvertes — 005-primary

**Portée** : partie A = décisions **techniques** tranchées et justifiées (005) ; partie B = **questions métier** non techniques, avec options et **valeur par défaut retenue** tant que le propriétaire du produit n'a pas tranché (`specs/v2/DECISIONS-METIER.md` l'emporte dès qu'une réponse y est inscrite) ; partie C = renvoi vers les questions de 007 et de 018.

Aucune règle officielle n'est inventée : une valeur par défaut ci-dessous est un **réglage modifiable ou une absence de règle**, jamais une règle réglementaire.

## A. Décisions techniques tranchées

| # | Décision | Justification | Alternative écartée |
|---|---|---|---|
| T-P01 | Un module `primary_school` (schéma `primary_school`, migrations `1800–1899`) — et **pas** un moteur ni un module « primary » | Le primaire compose `academic`, `assess`, `results`, `rules`, `reportcards`, `attendance` ; il ne manque que des **données pédagogiques** et des **journaux**. PRIMARY est un mot réservé SQL (`PRIMARY KEY`) : un schéma `primary` obligerait à citer l'identifiant partout | Réimplémenter notes/moyennes pour le primaire (viole D2 et R2) |
| T-P02 | Le conseil des maîtres **réutilise** `results.deliberations` (`kind = COUNCIL`) et `results.decisions` | 011 prévoit explicitement cette réutilisation (§5.8) ; la règle propose, le conseil confirme, la justification d'un écart est conservée ; 006 fera de même pour le conseil de classe | Table de décisions propre au primaire (doublon, divergence entre 005 et 006) |
| T-P03 | Contrat **propre** `coef-period@1` (N périodes pondérées) plutôt que d'étendre `coef-semester@1` | `coef-semester@1` encode « S1 / S2 » et `second_semestre` ; le primaire a un nombre de périodes paramétrable et des poids en donnée (`period_plans.slots[].weight`). Le contrat est volontairement **générique** : un texte officiel s'y loge sans nouveau code dans la plupart des cas | Faire passer le primaire par `coef-semester@1` (hypothèse « deux semestres » non établie) |
| T-P04 | L'**évaluation par compétences** vit dans `primary_school`, pas dans `assess` | `assess` ne porte que des notes numériques (`0 ≤ score ≤ barème`, `numeric`) : y mettre des niveaux de maîtrise affaiblirait ses invariants | Colonne « niveau » dans `assess.grades` |
| T-P05 | Les compétences produisent des **compteurs** (niveaux par domaine), **jamais** une moyenne ni un seuil | Toute interprétation chiffrée serait une règle (R2) ; l'état des textes ne permet pas d'en poser | Pourcentage de compétences « acquises » (suppose un seuil) |
| T-P06 | Ajouter `placeholder` à l'énumération `source_kind` de 012 | Distingue « valeur fictive de démonstration » de `platform` (portage fidèle du legacy) et de `institution` (règle de l'établissement) ; permet un filigrane et un refus de liaison en production | Marquer le fictif par un nom de RuleSet seulement (fragile, contournable) |
| T-P07 | Le bilan annuel est un **instantané scellé** (`annual_reviews`) ; le PDF est rendu et signé par `reportcards` depuis cet instantané | Même patron que les bulletins (013) : immuabilité par déclencheurs, version n+1 pour corriger, QR. Le module n'a ni PDF ni clé de signature | Générer le bilan à la demande depuis les tables vivantes (non reproductible) |
| T-P08 | `period_locks` : **miroir local** des états de période alimenté par les événements `academic.*`, **doublé** d'un contrôle synchrone via le port `PeriodStatePort` à chaque écriture (échec fermé) | Pas de lecture inter-schémas (ADR-006) ; le verrou SQL est une défense en profondeur si un événement est en retard ; l'API reste la source de vérité | Se fier au seul événement (fenêtre d'écriture indue) ou au seul appel (pas de garde-fou base) |
| T-P09 | L'archivage d'année est un **gel logique** (`year_archives.FROZEN`) avec manifeste et empreinte, sans déplacement ni purge | Les données restent consultables (familles, direction) ; aucune durée de conservation officielle n'est connue (Q-P11) ; un déplacement physique compliquerait l'isolation et les sauvegardes | Table d'historique séparée ; export hors base |
| T-P10 | « Instituteur » = **rôle RBAC** (`instituteur`) + affectation `HOMEROOM` avec `covers_all_subjects` (009) ; pas de nouvelle entité | 009 a déjà le titulaire de classe et le généraliste ; le droit se lit dans les permissions, jamais dans un nom de rôle (R7 de la convention) | Entité « instituteur » dans `primary_school` |
| T-P11 | Garde d'activation « classe du primaire ⇒ titulaire » via un **port** `ClassroomActivationGuard` de `academic` | `academic` ne dépend pas de `people` ; le port est implémenté au câblage par `people` ; comportement de repli : aucun refus, sauf si `primary_school.settings.require_homeroom_for_activation` | Contrainte SQL inter-schémas (interdite) |
| T-P12 | Saisie des compétences **en lot idempotente** (`Idempotency-Key`, ≤ 500 lignes, tout ou rien, `rowVersion`) | Smartphone, réseau faible, reprise sans doublon (même contrat que `assess`, 029 le consommera hors-ligne) | Saisie ligne à ligne |
| T-P13 | Révision d'une appréciation validée : la trace (`competency_revisions.xid = txid_current()`) **précède** la correction dans la même transaction | Aucune correction silencieuse possible, même avec un accès SQL direct d'`app_user` : la trace est la seule porte (testé) | Réglage de transaction `SET LOCAL` (forgeable) |
| T-P14 | Aucune constante réglementaire dans `primary_school` ; paramètres = données ; lint R2 | Principe de la plateforme (000) | — |
| T-P15 | Les tables ne référencent les niveaux (PS, CP1…) que par leur **code** (`grade_level_code`) | Pas de FK inter-schémas ; le code est stable (004, `UNIQUE (tenant_id, code)`) | UUID de niveau (plus fragile à l'import et aux seeds) |

## B. Questions métier (non techniques)

Format : **question** — options — **défaut retenu** (applicable tant que la question n'est pas tranchée). Les questions Q-P01 à Q-P20 sont à poser au propriétaire du produit, avec les textes de `regulatory-sources-needed.md`.

| # | Question | Options | Défaut retenu |
|---|---|---|---|
| Q-P01 | Sur quelle **échelle** note-t-on les élèves du primaire ? | sur 10 ; sur 20 ; autre selon le niveau | **Sur 20** (barème par défaut de la plateforme, modifiable par type d'évaluation) ; aucune conséquence réglementaire |
| Q-P02 | Combien de **périodes** dans l'année et de quel type ? | 3 trimestres ; 2 semestres ; autre | **3 trimestres** proposés (plan `THREE_TERMS`) ; l'établissement peut choisir `TWO_SEMESTERS` ou un plan personnalisé |
| Q-P03 | Les périodes ont-elles le **même poids** dans la moyenne annuelle ? | oui ; poids différents (lesquels) | **Poids égaux (1-1-1)**, neutres ; modifiable dans le plan de périodes |
| Q-P04 | Les **rangs** figurent-ils sur le bulletin du primaire ? Comment traiter les ex æquo ? | oui/non ; rang « compétition » (1, 1, 3) ou « dense » (1, 1, 2) | **Décidé le 2026-10-05 : rang AFFICHÉ par défaut**, classement « compétition » (1, 1, 3) ; l'établissement peut le désactiver (option `showRank` du gabarit, v2) ; la maternelle, sans note, n'a jamais de rang |
| Q-P05 | Le primaire a-t-il des **mentions** ou des appréciations chiffrées (« Bien », « Très bien »…) ? | oui (lesquelles, quels seuils) ; non | **Décidé le 2026-10-05 : OUI, mentions automatiques par seuils de moyenne**, seuils RÉGLABLES par l'établissement (variante de jeu de règles) et désactivables ; valeurs de départ FICTIVES (`source_kind = placeholder`, jeu `CI-PRIMARY-PLACEHOLDER` v3), aucune échelle officielle inventée ; `appreciation_periode` reste inactive, appréciations rédigées par l'instituteur |
| Q-P06 | Qui **décide** du passage : la règle, le conseil, ou la règle puis le conseil ? | règle seule ; conseil seul ; règle propose, conseil confirme | **La règle propose, le conseil confirme** (comportement de `results` : toute décision confirmée est tracée, un écart exige une justification) |
| Q-P07 | Que contient le **bilan annuel** / livret cumulatif ? | résultats de l'année seuls ; cumul de plusieurs années ; avec compétences | **Année en cours** : résultat d'année, synthèse des compétences, assiduité, décision ; le cumul pluriannuel est une évolution (relevé cumulé, 013) |
| Q-P08 | La **maternelle** est-elle évaluée avec des notes ou sans ? Quelle échelle de niveaux ? | sans note, par compétences ; notes ; mixte | **Sans note, par compétences** avec une échelle de démonstration à 4 niveaux (modifiable) ; pas de rang |
| Q-P09 | Le **CEPE** conditionne-t-il le passage en classe supérieure (CM2) ou seulement l'entrée en 6e ? | décision de passage indépendante du CEPE ; passage lié au CEPE | **Indépendants** : la décision de CM2 n'attend pas le CEPE (018 gère l'examen) ; `terminal_exam_required` reste faux |
| Q-P10 | Existe-t-il des classes à **plusieurs niveaux** (multigrades) à gérer ? | oui ; non | **Non supportées en V1** : une classe = un niveau (un programme multi-niveaux reste possible côté `academic`) |
| Q-P11 | Combien de **temps conserver** les bilans, listes et archives ? Peut-on rouvrir une année archivée ? | durée fixe (laquelle) ; illimitée ; réouverture exceptionnelle (qui décide) | **Illimitée, aucune purge** ; archive gelée irréversible ; **dégel exceptionnel** = procédure super-admin motivée et auditée (à décider) |
| Q-P12 | Quels **états** faut-il transmettre à l'administration (direction régionale, inspection…) ? | liste à fournir | Rapports internes R1 à R7 livrés ; R8 = formats d'export **configurables** sans engagement de conformité |
| Q-P13 | Quand l'instituteur est **remplacé** en cours d'année, qui garde la main sur les notes et appréciations déjà saisies ? | l'ancien (lecture) ; le nouveau (modification) | Les écrits gardent leur **auteur** (identité figée) ; le nouveau titulaire agit à partir de la date d'effet ; toute correction passe par la révision tracée |
| Q-P14 | Quel est le **quorum** du conseil des maîtres ? | nombre ou pourcentage des maîtres convoqués ; aucun | **Aucun quorum bloquant** : présence comptée et affichée ; règle `quorum_conseil` à 50 % **fictive** et sans effet bloquant tant qu'elle n'est pas sourcée |
| Q-P15 | Y a-t-il un **nombre maximal de redoublements** par cycle ? | oui (combien) ; non | **Aucun plafond** posé ; le nombre de redoublements est une entrée de règle (`cas_deja_redoublant`), signalée au conseil |
| Q-P16 | Les élèves **affectés par l'État** concernent-ils le primaire ? | oui ; non (secondaire seulement) | **Non activé** pour PRIMARY (la fonction `academic.state-assigned` est déclarée pour SECONDARY) ; activable par entitlement si besoin |
| Q-P17 | L'appel se fait-il par **demi-journée** (matin / après-midi) ? Combien de jours ouverts par an ? | journée entière ; demi-journées | **Appel journalier unique** ; jours ouverts = calendrier du tenant ; demi-journée = évolution (politique d'appel) |
| Q-P18 | Les parents voient-ils les **rangs** et le **détail des compétences** ? | oui ; non ; après publication seulement | **Après publication** du bulletin ; rang visible seulement si l'affichage est activé (Q-P04) |
| Q-P19 | Quelles sont les **disciplines**, les coefficients et les matières transversales par niveau ? | à fournir (programmes officiels) | Curriculum **vide** (fictif en démonstration) ; coefficients neutres (1) ; chaque établissement le saisit |
| Q-P20 | La **conduite** est-elle notée au primaire et compte-t-elle dans la moyenne ? | non notée ; notée hors moyenne ; notée dans la moyenne | **Matière transversale non comptée** (`is_transversal`, `counts_in_average = false`), sans enseignant affecté ; modifiable par nœud |

## C. Renvois

- **007-admissions** : voir `specs/v2/007-admissions/open-questions.md` (questions Q-A01 à Q-A18 : frais de dossier, délai de validité d'une offre, priorités de la liste d'attente, durée de conservation des dossiers refusés, consentements, âge minimal par niveau, affectés par l'État à l'admission…).
- **018-examinations** : voir `specs/v2/018-examinations/open-questions.md` et `regulatory-sources-needed.md` (questions Q-E01 à Q-E18 : épreuves et coefficients du CEPE, conditions d'éligibilité, numéro de candidat, taux de réussite, formats d'export officiels…).
- **Textes à obtenir** : `regulatory-sources-needed.md` (primaire) et celui de 018 (examens).

## D. Décisions techniques prises à l'implémentation

| # | Décision | Justification |
|---|---|---|
| T-P16 | Plage de migrations `1800–1899` (la spec initiale prévoyait cette plage ; une renumérotation transitoire en `1900–1999` a été annulée par le lead car `admissions` occupe `1900`) ; migration additive `1803` (période du conseil, procès-verbal figé) | `imports` occupe `1800` ; le procès-verbal doit être FIGÉ en base (contenu, empreinte, version) avant d'être confié à `reportcards`, et un conseil doit retrouver sa période sans interroger `results` |
| T-P17 | Idempotence de la saisie en lot par convergence, sans table de reçus | Une ligne identique n'est jamais réécrite ; une ligne différente exige `rowVersion` ; la reprise après échec réseau rejoue le même lot sans doublon (testé) |
| T-P18 | Permission `primary.class.read_all` | Distinguer « toutes les classes » (direction, secrétariat) de « mes classes » sans nom de rôle codé en dur (convention n° 7) |
| T-P19 | Le PDF d'un bilan est demandé par un abonné du worker à `primary_school.annual_review.sealed` ; « publié » pour une famille = scellé ET PDF émis | Le scellement (acte sensible, immuable) ne doit jamais dépendre d'un rendu qui peut échouer ou d'une nature de document non encore livrée |
| T-P20 | Le conseil se tient avant la clôture de la période ; le bilan se scelle après | Contrainte réelle de `results` (délibération et décisions refusées sur une période `CLOSED`) |

## E. Questions supplémentaires pour le propriétaire du produit

| # | Question | Options | Défaut retenu |
|---|---|---|---|
| Q-P21 | Un instituteur lit-il les bilans annuels de SA classe ? | oui (lecture seule) ; non | **Oui** (`primary.bilan.read`), préparation et scellement réservés à la direction |
| Q-P22 | Que voit la famille entre la réémission d'un bilan et son nouveau scellement ? | rien ; l'ancienne version | **Rien** (une seule version vivante par inscription et par année) ; à arbitrer si le trou est gênant (autoriserait deux versions vivantes en lecture, évolution du DDL) |
| Q-P23 | Un bilan peut-il être scellé avant que le PDF existe, et l'archive gelée sans PDF ? | oui / non | **Scellement : oui ; gel de l'archive : non** (tous les PDF doivent être émis) |
