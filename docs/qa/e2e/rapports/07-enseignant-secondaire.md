# Rapport de session 07 : Enseignant / Collège Le Baobab (secondaire-test)

- Compte : enseignant@secondaire-test.test, rôle actif « Enseignant » (sans MFA)
- Établissement : Collège Le Baobab (démonstration)
- Date : 2026-10-07 ; reprise de 14:30 à 15:16 environ (début de la première passe non relevé)
- Navigateur : Chrome piloté par Claude in Chrome, fenêtre 894 × 487, mode développement ; mode hors ligne non activé
- Passe 2 (reprise) : non faite

Règles de démonstration : bandeau « Règles de démonstration — non réglementaires » présent sur le conseil de classe et les éditions ; aucune conclusion réglementaire.

## Parcours exécutés
| Parcours | Résultat | Constats | Remarque |
|---|---|---|---|
| P1 Portail | ⚠️ | C-07-01, C-07-03, C-07-14 | 12 entrées de menu conformes ; « Mes classes » ne montre que 6e A |
| P2 Appel | ⚠️ | C-07-03, C-07-04, C-07-05 | Appel Anglais 6e A du 7 oct. « Appel soumis » (8 présents, 1 absent, 1 en retard) ; correction après soumission acceptée puis remise à l'état d'origine ; refus hors fenêtre non testé |
| P3 Emploi du temps | ⚠️ | C-07-01, C-07-07 | Semaine lue ; aucune déclaration de séance ponctuelle trouvée |
| P4 Évaluation | ⚠️ | C-07-02, C-07-03, C-07-06, C-07-10, C-07-11, C-07-16, C-07-19 | Création en Trimestre 2 refusée (période verrouillée), en Trimestre 3 acceptée ; note 25 refusée (« La note dépasse le barème (20,000). ») ; double-clic : une transition acceptée (200), une refusée (409) |
| P5 Correction d'une note publiée | ⚠️ | C-07-08, C-07-16 | Motif trop court refusé ; demande enregistrée (le renvoi donne 409) ; pas de confirmation ni d'état « en attente » ; aucun bouton d'approbation |
| P6 Appréciations | ⚠️ | C-07-09 | Aucun écran d'appréciation de matière ; proposition enregistrée via le conseil de classe |
| P7 Paie, congés, présence | ⚠️ | C-07-01, C-07-12 | Bulletins de paie : état vide clair ; congé enregistré (« Demandé »), type en code brut |
| P8 Messagerie | ⚠️ | C-07-17, C-07-18 | Message direct et diffusion à 6e A envoyés ; recherche hors périmètre : « Aucune personne autorisée ne correspond à cette recherche. » |
| P9 Hors ligne | ⏭️ | — | Désactivé (aucun service worker) |
| P10 Vie scolaire et conseil | ⚠️ | C-07-03, C-07-09, C-07-20 | Incident et encouragement enregistrés ; proposition d'appréciation enregistrée ; boutons « Accepter » / « Refuser » visibles |
| P11 Négatifs de droits | ⚠️ | C-07-13, C-07-15 | 9 adresses refusées sans donnée ; pas de bouton « Valider » ni « Publier » sur la feuille |

## Constats
### C-07-01 : Faux états vides pendant le chargement — Mineur
« Aucune classe ne vous est affectée », « Aucun emploi du temps n'est accessible avec votre profil », « Aucun appel sur la période. » (historique) pendant 5 à 15 s, puis les vraies données. Inclut l'ancien C-07-06 (historique) : après chargement complet l'appel du jour est bien listé.

### C-07-02 : Évaluations de même titre sans colonne « Matière » — Mineur
`/v2/teacher/assessments` : quatre « Devoir de la période 2 », quatre « Composition », etc., indiscernables ; la matière n'est que dans le détail.

### C-07-03 : Cinq élèves absents des feuilles d'appel et de notes ; identifiants tronqués sur l'appel — Majeur
« Mes classes » > 6e A liste 15 élèves ; l'appel et la feuille de notes n'en contiennent que 10. Manquent KOUASSI Yao Jean-Marc (00015), N'GUESSAN Aya (00012), N'GUESSAN Koffi (00011), SORO Aya (00010), SORO Elie (00009). Sur l'appel, élèves affichés « Élève …1ae9 », « …a937 », « …8d4e ». Incident pour N'GUESSAN Koffi : « Inscription introuvable (01a110ee-91f7-…) », alors qu'il aboutit pour ADOU Aïcha.

