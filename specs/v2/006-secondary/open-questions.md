# Questions ouvertes et décisions — 006-secondary

**Statut** : la partie **A** s'adresse au **propriétaire du produit** (aucun terme technique) ; la valeur par défaut proposée s'applique tant que la question n'est pas tranchée **et ne constitue jamais une règle officielle** : là où seul un texte peut répondre, le pack laisse le champ **vide** (`NULL`, liste vide). La partie **B** liste les **décisions de conception** prises par défaut (réversibles). La partie **C** liste les **incohérences relevées** dans d'autres documents. Les entrées de `specs/v2/DECISIONS-METIER.md` l'emportent sur toute valeur par défaut. Voir aussi `regulatory-sources-needed.md` pour les **textes** à fournir.

## A. Questions pour le propriétaire du produit

### A.1 Année et conseil de classe

**Q6-01 — Périodes de l'année au collège et au lycée.** Vos établissements découpent-ils l'année en **trois trimestres** ou en **deux semestres** ? Un conseil de classe se tient-il à la **fin de chaque période**, plus un **bilan de fin d'année**, ou seulement en fin d'année ? *Proposition* : un conseil par période et un bilan annuel, types réglables par établissement. *Pourquoi c'est important* : le calcul actuel de l'application suppose deux semestres (la moyenne annuelle pondère le 1ᵉʳ semestre une fois et le 2ᵈ deux fois) ; avec trois trimestres, un nouveau contrat de calcul est nécessaire (`secondary-annual@1`).

