# Annexe : index des enregistrements fictifs créés par le guide

Tous les enregistrements ci-dessous sont **fictifs** et portent le suffixe "test guide" (ou le préfixe `TG-` pour les codes). Chaque ligne indique le chapitre d'origine, l'établissement et la façon de nettoyer. Les données de départ du seed ne sont **pas** listées ici : voir [../annexe-donnees-de-depart.md](../annexe-donnees-de-depart.md).

**Nettoyage** : l'application ne supprime pas la plupart de ces objets (désactivation, archivage, annulation seulement). Le moyen le plus sûr de repartir à neuf est de recréer la base locale `ecoledigitale_v2` puis de relancer `pnpm dev:v2:seed`. Ne touchez à aucune autre base.


## Fragment 01-plateforme

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| École jetable test guide (`tg-jetable`), propriétaire fictif `proprietaire.tgjetable@exemple.test` | Organisation | 01 : 1.4 à 1.9 | aucun (organisation A de la console) | Archiver (ne se supprime pas) |
| École multi test guide (`tg-multi`), propriétaire emprunté `direction.generale@primaire-test.test` | Organisation | 01 : 1.20 à 1.22 | aucun (organisation B) | Réactiver puis archiver ; l'accès du propriétaire du Primaire y devient inerte |
| Établissement Lycée annexe test guide (`tg-lycee`) et son campus par défaut | Établissement | 01 : 1.20 | École multi test guide | Ne se supprime pas (organisation archivée) |
| Étapes de mise en service jusqu'à la production | Réglage définitif | 01 : 1.21 | École multi test guide | Aucun (sans effet sur les établissements de départ) |
| Dérogation « Retirer » sur `schoollife.core` ; changements de statut et d'abonnement | Dérogation / abonnement | 01 : 1.7 à 1.9, 1.22 | organisations A et B | Supprimer la dérogation, remettre « Actif », puis archiver |
| Plan Plan test guide modifié (`TG_PLAN_TEST`) | Plan du catalogue (global) | 01 : 1.10 | catalogue de la plateforme | Reste « Inactif » (ne se supprime pas) |
| Campus Campus annexe test guide (`tg-annexe`) | Campus | 01 : 1.14 | Collège Le Baobab | Supprimé dans le scénario |
| Rôle Secrétariat test guide (`tg_secretariat`) | Rôle personnalisé | 01 : 1.17, 1.19 | Collège Le Baobab | Supprimé dans 1.19 |
| Rôle Lecteur test guide (`tg_lecteur`) | Rôle personnalisé | 01 : 1.18, 1.19 | Collège Le Baobab | Supprimé dans 1.19 |
| Attribution de Lecteur test guide à `educateur@secondaire-test.test` | Attribution de rôle | 01 : 1.19 | Collège Le Baobab | Révoquée dans 1.19 |
| Nom commercial et couleurs du profil | Réglage modifié | 01 : 1.13 | Collège Le Baobab | Rétablis dans 1.13 |

## Fragment 02-connexion

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Membre `invite.tg@exemple.test` (rôle Enseignant, sans mot de passe possible) | Membre / identité | 02 : 2.14 | École multi test guide (organisation B) ou, à défaut, Collège Le Baobab | Ne se supprime pas ; le suspendre s'il est au Collège |
| Mot de passe de `educateur@primaire-test.test` | Réglage de compte modifié | 02 : 2.11 | École Les Palmiers | Remis à l'ancien mot de passe dans le scénario |
| MFA et codes de secours de `educateur@primaire-test.test` | Réglage de compte modifié | 02 : 2.12, 2.13 | École Les Palmiers | Réinitialisés par `direction.generale@primaire-test.test` ("Réinitialiser la MFA") |
| Suspension puis rétablissement de `educateur@secondaire-test.test` | État de membre | 02 : 2.14 | Collège Le Baobab | Rétabli dans le scénario |
| Sessions et échecs de connexion de test (adresses `verrou.tg@exemple.test`, `inconnu.tg@exemple.test`, `fantome.tg@exemple.test`) | Journal / compteurs | 02 : 2.4 à 2.9 | tous | Les compteurs expirent seuls (1 minute à 1 heure) ; les entrées d'audit restent (journal infalsifiable) |

