# Limites repérées pendant la rédaction du guide (Pack Primaire) — à traiter après

Ce fichier regroupe les écarts relevés **en lisant le code** pour écrire [`GUIDE_DONNEES_PRIMARY.md`](GUIDE_DONNEES_PRIMARY.md). Rien n'a été confirmé à l'exécution : chaque ligne est à vérifier dans l'application avant d'être corrigée. Ce sont des cas à gérer plus tard, pas des blocages pour commencer la saisie.

Colonne « Gravité » : **Bloque** = un parcours du guide ne peut pas être joué ; **Contourne** = un détour existe ; **Info** = comportement à connaître, probablement voulu.

## Avancement (2026-10-12)

| # | État | Ce qui a été fait |
| :--- | :--- | :--- |
| L-01 | Traité | `pnpm dev:v2:add-account` gère maintenant : directeur, responsable pédagogique, directeur des études, secrétariat, économe, éducateur, responsable des examens, chargé d'admissions, instituteur, parent, élève (`DEVV2_ACCOUNT_ROLE=<rôle>`). Les comptes à permission sensible reçoivent la MFA, les autres un mot de passe seul. |
| L-02 | Traité (développement) | `pnpm dev:v2` active `ACCOUNT_MAIL_DEV_LINKS=1` : sans SMTP, le lien d'invitation ou de réinitialisation est journalisé par l'API (événement `iam_mail_dev_link`, niveau info). Refusé si `NODE_ENV=production` ; jamais actif par défaut hors `dev:v2`. Test ajouté dans `apps/api/test/platform-assembly.test.ts`. |
| L-04 | Traité | Fiche du personnel : bouton « Lier à un compte existant » (liste des comptes de l'établissement, sans invitation) sur l'API `POST /people/persons/:id/identity` ; un compte déjà lié est refusé. Le propriétaire peut ainsi se relier à une fiche et saisir des compétences. `pnpm dev:v2:add-account` crée aussi l'instituteur avec sa fiche liée. Même lien possible pour une fiche de tuteur ou d'élève par l'API (pas d'écran dédié). |
| L-30 | Traité | « Appel du jour » de « Ma classe » : si l'API demande la demi-journée, l'instituteur choisit « Appel du matin » ou « Appel de l'après-midi » et l'appel s'ouvre sur cette demi-journée. |
| L-22 | Traité | (1) Écran « Réglages » des résultats (`/v2/results/settings`, permission `result.settings.manage`) : délibération obligatoire, approbateur distinct, temporisation du recalcul. (2) **Jury d'un EXAMEN BLANC** (Examens > Examens blancs, section « Jury de l'examen blanc », permission `exam.mock.manage`, fonction `examinations.mock`) : ouverture du jury (il faut des résultats calculés par la règle), décision par candidat (admis, ajourné, différé) avec motif de 20 caractères au moins pour tout écart avec la proposition de la règle, clôture quand tous les candidats sont tranchés (figé, base comprise). Migration `2008_examinations_mock_jury.sql` (aussi copiée dans `specs/v2/018-examinations/ddl/migrations`). Le jury ne modifie JAMAIS le résultat calculé et ne donne aucun document officiel. **Pas de jury pour un examen OFFICIEL** (CEPE…) : l'admission y est prononcée par l'autorité, l'école l'enregistre ou l'importe (principe du module, déclencheur `official_not_computed`). |
| L-60 | Traité (frais d'inscription) | À la création d'une inscription saisie à la main ou en ligne, la facture des frais `REGISTRATION` est créée automatiquement si un barème s'applique (même règle que l'admission ; clé d'idempotence `enrollment-registration-<inscription>`). Ni l'admission (qui facture elle-même), ni l'import, ni la reconduction. Un échec de facturation est journalisé et ne défait pas l'inscription. La scolarité (TUITION) reste facturée par l'économe selon le calendrier : non automatisée. À valider en réel avec un barème de frais d'inscription. |
| L-72 | Traité | Liste d'attente : avec un seul dossier, bouton « Classer ce dossier en rang 1 » puis « Enregistrer l'ordre » (l'API acceptait déjà une liste d'un élément ; seule l'interface exigeait deux dossiers pour proposer l'enregistrement). Le 5e dossier prévu dans le guide n'est plus indispensable. |
| L-75 | Partiel (comportement voulu) | L'admission facture déjà les frais de catégorie `REGISTRATION` dès qu'un barème de Finance s'applique (année, niveau, programme, type de financement) ; sans barème, aucune facture et l'inscription est confirmée sans paiement, par conception. Il n'y a donc pas de réglage « frais de dossier » à ajouter : il faut créer le barème dans Finance > Frais. Changé : après « Accepter au nom de la famille », le dossier affiche si la facture a été créée ou non (avertissement explicite quand elle ne l'est pas). Reste côté acceptation PAR LA FAMILLE (lien public) : aucun message équivalent, volontairement (la famille ne voit pas les montants). |
| L-41 | Traité | « Bulletins — émission » : case « Émettre pour quelques élèves seulement » et liste des élèves à cocher ; l'API recevait déjà `enrollmentIds`. La sélection entre dans la clé d'idempotence côté serveur (un second élève ne rejoue plus le lot du premier). Les bulletins déjà émis ne sont jamais refaits. |
| L-42 | Traité | Le bulletin reçoit le bloc « Compétences » : par domaine du référentiel publié, compétences évaluées / attendues et décompte par niveau de l'échelle de la période (`getReportcardCompetencies`, branché dans l'adaptateur résultats → bulletins). Que des comptages. Les bulletins déjà émis ne changent pas (instantané figé) : il faut en émettre de nouveaux. À vérifier visuellement sur le PDF (le gabarit affiche le bloc quand il est présent). |
| L-50 | Traité | Sans proposition de la règle, le conseil de fin d'année tranche lui-même : décision obligatoire + justification de 20 caractères au moins, conservée avec la décision, audit sensible. Hors dernière période : refus inchangé. |
| L-62 | Traité (développement) | `pnpm dev:v2:fail-webhook` pose un événement FAILED sur chaque paiement simulé (`sandbox`) en attente (montant finissant par 001) de l'école (`DEVV2_SCHOOL_SLUG`) : « Webhooks en échec » se remplit et « Rejouer » devient testable. Non exécuté en réel. |
| L-16 | Traité (horaires d'ouverture) | Nouvel écran « Horaires d'ouverture » (`/v2/schedule/hours`, onglet de l'emploi du temps, permission `schedule.manage`) : ouverture, fermeture, jours ouvrés, sur l'API existante. Le taux d'occupation des salles se calcule alors. Reste non fait : une grille de créneaux types de l'école (les heures des séances se saisissent toujours une à une). |
| L-10 | Traité | Nouvel écran « Matières » (`/v2/academic/subjects`, onglet du menu Académique) : liste, création, modification, désactivation, sur l'API existante (`curriculum.read` / `curriculum.manage`). |
| L-33 | Traité | Demande de congé : sélecteur « Justificatif (certificat médical…) » (dépôt d'un fichier ou choix d'un document du membre, catégories du personnel). Obligatoire à l'écran si le type de congé exige une pièce ; la référence part en `documentRef`. |
| L-83 | Traité (développement) | `DOCUMENTS_SCANNER=dev-eicar`, actif par défaut sous `pnpm dev:v2` : un fichier qui contient la chaîne d'essai EICAR (inoffensive) est mis en quarantaine, les autres sont « sains ». Refusé en production. |
| L-40 | Traité | Création d'évaluations en lot : un champ « Enseignant du cours n » par ligne (visible avec `assessment.manage`), envoyé en `teacherId` ; l'API le validait déjà. Sans lui elle répondait « Indiquez l'enseignant de l'évaluation ». |
| L-70 | Traité | Réglages d'admission : case « Formulaire de candidature public ouvert » (`publicFormEnabled`). |
| L-73 | Pas un défaut | Après « Retirer l'offre », le dossier reste « Admis » et garde sa place **volontairement** : la direction peut réémettre une offre (par exemple pour corriger la classe). La place se libère en clôturant le dossier (retrait, refus). À rendre plus explicite dans l'écran si besoin. |
| L-74 | Traité | Un refus à l'acceptation (409) affiche « l'établissement vous contactera », une offre échue (410) « arrivée à échéance » ; « lien invalide » est réservé aux liens inconnus. Le détail interne reste caché à la famille. |

## 1. Comptes et accès

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-01 | `pnpm dev:v2:add-account` ne gère que les rôles `directeur` et `responsable_pedagogique` (`scripts/dev-v2/add-account.ts`) | Bloque | Pas de compte instituteur, secrétariat, économe, directeur des études, parent ni élève utilisable | Étendre la table `ROLES` du script avec les rôles système `instituteur`, `secretariat`, `econome`, `directeur_etudes`, `parent`, `eleve` |
| L-02 | Les invitations faites par l'interface (« Utilisateurs », « Inviter au portail » des fiches personnel, élève, tuteur) n'envoient aucun e-mail en développement et le jeton n'est pas journalisé | Bloque | Une personne invitée n'obtient jamais de mot de passe et ne peut pas se connecter | Brancher un SMTP local (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `V2_APP_BASE_URL`) ou journaliser le lien d'invitation en développement |
| L-03 | « Inviter au portail » donne le rôle `enseignant` à un membre du personnel de catégorie « Enseignant », jamais `instituteur` ; seul `instituteur` porte les droits du pack (compétences, conseil) | Contourne | Un titulaire invité ne verrait pas « Ma classe » | Attribuer ensuite « Instituteur » dans « Attributions de rôles », ou choisir le rôle selon le cycle |
| L-04 | Aucun écran ne relie un compte existant à une fiche du personnel (seule l'invitation crée le lien) | Bloque | Le propriétaire ne peut pas saisir de compétence : « Un compte sans fiche de personnel ne saisit pas d'évaluation » | Écran de liaison compte ↔ fiche, ou fiche de personnel pour le propriétaire |
| L-05 | Le responsable pédagogique n'a aucune permission `analytics.*` | Info | Il ne voit pas le menu Pilotage | À confirmer si c'est voulu |

## 2. Structure académique

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-10 | Aucun écran « Matières » (création, modification, désactivation) ; le service existe côté API (`POST /api/v1/academic/subjects`) | Contourne | Le catalogue ne se remplit que par l'import « Matières et curriculum » | Ajouter l'écran |
| L-11 | Aucun écran pour modifier ou archiver une échelle d'appréciation (création seulement) | Info | Impossible de tester « échelle verrouillée » par la modification | Ajouter la modification d'une échelle non utilisée |
| L-12 | Les phrases de la banque d'appréciations ne se modifient ni ne se suppriment (création, désactivation, réactivation seulement) | Info | Une faute de frappe est définitive | Ajouter la modification d'une phrase |
| L-13 | Les niveaux de classe auxquels s'applique un référentiel ne sont pas affichés dans son détail | Info | Le lien référentiel ↔ classe ne se vérifie qu'à la publication | Afficher les niveaux dans le détail |
| L-14 | L'« Échelle d'appréciation par défaut » et le réglage « Activer la banque d'appréciations » ne sont lus par aucun autre écran | Info | Aucun effet visible quand on les change | À confirmer, sinon les brancher |
| L-15 | La durée de conservation des archives n'est qu'un réglage mémorisé : aucune purge n'existe | Info | Rien à observer | — |
| L-16 | Grille horaire de l'école et « Horaires d'ouverture » : aucun écran de saisie ; « Occupation de la semaine » affiche « Horaires d'ouverture non renseignés » | Contourne | Les heures ne servent qu'à remplir les créneaux à la main | Ajouter la saisie |

## 3. Écrans déclarés dans le menu mais absents

| # | Limite | Gravité | Piste |
| :--- | :--- | :---: | :--- |
| L-20 | « Calendrier de l'établissement », « Validation des séances », « Paramètres de présence » et « Paramètres des personnes » : entrées déclarées par l'API, volontairement masquées faute d'écran | Info | Créer les écrans ou retirer les entrées |
| L-21 | « Résultats de classe » et « Périodes : verrouillage et clôture » ouvrent la même page `/v2/results` | Info | Distinguer les deux ou fusionner les entrées |
| L-22 | « Délibérations » : pas d'écran de délibération pour les examens ; le réglage « délibération obligatoire pour clôturer une période » n'est modifiable par aucun écran | Bloque | Piste : écran de réglage |
| L-23 | Onglet « Offres de cours » proposé dans « Académique » alors que l'inscription à la carte n'est pas incluse dans le pack Primaire | Info | Masquer l'onglet pour ce pack |
| L-24 | « Vie scolaire (agrégée) » (Pilotage) est affiché alors que le module Vie scolaire n'est pas dans le pack Primaire | Info | Masquer le menu pour ce pack |

## 4. Présences et appel (pack Primaire)

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-30 | Le bouton « Appel du jour » de « Ma classe » ne propose pas la demi-journée : pour une classe du primaire (matin + après-midi) il répond « Précisez la demi-journée de l'appel : matin ou après-midi. » | Contourne | Passer par « Faire l'appel » | Ajouter le choix de la demi-journée |
| L-31 | Pas d'appel par séance au primaire : « Appels non faits » est sans objet | Info | — | — |
| L-32 | Remplacements : le remplaçant doit être libre sur le créneau ; le congé doit être approuvé après la génération des séances, sinon rien n'est signalé « À remplacer » | Info | Ordre de saisie contraint | Documenter dans l'écran |
| L-33 | « Congé maladie » exige une pièce jointe impossible à joindre depuis l'écran | Bloque | Type de congé inutilisable | Ajouter l'upload dans l'écran |

## 5. Évaluations, résultats, bulletins

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-40 | Création d'évaluations en lot par la direction : pas de champ « Enseignant » (« Indiquez l'enseignant de l'évaluation. ») | Bloque | La direction ne peut pas créer d'évaluation en lot | Ajouter le champ |
| L-41 | Les bulletins ne s'émettent que par classe entière, jamais pour un seul élève depuis l'écran | Contourne | Utiliser « Publier » sur la ligne de « Bulletins — liste » | Ajouter l'émission individuelle |
| L-42 | Le bloc « Compétences » n'est alimenté par aucun module : il manquera sur les bulletins, Grande Section comprise | Bloque | Le bulletin de maternelle est vide de compétences | Brancher les compétences du pack au contexte d'impression |
| L-43 | Au Trimestre 1, aucune décision n'est proposée par les règles (seulement au Trimestre 3) | Info | Les délibérations de T1 n'ont rien à confirmer | — |
| L-44 | Les titulaires n'ont aucun emplacement de signature sur le bulletin | Info | — | Ajouter un emplacement « Titulaire » |
| L-45 | Les règles de calcul du pack sont des règles de démonstration (jeu fictif `CI-PRIMARY-PLACEHOLDER`) | Info | Aucune conclusion réglementaire possible | — |
| L-46 | Pilotage : les cartes de moyenne et de validation restent « Non mesuré » ; aucune saisie de charges de fonctionnement (« Charges et résultat » n'a pas de formulaire) | Info | — | Prévoir un module de charges |
| L-47 | Règles d'alerte : pas d'indicateur « taux d'absence » ni de seuil d'ancienneté d'impayés | Info | — | Ajouter ces indicateurs |

## 6. Pack Primaire : conseil, bilans, archive

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-50 | Préparer un conseil exige un état de résultats pour la classe et la période ; décider exige une proposition de la règle (« La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés. ») | Bloque | Dans une école neuve, la décision du conseil peut être refusée | Permettre une décision manuelle motivée |
| L-51 | Sceller un bilan exige périodes closes, résultat d'année et décision du conseil confirmée : impossible en octobre | Info | Le scellement et la réémission ne se testent pas en début d'année | Environnement de démonstration avec année avancée |
| L-52 | L'archive d'année ne devient « Prête à geler » qu'une fois l'année close, les bilans scellés et chaque inscription couverte | Info | « Geler l'archive » n'est pas atteignable | — |
| L-53 | Les familles ne voient ni le PDF ni les notes du bilan : seulement les compteurs de compétences, la décision et l'empreinte | Info | À confirmer | — |
| L-54 | L'état d'une période « planifiée » s'affiche « ouverte » dans « Ma classe » : la saisie pourrait être possible avant l'ouverture par la direction | Info | À vérifier | Aligner l'affichage |

## 7. Finance et paie

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-60 | Aucune facture n'est créée à l'inscription ; l'inscription doit être choisie à la facture, sinon le barème par niveau n'est pas trouvé | Contourne | Ordre de saisie contraint | Facturer à l'inscription |
| L-61 | Aucun frère ni sœur parmi les 9 élèves : la remise fratrie est créée mais jamais appliquée | Contourne | — | Ajouter une fratrie au jeu de données |
| L-62 | Webhooks en échec : aucun événement ne peut être produit depuis l'interface (seuls de vrais opérateurs en envoient) | Bloque | « Rejouer » n'est pas testable | Injecteur de webhook de test |
| L-63 | Fournisseurs de paiement : le fournisseur simulé n'a pas de carte et dépend de `NEXT_PUBLIC_FINANCE_SANDBOX=1` | Info | — | — |
| L-64 | Paie : pas de règles de cotisation, de rubriques ni de jour de paie ; les cotisations se saisissent comme retenues manuelles ; les contrats ne portent pas de salaire (il est dans la configuration de paie) | Info | — | — |
| L-65 | Paie : pas d'économe ; pour les quatre yeux, le directeur calcule et le propriétaire arrête (seuil dépassé pour BAMBA) ; si le propriétaire calcule, il est bloqué | Contourne | Ordre des rôles contraint | — |
| L-66 | « Élèves affectés par l'État » n'est pas dans le pack Primaire : l'option « Affecté par l'État » du mode de prise en charge existe dans les listes mais ne doit pas être choisie | Info | — | Masquer l'option |
| L-67 | Les chiffres attendus du « Tableau de bord financier » sont calculés à la main dans le guide | Info | À vérifier à l'exécution | — |

## 8. Admissions

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-70 | L'ouverture du formulaire public (`publicFormEnabled`) ne peut être posée depuis aucun écran : `/v2/apply/<lien>` répond « Ce formulaire n'est pas disponible. » | Bloque | Candidature publique, suivi et réponse à l'offre par la famille non testables | Ajouter le réglage d'ouverture |
| L-71 | Aucun écran n'affecte une classe de priorité à un dossier : la colonne « Priorité » reste « — » | Info | — | Ajouter le champ |
| L-72 | Le classement de la liste d'attente exige au moins 2 dossiers | Contourne | Un 5e dossier est prévu dans le guide | — |
| L-73 | « Retirer l'offre » passe l'offre à « Retirée » mais ne libère pas la place | Bloque | Place conservée à tort | Corriger la libération de la place |
| L-74 | Les erreurs d'acceptation d'une offre (sexe absent, pièces non acceptées, classe non désignée) s'affichent côté famille « Ce lien n'est pas ou plus valide. » | Bloque | Message trompeur | Afficher la cause réelle |
| L-75 | Aucun réglage « frais de dossier » : sans barème Finance, l'acceptation d'une offre crée l'élève et l'inscription sans facture, et l'inscription est confirmée sans paiement | Contourne | La politique « après paiement » n'est pas déclenchée par l'admission | Lier les frais d'admission à la Finance |

## 9. Communication, notifications, documents

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-80 | Seuls le propriétaire et le directeur ont un compte : les conversations direction → tuteur et titulaire → parents donnent « Aucun destinataire joignable » | Bloque | Équivalent propriétaire → directeur donné dans le guide | Résolu par L-01/L-02 |
| L-81 | Une annonce est refusée sans destinataire | Contourne | Cible « Rôle = directeur » utilisée | — |
| L-82 | Partage de document et droits par personne : la recherche ne trouve que des personnes ayant un compte | Bloque | Non testables | Résolu par L-01/L-02 |
| L-83 | Aucun antivirus branché (`DOCUMENTS_SCANNER`) : rien n'entre jamais en quarantaine, les dépôts restent « Non analysé » | Bloque | Écran « Quarantaine des documents » toujours vide | Brancher un scanner de test |
| L-84 | Les tuteurs saisis n'ont pas d'e-mail : seul le SMS aboutit | Info | — | Ajouter des e-mails aux tuteurs du jeu de données |
| L-85 | Pas de réglage global des types de fichiers (ils se règlent par catégorie), pas de création de règle de notification, pas de cible « tuteur principal » | Info | — | — |
| L-86 | Canaux d'envoi simulés (`NOTIFICATIONS_SIMULATE=1`) | Info | Aucun envoi réel | — |

## 10. Examens (CEPE de démonstration)

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-90 | Le pack Primaire ne lie pas la règle d'examen `CI-EXAM-PLACEHOLDER` ; sans liaison manuelle (« Liaisons aux programmes ») l'éligibilité est manuelle, le taux est « — » et l'examen blanc ne se calcule pas | Contourne | Lier avant « Copier et figer la définition » | Lier la règle dans le modèle de pack |
| L-91 | Aucun contrôle de date : tout est jouable dès octobre 2026 | Info | — | — |
| L-92 | Un acte de naissance (module « Documents ») par élève est exigé avant l'inscription d'un candidat | Contourne | À déposer d'abord | — |
| L-93 | L'examen blanc exige des évaluations « Examen blanc » publiées ; les noms d'épreuves ne sont pas modifiables et ne correspondent pas aux matières ; aucun écran pour ajouter une pièce, une filière ou un format à un candidat (API seulement) | Contourne | — | — |
| L-94 | « Examens de mes enfants » : aucun compte parent | Bloque | Non jouable | Résolu par L-01/L-02 |

## 11. Données et environnement

| # | Limite | Gravité | Effet sur le test | Piste |
| :--- | :--- | :---: | :--- | :--- |
| L-100 | Le guide a été écrit en lisant le code, sans exécution : tous les « ✅ » sont à confirmer | Info | Les écarts à l'exécution sont attendus | Rejouer le guide et corriger les attendus |
| L-101 | Le contrôle automatique des libellés signale 195 « libellés » absents de `fr-CI.json` : presque tous sont des noms de données ou des messages du serveur entre « », pas des boutons ; non passés en revue un par un | Info | — | Trier ou normaliser l'usage des « » |
| L-102 | Panneau de connexion : présent sur `/v2/login`, absent de `/login` ; il faut relancer `pnpm dev:v2` après la création d'une école ou d'un compte | Info | — | — |
| L-103 | Les actes irréversibles (clôture de période, signature de présence du conseil, scellement, réémission, gel d'archive, passage en production) ne se rejouent pas sur la même école | Info | Une nouvelle école est nécessaire pour les rejouer | — |
