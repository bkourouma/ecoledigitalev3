# Questions métier à valider — EcoleDigitale v2

**Consolidation unique de toutes les questions métier ouvertes**, avec la valeur par défaut appliquée pour chacune. Source de vérité : `specs/v2/DECISIONS-METIER.md` emporte toute valeur par défaut proposée ici.

**Mise à jour** : 2026-10-02

---

## 004 — Cœur académique (O-01 à O-23)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| O-01 | Quand une inscription est-elle « confirmée » ? | Automatique après paiement des frais d'inscription (événement `finance.invoice.paid` sur la ligne d'inscription) | Calendrier de confirmation décalé ou blocages impayés | Propriétaire du produit |
| O-02 | Programmes officiels de la Côte d'Ivoire (listes de matières, coefficients, séries) | Niveaux livrés ; chaque école saisit ses matières et coefficients (aucune invention) | Règles fausses, données manquantes pour les certificats | Propriétaire + personne de référence inspection |
| O-03 | Découpage de l'année (primaire/secondaire) : 3 trimestres, 2 semestres, ou libre ? | Libre par école ; modèles 3 trimestres et 2 semestres proposés | Calendrier incohérent ou calculs de moyennes faux | Propriétaire du produit |
| O-04 | Élèves affectés par l'État : cumul de financements ou un seul ? | Un seul type de financement par inscription (principal) ; détail des parts dans la facturation | Facturation double ou affectations ignorées | Propriétaire du produit |
| O-05 | Génération automatique de l'emploi du temps | Aide au placement (suggestions de créneaux libres, détection de conflits) en V1 ; générateur complet plus tard | Surcharge manuelle ou impossibilité de planification | Propriétaire du produit |
| O-06 | Heures de surveillance et co-enseignement : rémunération ? | Enseignant responsable, co-enseignant et remplaçant rémunérés ; surveillant non rémunéré par défaut | Budget de paie faux ou contestations | Propriétaire du produit |
| O-07 | Fusion de dossiers en double | V1 : pas de fusion (avertissement à la création) ; fusion assistée plus tard | Perte de données ou doublons | Propriétaire du produit |
| O-08 | Champs de santé (allergies, maladies, vaccinations) | Non en V1 (donnée très sensible) | Manque information critique ou exposition RGPD | Propriétaire + juridique |
| O-09 | Règles d'absence (retards = absences, seuils d'alerte) | Aucune équivalence ni seuil codé ; chaque école configure les siens | Alertes fausses ou inapplicables | Propriétaire + textes officiels |
| O-10 | Jours fériés et calendrier scolaire | Saisie par l'école en V1 ; calendrier officiel livré plus tard | Jours ouvrés faux ou appels invalides | Propriétaire du produit |
| O-11 | Même UE dans deux semestres (supérieur) | Non géré en V1 ; on duplique l'unité | Confusion de résultats ou validation fausse | Propriétaire du produit |
| O-12 | Changement de classe en cours d'année : fusion ou séparation des notes ? | Regroupement avec mention des deux classes ; notes restent attachées à l'inscription d'origine | Bulletin incohérent ou notes perdues | Propriétaire du produit |
| O-13 | Format de numéro d'élève et numéro national obligatoire | Format réglable par école (défaut 5 chiffres) ; numéro national facultatif et unique | Validation fausse ou doublon impossible à détecter | Propriétaire + direction |
| O-14 | Dispenses et équivalences (UE) | Hors V1 | Prérequis ignorés ou validation fausse | Propriétaire du produit |
| O-15 | Durée de conservation des dossiers avant anonymisation | À fournir (droit à l'effacement) | Non-conformité RGPD | Juridique / autorités |
| O-16 | Élève inscrit dans plusieurs établissements simultanément | Autorisé (une inscription par établissement) | Confusion de financements ou doublons | Propriétaire du produit |
| O-17 | Réservation d'une place avant paiement (durée) | Durée réglable par école ; sans limite par défaut serait un risque | Places bloquées indéfiniment | Propriétaire + direction |
| O-18 | Crédits et compensation (supérieur) | 20 crédits par semestre et 48 pour l'année = paramètres de règles modifiables, sans compensation entre UE par défaut | Validation et passage faux | Propriétaire + textes officiels |
| O-19 | Disponibilités des enseignants par défaut | Disponible si aucune déclaration | Conflits d'emploi du temps ou absence injustifiée | Direction des études |
| O-20 | Justification d'une absence : par qui et quelles pièces ? | Parent, élève majeur et école ; PDF/photo ≤ 5 Mo ; pièce obligatoire pour la maladie | Justifications manquantes ou invalides | Propriétaire + règlement |
| O-21 | Validation « à quatre yeux » des heures comptables | Réglable par établissement (défaut : interdire à celui qui saisit de valider) | Double paie ou heures fausses | Propriétaire du produit |
| O-22 | Se réinscrire à une UE validée | Autorisé avec avertissement et motif | Doublon ou amélioration impossible | Propriétaire du produit |
| O-23 | Qui peut déclarer/modifier une séance ? | Enseignants : séance ponctuelle de leurs classes oui, réservation de salle selon permission | Séances non déclarées ou conflit de ressources | Direction des études |

---

## 005 — Enseignement primaire (Q-P01 à Q-P20)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-P01 | Échelle de notation des élèves du primaire | Sur 20 (barème par défaut, modifiable par type d'évaluation) | Notes incomparables ou moyennes fausses | Propriétaire + textes officiels |
| Q-P02 | Périodes dans l'année (primaire) | 3 trimestres proposés (plan `THREE_TERMS`) ; l'établissement peut choisir 2 semestres ou autre | Calendrier incohérent ou calculs faux | Propriétaire du produit |
| Q-P03 | Poids des périodes dans la moyenne annuelle | Poids égaux (1-1-1), modifiables dans le plan | Moyenne annuelle fausse | Propriétaire + textes officiels |
| Q-P04 | Rangs sur le bulletin du primaire et égalité | Rang calculé (compétition), affichage désactivé par défaut | Confusion des élèves ou invaleur | Direction des études |
| Q-P05 | Mentions ou appréciations chiffrées (primaire) | Non : règles fictives et inactives ; appréciations rédigées par l'instituteur | Appréciations manquantes ou impersonnelles | Propriétaire du produit |
| Q-P06 | Qui décide du passage : règle ou conseil ? | Règle propose, conseil confirme (tracé et justification obligatoire en cas d'écart) | Passage injustifié ou non documenté | Propriétaire + textes officiels |
| Q-P07 | Contenu du bilan annuel / livret cumulatif | Année en cours : résultat d'année, synthèse des compétences, assiduité, décision | Historique perdu ou cumul manquant | Propriétaire du produit |
| Q-P08 | Évaluation de la maternelle | Sans note, par compétences à 4 niveaux de démonstration (modifiable) ; pas de rang | Notes inappropriées ou confusion avec CP1 | Propriétaire + textes officiels |
| Q-P09 | CEPE : condition de passage en 6e ou juste entrée en 6e ? | Indépendants : passage de CM2 sans attendre CEPE | Inscription en 6e bloquée ou CEPE inutile | Propriétaire + textes officiels |
| Q-P10 | Classes multi-niveaux (multigrades) | Non supportées en V1 : une classe = un niveau | Confusion de programmes ou calculs d'appels | Direction de l'établissement |
| Q-P11 | Durée de conservation des bilans et archives | Illimitée, aucune purge ; dégel exceptionnel = procédure super-admin auditée | Données perdues ou accès abusif | Juridique / direction |
| Q-P12 | États à transmettre à l'administration (inspection) | Rapports internes R1-R7 livrés ; R8 = exports configurables sans engagement de conformité | Manquements légaux ou fichiers invalides | Inspection académique |
| Q-P13 | Instituteur remplacé en cours d'année : notes antérieures | Écrit garde son auteur ; nouveau titulaire agit à partir de sa date d'effet ; correction tracée | Attribution fausse ou perte de signature | Direction des études |
| Q-P14 | Quorum du conseil des maîtres | Aucun quorum bloquant ; présence comptée ; règle fictive sans effet | Conseil incomplet ou invalide | Propriétaire + textes officiels |
| Q-P15 | Nombre maximal de redoublements par cycle | Aucun plafond ; le nombre est une entrée de règle, signalé au conseil | Redoublement excessif non décelé | Propriétaire + textes officiels |
| Q-P16 | Élèves affectés par l'État au primaire | Non activé (feature pour SECONDARY) ; activable si besoin | Affectations ignorées | Propriétaire du produit |
| Q-P17 | Appel par demi-journée ? | Appel journalier unique ; demi-journée = évolution (politique d'appel) | Comptage d'absences faux | Propriétaire du produit |
| Q-P18 | Visibilité des rangs et compétences aux parents | Après publication du bulletin ; rangs visibles seulement si affichage activé | Divulgation prématurée ou opacité | Direction des études |
| Q-P19 | Disciplines, coefficients et matières transversales | Curriculum vide (fictif) ; coefficients neutres (1) ; chaque établissement saisit | Règles de calcul invalides | Propriétaire + textes officiels |
| Q-P20 | Conduite : notation et poids dans la moyenne | Matière transversale non comptée (`is_transversal`) ; modifiable par nœud | Moyenne fausse ou conduite ignorée | Propriétaire + textes officiels |

---

## 006 — Enseignement secondaire (Q6-01 à Q6-32)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q6-01 | Périodes au collège/lycée : 3 trimestres ou 2 semestres ? | Un conseil par période et un bilan annuel ; types réglables par établissement | Clôtures incohérentes ou résultats faux | Propriétaire + textes officiels |
| Q6-02 | Composition du conseil de classe | Rôles génériques adaptables par établissement ; un président obligatoire pour ouvrir | Conseil invalide ou décisions contestées | Propriétaire + textes officiels |
| Q6-03 | Quorum du conseil | Aucun contrôle imposé tant que règle non fournie ; ouverture sans quorum possible avec motif | Conseil incomplet ou non valide | Propriétaire + textes officiels |
| Q6-04 | Décisions du conseil (passage, redoublement, orientation, exclusion…) | Toutes listées au PRD, configurables ; exclusion jamais appliquée automatiquement | Décision non prise ou appliquée abusivement | Propriétaire + textes officiels |
| Q6-05 | Vote au conseil | Consensus par défaut ; vote optionnel avec consignation si un type l'exige | Décision contestée sans preuve | Propriétaire du produit |
| Q6-06 | Distinctions (tableau d'honneur, encouragements…) | Suggestions de la règle, toujours acceptées/refusées par une personne ; libellés réglables | Distinctions injustes ou invalides | Propriétaire + textes officiels |
| Q6-07 | Appréciation générale du conseil | Phrase suggérée + validation humaine ; aucune appréciation publiée sans validation | Appréciation générique ou absente | Propriétaire du produit |
| Q6-08 | Procès-verbal du conseil | PV généré automatiquement, signature dans l'app et possibilité de scan signé ; conservation tant que l'établissement existe | PV manquant ou inauthentique | Propriétaire + juridique |
| Q6-09 | Quand les familles voient-elles les décisions ? | Après notification officielle (réglable) ; parents ne voient jamais justifications ni votes | Divulgation prématurée ou manque de transparence | Propriétaire + direction |
| Q6-10 | Rouvrir un conseil signé | Demande écrite motivée approuvée par une autre personne ; impossible si effet appliqué | Erreur irréversible ou manipulation | Propriétaire + direction |
| Q6-11 | Limites de redoublement | Aucune limite codée ; décision humaine avec justification ; texte officiel à confirmer | Redoublement excessif non décelé | Propriétaire + textes officiels |
| Q6-12 | Séries, options, langues, parcours | Rien livré ; vous saisissez séries et options (liste de départ vide) | Parcours invalides ou orientation impossible | Direction de l'établissement |
| Q6-13 | Changement de série en cours d'année | Possible sur décision écrite avec motif ou dérogation motivée | Parcours confus ou non tracé | Direction pédagogique |
| Q6-14 | Catalogue des fautes, sanctions, avertissements | Types génériques à remplacer ; aucun repris d'un texte officiel | Sanctions invalides ou incohérentes | Propriétaire + règlement |
| Q6-15 | Gravité et validation des sanctions | Quatre yeux obligatoires (proposant ≠ validateur) pour sanctions et exclusions ; réglable par type | Double paie ou sanction injuste | Propriétaire + direction |
| Q6-16 | Exclusions (durée max et procédure définitive) | Aucune durée imposée ; exclusion définitive = changement de statut explicite | Exclusion incohérente ou abusive | Propriétaire + juridique |
| Q6-17 | Confidentialité et conservation des dossiers disciplinaires | Trois niveaux (standard, restreint, confidentiel) ; lectures confidentielles journalisées ; aucune purge codée | Données exposées ou manquements légaux | Propriétaire + juridique |
| Q6-18 | Points de conduite (barème) | Application n'affiche que le solde ; saisie humaine de la note ; aucun barème livré | Calcul caché ou note fausse | Propriétaire + textes officiels |
| Q6-19 | Absences pendant exclusion temporaire | Qualification paramétrable ; aucune note générée automatiquement | Comptage faux ou absence illégitime | Propriétaire du produit |
| Q6-20 | Convocations des parents (canaux, délai, accusé) | Message in-app et impression courrier ; SMS et WhatsApp quand fournisseur choisi ; accusé enregistré | Convocation manquée ou non prouvée | Direction de l'établissement |
| Q6-21 | Seuils d'absences/retards | Aucun seuil codé ; l'établissement fixe seuils d'alerte qui suggèrent convocation | Alertes manquées ou injustifiées | Direction pédagogique |
| Q6-22 | Recours contre une sanction | Recours possible pour types qui le prévoient, décidé par personne habilitée avec motif | Sanction irréversible ou injuste | Propriétaire + juridique |
| Q6-23 | Signification d'« Affecté(e) » sur le bulletin | « Affecté(e) » = type de financement « affecté par l'État » de l'inscription (NON résultat de fin d'année) | Affectation mal signalée ou oubliée | Propriétaire + finance |
| Q6-24 | Part État / part famille : montants et paiement | Montants saisis dans le dossier, rapprochés avec facturation ; tolérance d'écart zéro par défaut | Paiement faux ou part mal calculée | Propriétaire + finance |
| Q6-25 | Contrôles exigés par l'État (présence, identité, pièces) | Aucun contrôle imposé par défaut ; l'établissement choisit natures et fréquence | Contrôle omis ou abusif | Propriétaire + autorités |
| Q6-26 | Plateforme/échange de fichiers de l'État | Saisie et import manuels ; intégration via interface future | Données manquantes ou non synchr | Propriétaire + autorités |
| Q6-27 | Niveaux terminaux et diplômes (3e → BEPC, Tle → BAC) | Confirmé ; 3e et Tle marquées « examen terminal » | Examen non déclenché ou mauvais diplôme | Propriétaire + textes officiels |
| Q6-28 | Conditions de présentation aux examens (assiduité, discipline) | Pack fournit les faits ; conditions = ressort spec 018 et vos textes | Présentation non vérifiée ou bloquée faussement | Spec 018 + textes officiels |
| Q6-29 | Tableau officiel des coefficients (par niveau et série) | Rien livré ; vous saisissez coefficients dans le programme de chaque série | Coefficients faux ou manquants | Direction académique |
| Q6-30 | Conduite au bulletin (matière ou appréciation) | Matière transversale notée par une personne, coefficient réglable | Conduite ignorée ou mal comptée | Propriétaire + textes officiels |
| Q6-31 | Ce que voit l'élève (sanctions, encouragements, décisions) | Réglable par établissement ; par défaut, élève voit ce que la famille voit sauf « parents seulement » | Divulgation inappropriée ou manque info | Propriétaire + direction |
| Q6-32 | Conseil des maîtres du primaire et outils communs | Oui, outil de conseil identique (types en données) ; assemblage : 005 et 006 à valider | Doublon d'outils ou outils divergents | Propriétaire du produit |

---

## 007 — Admissions (Q-A01 à Q-A18)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-A01 | Frais de dossier avant admission | Non : seuls frais d'inscription après acceptation | Doublon de frais ou candidat sans dossier | Propriétaire du produit |
| Q-A02 | Durée de validité d'une offre d'admission | 14 jours (réglage) | Offre expirée prématurément ou bloquée | Direction de l'établissement |
| Q-A03 | Ordre de priorité (liste d'attente) | Ancienneté de la demande ; l'école déclare ses classes et leur rang | Appel faux ou priorité oubliée | Direction de l'établissement |
| Q-A04 | Durée de conservation des dossiers refusés | Non fixée : aucune purge automatique ; anonymisation sur demande motivée | Données résiduelles ou accès abusif | Propriétaire + juridique |
| Q-A05 | Délai de paiement des frais d'inscription | Aucun délai : pas d'annulation automatique | Inscription annulée abusivement ou reste impayée | Direction de l'établissement |
| Q-A06 | Âge minimal/maximal par niveau | Aucun contrôle ; ce serait une règle à publier avec texte | Enfant trop jeune/vieux inscrit ou refusé injustement | Propriétaire + textes officiels |
| Q-A07 | Test d'entrée ou entretien obligatoire | Facultatif : étape optionnelle, résultat saisi (aucun seuil) | Test ignoré ou bloquant abusivement | Propriétaire du produit |
| Q-A08 | Qui peut accepter une offre | Tout tuteur par lien unique ; délégation du secrétariat avec pièce justificative | Acceptation invalide ou non tracée | Propriétaire du produit |
| Q-A09 | Texte de consentement (données, photos, communications) | À fournir ; sans texte publié, formulaire public fermé | Non-conformité RGPD ou oubli consentement | Propriétaire + juridique |
| Q-A10 | Pièces à exiger par niveau et financement | Liste vide : chaque école la saisit | Dossier incomplet ou pièce obligatoire manquante | Direction de l'établissement |
| Q-A11 | Pièces et parcours pour élève d'un autre établissement | Même workflow ; inscriptions porte `is_transfer_in` ; pièces déclarées par école | Transfert non tracé ou pièces oubliées | Direction de l'établissement |
| Q-A12 | Élèves affectés par l'État : obligation d'accueil | Capacité respectée (politique `SOFT` possible avec motif) ; liste importée plus tard | Capacité dépassée ou affectation ignorée | Propriétaire + autorités |
| Q-A13 | Place libérée proposée automatiquement au premier liste d'attente | Manuelle (secrétariat clique) ; `AUTO` est un réglage | Appel faux ou place oubliée | Direction de l'établissement |
| Q-A14 | Frais d'inscription remboursés en cas de désistement | Aucun remboursement automatique : décision de finance au cas par cas | Désistement impayé ou remboursement illégitime | Propriétaire + finance |
| Q-A15 | Réinscription des élèves existants | Non par admissions : reconduction annuelle (004) | Élève perdu ou réinscription doublée | Direction académique |
| Q-A16 | Fournisseur SMS / WhatsApp | Aucun canal : envois `SKIPPED` ; « contacter par téléphone » | Notifications manquées ou budget SMS inutile | Propriétaire + exploitation |
| Q-A17 | Commissions d'apporteurs d'affaires | Non reprises ; canal d'acquisition conservé pour statistiques | Commission perdue ou statistiques invalides | Propriétaire du produit |
| Q-A18 | Motifs de refus communiqués aux familles | Libellé neutre du motif codé seulement ; aucun motif libre exposé | Refus incompris ou communication maladroite | Direction de l'établissement |

---

## 012 — Moteur de règles (40 questions + 6 décisions)

### Bloc 1 — Résultats supérieur (9 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-01 | Validation d'un semestre et passage en année supérieure (supérieur) | Toutes les UE validées ; aucune compensation entre UE ; pas de règle automatique de passage | Validation fausse ou UE non reconnue | Propriétaire + textes officiels |
| Q-02 | Note de rattrapage (session 2) : laquelle compte ? | Elle remplace toujours celle de session 1, même si plus basse ▶ **DÉCISION MÉTIER du 2026-10-01** | Meilleure note ignorée ou note fausse | Propriétaire du produit |
| Q-03 | Compensation entre UE d'un même semestre | Rien de plus : compensation seulement intra-UE | Semestre validé faussement ou UE incompensée | Propriétaire + textes officiels |
| Q-04 | Note éliminatoire (< 5) et rattrapage | Conserver (moins de 5 bloque l'UE, repassable en session 2) | Validation injuste ou rattrapage bloqué | Propriétaire + textes officiels |
| Q-05 | Échelles de mention (diplôme du supérieur) | Conserver chaque échelle dans son RuleSet (10/12/14/16/18 vs 8/10/12/14/16) | Diplôme avec mention fausse | Propriétaire + textes officiels |
| Q-06 | Arrondis : calcul exact, arrondi à la fin | Calcul exact, arrondi uniquement à l'affichage (2 décimales, demi-supérieur) | Moyenne affichée fausse ou seuil franchi injustement | Propriétaire + textes officiels |
| Q-07 | Seuils testés sur valeur exacte ou affichée ? | Valeur exacte (9,995 s'affiche 10,00 mais n'est pas validée) | Élève à 9,995 admis ou refusé faussement | Propriétaire + textes officiels |
| Q-25 | Crédit (UE) acquis : définitivement ou durée limitée ? | Oui, définitivement | Crédit annulé injustement ou capitalisation incohérente | Propriétaire + textes officiels |
| Q-26 | Prérequis entre UE : qu'est-ce qui les satisfait ? | UE validée seulement (pas de note minimale) | Prérequis ignoré ou UE bloquée faussement | Propriétaire + textes officiels |

### Bloc 2 — Notes et évaluations (11 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-08 | Moyenne des devoirs pondérée ou simple ? | Moyenne simple (identique à aujourd'hui) | Poids d'évaluation ignoré ou note fausse | Propriétaire du produit |
| Q-09 | Sans examen ou sans devoirs | Conserver : sans examen = pas de note ; sans devoir = contrôle continu = 0 | Note ignorée ou contrôle continu absent | Propriétaire + textes officiels |
| Q-10 | Absence à une évaluation : zéro ou ignorée ? | Absence justifiée ignorée ; absence injustifiée = 0 (paramétrable) | Note fausse ou absence incomptée | Propriétaire du produit |
| Q-11 | Petits établissements : même personne saisit/valide/publie ? | Deux personnes différentes par défaut, option « tâches cumulables » traçable | Conflit d'intérêt ou doublon de travail | Propriétaire + direction |
| Q-12 | Corriger une note après publication/clôture | Correction possible (période clôturée) avec approbation du directeur ; bulletin réédité en nouvelle version | Bulletin faux circulant ou correction impossible | Propriétaire + direction |
| Q-23 | Calcul de la moyenne de matière (pile classique) | Moyenne simple des notes ramenées sur 20 | Moyenne de matière incalculable ou fausse | Propriétaire du produit |
| Q-35 | Établissements souhaitent saisir directement les moyennes | Oui, via type « moyenne saisie » (traçable, même circuit de validation) | Moyennes calculées incorrectement ou opacité | Propriétaire du produit |
| Q-38 | Barèmes autres que /20 | Barème libre par évaluation, ramené sur 20 par la règle | Notes incomparables ou conversion invalide | Propriétaire du produit |
| Q-18 | Classement : ex æquo | Deux élèves égaux au-delà 4 décimales ont le même rang ; suivant saute (1, 1, 3) | Rang contesté ou inégalité masquée | Propriétaire du produit |
| Q-19 | Distinctions et alertes (seuils) | Conserver : tableau d'honneur ≥ 12, encouragements ≥ 15, félicitations ≥ 17 | Distinctions fausses ou élève oublié | Propriétaire + textes officiels |
| Q-20 | Libellés officiels des décisions | À confirmer (Admis, Rattrapage, Ajourné, etc.) | Décision incompréhensible ou non officielle | Propriétaire + textes officiels |

### Bloc 3 — Règles par ordre et décisions (8 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-14 | Primaire/secondaire : textes officiels et personne de référence | À fournir (programmes, bulletins réels annotés, validateur) | RuleSet fictif ou officiel invalide | Propriétaire + inspection |
| Q-15 | BTS : quelles vraies règles ? | Coefficients/semestres comme aujourd'hui, en attente des textes | Diplôme faux ou règles inapplicables | Propriétaire + textes officiels |
| Q-16 | Réforme en cours d'année : à partir de quand ? | À partir de la période suivante (période commencée garde ses règles) | Résultats mélangés ou règle mal appliquée | Propriétaire du produit |
| Q-17 | Liberté des établissements sur les règles | V1 : paramètres seulement (bornes) ; formules libres avec validation plateforme (option payante) | Règles divergentes ou formules cassées | Propriétaire du produit |
| Q-34 | Date de délibération (procès-verbal) | Oui, date saisie ; relevé définitif seulement après délibération | Délibération manquante ou malséance | Propriétaire + direction |
| Q-13 | Bulletins et impayés | Non par défaut, option d'établissement activable | Bulletin remis à faux frais ou retenu injustement | Propriétaire du produit |
| Q-21 | Signataires par défaut | Aucun : un document ne peut pas s'imprimer sans signataires renseignés | Document signé par défaut ou absences détectées tard | Propriétaire + direction |
| Q-22 | Diplôme révoqué puis réattribué | Définitif sauf décision écrite du directeur général (nouvel octroi référencé) | Fraude possible ou diplôme pérenne | Propriétaire + juridique |

### Bloc 4 — Documents officiels (5 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-24 | Numérotation des diplômes/attestations | Séquences sans trou ni doublon par établissement et année, démarrage 1 sur base neuve | Doublon ou trou dans numérotation | Direction de l'établissement |
| Q-31 | Vérification publique (QR code, que voir ?) | « Authentique », nom, nature, date, établissement, mention (sans notes ni date naissance) | Données surexposées ou vérification impossible | Propriétaire + juridique |
| Q-32 | Personnalisation des modèles de bulletin | V1 : modèle plateforme + options (logo, couleurs, rubriques, signatures) | Bulletin non conforme ou impossibilité d'adapter | Propriétaire du produit |
| Q-33 | Langues des documents | Français uniquement en V1 | Documents en mauvaise langue ou diplomate confus | Propriétaire du produit |

### Bloc 5 — Paie des enseignants (7 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-27 | Calcul de paie : heures à la minute, montants en francs, prorata lundi-vendredi | Confirmé (a, b, c) ; calcul mois par mois (d) | Budget faux ou sous-paiement | Propriétaire + ressources humaines |
| Q-28 | Retenues et cotisations légales | Non pour l'instant | Paie brute manquante de déductions obligatoires | Propriétaire + conseil juridique |
| Q-29 | Administrateur accède-t-il à un bulletin en attente de paiement ? | Oui, pour la gestion (constat 2026-09-30) | Paie opaque ou accès abusif | Propriétaire + direction |
| Q-30 | Validation d'un bulletin (calculé → arrêté) | Les deux : propriétaire ET administrateur selon les droits | Bulletin sans validation ou validation manquée | Propriétaire du produit |
| Q-36 | D'où viennent les heures payables ? | Conserver les deux : présences (classiques) et séances validées (supérieur), au choix établissement | Heures manquantes ou doublon payé | Propriétaire du produit |
| Q-37 | Deux périodes chevauchantes | Oui, garanti par contrainte (une heure payée qu'une fois) | Doublon payé ou heure perdue | Propriétaire + finance |
| Q-40 | Enseignant désactivé : paie des heures validées ? | Oui, les heures validées avant désactivation sont payées | Salaire perdu ou injustement gardé | Propriétaire + ressources humaines |

### Bloc 6 — Élèves en mouvement (1 question)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-39 | Élève change de classe en cours de période | Chaque classe calcule avec ses notes ; élève reçoit un bulletin par classe | Bulletin mélangé ou notes perdues | Propriétaire du produit |

---

## 015 — Paiements (12 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-PAY-30 | Établissement sans identifiants propres : utiliser ceux de la plateforme ? | Non (R-PAY-02) ; option `FINANCE_PROVIDER_ENV_FALLBACK` pour mono-établissement | Argent des parents au compte plateforme | Propriétaire + finance |
| Q-PAY-31 | Qui peut gérer les fournisseurs ? | Directeur et propriétaire ; pas l'économe (permission sensible, MFA) | Fournisseur modifié abusivement | Propriétaire du produit |
| Q-PAY-32 | Remboursement exécuté chez le fournisseur | Décidé et livré (où possible) ; où impossible, manuel explicite avec preuve auditée | Remboursement bloqué ou non lancé | Propriétaire + finance |
| Q-PAY-33 | Rattrapage des paiements en attente | Livré : job `finance.reconcile-pending-payments` (15 min délai, 12 tentatives, signalement après) | Paiement perdu ou doublon | Propriétaire + exploitation |
| Q-PAY-37 | Paiement toujours en attente : échec automatique après plafond ? | Non : signalé et reste `PENDING` ; résolution manuelle à quatre yeux | Paiement faussement échoué ou argent reçu non tracé | Propriétaire + finance |
| Q-PAY-38 | Résolution manuelle : second approbateur exigé ? | Oui (quatre yeux), permission sensible `finance.payment.reconcile` (MFA) | Résolution autocrate ou opération cachée | Propriétaire + direction |
| Q-PAY-39 | Vocabulaire d'un remboursement (`COMPLETED` vs `REFUNDED`) | `REFUND_PENDING` → `COMPLETED` (lire « REFUNDED ») ou `REFUND_FAILED` | Historique incompris | Propriétaire du produit |
| Q-PAY-40 | Où part l'alerte `reconciliation_needed` ? | Événement outbox + audit sensible + `FinanceAlertPort` (journal structuré) | Alerte perdue ou pas d'escalade | Exploitation |
| Q-PAY-41 | Wave : remboursement idempotent vraiment ? | Oui, documenté (si faux, passer `idempotent` à `false`) | Doublon remboursé ou paiement gelé | Propriétaire + Wave |
| Q-PAY-34 | Frais d'agrégation (CinetPay, Wave) imputés à la famille ? | Non modélisés : montant payé = facture | Frais non affichés ou double facturation | Propriétaire + finance |
| Q-PAY-35 | TresorPay en production vraiment ? | Adaptateur livré (legacy l'utilise) ; contrat à confirmer | Adaptateur inutile ou contrat cassé | Propriétaire + finance |
| Q-PAY-36 | Secret du coffre : KMS ou environnement ? | Environnement (trousseau, rotation) ; `SecretStorePort` remplaçable | Clés exposées ou rotation impossible | Sécurité / exploitation |

---

## 016 — Communications et messagerie (29 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-01 | Rôles système pour messagerie | Appliquée dans rbac : `messaging.read`+`send` pour enseignants/éducateurs/secrétariat ; direction via `*` | Messages non lus ou envoyés abusivement | Propriétaire du module rbac |
| Q-02 | Conservation des conversations et anonymisation | Aucune suppression ; messages retirés en base ; anonymisation sur demande | Données résiduelles ou conformité RGPD | Propriétaire + juridique |
| Q-03 | Politique des élèves par défaut | `TEACHERS_AND_ADMIN` (élève écrit à enseignants et établissement) | Élève isolé ou messagerie ouverte | Propriétaire du produit |
| Q-04 | Contacts de l'administration (parents/élèves) | `admin_contact_roles = ['directeur', 'secretariat']`, max 30 contacts | Contacts manquants ou trop | Direction de chaque établissement |
| Q-05 | Enseignant « actuel » : parent peut écrire à l'année précédente ? | Non : affectations EN COURS uniquement | Échange bloqué avec ancien enseignant | Propriétaire du produit |
| Q-06 | Plafonds (messages, participants, pièces) | 60/h, 30 conversations/jour, 200 participants, 5 000 chars, 5 × 5 Mio | Limite atteinte ou file gelée | Propriétaire + exploitation |
| Q-07 | Filtre de contenu (mots, coordonnées) | Aucun ; signalement manuel et décision | Contenu interdit non détecté | Propriétaire du produit |
| Q-08 | Antivirus des pièces jointes | Type RÉEL seulement (PDF, JPEG, PNG, WebP) ; scanner branchable en amont | Fichier malveillant non détecté | Sécurité |
| Q-09 | Accusé « vu » d'un message | Non exposé (confidentialité parents) | Parents sur-contrôlés ou inégalité | Propriétaire du produit |
| Q-10 | Notifications externes (e-mail/SMS/WhatsApp si app pas ouverte) | Hors de ce chantier ; module émet `messaging.*` ; canaux externes décident déclenchement | Notification manquée ou sur-notification | Chantier notifications |
| Q-11 | Groupe : ajout/retrait de participants, groupe « vivant » | Instantané à création ; départ possible ; pas d'ajout | Participant oublié ou groupe figé | Propriétaire du produit |
| Q-12 | Annonce programmée : audience | Figée à la programmation (élève inscrit après ne la reçoit pas) | Diffusion incohérente | Propriétaire du produit |
| Q-13 | Enseignants hors classe (ex. surveillant) | Non : seulement SES classes ; permission `send.any` pour vie scolaire, à accorder explicitement | Message non autorisé ou cloisonnement strict | Propriétaire du produit |
| Q-14 | Supervision : qui peut lire conversations d'autrui ? | `moderation.supervise` (sensible, MFA) + motif obligatoire + audit ; information des utilisateurs (règlement) | Supervision abusive ou confidentialité brisée | Direction + juridique |
| Q-15 | Invitations d'événements / RSVP legacy | Non repris (calendrier) | Événements sans RSVP | Spec 017 |
| Q-16 | Messages système supplémentaires | Seuls absence et retard ; autres = événement + gabarit | Alerte manquée ou doublon | Modules producteurs |
| Q-17 | Rôle élève : accusés et annonces | Oui (`messaging.self.read`) | Élève isolé de ses annonces | Propriétaire du produit |
| Q-18 | Fournisseur SMS | Non choisi : adaptateur générique HTTP + variables d'env ; référence `africastalking` | SMS non envoyé ou inefficace | Propriétaire + exploitation |
| Q-19 | Consentement par défaut (SMS/WhatsApp/notifications) | `IMPLIED` (envoyé sauf refus) ; établissement passe un canal en `EXPLICIT` si souhaite | Non-conformité RGPD ou sur-consentement | Propriétaire + juridique |
| Q-20 | Notification externe (message direct, délai et canal) | Non livré : à spécifier avec équipe messagerie | Utilisateur ne reçoit pas d'alerte | Spec 016 |
| Q-21 | Rebonds asynchrones (DSN) et plaintes | Webhook signé générique ; relais SMTP transactionnel recommandé (DKIM/SPF/DMARC) | E-mails en spam ou réputation perdue | Exploitation |
| Q-22 | Langues | Seul fr-CI livré ; table prévoit langue, repli fr-CI | Messages en mauvaise langue | Propriétaire du produit |
| Q-23 | Heures calmes par défaut (20:00-07:00, fuseau Abidjan) | Paramétrables par établissement et personne ; urgence bypass | Notifications hors heures ou non bloquées | Direction de chaque établissement |
| Q-24 | Urgence et révocation (bypass liste suppression) | Non par défaut ; établissement l'autorise (`urgent_bypasses_revocations`) | Alerte non reçue ou consentement contourné | Propriétaire + juridique |
| Q-25 | Plafonds canaux (SMS 500/j, WhatsApp 1500, e-mail 3000, push 10k, in-app 20k par établissement) | Paramétrables ; à calibrer sur usage et coût | Quota atteint ou overspend | Exploitation |
| Q-26 | Relances impayés : paliers, gabarit, destinataire | J+3/J+10/J+30, une seule règle active, responsable financier (repli : tuteurs puis élève) | Impayé oublié ou relance double | Propriétaire + économat |
| Q-27 | Charge d'enseignement et baisse de résultats | Charge : heures planifiées année (défaut 800 h) ; baisse : désactivée, seuil en points | Alerte erronée ou manquée | Direction des études |
| Q-28 | Rôle « ressources humaines » | Aucun modèle ; alerte document expirant = secrétariat par défaut | Alerte à mauvaise personne | Propriétaire du produit |
| Q-29 | Conservation consentement (`consent_log`) | Conservé tant qu'établissement existe ; effacement sur demande | Non-conformité RGPD | Juridique |

---

## 018 — Examens (18 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-E01 | Épreuves, barèmes et coefficients du CEPE | Trois fictives (`EP1`–`EP3`), marquées fictives | Résultats officiels faux | Propriétaire + textes officiels |
| Q-E02 | Conditions d'éligibilité au CEPE | Être en classe d'examen et avoir toutes pièces (fictif) ; dérogation motivée possible | Candidat inéligible accepté ou refusé | Propriétaire + textes officiels |
| Q-E03 | Numéro de candidat : qui l'attribue et quel format ? | Numéro interne sans trou (`CEPE2027-00001`) à l'inscription + numéro officiel importé | Doublon ou perte de numéro officiel | Direction de l'établissement |
| Q-E04 | Centre d'examen ou centre d'accueil | Les deux supportés ; répartition manuelle ou automatique selon capacités | Candidat mal répartie ou confus | Direction de l'établissement |
| Q-E05 | Épreuves facultatives ou à option, compensation | Facultative non comptée si non notée ; aucune compensation | Option invalide ou mal calculée | Propriétaire + textes officiels |
| Q-E06 | Seuil d'admission et délibération | Aucun seuil officiel : admission importée ou saisie ; blanc calcule avec seuil fictif 10 | Résultat officiel calculé (interdit) | Propriétaire + textes officiels |
| Q-E07 | Session de rattrapage | Prévue par `attempt_kind` ; aucune règle d'accès | Rattrapage bloqué ou autorisé faussement | Propriétaire + textes officiels |
| Q-E08 | Taux de réussite (admis ÷ présents ou inscrits) | Admis ÷ présents, 2 décimales (paramètre) | Taux faux ou incomparable | Propriétaire + textes officiels |
| Q-E09 | Mentions (CEPE, BEPC, BAC) | Non : règle fictive et inactive | Mention manquante ou imposée injustement | Propriétaire + textes officiels |
| Q-E10 | Comment l'établissement reçoit les résultats | Import CSV ou saisie ; format = donnée | Résultats manuels ou fichier incomplet | Direction de l'établissement |
| Q-E11 | Comment transmettre la liste de candidats à l'autorité | Export paramétrable ; format fictif livré | Export invalide ou autorité non informée | Direction de l'établissement |
| Q-E12 | Modèles officiels (convocation, attestation, relevé) | Gabarits génériques (013) ; aucun signataire par défaut | Document sans signataire ou non officiel | Propriétaire + textes officiels |
| Q-E13 | Frais d'examen | Aucun géré par ce module ; barème finance si besoin | Frais oubliés ou mal comptabilisés | Propriétaire + finance |
| Q-E14 | Examens blancs et valeur | Libre : autant de sessions blanches que souhaité ; résultats jamais officiels | Blanc influençant admission officielle | Direction de l'établissement |
| Q-E15 | Candidat libre (non élève) | Non en V1 : candidat = élève établissement | Candidat externe non pris | Propriétaire du produit |
| Q-E16 | Durée de conservation listes et résultats | Illimitée, aucune purge ; identité candidat session archivée = immuable | Données perdues ou candidat modifié | Juridique |
| Q-E17 | Correction d'un résultat déjà transmis | Révision approuvée ≠ demandeur, motif ≥ 10 chars ; document réémis | Résultat non corrigeable ou corruption silencieuse | Propriétaire + direction |
| Q-E18 | CEPE vers admission 6e ou affectation : quelles infos ? | Résultat seul (admis/non-admis), sans note ni moyenne | Information manquante ou sur-exposée | Propriétaire + autorités |

---

## 024 — Gestion documentaire (17 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| Q-01 | Rôles système (lecture documentaire) | Appliquée dans rbac : `documents.read`, `.restricted`, `.confidential`, `manage` | Documents sur-exposés ou inaccessibles | Propriétaire du module rbac |
| Q-02 | Niveaux par nature (économat voit-il pièces d'identité ?) | Un seul RESTRICTED ; catégorie financière via droits de catégorie | Surexposition ou manque info | Propriétaire du produit |
| Q-03 | Rétention légale pièces | 365 jours après archivage (paramétrable, `0` = jamais) ; aucune purge hors archivage | Données résiduelles ou conformité RGPD | Juridique / propriétaire |
| Q-04 | Taille maximale fichier | 15 Mio (paramétrable, plafond plateforme 50 Mio) | Fichier rejeté ou débordement | Exploitation |
| Q-05 | Quotas par plan | 2 Gio / 20 Gio / 100 Gio ; features `documents.storage.*` à rattacher aux plans | Quota atteint ou storage oublié | Produit / commercial |
| Q-06 | Antivirus ClamAV obligatoire | Optionnel : sans scanner = `UNSCANNED` + avertissement ; avec scanner = fail-closed en production | Malware non détecté ou service gelé | Sécurité / exploitation |
| Q-07 | Prévisualisation Office (conversion PDF) | Désactivée ; adaptateur LibreOffice fourni (conteneur isolé) ; téléchargement OK | Fichier malveillant exécuté ou conversion lente | Sécurité / exploitation |
| Q-08 | Origine séparée pour prévisualisation | Via API (blob + en-têtes restrictifs) ; origine séparée recommandée à terme | Injection PDF dans session | Sécurité |
| Q-09 | Formats acceptés (archives, vidéo, audio, SVG, Office macros) | Refusés ; Office 97 accepté (OLE + extension) | Vecteur d'attaque ou fichier refusé injustement | Sécurité |
| Q-10 | Dépôt parent/élève : validation préalable ? | Non : visible du personnel autorisé, traçable ; secrétariat peut archiver | Pièce invalide acceptée | Propriétaire du produit |
| Q-11 | Dédoublonnage | Refus `409` (même contenu/catégorie/propriétaire) | Duplicata importé ou non détecté | Propriétaire du produit |
| Q-12 | Migration pièces existantes (people, attendance, messaging) | Non réalisée ; adaptateur d'analyse seulement | Données orphelines ou doublées | Modules concernés |
| Q-13 | Expiration : qui reçoit l'alerte ? | Déposant, propriétaire, gestion (événement `createdBy`, `ownerType`, `ownerId`) | Expiration oubliée | Chantier notifications |
| Q-14 | Recherche dans contenu (OCR, texte PDF) | Hors V1 : métadonnées, titre, nom, étiquettes seulement | Recherche impossible ou lente | Produit |
| Q-15 | Partage à un parent/élève précis | Partage à toute identité IAM (tuteur, élève) ; proposé en un clic | Partage impossible ou sur-exposé | Propriétaire du produit |
| Q-16 | Re-scan fichiers existants à mise à jour signatures | Non prévu | Malware vieux non détecté | Sécurité |
| Q-17 | Changement de catégorie | Refusé (même type uniquement) | Sens du propriétaire altéré | Propriétaire du produit |

---

## 031 — Imports (15 questions)

| ID | Question | Défaut appliqué | Impact si le défaut est faux | Qui tranche |
|---|---|---|---|---|
| O-01 | Longue transaction « tout ou rien » | Plafond 5 000 lignes (réglable) ; `VALID_ONLY` recommandé gros fichiers | Verrous bloquants ou rollback sans compensation | Propriétaire du produit |
| O-02 | Importation notes : permissions suffisantes ? | `grade.enter` + `assessment.manage` exigés (direction/resp. pédagogique seulement) | Enseignant importe notes d'un collègue | Propriétaire du produit |
| O-03 | Attribution permissions `imports.*` | Seuls owner et directeur (`*`) ; `rbac` à modifier pour secrétariat/directeur études | Importeur sans droit ou droit trop large | Propriétaire du module rbac |
| O-04 | Numéro d'inscription comme référence d'élève | Non retenu : matricule plateforme ou matricule d'origine | Référence invalide ou élève mal résolu | Propriétaire + academic |
| O-05 | Doublons probables d'élèves/tuteurs | `REJECT` ou `ACKNOWLEDGE` (crée avec motif tracé) ; aucune fusion (spec 008) | Doublon créé ou élève perdu | Propriétaire + people |
| O-06 | Détection doublons tuteurs | Table `imports.entity_refs` (clé nom + contact) ; tuteur supprimé/réimporté recréé | Doublon tuteur non détecté | Propriétaire du produit |
| O-07 | Mise à jour tuteur/lien | Identité/contacts tuteur et drapeaux du lien seulement | Affectation non à jour | Propriétaire du produit |
| O-08 | Limite de lignes | 5 000 défaut, 20 000 max | Fichier trop gros refusé | Propriétaire + exploitation |
| O-09 | Débit (~10-20 lignes/s) | Mesuré, documenté ; bulk en people multiplierait le débit (hors scope) | Import lent ou inachevé | Propriétaire + exploitation |
| O-10 | Fichier original conservé | 30 jours (puis purge) ; valeurs brutes purgées avec lui | Fichier perdu ou données conservées trop longtemps | Propriétaire + juridique |
| O-11 | Formats acceptés (xlsx, csv seulement) | `.xls`, `.ods`, `.xlsb` refusés ; message explicite | Format invalide rejeté | Utilisateur |
| O-12 | Reprise données legacy (Imhotep) | Aucune | Données legacy perdues | Propriétaire du produit |
| O-13 | Importeurs absents (inscriptions, affectations, emplois du temps, paiements, assiduité) | Hors V1 | Données rentrées manuellement | Backlog |
| O-14 | Financement inscriptions (type, référence affectation) | Seulement type et référence ; bourses finance non importées | Financement incomplet ou données éclatées | Propriétaire + finance |
| O-15 | Avoirs sans facture de reprise | Refus explicite | Crédit orphelin | Propriétaire + finance |

---

## Textes officiels ivoiriens à fournir

**Aucune règle réglementaire n'est inventée dans les specs.** Les RuleSet avec `source_kind=placeholder` ou sans texte sourcé sont des modèles fictifs de démonstration. À obtenir avant Phase 4 (Primaire) et Phase 5 (Secondaire).

### Primaire (spec 005, Phase 4)

| Domaine | Texte à fournir | Exemple à joindre |
|---------|-----------------|------------------|
| **Programmes officiels** | Arrêtés/programmes ministère (CP1 à CM2 : disciplines, coefficients, niveaux de maîtrise) | Bulletin anonymisé avec résultat attendu |
| **MGA (Moyenne générale annuelle)** | Formule officielle, pondération des 3 trimestres | 3 cas d'or (élève au passage, limite, redoublement) |
| **Passage/redoublement** | Seuils, rôle conseil des maîtres, dérogations, plafond redoublements | PV type de conseil d'orientation |
| **Maternelle** | Évaluation par compétences ou appréciations (échelle officielle si chiffrée) | Livret maternelle officiel |
| **Bulletin/livret** | Modèle officiel (rubriques, signatures, cachets) | Bulletin scanné anonymisé |

### Secondaire (spec 006, Phase 5)

| Domaine | Texte à fournir | Exemple à joindre |
|---------|-----------------|------------------|
| **Programmes et coefficients** | Séries, matières par série, volumes horaires, coefficients (6e–Tle) | Tableau officiel |
| **Moyenne générale secondaire** | Formule (type 3 trimestres vs 2 semestres), malus/bonus éventuels | 3 cas d'or par série |
| **Passage et orientation** | Seuils, rôle conseil de classe, orientation/réorientation, redoublement | PV type de conseil de classe |
| **Conseil de classe** | Composition légale, quorum, types de décisions, PV modèle | PV scanné anonymisé |
| **Conduite** | Notation sur 20 avec coefficient, place dans la moyenne | Bulletin avec conduite |
| **Mentions** | Seuils et appellations officielles | Bulletins variés (mention/non-mention) |
| **Discipline** | Règlement type, impact des sanctions sur bulletin | Incident, sanction et leur reflet |
| **Bulletin** | Modèle officiel par niveau (collège, lycée) | Bulletins scannés anonymisés |

### Examens (spec 018)

| Examen | Texte à fournir | Exemple à joindre |
|--------|-----------------|------------------|
| **CEPE** | Épreuves, coefficients, conditions d'éligibilité, seuil admission, mentions | Relevé officiel + attestation |
| **BEPC** | Idem CEPE + prise en compte moyenne classe éventuelle | Relevé + décision orientation |
| **BAC** | Idem + rattrapage/2ᵈ groupe | Relevés (admis, ajourné, rattrapage) |
| **BTS** | Organisation, étapes (contrôle continu, examen, stage, soutenance) | Relevé diplôme |

---

## Décisions techniques et exploitation à prendre par l'humain

### Rotation des secrets exposés

**Action requise** : politiques de rotation (fréquence, audit), gestion de secrets (AWS KMS, HashiCorp Vault, trousseau)

**Décision** : lead + sécurité / exploitation

### `AUTH_SOCIAL_SHARED_SECRET` pour `/auth/social-login`

**Action requise** : vérifier que le secret n'est pas en dur ; remplacer par passage sécurisé ou rotation avant déploiement v2

**Décision** : lead + sécurité

### Sauvegarde de production avant tout reset de la base

**Action requise** : before-reset backup + restore test + procédure documentée

**Décision** : DBA + exploitation + propriétaire

### Choix du fournisseur SMS

**Action requise** : tests sandbox, tarifs, accord expéditeur alphanumérique (ARTCI)

**Décision** : propriétaire + exploitation

### Nettoyage du serveur Imhotep et migration des données

**Action requise** : inventaire, archivage/purge/migration, communication clients

**Décision** : propriétaire + DBA

### Authentification par le portail (legacy) vs IAM v2

**Action requise** : plan de cutover, date d'arrêt support legacy, tests E2E

**Décision** : lead + propriétaire

### Conformité RGPD et loi n° 2013-450 (Côte d'Ivoire)

**Action requise** : avis juridique sur droit à l'oubli, anonymisation, consentement, transferts internationaux

**Décision** : juridique + propriétaire

---

## Récapitulatif des questions consolidées

**Total : 244 questions métier ouvertes**

| Module | Plage | Nombre |
|--------|-------|--------|
| 004 — Academic core | O-01 à O-23 | 23 |
| 005 — Primaire | Q-P01 à Q-P20 | 20 |
| 006 — Secondaire | Q6-01 à Q6-32 | 32 |
| 007 — Admissions | Q-A01 à Q-A18 | 18 |
| 012 — Moteur de règles | Q-01 à Q-40 + Q-13/Q-21/Q-22/Q-24/Q-31/Q-32/Q-33 | 47 |
| 015 — Paiements | Q-PAY-30 à Q-PAY-41 | 12 |
| 016 — Communications | Q-01 à Q-29 | 29 |
| 018 — Examens | Q-E01 à Q-E18 | 18 |
| 024 — Documents | Q-01 à Q-17 | 17 |
| 031 — Imports | O-01 à O-15 | 15 |
| **Textes officiels à fournir** | — | 15 |
| **Décisions techniques/exploitation** | — | 7 |
| **Total** | — | **244** |

**Statut** : consolidation unique des questions métier ouvertes de EcoleDigitale v2 avec défauts appliqués. Source de vérité : `specs/v2/DECISIONS-METIER.md` emporte toute réponse par défaut. Aucune des réponses par défaut n'est une règle réglementaire ivoirienne officielle.

---

**Mise à jour** : 2026-10-02 sur branche `feat/v2-phase-0`

## Ajouts du lead (2026-10-02) — arbitrages par défaut pris pendant l'intégration

| Id | Question | Défaut appliqué | Qui tranche |
|----|----------|-----------------|-------------|
| L-01 | `council.read` accordé à l'enseignant (périmètre limité à ses classes côté serveur) ; ajoute le menu « Conseils de classe » | Accordé (suit le README councils) | Direction |
| L-02 | Publication des résultats d'examen, dérogation d'éligibilité, approbation d'une révision : `directeur`/`owner` seuls ; `directeur_etudes` en consultation | Direction seule | Direction |
| L-03 | Le secrétariat n'a aucun droit sur les examens (convocations : permission `exam.document.issue` à lui donner si souhaité) | Aucun | Direction |
| L-04 | Imports : secrétariat = élèves/tuteurs ; directeur d'études = classes/curriculum ; économe = préparation ; soldes d'ouverture (MFA) = direction | Voir à gauche | Direction |
| L-05 | Règles de notification `schoollife.*` et `admissions.*` livrées DÉSACTIVÉES (les modules informent déjà eux-mêmes ; les activer enverrait en double) | Désactivées | Propriétaires des modules |
| L-06 | Rapprochement stateassign : compte tous les frais de la famille, frais d'inscription compris | Tolérance de l'établissement | Économe |
| L-07 | Job `councils.apply-effects` exécuté sous l'identité de l'humain décideur (contrainte `TenantDb`) | Identité du décideur | Technique / direction |
| L-08 | Couleur « destructive » éclaircie pour atteindre le contraste 4,5:1 | Appliqué | Design |