## Fragment 03-structure

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| `TG-2027-2028` "Année test guide 2027-2028" (clôturée) | Année académique | 03 / 3.2, 3.14 | les 3 | Non supprimable ; laisser clôturée |
| Périodes de l'année test (plan "Trois trimestres" ou "Deux semestres") | Périodes | 03 / 3.4, 3.5 | les 3 | Non supprimables ; closes en 3.14 |
| Type de période `TG_MODULE` "Module test guide" | Référentiel | 03 / 3.6 | les 3 | Désactiver (jamais supprimé) |
| Programme `TG-COL` / `TG-PRI` / `TG-LIC` | Programme | 03 / 3.7 | secondaire / primaire / supérieur | Archiver |
| Curriculum du programme test (2026-2027 publié puis amendé ; cloné sur l'année test) | Curriculum | 03 / 3.8 | les 3 | Non supprimable ; verrouillé à la clôture de l'année test |
| `TG-6EB` / `TG-CP1B` / `TG-L1B` "6e B / CP1 B / Licence 1 B test guide" | Classe (principale) | 03 / 3.9 | secondaire / primaire / supérieur | Terminer ou annuler (sans inscrit) |
| `TG-6EC` / `TG-CP1C` / `TG-L1C` (capacité 1 bloquante, brouillon) | Classe | 03 / 3.9 | idem | Annuler (motif obligatoire) |
| Offres de cours des UE de `TG-L1B` | Offres | 03 / 3.10 | supérieur | Annuler (motif) |
| Date de calendrier `Fête de l'école test guide` | Calendrier | 03 / 3.11 | les 3 | Supprimée dans le scénario |
| Exécution de reconduction 2026-2027 vers l'année test (classes, curriculum, jours fériés) | Reconduction | 03 / 3.13 | secondaire | Non annulable ; classes reconduites en brouillon |

## Fragment 04-personnes

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Tuteur test guide : `KOUASSI Marcel test guide` / `TRAORE Moussa test guide` / `KONÉ Seydou test guide` | Tuteur | 04 / 4.2, 4.11 | secondaire / primaire / supérieur | Non supprimable ; invitation au portail non annulable |
| Élève test guide principal : `KOUASSI Aïcha test guide` / `TRAORE Awa test guide` / `KONÉ Ibrahim test guide` | Élève | 04 / 4.3 | idem | Statut "Retiré" puis "Archivé" ; jamais supprimé |
| Élève 2 : `KOUASSI Brice test guide` / `TRAORE Issa test guide` / `KONÉ Rokia test guide` | Élève | 04 / 4.3 | idem | Inscription retirée |
| Élève 3 : `KOUASSI Cécile test guide` / `TRAORE Mariam test guide` / `KONÉ Awa test guide` | Élève | 04 / 4.25, 4.28 | idem | Statut "Retiré" |
| Lien tuteur `KOUASSI Adjoua test guide` (lien clos) | Tuteur et lien | 04 / 4.7 | secondaire | Lien clos, conservé |
| Contact d'urgence `BAMBA Oncle test guide` (sur DIABATE Nadia) | Contact d'urgence | 04 / 4.8 | les 3 | Retiré dans le scénario |
| Antécédent scolaire `CM2 test guide` | Antécédent | 04 / 4.9 | les 3 | Retiré dans le scénario |
| Pièce "Acte de naissance test guide" (2 versions) | Pièce de dossier | 04 / 4.10 | les 3 | Retirée avec motif |
| Personnel test guide : `OUATTARA Zénon / Mariam / Seydou test guide` | Membre du personnel | 04 / 4.15 | secondaire / primaire / supérieur | Statut "Parti" ; jamais supprimé ; invitation non annulable |
| Contrat, qualification, compétence, disponibilité du personnel test | Éléments de fiche | 04 / 4.16 | les 3 | Contrat terminé, autres retirés |
| Affectations de `OUATTARA … test guide` (responsable, titulaire, généraliste) | Affectation | 04 / 4.19 | les 3 | Terminée à la fin (historique conservé) |
| Inscriptions des élèves 1 à 3 | Inscription | 04 / 4.22 à 4.28 | les 3 | Élève 1 : reste (confirmée par le paiement) ; élève 2 retirée ; élève 3 annulée |

## Fragment 05-imports

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Élèves `KOUASSI Aïcha test guide`, `KOUASSI Yves test guide`, `KONÉ Fanta test guide`, `TRAORE Mamadou test guide`, `YAO Adjoua test guide`, `BAMBA Ismaël test guide`, `COULIBALY Awa test guide`, `DIABATE Seydou test guide`, `BROU Esther test guide`, `OUATTARA Souleymane test guide` (matricules d'origine `TG-ELV-S01` à `S10`, classe 6e A, inscription en attente) | élèves + inscriptions | 05-imports 5.12 | Collège Le Baobab | aucun nettoyage à l'écran ; base neuve (`pnpm dev:v2:seed`) |
| Élèves `SANGARE Mariam test guide` (`TG-ERR-01`), `ZOKORA Léonie test guide` (`TG-ERR-13`), `LOROUGNON Dominique test guide` (sans matricule) | élèves + inscriptions | 05-imports 5.13 | Collège Le Baobab | idem |
| Élèves `ABLE Rachel`, `BAH Moussa`, `CAMARA Hawa`, `DJÉ Armand`, `EHUI Sylvie`, `FOFANA Karim` (tous "test guide", `TG-INS-01` à `06`), puis inscrits en 6e A | élèves + inscriptions | 05-imports 5.17, 5.22 | Collège Le Baobab | idem |
| Élèves du fichier des formats (`TG-FX-01` à `04`, par exemple ADJA Clarisse test guide) | élèves + inscriptions | 05-imports 5.25 | Collège Le Baobab | idem |
| Élèves `KOFFI Amenan test guide`… (`TG-ELV-P01` à `P10`, classe CP1-A) | élèves + inscriptions | 05-imports 5.16 | École Les Palmiers | idem |
| Élèves `KOUADIO Jean-Baptiste test guide`… (`TG-ELV-U01` à `U10`, classe L1-A) | élèves + inscriptions | 05-imports 5.16 | Université Horizon | idem |
| Mise à jour du téléphone et de l'adresse de `KOUASSI Aïcha test guide`, `KOUASSI Yves test guide`, `KONÉ Fanta test guide` | modification | 05-imports 5.15 | Collège Le Baobab | idem |
| Tuteurs `KOUASSI Marie-Claire test guide`, `KOUASSI Bernard test guide`, `KONÉ Salif test guide`, `TRAORE Hawa test guide`, `YAO Kouadio Paul test guide`, `BAMBA Aminata test guide`, `COULIBALY Drissa test guide`, `DIABATE Mariam test guide`, `BROU Akissi test guide`, `OUATTARA Zoumana test guide`, `GNAGNE Eugénie test guide`, `KRA Odette test guide` et leurs liens | tuteurs + liens | 05-imports 5.18 | Collège Le Baobab | idem |
| Fiches personnel `TG-ENS-001` à `008` (KOUADIO Brice, YAPI Nathalie, ESSOH Armand, ADOU Clarisse, GUEI Parfait, DJE Mireille, KRAGBE Joël, BEUGRÉ Estelle, tous "test guide"), `TG-STE-01` (LOBA Fabrice), `TG-STE-06` (QUENUM Thierry) | personnel | 05-imports 5.19 | Collège Le Baobab | idem |
| Classes `TG-5EA`, `TG-5EB`, `TG-4EA`, `TG-4EB`, `TG-3EA`, `TG-3EB`, `TG-6ED`, `TG-3EC`, `TG-E5A` | classes | 05-imports 5.20 | Collège Le Baobab | archivage/suppression selon le chapitre Structure académique (à vérifier) |
| Classes `TG-CP2A`, `TG-CP2B`, `TG-CE1A`, `TG-CE2A`, `TG-CM1A`, `TG-CM2A` | classes | 05-imports 5.20 | École Les Palmiers | idem |
| Classes `TG-L1P`, `TG-L1Q`, `TG-L1R`, `TG-L1S` (et `TG-L1T`, `TG-L1U` si le fichier d'échec est importé en mode valides seulement) | classes | 05-imports 5.20 | Université Horizon | idem |
| Noeuds de curriculum `TG-ARTP`, `TG-MUS`, `TG-INFO`, `TG-SVT`, `TG-EDHC`, `TG-CE1`, `TG-CE11` et matières associées ; supérieur : `TG-IUE1`, `TG-IE11`, `TG-IE12`, `TG-IUE2`, `TG-IE21`, `TG-IE22` | matières + noeuds | 05-imports 5.21 | Collège Le Baobab, Université Horizon | version en brouillon abandonnable |
| Notes du fichier `07-grades-valide-secondaire.csv` sur l'évaluation `Contrôle import test guide` (élèves 00001 à 00008) | évaluation + notes (brouillon) | 05-imports 5.23 | Collège Le Baobab | retour de la feuille en brouillon / évaluation à supprimer selon le chapitre 08 |
| Factures de reprise `TG-REPRISE-001` à `008` (dont l'avoir `TG-REPRISE-007`), `TG-REPRISE-E01`, `TG-REPRISE-E10` | factures + avoir | 05-imports 5.24 | Collège Le Baobab | documents financiers immuables : aucun nettoyage |
| Imports de l'historique (fichiers `01-students-*.csv`, `02-…` à `08-…`) | imports | 05-imports 5.12 à 5.32 | selon le scénario | restent dans l'historique ; brouillons abandonnés annulés après 72 h |
| Modèle de mapping `Modèle élèves test guide` | modèle de mapping | 05-imports 5.6 | Collège Le Baobab | supprimé en 5.6 |
| Réglages des imports (plafonds) modifiés puis restaurés | paramètres | 05-imports 5.7, 5.10, 5.11, 5.31 | Collège Le Baobab | restaurer 5000 / 100 / 5 / 200 / 5000 / 5 / 50 / 30 |

## Fragment 06-presences

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Appel "Séance d'appel test guide" (6e A, jour J, 11:00 à 12:00) : DIABATE Nadia absente, DIABATE Salimata en retard 10 min, TOURE Yao absent justifié, TOURE Jean-Marc absent | appel par séance (soumis, validé, rouvert, revalidé) | 06 : 6.2 à 6.7 | Collège Le Baobab | non supprimable (journal) ; ne pas annuler sans l'accord de l'équipe |
| Appels "Séance d'appel 2 test guide" (Nadia absente) et "Séance d'appel 3 test guide" | appels par séance validés par lot | 06 : 6.6 | Collège Le Baobab | non supprimable |
| Appel "Séance d'appel 4 test guide" | appel annulé avec motif | 06 : 6.8 | Collège Le Baobab | non supprimable |
| Appels journaliers CP1 A du jour (matin et après-midi) | appels journaliers | 06 : 6.9 | École Les Palmiers | non supprimable |
| Absence justifiée immédiate de TOURE Yao (motif « Difficulté de transport ») | justificatif accepté d'un jour | 06 : 6.4 | Collège Le Baobab | révocable ; conservé dans le journal |
| Justificatif DIABATE Nadia (parent, Maladie, pièce `justificatif-maladie-test-guide.pdf`) | justificatif accepté puis révoqué | 06 : 6.15, 6.16 | Collège Le Baobab | non supprimable |
| Justificatif DIABATE Salimata (éducateur, Autre, pièce `justificatif-photo-test-guide.png`) | justificatif rejeté | 06 : 6.16 | Collège Le Baobab | non supprimable |
| Justificatif DIABATE Nadia (déposé par l'élève) | justificatif retiré | 06 : 6.16 | Collège Le Baobab | non supprimable |
| Règle d'alerte `TG_ABSENCES_2` | règle d'assiduité (créée puis supprimée) | 06 : 6.18 | Collège Le Baobab | « Supprimer » la règle |
| Surcharge d'assiduité de DIABATE Nadia | surcharge de récapitulatif (créée puis retirée) | 06 : 6.13 | Collège Le Baobab | « Retirer la surcharge » (historique conservé) |
| Congés de TRAORE Kouadio : « Congé annuel » du vendredi V1 (approuvé), deux « Absence autorisée » (refusé, annulé) | demandes de congé | 06 : 6.20, 6.21 | Collège Le Baobab | « Annuler » le congé approuvé pour libérer l'emploi du temps |
| Pointage du jour de TRAORE Kouadio (arrivée, départ) ; présence « En retard » de YAO Fatou | présence du personnel | 06 : 6.20, 6.21 | Collège Le Baobab | non supprimable |

## Fragment 07-emploi-du-temps

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Salle 1 test guide (`TG-S1`, capacité 40, Bloc A test guide) | salle | 07 : 7.2 | Collège Le Baobab | « Archiver » la salle |
| Laboratoire test guide (`TG-LAB`, capacité 30, Bloc B test guide) | salle | 07 : 7.2, 7.3 | Collège Le Baobab | « Archiver » la salle |
| Petite salle test guide (`TG-MINI`, capacité 5) | salle | 07 : 7.2, 7.3 | Collège Le Baobab | « Archiver » la salle |
| Vidéoprojecteur test guide (`TG-VP`, quantité 1) | équipement (si l'option est incluse) | 07 : 7.3 | Collège Le Baobab | mettre l'état « Archivée » |
| Emploi du temps test guide 6e A (brouillon, ancre de semaine A) avec les créneaux "Mathématiques vendredi test guide", "Anglais vendredi test guide", "Histoire-Géographie semaine A test guide" | emploi du temps (brouillon) | 07 : 7.4, 7.5, 7.6, 7.20 | Collège Le Baobab | non supprimable ; archivable après publication |
| Emploi du temps test guide B (brouillon, sans ancre ; contenu remplacé au 7.18) | emploi du temps (brouillon) | 07 : 7.4, 7.18 | Collège Le Baobab | non supprimable |
| Emploi du temps généré test guide (brouillon) | emploi du temps issu du générateur | 07 : 7.18 | Collège Le Baobab | non supprimable |
| Séance d'appel test guide, Séance d'appel 2 test guide, Séance d'appel 3 test guide, Séance d'appel 4 test guide (6e A, jour J) | séances de cours ponctuelles (utilisées par le chapitre 06) | 07 : 7.7 ; 06 | Collège Le Baobab | « Annuler » avec motif |
| Séance de remplacement test guide (6e A, vendredi V1, 14:00 à 15:00, Laboratoire test guide) | séance de cours ponctuelle | 07 : 7.7, 7.11 ; 06 : 6.21 | Collège Le Baobab | « Annuler » avec motif |
| Réunion de parents test guide (mercredi W1, puis déplacée au jeudi, 15:00 à 16:30) | séance de réunion | 07 : 7.7, 7.8, 7.11 | Collège Le Baobab | « Annuler » avec motif |
| Réunion passée test guide (hier, 16:00 à 17:00) | séance de réunion | 07 : 7.7, 7.10 | Collège Le Baobab | « Annuler » avec motif |
| Réservation test guide (jour J, Salle 1 test guide, dérogation motivée) | réservation de salle (annulée) | 07 : 7.7, 7.9 | Collège Le Baobab | déjà annulée |
| Remplacements : YAO Fatou sur la Réunion de parents ; remplaçant sur la Séance de remplacement | affectation de remplaçant | 07 : 7.11 | Collège Le Baobab | non supprimable (historique) |
| Séances générées de "Emploi du temps 6E-A" (semaine courante et suivante) | séances datées générées | 07 : 7.12 | Collège Le Baobab | « Annuler » les séances en trop |
| Lien d'abonnement "Téléphone test guide" (enseignant, parent) | jeton iCalendar | 07 : 7.14 | Collège Le Baobab | « Révoquer » (déjà révoqué en fin de scénario) |
| Générations "Génération test guide 6e A" (appliquée, puis rejouée à l'identique), "Génération test guide 6e A (bis)" (abandonnée), "Génération surchargée test guide" (appliquée dans le brouillon B) | propositions du générateur | 07 : 7.16 à 7.18 | Collège Le Baobab | « Abandonner » les propositions non appliquées |
| Archivage de "Emploi du temps 6E-A" et publication de "Emploi du temps test guide 6e A" | changement d'état irréversible | 07 : 7.20 | Collège Le Baobab (ou Université Horizon) | irréversible : refaire la base |

## Fragment 08-evaluations

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Devoir n°1 Mathématiques test guide | Évaluation (6e A, Trimestre 3, Publiée) | 08 / 8.5 à 8.13 ; réutilisée en 09 | Collège Le Baobab | Aucun (publiée : immuable) ; reset de la base |
| Interrogation Mathématiques test guide | Évaluation (sur 10, coef. 2, Publiée) | 08 / 8.5 à 8.13 ; réutilisée en 09 | Collège Le Baobab | Aucun ; reset de la base |
| Devoir commun test guide (Français) | Évaluation (Soumise, annulée en 9.16) | 08 / 8.6, 8.9 ; 09 / 9.16 | Collège Le Baobab | Annulée en 9.16 |
| Devoir commun test guide (Anglais) | Évaluation (Annulée) | 08 / 8.6, 8.9 | Collège Le Baobab | Déjà annulée |
| Contrôle direction test guide | Évaluation (Annulée) | 08 / 8.14 | Collège Le Baobab | Déjà annulée |
| Quiz test guide (TG_QUIZ) | Type d'évaluation (inactif) | 08 / 8.3 | Collège Le Baobab | Désactivé ; non supprimable |
| Correction ASSI Brice 9,5 vers 10,5 | Demande de correction (Appliquée) | 08 / 8.15 | Collège Le Baobab | Aucun (tracée) |
| Correction DIABATE Salimata 0 vers 20 | Demande de correction (Rejetée) | 08 / 8.15 | Collège Le Baobab | Aucun |
| Devoir Français test guide | Évaluation (CP1 A, Annulée) | 08 / 8.17 | École Les Palmiers | Déjà annulée |
| Devoir Algorithmique test guide | Évaluation (L1 A, Annulée) | 08 / 8.17 | Université Horizon | Déjà annulée |

## Fragment 09-regles-resultats

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Liaison TG-NIVEAU (coef-semester@1, 2030-09-01) | Liaison de règles | 09 / 9.4 | Collège Le Baobab | Supprimée au même scénario |
| Variante test guide (brouillon, 2031-09-01) | Version de règles d'établissement | 09 / 9.5 | Collège Le Baobab | Proposition retirée ; brouillon non supprimable |
| Simulation de la variante (6e A, Trimestre 1) | Simulation | 09 / 9.5 | Collège Le Baobab | Aucun (lecture) |
| Variante LMD test guide (brouillon) | Version de règles d'établissement | 09 / 9.6 | Université Horizon | Brouillon non supprimable |
| Surcharge COULIBALY Moussa vers 14,5 | Surcharge (Révoquée) | 09 / 9.12 | Collège Le Baobab | Révoquée au même scénario |
| Surcharge DIABATE Salimata vers 5 | Surcharge (Rejetée) | 09 / 9.12 | Collège Le Baobab | Aucun |
| Décision DIABATE Salimata (Renforcement recommande), Trimestre 3 | Décision | 09 / 9.13 | Collège Le Baobab | Retirée à la réouverture 9.16 |
| Délibération Conseil de classe (Tenue), Trimestre 3 | Délibération | 09 / 9.13 | Collège Le Baobab | Aucun |
| Appréciation DIABATE Nadia, Trimestre 3 | Appréciation | 09 / 9.13 | Collège Le Baobab | Aucun |
| 6e A, Trimestre 3 : verrouillée, clôturée v1, rouverte, clôturée v2 | État de période et résultats définitifs | 09 / 9.14 à 9.16 ; base du chapitre 10 | Collège Le Baobab | Reset de la base |
| Licence 1 A, Semestre 1 : fenêtre de rattrapage, Examen Programmation session 2 test guide, reclôture v2 | Rattrapage | 09 / 9.18 | Université Horizon | Reset de la base (à exécuter en dernier) |

## Fragment 10-bulletins

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Identité version 2 (pied de page "Document de démonstration test guide", AGR-TG-0001, logo `logo-test-guide.png`) | identité imprimée versionnée | 10.1 | Collège Le Baobab | non supprimable ; créer une version qui vide le pied de page |
| Réglages de documents (délibération, mention publique) | réglage | 10.1, 10.6 | Collège Le Baobab | rétablis dans le scénario |
| Signataire "KONÉ Mamadou test guide" | signataire | 10.2 | Collège Le Baobab | désactiver (non supprimable) |
| Configuration Bulletin v2 (`showClassAverage`, signataire KONÉ) | configuration de modèle | 10.3 | Collège Le Baobab | reconfigurer avec "Directeur Fictif" |
| Configuration Relevé de notes v1 (`transcript-credits`) | configuration de modèle | 10.13 | Université Horizon | non supprimable |
| Bulletin de TOURE Jean-Marc, version 2 (publié, retiré, révoqué) et version 1 remplacée | bulletin | 10.14, 10.15, 10.16 | Collège Le Baobab | irréversible ; restaurer la base de démonstration |
| Lot de génération rejoué 6e A / Trimestre 1 | lot | 10.9 | Collège Le Baobab | aucun (sans effet sur les bulletins) |

## Fragment 11-superieur

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Diplôme "Licence Informatique test guide" (`TG-LIC-INFO`) | diplôme | 11.8 | Université Horizon | désactiver (suppression refusée dès qu'un octroi existe) |
| Diplôme "Diplôme à supprimer test guide" (`TG-DEL-001`) | diplôme | 11.8 | Université Horizon | supprimé dans le scénario |
| Octroi à DIABATE Nadia, documents (diplôme, attestation d'authenticité, duplicata, attestation de réussite) publiés | octroi + documents officiels | 11.9, 11.12, 11.13, 11.14 | Université Horizon | irréversible ; à conserver pour le portail élève/parent |
| Octroi forcé à TOURE Jean-Marc, puis révoqué | octroi + documents | 11.10, 11.17 | Université Horizon | irréversible |
| Dispenses d'UE (COULIBALY Moussa), révoquées | dispense | 11.5 | Université Horizon | révoquées dans le scénario |
| Emplacements de signature (4) affectés à "Directeur Fictif" | signataires datés | 11.11 | Université Horizon | historique non supprimable |
| Signataire "TRAORE Mariam test guide" | signataire | 11.11 (via 10.2) | Université Horizon | désactiver |
| UE annuelle UE2 | déclaration | 11.6 | Université Horizon | retirée dans le scénario |
| Fenêtre de rattrapage Licence 1 A / Semestre 1 | fenêtre | 11.7 | Université Horizon | clôturée dans le scénario ; la session 2 rouvre la période |
| Prérequis UE2 ← UE1 | prérequis | 11.4 | Université Horizon | retiré dans le scénario |
| Durée de validité des crédits (60 mois) et politique de dispense | réglages | 11.3, 11.5 | Université Horizon | rétablis (vide ; "Enregistrer seulement") |

## Fragment 12-finance

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| `TG-DIVERS` "Frais divers test guide" | Frais | 12.2 | chaque établissement rejoué | Désactivable (« Désactiver »), non supprimable |
| `TG-CANTINE` "Frais de cantine test guide" | Frais | 12.2 | idem | Désactivable, non supprimable |
| Barème `TG-DIVERS` 2026-2027, 60 000 F CFA | Barème | 12.3 | idem | Non nettoyable (aucune mise hors vigueur dans l'interface) |
| `TG-3T` "Plan 3 tranches test guide" ; `TG-FIXE` "Plan acompte test guide" | Plans d'échéancier | 12.4 | idem | Non nettoyable |
| `TG-REM10` "Remise 10 % test guide" ; `TG-REM5000` "Remise 5 000 F test guide" | Remises | 12.5 | idem | Non nettoyable |
| Facture n°1 test guide (DIABATE Nadia, 54 000 F CFA) | Facture | 12.7 | Collège Le Baobab | Non supprimable (corriger par avoir / remboursement) |
| Brouillon de facture (DIABATE Nadia, 60 000) | Facture brouillon | 12.9 | Collège Le Baobab | Non supprimable ; peut être émis puis annulé |
| Facture n°2 test guide, reprise de solde d'ouverture (25 000) | Facture | 12.17 | Collège Le Baobab | Soldée ; non supprimable |
| Facture n°3 test guide (COULIBALY Moussa, 60 000) | Facture annulée | 12.30 | Collège Le Baobab | Déjà annulée |
| Facture n°4 test guide (SORO Aya, famille 48 000 + financeur 12 000) | Factures liées | 12.31 | Collège Le Baobab | Part famille à annuler si désiré ; part financeur payée |
| `TG-CAISSE-1` "Caisse test guide" et deux sessions clôturées | Caisse | 12.11, 12.29 | idem | Non supprimable |
| Paiements "VIR-TG-001", espèces 8 000, "MM-TG-001", "VIR-TG-002", "CHQ-TG-0001", doublon "MM-TG-001" (1 000), "VIR-TG-FIN-001", "VIR-TG-INSC-1" et "-2" | Paiements manuels | 12.12 à 12.19, 12.31, 12.32, 12.34 | Collège Le Baobab | Immuables ; remboursables |
| Paiements en ligne simulés 5 000, 5 001, 5 013 (économe) ; 4 000, 2 001, 2 013 (parent) ; 3 013 (élève) | Paiements en ligne | 12.16, 12.23, 12.24 | Collège Le Baobab | Immuables ; aucun effet réel |
| Reçus `REC-2026-nnnnnn` (un par paiement confirmé) | Reçus | 12.12 à 12.34 | Collège Le Baobab | Immuables, non supprimables |
| Avoir de 3 000 F CFA sur la facture n°1 | Avoir | 12.25 | Collège Le Baobab | Immuable |
| Remboursements de 3 000 (exécuté), 2 000 (refusé), 1 000 en ligne (manuel, "REMB-TG-001") | Remboursements | 12.28 | Collège Le Baobab | Définitifs |
| Résolutions manuelles "RELEVE-TG-001" et "RELEVE-TG-002" | Résolutions de paiements | 12.27 | Collège Le Baobab | Définitives, journalisées |
| Bourse "Fondation Test Guide" (terminée) ; financement de SORO Aya remis à « Privé (famille) » | Financement | 12.31 | Collège Le Baobab | Terminée ; non supprimable |
| Inscription de SORO Elie passée « Active » | Effet de bord | 12.34 | Collège Le Baobab | Non réversible simplement : refaire une base ou choisir un autre élève |

## Fragment 13-paie

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Configuration TRAORE Kouadio (Mixte, 150 000 F CFA, 3 000 F CFA/h, seuil 1 min, ×2) | configuration de paie | 13.3 | Collège Le Baobab | non supprimable ; mettre une date de fin |
| Configuration YAO Fatou (Horaire, 3 000 F CFA/h) | configuration de paie | 13.3 | Collège Le Baobab | non supprimable ; mettre une date de fin |
| Tarif générique Mathématiques 4 000 F CFA (notes "Tarif générique modifié test guide") | tarif horaire | 13.4 | Collège Le Baobab | « Supprimer » |
| Tarif nominatif TRAORE Kouadio 5 000 F CFA (notes "Tarif nominatif test guide") | tarif horaire | 13.4 | Collège Le Baobab | « Supprimer » |
| Période "Septembre test guide" | période de paie | 13.5, 13.19 | Collège Le Baobab | archivée en 13.19 (jamais supprimée) |
| Période "Octobre test guide" | période de paie | 13.13 à 13.17 | Collège Le Baobab | clôturer puis archiver |
| Période "Chevauchement test guide" | période de paie | 13.18 | Collège Le Baobab | clôturer puis archiver |
| Bulletin septembre TRAORE Kouadio, 158 000 F CFA, versé (VIR-TG-001) | bulletin de paie | 13.6 à 13.11 | Collège Le Baobab | non supprimable |
| Bulletin octobre TRAORE Kouadio, 150 150 F CFA, annulé | bulletin de paie | 13.14, 13.15 | Collège Le Baobab | non supprimable |
| Bulletin octobre TRAORE Kouadio, 150 150 F CFA, versé (TG-MM-001) | bulletin de paie | 13.16 | Collège Le Baobab | non supprimable |
| Prime "Prime d'assiduité test guide" 10 000 F CFA ; retenue "Avance sur salaire test guide" 2 000 F CFA | ajustements de bulletin | 13.7 | Collège Le Baobab | liés au bulletin |
| Pointage Arrivée/Départ de TRAORE Kouadio (jour du test) | présence du personnel | 13.13 | Collège Le Baobab | non supprimable |
| Réglages de la paie (séparation des tâches, seuil du propriétaire) | réglage | 13.2, 13.14, 13.16 | Collège Le Baobab | remis à l'état de départ en 13.16 |

## Fragment 14-documents

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Règlement intérieur test guide (2 versions) | document | 14.2, 14.5, 14.7, 14.16 | Collège Le Baobab | archiver (jamais purgé par défaut) |
| Image test guide ; Note de service test guide (renommée) ; Note Word test guide ; Scan sans texte test guide | documents | 14.6, 14.7, 14.8, 14.14 | Collège Le Baobab | archiver |
| Attestation d'assurance test guide (+20 jours) ; Assurance échue test guide (hier) | documents à échéance | 14.4, 14.9 | Collège Le Baobab | archiver |
| Pièce comptable test guide (confidentiel) | document | 14.10, 14.11 | Collège Le Baobab | archiver |
| Extrait de naissance Nadia test guide (parent) ; Pièce Nadia déposée par l'élève test guide ; Diplôme enseignant test guide | documents déposés par le propriétaire de la pièce | 14.12 | Collège Le Baobab | archiver |
| Pièce élève Salimata test guide ; Pièce élève Aya BAMBA test guide | documents d'élève | 14.12, 14.13, 14.18 | Collège Le Baobab | archiver |
| Catégorie TG_CATEGORIE "Catégorie test guide" | catégorie | 14.15 | Collège Le Baobab | « Archiver » (jamais supprimée) |
| Pièce de catégorie test guide | document | 14.15 | Collège Le Baobab | archiver |
| Partages et droit de catégorie TRAORE Kouadio | partages | 14.9, 14.15 | Collège Le Baobab | « Retirer » (fait dans les scénarios) |
| Paramètres des documents (versions max 2 puis 50) | réglage | 14.16 | Collège Le Baobab | remis à 50 en 14.16 |
| Fichiers `jeux-de-donnees/ged-*` (10) | fichiers d'essai | 14.2 à 14.8 | poste de test | à conserver |

## Fragment 15-messagerie

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Conversation "Question sur le devoir test guide" | Message direct | 15.2, 15.4 | Collège Le Baobab | Archiver ; non supprimable |
| Conversation "Pièce jointe test guide" (+ `ch15-piece-jointe-test-guide.pdf`) | Message direct | 15.6, 15.7 | Collège Le Baobab | Message retiré par son auteur |
| "Diffusion 6e A test guide" | Diffusion | 15.8 | Collège Le Baobab | Archiver |
| "Groupe pédagogique test guide" | Message de groupe | 15.9 | Collège Le Baobab | Quitter le groupe |
| "Réunion de classe 6e A test guide" | Annonce | 15.14, 15.18 | Collège Le Baobab | Retirer l'annonce (motif) |
| "Annonce programmée test guide" | Annonce | 15.15 | Collège Le Baobab | Retirer l'annonce |
| "Brouillon à modifier test guide" | Annonce (brouillon) | 15.16 | Collège Le Baobab | Supprimer le brouillon |
| "Annonce enseignant test guide" | Annonce | 15.17 | Collège Le Baobab | Retirer l'annonce |
| "Annonce élèves test guide" | Annonce | 15.19 | Collège Le Baobab | Retirer l'annonce |
| "Annonce importante test guide" | Annonce | 15.26 | Collège Le Baobab | Retirer l'annonce |
| Accusé de DIABATE Séka sur l'annonce de rentrée du seed | Accusé de réception | 15.12 | Collège Le Baobab | Irréversible : réinitialiser la base |
| Signalements (2) et décisions de modération | Modération | 15.21, 15.22 | Collège Le Baobab | Non supprimable |
| Restriction d'envoi du parent | Restriction | 15.22 | Collège Le Baobab | Levée dans le scénario |
| Réglages de messagerie modifiés (politique élèves, plafonds, message d'absence) | Réglage | 15.24, 15.25 | Collège Le Baobab | Rétablir les valeurs d'origine |
| Envois "Entretien avec la direction test guide" et "Avis urgent test guide" | Notification (journal) | 15.27, 15.28 | Collège Le Baobab | Non supprimable (purge selon la conservation) |
| Version 1 du gabarit "Convocation" e-mail (note "Version test guide") | Version de gabarit | 15.29 | Collège Le Baobab | Revenir au gabarit livré |
| Règle de notification modifiée puis rétablie | Règle | 15.30 | Collège Le Baobab | Rétablir la règle livrée |
| Réglages de canaux modifiés (expéditeur, mention légale) | Réglage | 15.31 | Collège Le Baobab | Rétablir les valeurs d'origine |
| Préférences personnelles du parent (canaux, heures calmes) | Préférence | 15.20, 15.32 | Collège Le Baobab | Rétablir |

## Fragment 16-tableaux-de-bord

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| "Effectif minimal test guide" | Règle d'alerte | 16.18, 16.21 | Collège Le Baobab | Désactiver (pas de suppression dans l'interface) |
| "Absences élevées test guide" | Règle d'alerte | 16.22 | Collège Le Baobab | Désactiver |
| Alertes issues de ces règles (ouverte, accusée avec la note "Alerte vue lors du test guide", résolue) | Alertes | 16.20, 16.21 | Collège Le Baobab | Historique conservé ; résolues par la désactivation |
| Paiement de 10 000 F CFA sur une facture de départ | Paiement | 16.16 | Collège Le Baobab | Rembourser ou réinitialiser la base |
| Réglages d'affichage (seuils de lecture, ancienneté 1 h) | Réglage | 16.15 | Collège Le Baobab | Rétablir 80, 60, 85, 70 % et 24 h |
| Demande de reconstruction des tableaux | Opération | 16.15 | Collège Le Baobab | Aucun (idempotent) |
| Fichiers `analytics-*.csv` téléchargés | Fichiers locaux | 16.4 | poste de test | Supprimer du poste |

## Fragment 17-admissions

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Campagne `TG-2027` ("Campagne test guide 2027", 2 places, liste d'attente 5) | campagne d'admission | 17.5 | chaque établissement joué | « Clôturer » ; non supprimable |
| Motif de décision `TG_MOTIF_REFUS` | référence | 17.7 | chaque établissement joué | « Désactiver » |
| Classe de priorité `TG_PRIORITE` | référence | 17.7 | chaque établissement joué | « Désactiver » |
| Pièce exigée `TG_ACTE_NAISSANCE` ("Acte de naissance test guide") | référence | 17.7, 17.13, 17.16 | chaque établissement joué | « Désactiver » dès 17.16 |
| Texte de consentement `tg1` | texte versionné | 17.8 | chaque établissement joué | « Retirer » si un autre texte est désigné |
| Lien public de l'établissement | lien | 17.8 | chaque établissement joué | « Désactiver le lien » |
| Réglages "Validité d'une offre" (21 puis 14) et politique de capacité (Souple puis Stricte) | réglage modifié | 17.6, 17.25 | Collège Le Baobab | remettre 14 et "Stricte" |
| Prospects `Mariam COULIBALY test guide` (converti), `Seydou KONÉ test guide` (perdu) | prospect | 17.9 | chaque établissement joué | non supprimables |
| Dossiers `Awa COULIBALY test guide`, `Ibrahim TRAORE test guide`, `Kader BAMBA test guide`, `Salimata KONÉ test guide`, `Yao KOUASSI test guide` (anonymisé) | candidature | 17.10 à 17.20, 17.23 | chaque établissement joué | non supprimables |
| Dossier facultatif `Nadia DIABATE` (doublon, sans suffixe) | candidature | 17.15 | Collège Le Baobab | écarter le doublon, laisser en brouillon |
| Pièces déposées (acte de naissance, bulletin précédent) | pièce de dossier | 17.13 | chaque établissement joué | non supprimables |
| Entretien réalisé et entretien annulé sur `Ibrahim TRAORE test guide` | entretien | 17.14 | chaque établissement joué | non supprimables |
| Offres de place (Awa acceptée, Ibrahim retirée puis déclinée, Salimata promue) | offre | 17.17, 17.18, 17.20 | chaque établissement joué | non supprimables |
| Élève `COULIBALY TEST GUIDE Awa`, inscription, facture des frais d'inscription (25 000 F CFA au collège, 15 000 à l'école, 50 000 à l'université), règlement `VIR-TG-AWA-001` | élève, inscription, facture, paiement | 17.18, 17.19 | chaque établissement joué | à reprendre dans les chapitres Élèves et Finances ; remise à zéro |
| Brouillon de workflow `TG_PARCOURS` | workflow | 17.22 | Collège Le Baobab | supprimé dans le scénario |
| Export `dossier-<numéro>.json` | fichier téléchargé | 17.23 | Collège Le Baobab | supprimer le fichier local |

## Fragment 18-primaire

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Séance d'appel du jour (Grande Section A, CP1 A), absence testée sur EKRA Désiré | appel | 18.4 | École Les Palmiers | non supprimable ; corriger en « Marquer ... présent » |
| Saisies de compétences CP1 A semestre 2 (DIABATE Nadia N3 puis révisée N4, DIABATE Salimata N2, BAMBA Aya N4) | évaluations par compétences | 18.6, 18.8 | École Les Palmiers | non supprimables après validation ; remise à zéro |
| Validation de la grille du CP1 A semestre 2 | validation | 18.8 | École Les Palmiers | irréversible ; remise à zéro |
| État "prête" du semestre 2 du CP1 A (marqué puis retiré, motif `Erreur de marquage constatée (test guide)`) | état classe × période | 18.7 | École Les Palmiers | retiré dans le scénario |
| Phrase `TG_PHRASE_LECTURE` | banque d'appréciations | 18.9 | École Les Palmiers | « Désactiver » |
| Conseil du CP1 A (préparé si possible), proposition `Lecture non acquise (test guide)`, décision de test, procès-verbal éventuel | conseil des maîtres | 18.12 | École Les Palmiers | non supprimable ; remise à zéro |
| Signature de `SECRETAIRE Conseil` sur la feuille de présence de la Grande Section A | présence au conseil | 18.11 | École Les Palmiers | figée ; remise à zéro |
| Un bilan annuel de la Grande Section A scellé en plus, puis réémis (version 2 en brouillon) | bilan annuel | 18.14 | École Les Palmiers | irréversible ; remise à zéro |
| Archive d'année préparée (non gelée) | archive | 18.15 | École Les Palmiers | reste « En préparation » ; remise à zéro |
| Fichiers CSV exportés (`class-list.csv`, etc.) | fichier téléchargé | 18.16 | École Les Palmiers | supprimer les fichiers locaux |
| Durée de conservation des archives (`5`, remise à vide) | réglage | 18.17 | École Les Palmiers | remettre vide |
| Échelle `TG_ECHELLE` ("Échelle test guide", niveaux T1 et T2) | échelle d'appréciation | 18.17 | École Les Palmiers | verrouillée après publication du référentiel ; remise à zéro |
| Référentiel `TG_REFERENTIEL` ("Référentiel test guide", niveau CE2, publié) | référentiel de compétences | 18.17 | École Les Palmiers | immuable ; remise à zéro |
| Brouillon `TG_REFERENTIEL_BROUILLON` | référentiel | 18.17 | École Les Palmiers | supprimé dans le scénario |

## Fragment 19-secondaire

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Incident "Incident test guide : bavardage pendant la composition" (COULIBALY Moussa) | incident de vie scolaire | 19a : 19.5 | Collège Le Baobab | aucun (écarter n'existe pas dans l'interface) ; réinitialiser la base |
| Encouragement "Encouragement test guide : très bonne participation en classe" (DIABATE Nadia, visible élève et parents) | note de vie scolaire | 19a : 19.6, 19.14, 19.22 | Collège Le Baobab | « Retirer la note » |
| Observation "Observation test guide : a besoin d'un suivi en lecture" (COULIBALY Salimata) | note de vie scolaire | 19a : 19.6, 19.7 | Collège Le Baobab | retirée en 19.7 |
| Incidents "Incident test guide : …" (oubli de matériel, propos injurieux, refus d'obéir, fait confidentiel, perturbation du cours) | incidents | 19a : 19.7, 19.8, 19.11, 19.18, 19.20 | Collège Le Baobab | aucun ; réinitialiser la base |
| Mesures "Exclusion test guide : …" et "Avertissement test guide : …" (TOURE Jean-Marc, COULIBALY Moussa, COULIBALY Salimata) | mesures disciplinaires | 19a : 19.8 à 19.12, 19.17 | Collège Le Baobab | rejetées, annulées ou révoquées en cours de parcours ; réinitialiser la base |
| Statut « Suspendu » de TOURE Jean-Marc (effet appliqué) | changement de statut d'élève | 19a : 19.17 | Collège Le Baobab | remettre le statut « Actif » dans le module des élèves |
| Recours "Recours test guide : la famille conteste la décision" (DIABATE Salimata) | recours | 19a : 19.14 | Collège Le Baobab | tranché "maintenu" ; réinitialiser la base |
| Convocations "Convocation test guide : …" (3, dont une reportée et un brouillon annulé) | convocations | 19a : 19.15, 19.16 | Collège Le Baobab | « Annuler » ; réinitialiser la base |
| Niveau de gravité `TG_GRAVITE`, type d'événement `TG_PERTURBATION` | paramètres de vie scolaire | 19a : 19.20 | Collège Le Baobab | désactiver (« Type actif », « Niveau actif ») |
| Barème `TG_BAREME` (optionnel) et réglage « Activer les points de conduite » | paramètres de vie scolaire | 19a : 19.21 | Collège Le Baobab | « Retirer » le barème, décocher le réglage |
| Séance "Conseil de classe T1 test guide" (+ participants TRAORE Kouadio, YAO Fatou, KOUAME Adjoua) | séance de conseil de classe | 19b : 19.28 à 19.33 | Collège Le Baobab | « Annuler la séance » |
| Propositions et décisions "test guide" sur la séance de démonstration du Trimestre 2 (Nadia, Aya) | propositions, décisions | 19b : 19.35 à 19.37 | Collège Le Baobab | retirées sauf "Avis requis du conseil" de Nadia (à retirer) |
| Procès-verbal version 1 et demandes de déverrouillage de la séance de démonstration | procès-verbal, déverrouillages | 19b : 19.39 à 19.42 | Collège Le Baobab | aucun ; la séance est rouverte (2 réouvertures) |
| Effet « Information des tuteurs » de Nadia | effet de décision | 19b : 19.44 | Collège Le Baobab | « Annuler l'effet » |
| Rôle `TG_OBSERVATEUR`, type de décision `TG_AVIS`, réglage « Déclenchement des effets » | paramètres des conseils | 19b : 19.32, 19.44, 19.49 | Collège Le Baobab | désactiver ; remettre les réglages |
| Parcours "Parcours test guide : 6e vers 5e" | parcours d'orientation | 19b : 19.46 | Collège Le Baobab | décocher « Actif » |
| Dossier d'orientation DIABATE Salimata (vœux n° 1 et n° 2), transfert annulé `ACTE-TG-0001` | dossier d'orientation, transfert | 19b : 19.47, 19.48, 19.51 | Collège Le Baobab | transfert annulé ; dossier à réinitialiser |
| Dossier `AFF-TG-0001` (N'GUESSAN Aya), versions 1 et 2, « Terminé » | dossier d'affectation | 19c : 19.56 à 19.67 | Collège Le Baobab | aucun (la fin d'un dossier ne se défait pas) ; réinitialiser la base |
| Financement « Affecté par l'État » de l'inscription de N'GUESSAN Aya | financement d'inscription | 19c : 19.59 | Collège Le Baobab | aucun ; réinitialiser la base |
| Dossiers `AFF-TG-0002` (N'GUESSAN Koffi, deux saisies rejetées) et `AFF-TG-0003` (variante, DIABATE Salimata) | dossiers d'affectation | 19c : 19.58, 19.70 | Collège Le Baobab | rejeter ; réinitialiser la base |
| Échéances "Versement test guide 1, 2, 3" | créances sur l'État | 19c : 19.62 | Collège Le Baobab | « Annuler » l'échéance (si non reçue) |
| Contrôles Identité, Pièces, Autre du dossier `AFF-TG-0001` | contrôles | 19c : 19.64 | Collège Le Baobab | aucun ; réinitialiser la base |
| Format d'export `tg-dossiers` ; réglages tolérance/nature/délais | paramètres des affectations | 19c : 19.69 | Collège Le Baobab | « Désactiver » le format ; remettre les réglages |

## Fragment 20-examens

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| `TG_BEPC` BEPC test guide (démonstration), filière `TGA`, épreuves `TG_EP1`, `TG_EP2`, `TG_EP3` | Type d'examen | 20.3, 20.4 | Collège Le Baobab | Non supprimable depuis l'écran ; `pnpm demo:reset` |
| `TG-CTR1` Centre Cocody test guide, salles `S1`, `S2`, `S3` | Centre d'examen | 20.6, 20.15 | Collège Le Baobab | Désactivation possible, pas de suppression |
| `TG-BEPC-2027` Session BEPC test guide (officielle, jusqu'à Archivée) | Session d'examen | 20.7 à 20.29 | Collège Le Baobab | Aucun ; ne se supprime pas |
| `TG-BLANC-2027` BEPC blanc test guide (examen blanc, 9 candidats) | Session d'examen | 20.7, 20.34 | Collège Le Baobab | Aucun |
| KOUASSI Yves test guide, SORO Aya test guide, KONE Mariam, TRAORE Seydou (retiré), YAO Adjoua, DIABATE Ibrahim, BAMBA Fanta, COULIBALY Karim (anonymisé) (tous "test guide") | Candidats libres | 20.11 à 20.14 | Collège Le Baobab | Anonymisation possible, pas de suppression |
| Candidats TG_BEPC2027-00001 à 00006 (Nadia, Salimata, Moussa, Yves, Mariam, Fanta), identifiant officiel `TG-OFF-0001` | Inscriptions et identifiant | 20.10, 20.14 | Collège Le Baobab | Aucun |
| Convocations, attestations, relevés de la session BEPC (certains révoqués) | Documents scellés | 20.17, 20.27 | Collège Le Baobab | Révocation motivée, conservés |
| Demandes de correction (3 approuvées, 1 rejetée) sur Salimata, Moussa, Yves, Nadia | Corrections | 20.22 à 20.24, 20.27 | Collège Le Baobab | Aucun |
| `CEPE` CEPE (données fictives de démonstration) | Type d'examen (pack) | 20.35 | École Les Palmiers | Non supprimable ; idempotent |
| `TG-CTRP` Centre Les Palmiers test guide, salles `P1`, `P2` | Centre d'examen | 20.36 | École Les Palmiers | Désactivation possible |
| `TG-CEPE-2027` CEPE 2027 test guide | Session d'examen | 20.36 à 20.41 | École Les Palmiers | Aucun |
| Six candidats libres du CSV et candidats élèves du CP1 A (brouillons) ; numéros CEPE2027-00001 à 00004 | Candidats | 20.37 | École Les Palmiers | Aucun |
| Lots d'import (en-tête invalide, erreurs, appliqué), exports CSV, convocations, attestations, relevés | Imports, exports, documents | 20.38 à 20.41 | École Les Palmiers | Aucun |

## Fragment 21-portails

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Justificatif d'absence "Rendez-vous médical test guide" (DIABATE Nadia, 1 jour, déposé par le parent) | Justificatif d'absence | 21 / 21.6 | Collège Le Baobab | « Retirer ce justificatif » en fin de scénario |
| Justificatif d'absence "Malaise passager test guide" (DIABATE Nadia, déposé par l'élève) | Justificatif d'absence | 21 / 21.18 | Collège Le Baobab | « Retirer ce justificatif » en fin de scénario |
| Paiement en ligne simulé 20 000 F CFA (DIABATE Salimata, confirmé) et son reçu | Paiement + reçu | 21 / 21.9, 21.10 | Collège Le Baobab | Non supprimable ; remboursement par quatre yeux (chapitre Finance) ou réinitialisation de la base |
| Paiement en ligne simulé 5 001 F CFA (DIABATE Salimata, en attente) | Paiement | 21 / 21.9 | Collège Le Baobab | Non supprimable (reste en attente) ; réinitialisation de la base |
| Paiement en ligne simulé 5 013 F CFA (DIABATE Salimata, échoué) | Paiement | 21 / 21.9 | Collège Le Baobab | Non supprimable ; réinitialisation de la base |
| Facture "Frais divers test guide" 10 000 F CFA (DIABATE Nadia), émise par l'économe | Facture | 21 / 21.19 (prérequis, chapitre Finance) | Collège Le Baobab | Annulation par l'économe (chapitre Finance) |
| Paiements simulés 3 000 (confirmé), 3 001 (en attente), 3 013 (échoué) sur cette facture | Paiements | 21 / 21.19 | Collège Le Baobab | Non supprimables ; réinitialisation de la base |
| Contact d'urgence "KONÉ Ibrahim test guide" (DIABATE Nadia) | Contact d'urgence | 21 / 21.12 | Collège Le Baobab | « Retirer » par le secrétariat en fin de scénario |
| Coordonnées modifiées : tuteur DIABATE Séka (téléphones, ville, quartier "Cocody Riviera test guide") | Coordonnées | 21 / 21.13 | Collège Le Baobab | Rétablir le téléphone `+225 07 10 20 30 40` ; ville et quartier à vider par le secrétariat |
| Coordonnées modifiées : élève DIABATE Nadia (téléphone, ville, quartier "Cocody Danga test guide") | Coordonnées | 21 / 21.21 | Collège Le Baobab | Rétablir les valeurs relevées avant le test |
| Coordonnées modifiées : enseignant TRAORE Kouadio (téléphone, ville) | Coordonnées | 21 / 21.28 | Collège Le Baobab | Rétablir les valeurs relevées avant le test |
| Demande de congé "Congé test guide" (TRAORE Kouadio, 26 au 28 oct. 2026) | Demande de congé | 21 / 21.27 | Collège Le Baobab | « Annuler » en fin de scénario |
| Pointage « Arrivée » / « Départ » de TRAORE Kouadio (jour du test) | Pointage du personnel | 21 / 21.27 (facultatif) | Collège Le Baobab | Correction par la direction (chapitre 06) |

## Fragment 22-accessibilite

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Appel soumis hors ligne (séance du jour de la 6e A, ou « Appel du jour » du CP1 A) avec COULIBALY Moussa absent | Appel / pointages | 22 / 22.29 | Collège Le Baobab ; École Les Palmiers | Rouverture ou annulation par la direction (chapitre 06) |
| Notes `12,5`, `ABS`, `15` sur l'évaluation "Contrôle test guide" (brouillon) | Notes | 22 / 22.30, 22.31 | Collège Le Baobab | Supprimées ou annulées avec l'évaluation du chapitre 08 |
| Copie hors ligne de l'emploi du temps, brouillons de notes, file d'appel (IndexedDB `ed-offline` du navigateur) | Données locales du navigateur | 22 / 22.28 à 22.32 | Collège Le Baobab | « Se déconnecter » (copie) ; F12 > « Application » > "Clear site data" |
| Service worker `/sw.js`, caches `ed-shell-v2` et `ed-static-v2` | Données locales du navigateur | 22 / 22.25, 22.27 | tous | "Unregister", suppression des caches, relancer l'application sans `NEXT_PUBLIC_PWA` |
| Application installée (PWA) "EcoleDigitale" | Installation | 22 / 22.27 | tous | Désinstaller depuis le navigateur ou le système |

## Fragment 24-securite

| Enregistrement | Type | Chapitre/scénario | Établissement | Nettoyage |
|---|---|---|---|---|
| Sessions de connexion supplémentaires (second navigateur, fenêtre privée) | Session IAM | 24.18, 24.41, 24.42 | Collège, École, Université | Révoquer dans « Mes sessions » ou « Se déconnecter » |
| Entrées du journal d'audit (`login.failed`, `session.revoked`, `finance.refund.*`, `audit_log.exported`) | Journal d'audit | 24.44, 24.41, 24.48, 24.51 | Collège, École | Non supprimables par conception (journal immuable) |
| Verrouillage temporaire de `eleve@primaire-test.test` (essais de connexion échoués) | Compteur de limitation | 24.44 | École | Expire seul après 1 minute (jusqu'à 1 h si le niveau de verrou est monté) |
| Demandes et objets des quatre yeux (remboursement, bulletin de paie, feuille de notes "Contrôle direction test guide", mesure de vie scolaire, séance comptable) | Objets métier créés dans leurs chapitres | 24.25 à 24.34 | Collège | Voir le nettoyage des chapitres 8, 12, 13, 19, 20 ; remettre le réglage « Séparation des tâches » de la paie à décoché (24.26) |