**Q6-02 — Composition du conseil, présidence, secrétaire, signatures.** Qui siège obligatoirement (professeur principal, enseignants de la classe, éducateur, conseiller d'orientation, délégués des élèves, délégués des parents, direction) ? Qui **préside** et qui **rédige le procès-verbal** ? **Qui signe** : seulement le président et le secrétaire, ou tous les présents ? Les délégués d'élèves et de parents assistent-ils à toute la séance ou seulement à une partie ? *Proposition* : président + secrétaire signent ; rôles de départ génériques que chaque établissement adapte. *Remarque* : l'application impose seulement qu'**un président soit présent pour ouvrir la séance** (il faut quelqu'un qui porte la décision) ; dites-nous si ce n'est pas le cas chez vous.

**Q6-03 — Quorum.** Existe-t-il un **nombre minimal de présents** ou de rôles à représenter pour tenir un conseil valable ? Une séance peut-elle se tenir malgré tout (avec motif) ? *Proposition* : **aucun contrôle** tant que vous n'avez pas fourni la règle ; ouverture sans quorum possible avec motif écrit si l'établissement l'autorise.

**Q6-04 — Décisions du conseil et conseil de discipline.** Quelles décisions votre conseil de classe prend-il (passage, redoublement, orientation, réorientation, exclusion, **avis** — lesquels —, autre) ? L'**exclusion** est-elle décidée par le conseil de classe ou par un **conseil de discipline** distinct ? *Proposition* : toutes les décisions listées dans le PRD, configurables ; l'exclusion décidée par le conseil n'est **jamais appliquée automatiquement** (une personne habilitée l'applique). Un conseil de discipline distinct s'ajoute par la configuration, sans développement.

**Q6-05 — Vote.** Le conseil **vote**-t-il ? La voix du président est-elle prépondérante ? Faut-il consigner le nombre de voix pour chaque décision ? *Proposition* : consensus par défaut ; le vote (pour / contre / abstentions) est possible et consigné quand un type de décision l'exige.

**Q6-06 — Distinctions.** Quelles distinctions votre établissement décerne-t-il (tableau d'honneur, encouragements, félicitations, avertissement de travail, blâme…) ? À partir de quels critères et qui décide ? *Proposition* : suggestions de la règle de démonstration, **toujours acceptées ou refusées par une personne** ; libellés réglables.

**Q6-07 — Appréciation du conseil.** L'appréciation générale doit-elle toujours être un **texte rédigé** par le professeur principal, ou acceptez-vous une **phrase suggérée** à partir de la moyenne (comme aujourd'hui) que la personne valide ou modifie ? *Proposition* : phrase suggérée + validation humaine ; aucune appréciation publiée sans validation.

**Q6-08 — Procès-verbal.** Avez-vous un **modèle officiel** de PV (mentions obligatoires, signatures, cachet) ? La **signature manuscrite** sur papier est-elle exigée en plus de la signature dans l'application ? Combien de temps conservez-vous les PV ? *Proposition* : PV généré automatiquement, signature dans l'application **et** possibilité de déposer un scan signé ; conservation tant que l'établissement existe.

**Q6-09 — Quand les familles voient-elles les décisions ?** Dès la signature du PV, seulement après une **notification officielle** (remise du bulletin, convocation), ou jamais dans l'application ? *Proposition* : après notification (réglable). Les parents ne voient jamais les justifications internes ni les votes.

**Q6-10 — Rouvrir un conseil signé.** Qui peut le rouvrir (le chef d'établissement seul, ou avec l'accord d'une autre personne) ? Dans quel délai ? *Proposition* : demande écrite motivée approuvée par **une autre personne** que le demandeur ; impossible si une décision a déjà produit un effet qui ne peut plus être annulé (par exemple l'inscription de l'année suivante).

**Q6-11 — Redoublement.** Existe-t-il des limites officielles (nombre de redoublements, dérogations) que l'application doit connaître ? *Proposition* : aucune limite codée ; la décision reste humaine avec justification. *Texte à fournir.*

### A.2 Orientation et séries

**Q6-12 — Séries, options, langues et parcours.** Quelles **séries** (générales, techniques, professionnelles) vos établissements proposent-ils, avec quelles **options** et **langues** ? Quels **passages** sont permis d'un niveau ou d'une série à l'autre (par exemple de la 3e vers une série de 2nde) et sous quelles conditions ? Les **parents expriment-ils des vœux** ? Leur **accord** est-il obligatoire ? *Proposition* : rien n'est livré ; vous saisissez séries, options et parcours (liste de départ vide). Les vœux de la famille sont recueillis dans l'application.

**Q6-13 — Changer de série en cours d'année.** Est-ce autorisé ? Par qui ? À quelles conditions ? *Proposition* : possible sur décision écrite de la direction ou du conseil, avec motif, sur un parcours autorisé ou avec une dérogation motivée.

### A.3 Vie scolaire

**Q6-14 — Catalogue des fautes, sanctions, avertissements, encouragements.** Pouvez-vous nous donner la liste (celle de votre **règlement intérieur**) des types d'incidents, de sanctions, d'avertissements et d'encouragements ? *Proposition* : types génériques de démonstration à remplacer ; aucun type n'est repris d'un texte officiel.

**Q6-15 — Gravité et validation.** Quels niveaux de gravité utilisez-vous ? **Qui valide quoi** (surveillant général, chef d'établissement, conseil de discipline) ? Une même personne peut-elle proposer **et** valider une sanction ? *Proposition* : quatre yeux obligatoires (proposant ≠ validateur) pour les sanctions et exclusions, réglable par type ; une exclusion temporaire exige toujours une validation.

**Q6-16 — Exclusions.** Durée maximale d'une **exclusion temporaire** ? Procédure d'une **exclusion définitive** (qui décide, délais, droit de se défendre) ? *Proposition* : aucune durée imposée par l'application ; l'exclusion définitive est un changement de statut explicite fait par une personne habilitée après décision.

**Q6-17 — Confidentialité et conservation.** Que peuvent voir les **parents** et l'**élève** (sanctions, observations) ? Une **observation** ou une sanction reste-t-elle visible de l'enseignant ? Combien de temps conservez-vous les dossiers disciplinaires ? Que devient le dossier quand l'élève **change d'établissement** ou demande l'effacement de ses données ? *Proposition* : trois niveaux (standard, restreint, confidentiel) ; jamais un élément confidentiel visible d'une famille ; lectures confidentielles **journalisées** ; **aucune durée de conservation codée** (à fixer par l'établissement) ; aucun transfert de données disciplinaires sans demande explicite.

**Q6-18 — Points de conduite.** Utilisez-vous un **barème de points** (points de départ, retraits par faute, bonifications, plafond, remise à zéro par période ou par année) ? La **note de conduite** du bulletin en dépend-elle ? *Proposition* : l'application ne calcule **jamais** la note ; elle affiche le solde comme aide et la note est saisie par une personne ; aucun barème livré.

**Q6-19 — Absences pendant une exclusion temporaire.** Ces absences comptent-elles comme **justifiées**, comme **non justifiées**, ou ne comptent-elles pas ? Une évaluation manquée pendant l'exclusion est-elle rattrapée ? *Proposition* : qualification paramétrable ; aucune note générée automatiquement.

**Q6-20 — Convocations des parents.** Par quels canaux (message dans l'application, SMS, WhatsApp, courrier) ? Quel délai ? L'**accusé de réception** est-il exigé ? Que fait-on si les parents ne viennent pas ? *Proposition* : message dans l'application et impression pour le courrier ; SMS et WhatsApp quand le fournisseur sera choisi (question du plan : fournisseur SMS) ; accusé de réception enregistré par le parent ou le secrétariat.

**Q6-21 — Seuils d'absences et de retards.** À partir de combien d'absences ou de retards convoquez-vous les parents ou prononcez-vous un avertissement ? *Proposition* : **aucun seuil codé** ; vous fixez des seuils d'alerte qui **suggèrent** une convocation, que l'éducateur confirme.

**Q6-22 — Recours.** Les familles ont-elles un droit de recours formel contre une sanction ? Dans quel délai et devant qui ? *Proposition* : recours possible pour les types de sanction qui le prévoient, décidé par une personne habilitée avec motif.

### A.4 Élèves affectés par l'État

**Q6-23 — Que signifie « Affecté(e) » sur votre bulletin ?** L'application actuelle imprime « Affecté(e) : Oui » pour **tout élève qui ne redouble pas**, ce qui ne semble pas correspondre à un élève **affecté par l'État**. Sur vos bulletins papier, la case « Affecté(e) » désigne-t-elle bien l'élève **affecté par l'État** ? Comment se déroule l'**affectation** (qui délivre l'acte, quand, quelle référence) ? Un élève affecté peut-il aussi avoir une **bourse** ? *Proposition* : « Affecté(e) » = type de financement « affecté par l'État » de l'inscription (et non plus le résultat de fin d'année) ; un seul type de financement par inscription, détail des parts dans la facturation.

**Q6-24 — Montants et paiement.** Comment sont déterminées la **part de l'État** et la **part de la famille** ? L'État paie-t-il l'établissement directement, à quelle fréquence ? Quels **écarts** sont tolérés entre l'acte et ce que vous facturez ? *Proposition* : montants déclarés par l'acte saisis dans le dossier, rapprochés avec la facturation ; tolérance d'écart fixée par l'établissement (zéro par défaut).

**Q6-25 — Contrôles exigés par l'État.** Quels contrôles (présence, identité, pièces), à quel rythme, avec quel justificatif (certificat de présence) ? Que se passe-t-il en cas d'absences ou d'anomalie ? *Proposition* : aucun contrôle imposé par défaut ; vous choisissez les natures et la fréquence ; l'application planifie, une personne réalise.

**Q6-26 — Plateforme de l'État.** Existe-t-il, ou est-il prévu, une **plateforme ou un échange de fichiers** officiel pour les affectations ? À quelle échéance ? *Proposition* : saisie et import manuels ; l'intégration viendra derrière une interface prévue, **non activée** au départ.

### A.5 Examens et programme

**Q6-27 — Niveaux terminaux et diplômes.** Confirmez-vous que la **3e** conduit au **BEPC** et la **Terminale** au **BAC** (PRD §15) ? Existe-t-il d'autres diplômes à gérer dans le secondaire (techniques, professionnels) ? *Proposition* : ces deux niveaux sont marqués « examen terminal » ; d'autres se configurent.

**Q6-28 — Présentation aux examens.** Y a-t-il des conditions de présentation liées à l'**assiduité** ou à la **discipline** ? Les **examens blancs** sont-ils obligatoires ? *Proposition* : le pack fournit les faits (assiduité, décisions, discipline en comptages) ; les conditions sont du ressort de la spec des examens (018) et de vos textes.

**Q6-29 — Coefficients par matière et par série.** Avez-vous le **tableau officiel** des coefficients (par niveau et par série) et des volumes horaires ? *Proposition* : rien n'est livré ; vous saisissez vos coefficients dans le programme de chaque série.

**Q6-30 — Conduite au bulletin.** La conduite est-elle une **matière notée sur 20** avec un coefficient, ou une simple appréciation ? *Proposition* : matière transversale notée par une personne (comme aujourd'hui dans le module Professionnel), coefficient réglable.

**Q6-31 — Ce que voit l'élève.** L'élève voit-il lui-même ses sanctions, ses encouragements, les décisions du conseil ? À partir de quel âge ou niveau ? *Proposition* : réglable par établissement ; par défaut, l'élève voit ce que la famille voit, sauf les éléments marqués « parents seulement ».

**Q6-32 — Collège et lycée dans un même établissement.** Un même chef d'établissement préside-t-il les deux conseils ? Le **conseil des maîtres** du primaire (spec 005) doit-il réutiliser le même outil de séance, de décision et de procès-verbal ? *Proposition* : oui, l'outil de conseil est le même (types de conseil et de décision en données).

### A.6 Élèves affectés par l'État — créances, rejets, contrôles, exports (module `stateassign`)

Ces questions sont nées de l'**implémentation** du module (migrations 2300-2303). Pour chacune, la **valeur par défaut** ci-dessous est ce que fait l'application aujourd'hui ; elle n'est **pas** une règle officielle et chaque point reste **réglable ou vide** tant que vous n'avez pas tranché.

**Q6-33 — Calendrier des versements de l'État.** L'État (ou l'autorité d'affectation) verse-t-il la part qui lui revient **en une fois, par trimestre, par mois** ? Qui fixe les **dates** : l'acte d'affectation, une convention, une circulaire ? Un versement porte-t-il sur **un seul élève** ou sur **plusieurs** (virement groupé à ventiler) ? *Défaut* : l'établissement **planifie lui-même** les échéances attendues de chaque dossier (libellé, date, montant) ; leur **total ne peut pas dépasser** la part de l'État déclarée par l'acte ; un paiement est suivi **par élève**. *Pourquoi c'est important* : un virement groupé doit être ventilé par élève dans les finances avant que le suivi puisse l'affecter.

**Q6-34 — Quand une créance de l'État est-elle « en retard » ?** Existe-t-il un délai de grâce usuel après l'échéance ? Qui prévenir (économe, direction, autorité de tutelle) et à quel rythme ? *Défaut* : **zéro jour de grâce** (réglable de 0 à 366 jours) ; l'alerte « créance en retard » est publiée **une seule fois** par échéance ; ancienneté présentée en tranches de 30 jours (présentation, pas une règle).

**Q6-35 — Paiement partiel, trop-perçu, non-valeur.** Que fait-on d'un versement **inférieur** à l'échéance, **supérieur** au total attendu, ou jamais reçu ? Faut-il pouvoir **admettre en non-valeur** une créance, ou la **transférer** à la famille ? *Défaut* : le versement reçu est affecté aux échéances **dans l'ordre**, le surplus est affiché « non affecté » (jamais perdu) ; on **annule** une échéance **sans versement** avec un motif ; **aucune non-valeur** n'est modélisée.

**Q6-36 — Rejet d'un dossier déjà vérifié.** Si l'autorité conteste un dossier **après** sa vérification (la référence est déjà portée sur l'inscription et la facturation a été séparée en parts État / famille), que doit devenir l'**inscription** (retour au type « privé ») et la **facturation** (refacturation de la part de l'État à la famille) ? *Défaut* : **rien n'est modifié automatiquement** (acte financier : une personne décide) ; l'audit et l'événement de rejet signalent que l'inscription porte encore la référence.

**Q6-37 — Qui vérifie, qui active ?** La vérification doit-elle être faite par la **direction**, l'**économe**, un autre profil ? L'**activation** est-elle un acte distinct ? *Défaut* : la **séparation des tâches est active** (celui qui enregistre ne vérifie pas ; réglable) ; la permission de vérifier est **sensible** (authentification forte) et **n'est pas donnée au secrétariat** par défaut ; l'activation est un acte distinct (`stateassign.manage`).

**Q6-38 — Avenants : effet sur la facturation.** Un avenant qui change la part de l'État doit-il entraîner une **refacturation** (avoir et nouvelle facture) ? À partir de **quelle date** s'applique-t-il ? *Défaut* : l'avenant **remplace** le dossier (date d'effet et motif obligatoires) et crée la version suivante, qui doit être **vérifiée à son tour** ; **aucune écriture n'est faite dans la facturation** : l'écart apparaît au rapprochement et une personne corrige. Un avenant **ne peut pas descendre** sous le calendrier de créances déjà planifié.

**Q6-39 — Création de la bourse de l'État.** Le dossier vérifié doit-il **créer** la bourse « État » et séparer la facture (part de l'État / part de la famille) dans les finances ? *Défaut* : **non** — la bourse et les factures restent créées par l'économe dans les finances ; le module **compare** (écart facturé − déclaré, tolérance de l'établissement, zéro par défaut) et alerte.

**Q6-40 — Contrôles et certificat de présence.** Quelles **natures** de contrôle, à quel **rythme**, avec quel **justificatif** ? Le **certificat de présence** a-t-il un modèle imposé (en-tête, signatures, période) ? Que transmet-on à l'autorité et comment ? *Défaut* : **aucun contrôle exigé** ; l'établissement choisit les natures (présence, identité, rapprochement financier, pièces, autre) et le **délai d'échéance** (jours après la fin de période ou la vérification) ; l'application **planifie**, une personne **réalise** ; les faits de présence viennent du module des présences ; le certificat est une **pièce** rattachée (le gabarit officiel reste à fournir).

**Q6-41 — Formats d'export attendus par l'administration.** Quels fichiers l'autorité attend-elle (colonnes, ordre, intitulés, séparateur, encodage, fréquence, destinataire) ? *Défaut* : **aucun format officiel** ; chaque établissement **compose** ses formats (colonnes d'un catalogue, en-têtes, séparateur, BOM) ; à défaut, un **format neutre** reprend toutes les colonnes ; les montants sont des **entiers de francs**.

**Q6-42 — Ce que voit la famille.** La famille voit-elle la **référence** et la **date de l'acte**, le **statut** du dossier, la **part de la famille** ? *Défaut* : statut, référence, date de l'acte et « vérifié / en attente » ; **jamais** les montants de l'État, les échéances, les écarts ni les contrôles.

**Q6-43 — Changement d'année ou d'établissement.** Un élève affecté reconduit l'année suivante : le dossier est-il **reconduit** (même référence) ou **refait** ? Que devient le dossier en cas de **transfert** vers un autre établissement ? *Défaut* : le dossier suit l'**inscription** ; un nouvel exercice = nouveau dossier (la référence peut être reportée par une personne) ; le transfert **clôt** le dossier (date et motif).

**Q6-44 — Plateforme publique d'affectation.** Existe-t-il un **échange de fichiers** ou une **interface** officielle, avec quel identifiant d'échange et quelle garantie d'intégrité ? *Défaut* : **saisie et import manuels** ; la passerelle est un **port** dont l'adaptateur `NotConfigured` répond « non disponible » ; **aucun appel externe** n'existe ; `source = GATEWAY` et l'empreinte (SHA-256) de l'échange sont prêts.

## B. Décisions de conception prises par défaut (réversibles)

| # | Décision | Justification |
|---|---|---|
| D6-01 | Trois modules : `councils` (conseil + orientation), `schoollife` (vie scolaire), `stateassign` (affectés par l'État) | Un module = un schéma = un périmètre de responsabilité ; les trois évoluent à des rythmes différents ; `stateassign` n'est ni un conseil ni de la vie scolaire (le PRD demandait deux schémas : le troisième est le plus petit regroupement cohérent) |
| D6-02 | Les modules du pack sont **agnostiques du pack** (types en données) et déclarés `SECONDARY` | `councils` peut servir le conseil des maîtres du primaire (005) sans changement de schéma |
| D6-03 | `councils` **lit** `results`, `attendance`, `schoollife` par ports et n'en garde qu'un **instantané hashé** ; il ne calcule aucune valeur | Zéro règle hors moteur ; reproductibilité ; lint « aucune arithmétique sur les résultats » |
| D6-04 | Les décisions `PASSAGE`/`REPEAT` sont **propagées** à `results.decisions` ; les autres familles restent dans `councils` | `results` est la seule source lue par `academic`, `reportcards`, `higher` ; les contrats de règles ne connaissent que des codes de passage/redoublement |
| D6-05 | Appréciations et distinctions **écrites dans `results`** par effet, jamais dupliquées | Une seule source pour le snapshot de bulletin (013) |
| D6-06 | **L'acteur humain est imposé par la base** (`app.actor = 'user'` + `app.user_id`) pour tout acte réglementaire ou disciplinaire ; la personne enregistrée est toujours celle de la session | L'application ne décide jamais seule (PRD §41, §66.10) ; défense en profondeur contre un job ou un bug |
| D6-07 | Le **hash du PV est calculé par la base** (SHA-256 du texte `jsonb`, snapshot sans flottant) | Une seule source du hash ; vérifié par un job d'intégrité ; repli : fonction canonique de 013 |
| D6-08 | La signature est un **accusé daté et haché** (électronique, ou scan de signature papier) ; la **signature complète** passe automatiquement PV et séance à `SIGNED` (signatures sérialisées par verrou de ligne) | Aucune étape manuelle oubliée ; valeur légale = question juridique (§9 des sources) |
| D6-09 | Déverrouillage = **demande motivée approuvée par une autre personne** (défaut), consommée une fois, impossible avec un effet appliqué | Traçabilité sans bloquer la correction d'une erreur |
| D6-10 | **Effets idempotents** déclenchés à la signature (réglable : clôture) ; **exclusion = demande en attente d'un humain** | Aucun acte irréversible automatique |
| D6-11 | **Quorum, rôles exigés, signataires = données NULLables** ; **seule exigence structurelle : un président présent pour ouvrir** | Aucune valeur officielle inventée ; la décision doit avoir un porteur (Q6-02) |
| D6-12 | Types d'événements, gravités, barèmes, parcours, types de décision : **données** ; la **famille** (`kind`, `family`) reste énumérée | La famille pilote les tables et les circuits ; ajouter un type = une ligne |
| D6-13 | Confidentialité en trois niveaux, règle `audience_may_see` **unique** dans la base ; lecture confidentielle journalisée avant réponse | « Qui voit quoi » imposé à un seul endroit |
| D6-14 | Barème de conduite = **paramètre versionné et figé**, solde **dérivé**, registre **en ajout seul**, mouvement = valeur du barème ; la note de bulletin reste une saisie humaine | Zéro calcul caché de la note de conduite |
| D6-15 | `orientation_paths` **vide par défaut** ; un transfert de série n'existe que par une décision humaine ; dérogation motivée possible | Aucun parcours officiel inventé |
| D6-16 | Dossier d'affectation **versionné** (avenant = remplacer puis créer la version n+1) ; statut de rapprochement **calculé par la base** ; la référence d'`academic` provient du dossier **vérifié** | Une seule source de la référence ; traçabilité des changements de montants |
| D6-17 | Passerelle de l'État = **port** avec adaptateur `NotConfigured` ; `source` et empreinte d'échange déjà prévues | PRD §20 : couche d'intégration future |
| D6-18 | Retards et absences : **vue** d'`attendance`, aucune copie ni équivalence | Une seule source de présence |
| D6-19 | Jeu de règles **`CI-SECONDARY-PLACEHOLDER`** (copie de démonstration de `CI-CLASSIC-SEMESTRE`) + contrat demandé `secondary-annual@1` ; valeur `placeholder` demandée à 012 | Mécanisme + jeu fictif, mention imprimée |
| D6-20 | Plages de migrations : **attribuées** (councils 2100, schoollife 2200, stateassign 2300) ; les numéros 1800 / 1900 / 2000 de la première rédaction sont obsolètes | Prochaines plages libres du tableau de `module-conventions.md` ; à renuméroter si 005/007/018 les prennent |
| D6-21 | `effects_trigger = SIGNED`, `guardian_visibility = AFTER_NOTIFICATION`, `require_separate_unlocker = true`, `allow_quorum_waiver = true`, `require_separate_verifier = true` (défauts réglables) | Défauts prudents ; aucun n'est une règle officielle |
| D6-22 | `retention_days = NULL` | Aucune durée légale codée (Q6-17) |
| D6-23 | Les **créances sur l'État** sont un **calendrier attendu** (échéances) suivi dans `stateassign`, rattaché à l'**inscription** (un avenant n'en perd aucune) ; `finance` reste le grand livre ; le **reçu** est rapproché des paiements du financeur, le **statut** d'échéance est **calculé par la base**, le **retard est dérivé** (échéance + grâce) | R-A6 : `stateassign` n'écrit aucun montant facturé ; une seule source des paiements |
| D6-24 | Les **formats d'export** sont des **données** (`stateassign.export_formats`), sans format officiel livré ; un format neutre intégré sert de repli ; cellules texte neutralisées contre l'injection de formule | Aucun format inventé ; sécurité des tableurs |
| D6-25 | Rejeter un dossier **déjà vérifié** ne modifie **pas** l'inscription (financement, référence) : audit et événement le signalent | Acte financier : une personne décide (Q6-36) |
| D6-26 | Un contrôle de **présence** vise une **période** ; les faits viennent d'`attendance` (valeur effective), jamais calculés par le module | Les récapitulatifs de présence sont par période |
| D6-27 | Le rapprochement n'écrit rien s'il n'a rien à changer le même jour ; les horodatages de rapprochement, d'alerte et de retard viennent de l'**horloge injectée** | Historique non pollué ; tests déterministes |

## C. Incohérences relevées dans d'autres documents

| # | Constat | Traitement |
|---|---|---|
| B6-01 | `012/parity.md` P-RUL-25 écarte l'indicateur « affecté / redoublant » en le déduisant du **code de décision** ; le legacy affiche « Affecté(e) » pour tout non-redoublant, et le PRD §20 désigne l'**affectation par l'État** | 006 rattache « Affecté(e) » au **type de financement** de l'inscription (parité P-S-05, Q6-23) ; **013 doit adapter son snapshot** (`fundingType`) |
| B6-02 | `011/spec.md` §2 : « conseil de classe complet : 005, 006 (réutilisent `results.deliberations/decisions`) » ; mais `results.confirmDecision` n'accepte que les codes du contrat de règles | 006 **compose** : propagation limitée aux familles `PASSAGE`/`REPEAT` ; les autres décisions restent dans `councils` (D6-04) ; demande d'un port d'écriture à 011 |
| B6-03 | `rule-contracts.md` (`coef-semester@1`) : la moyenne annuelle suppose `s1`, `s2` et `second_semestre` ; le modèle de pack `academic/templates/CI/secondary.json` propose aussi `THREE_TERMS` | Contrat `secondary-annual@1` demandé ; pour `THREE_TERMS`, aucun contrat de calcul n'est valide aujourd'hui (Q6-01) |
| B6-04 | `academic/templates/CI/secondary.json` : `terminalExamRequired` absent partout alors que le PRD §15 relie 3e → BEPC et Terminale → BAC | Demande à 004 de renseigner les deux niveaux, **à confirmer** (Q6-27) |
| B6-05 | `004/open-questions.md` D-27 : la feature `academic.state-assigned` est rattachée au pack SECONDARY ; `finance.state-assigned` aussi | `stateassign.core` suit la même logique (pack SECONDARY) ; Q6-23 pour l'extension éventuelle au primaire |
| B6-06 | `008/spec.md` R3 : « la sanction disciplinaire détaillée relève de 006 » | Pris en charge (mesures `TEMP_EXCLUSION`, application humaine du statut `SUSPENDED`/`EXCLUDED`) |
| B6-07 | PRD §20 liste « présence », « contrôles », « historique des créances », « documents » pour l'élève affecté | Présence = lecture d'`attendance` ; créances = `finance` ; contrôles et documents = `stateassign` |
| B6-08 | Spec 018 (examens) en cours de rédaction par un autre agent | Noms d'événements et de ports de 018 marqués ⚠ ; alignement dans T6-EXAM-FACTS |
| B6-09 | `docs/menus-et-fonctionnalites-par-profil.md` ne décrit ni conseil, ni vie scolaire, ni affectation (seule la page « Conduite » du module Professionnel existe) | Parité §2 ; ces fonctions sont **nouvelles** |
| B6-10 | `infra/scripts/migrations/026_create_incidents_tables.sql` crée des tables d'« incidents » : il s'agit de la **sécurité d'installations (RSO-PFSO)**, pas de la vie scolaire | Hors périmètre, non réutilisé (parité P-S-21) |