### C-07-04 : « Aucune exception : tous présents » affiché avec un absent et un retard — Mineur
Constaté en première passe ; non reproduit en reprise (la page soumise affiche « Présent : 8 · Absent : 1 · En retard : 1 »).

### C-07-05 : La navigation par lien interne se bloque — Majeur
« Mes appels » > « Voir l'appel » : « Ouverture de l'appel… » figé plus de 20 s (jusqu'à plus de 2 minutes) ; « Nouvelle évaluation » ne change pas de page. Chargement direct de l'adresse : environ 20 s, puis environ 6 s après le correctif annoncé.

### C-07-06 : Erreur d'hydratation React sur « Mes évaluations » — Mineur
« Hydration failed… » : le tableau a `aria-busy` côté client et une ligne « skeleton-row » absente du rendu serveur (deux occurrences à 14:55:04).

### C-07-07 : Aucune déclaration de séance ponctuelle sur l'emploi du temps — Mineur
Seuls « Afficher », « Vue » (Semaine/Jour), navigation de semaine, « Aujourd'hui », « Exporter le calendrier » et la case « séances annulées ».

### C-07-08 : Demande de correction sans confirmation ni état « en attente » — Mineur
La boîte se ferme sans message ; la page affiche toujours « Aucune modification en attente » ; un second envoi donne 409 « Une demande de correction est déjà en cours pour cette note. ».

### C-07-09 : « Accepter » / « Refuser », décision et mode séance proposés à l'enseignant — Majeur (à confirmer)
Conseil « période 2 (démonstration) » : boutons « Accepter » et « Refuser » sur la proposition, formulaire « Enregistrer une décision » (type, décideur, mode ; aucun bouton d'envoi trouvé), « Passer en mode séance », « Délibération », « Voir les effets ». Non cliqués.

### C-07-10 : « Renvoyer en brouillon » et « Annuler l'évaluation » proposés à l'enseignant — Majeur (à confirmer)
Sur une feuille « Soumise » : « Renvoyer en brouillon » et « Annuler l'évaluation » ; sur une évaluation « Publiée » : « Annuler l'évaluation ». Non cliqués.

### C-07-11 : Message d'erreur affiché après une soumission réussie (double-clic) — Mineur
« La feuille de notes est soumise. » avec, en même temps, « L'évaluation a été modifiée entre-temps : rechargez-la. » (200 puis 409).

### C-07-12 : Type de congé affiché en code brut — Mineur
« AUTHORIZED_ABSENCE » dans la liste des congés.

### C-07-13 : Fiche élève « réduite » incohérente — Mineur
Bandeau « Fiche réduite : … sans coordonnées ni historique complet », alors que la fiche affiche le tuteur principal, son téléphone et une section « Coordonnées ».

### C-07-14 : Titre d'onglet « Administration » sur des pages enseignant — Mineur
`/v2/students/…`, `/v2/councils`, `/v2/messages`, `/v2/announcements`.

### C-07-15 : Accès refusé dans l'ancien habillage en anglais — Mineur (connu : C-03-09)
9 adresses refusées sans donnée : `/v2/finance`, `/v2/payroll/history`, `/v2/academic/years`, `/v2/results/matrix`, `/v2/students/new`, `/v2/access/roles`, `/v2/audit`, `/v2/admissions`, `/v2/schoollife/validations`.

### C-07-16 : Messages de validation périmés dans les formulaires — Mineur
« La période de cette classe est verrouillée… » reste affiché après changement de période ; « Le motif doit faire au moins 10 caractères. » reste affiché avec un motif correct.

### C-07-17 : Notifications contradictoires — Mineur
« Aucune notification non lue » dans la page alors que la cloche affiche « 1 notification non lue ».

### C-07-18 : Libellé « vos enfants » dans la messagerie enseignant — Suggestion
« … celles qui sont liées à vos enfants, à vos classes ou à l'administration. »

### C-07-19 : Barème affiché « 20,000 » — Suggestion
« Sur 20,000 », « Par défaut : 20,000 », « Par défaut : 1,000 ».

### C-07-20 : Chevauchement de textes sur les cartes de « Saisie rapide » — Mineur
`/v2/schoollife/saisie` à 894 px : titres et descriptions se chevauchent ; semaine de l'emploi du temps tronquée (« Mathématiq… »).

## Données créées (fictives)
Évaluation « Devoir de Mathématiques n°2 (test QA) » (6e A, Mathématiques, sur 20, coef. 1, Trimestre 3), soumise, notes : ADOU 14, ASSI 9,5, BAMBA Aya absente, BAMBA Fatou dispensée, COULIBALY Moussa 12, COULIBALY Salimata 15, DIABATE Nadia 16, DIABATE Salimata 11, TOURE Jean-Marc 8, TOURE Yao 13 ; demande de correction BAMBA Aya 10 → 11 (« Erreur de report de la copie n°7 (test QA) ») à rejeter par le relecteur ; correction d'appel (élève …8d4e) remise à l'état d'origine ; congé « Absence autorisée » 19–20 oct. (« Demandé », annulable) ; message direct à DIABATE Séka et diffusion à la 6e A ; incident « Bavardage répété en classe (test QA) » et encouragement « Bonne participation en classe (test QA) » pour ADOU Aïcha ; proposition d'appréciation pour BAMBA Aya au conseil.

## Actions irréversibles
Soumission de la feuille de notes (double-clic ; une transition acceptée, une refusée), vers 15:13.

## Points non testés
Séance ponctuelle et conflit (fonction non trouvée) ; appréciation de matière (pas d'écran dédié) ; refus d'une correction hors fenêtre ; hors ligne (désactivé) ; famille ou élève d'une autre classe (une seule classe) ; effets réels des boutons C-07-09 et C-07-10 ; clavier ; « Mon profil » rouvert en reprise.

## Synthèse
Bloquant 0 · Majeur 4 (C-07-03, C-07-05, C-07-09, C-07-10) · Mineur 14 · Suggestion 2.

## Traitement par le développeur (2026-10-07)
| Constat | Verdict | Action |
|---|---|---|
| C-07-03 | **Pas un défaut de données.** Les 5 élèves ont une inscription « En attente » (10 inscriptions actives, 5 en attente) : l'appel et les notes ne portent que sur les inscriptions actives, c'est voulu. Reste un défaut d'affichage : la fiche de classe les compte comme élèves actifs sans montrer que leur inscription est en attente, et le message « Inscription introuvable (identifiant) » n'est pas lisible. | À corriger : afficher le statut d'inscription dans « Mes classes », message « L'inscription de cet élève n'est pas encore confirmée » ; nom au lieu de « Élève …1ae9 » sur l'appel. |
| C-07-05 | **Défaut réel corrigé** : l'écran perdait le rappel qui reçoit l'identifiant de la session d'appel quand React montait deux fois le composant (mode développement). API mesurée à 61–400 ms. | `CallScreen.tsx` et `DailyCall.tsx` lisent l'identifiant dans l'état de la mutation. Tests 166 verts. À revérifier navigateur. |
| C-07-06 | **Corrigé** par le changement de `useApiQuery` (tenant lu après hydratation). | À revérifier après rechargement. |
| C-07-09 | **Défaut réel corrigé** : « Accepter / Refuser / Retirer » étaient gardés par le droit de proposer ; l'API exige `council.decision.record`, que l'enseignant n'a pas. | `ItemPanels.tsx`. Les boutons « Passer en mode séance » et le formulaire de décision sont gardés par `council.session.run` et `council.decision.record` (absents du rôle) : s'ils restent visibles après rechargement, à relever. |
| C-07-10 | **Conforme à l'API** : l'enseignant peut reprendre sa propre feuille soumise et annuler son évaluation ; pour une évaluation publiée l'annulation passe par une demande de retrait. À noter : « Renvoyer en brouillon » est proposé aussi sur une feuille relue ou approuvée, où l'API le refuse. | À affiner côté écran. |
| C-07-04 | Non reproduit. | — |
| Correction d'appel après soumission | **Voulue** : fenêtre de correction après soumission, jusqu'à la validation. | — |
| Autres (C-07-01, 02, 07, 08, 11 à 20) | Confirmés (Mineur / Suggestion). | À planifier. |
