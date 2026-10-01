# Parité legacy — 013-report-cards

**Périmètre** : bulletins, relevés, rendu PDF, signataires/identité des documents de période, accès familles. Les diplômes, attestations et leurs signataires de document officiel sont dans `019/parity.md` (ils réutilisent le rendu de 013). Les formules sont dans `012/parity.md` ; la saisie et le calcul dans `011/parity.md`.

Statuts : **Conservé**, **Amélioré**, **Abandonné**, **Reporté**. Lignes : état au 2026-10-01.

Tables legacy remplacées (tranche 2.6) : `report_cards`, `transcripts`, `professional_bulletins`. Services/gabarits supprimés : `report-card-template.service.ts`, `bulletin-pdf.ts`, `bulletin-pdf-bts.ts` (web), `BulletinView.tsx` (logique de présentation), parties bulletin de `professional-bulletin.service.ts` et de `semester-averages.ts`.

## 1. Pile classique — `report-cards.ts`, `transcripts.ts`, `semester-averages.ts`

| ID | Fonction (fichier:ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-RC-01 | `report-cards.ts` `GET /` (`:24`), `POST /` (`:220`), `PUT /:id` (`:359`), `DELETE /:id` (`:549`) | CRUD d'un « bulletin » **manuel** : `overall_grade` saisie (0-20), `report_url` libre, `downloadable`/`viewable`, unicité (élève, année, semestre) | **Abandonné** | Snapshot **calculé** et immuable (`report_cards` v2) | Une note générale saisie et une URL de fichier ne prouvent rien ; plan §3.7. Les drapeaux `viewable`/`downloadable` deviennent la publication/retrait. |
| P-RC-02 | `transcripts.ts` `GET/POST/PUT/DELETE` (`:24`, `:236`, `:375`, `:564`) | CRUD d'un relevé manuel (`totalCredits`, `gpa`, `transcriptUrl`) | **Abandonné** | `TRANSCRIPT` calculé (US7) | Idem. |
| P-RC-03 | `POST /report-cards/pdf` (`semester-averages.ts:961-1284`) | PDF Puppeteer d'une classe ou d'un élève pour une période : sections par type de bilan, rangs par matière/section/global, moyenne annuelle `(S1+2×S2)/3`, distinctions, appréciation, décision, absences | **Conservé** (contenu) / **Amélioré** (mécanisme) | Gabarit `higher-bulletin-coef` / `secondary-bulletin` ; contenu issu du snapshot ; rendu dans le worker | Même information, mais calculée une fois (011/012), figée, signée. |
| P-RC-04 | Calculs dans la route (rangs `:1015-1160`, moyennes de section, annuelle `:1151`, mention, décision) | Logique métier dans le plugin | **Abandonné** | Règles 012 + résultats `FINAL` | Zéro calcul au rendu (R-RC-12). |
| P-RC-05 | `fetchReportCardStudents` (`:330`) : élèves `student_enrollments.status = 'active'` | Périmètre du lot | **Conservé** | Inscriptions actives de la classe (port 004) ; **exclusions listées** | |
| P-RC-06 | `fetchReportCardCourses` (`:300`) : matières du programme de la classe, `coef` repli 1, tri par type de bilan | Contenu du bulletin | **Amélioré** | Nœuds du curriculum de la classe ; coefficient explicite | |
| P-RC-07 | `buildAttendanceSummary` (`:245`) : « NN heure(s) d'abscence (dont NN justifiée(s)) » (faute « abscence » conservée dans le code) | Absences saisies à la main (`student_period_attendance_summaries`) | **Amélioré** | Absences lues dans le module `attendance` (010) au moment de l'émission, copiées dans le snapshot | Plus de saisie manuelle ; faute corrigée dans le gabarit. |
| P-RC-08 | `POST /attendance-certificates/pdf` et `/pdf-html` (`:716`, `:847`) ; `attendance-certificate-template.service.ts` (1 078 lignes) | Attestation d'assiduité d'une classe/élève | **Reporté** | 024-documents / 010-attendance (via le port `DocumentRenderer` de cette spec) | Autre nature de document ; réutilisera le rendu. |
| P-RC-09 | `generateReportCardsPdfFromHtml` (`report-card-template.service.ts:844`) | Génération par lot d'un PDF unique concaténé | **Conservé** | PDF combiné de classe (job) | Fusion `pdf-lib`. |
| P-RC-10 | `renderHtmlToPdf` (`:214`), `findPuppeteerChromeBinary` (`:93`), `resolveProjectRootFromCwd` (`:75`) | Puppeteer dans le **process API**, binaire recherché dans plusieurs dossiers | **Amélioré** | Puppeteer dans le **worker**, image dédiée | Plan §3.10 ; isolation du navigateur hors de l'API. |
| P-RC-11 | `resolveSchoolLogoPath` (`:87`) | Un logo unique pour tous | **Amélioré** | `branding_versions.logo_object_key` par tenant | |
| P-RC-12 | En-tête codé en dur (`:399-404`) : « MINISTERE DE L'ENSEIGNEMENT SUPERIEUR ET DE LA RECHERCHE SCIENTIFIQUE », « DIRECTION DEPARTEMENTALE D'ABIDJAN 1 », « IMHOTEP ACADEMY (EXASP CI) », adresse et téléphone | Identité d'un établissement imprimée pour tous les tenants | **Abandonné** | `branding_versions` (lignes officielles = **texte fourni par l'établissement**) | Inventaire tranche 2.6 : « le premier tenant non-IPAM imprimera le logo d'un autre ». |
| P-RC-13 | `escapeHtml` (`:161`), `formatNumber` (`:177`), `formatNumberOrBlank` (`:187`), `formatRank` (`:194`), `formatDateFr` (`:170`) | Mise en forme | **Conservé** | Fonctions de présentation du moteur de gabarit (locale `fr-CI`, Intl) | |

## 2. Pile Professional — `professional-bulletin.service.ts`

| ID | Fonction (ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-RC-20 | `computeStudentBulletin` (`:1621`) | Calcule à chaque lecture le relevé (UE, ECUE, catégories, décision) depuis les tables vivantes | **Amélioré** | Résultats `FINAL` (011) + snapshot | Le relevé ne dépend plus des données vivantes. |
| P-RC-21 | `generateBulletins` (`:1218`) : `INSERT … ON CONFLICT (tenant, student, semestre) DO UPDATE SET data, statut` | « Génération » = **écrasement** du JSON, statut `provisoire`/`definitif`, `generated_at` | **Amélioré** | Émission versionnée, jamais écrasée ; `provisional` explicite et non vérifiable | Défaut : un bulletin « définitif » était réécrit à la régénération. |
| P-RC-22 | `cloturerBulletins` (`:1557`) + refus de régénérer après clôture (`:1223-1228`) | Clôture des bulletins du semestre, idempotente, refusée si aucun bulletin | **Conservé** (intention) | Clôture de période (011) + émission ; remplacement par versions | Le semestre « clos » ne se régénère pas : seules les versions successives le permettent, avec motif. |
| P-RC-23 | `enAttenteSession2` (`:38`), `SESSION2_PENDING_MESSAGE` (`:43`) | Pas de bulletin tant que la session 2 n'est pas saisie (`statut_etudiant = 'session2'`) | **Conservé** | Pré-contrôle : décision `RESIT` ⇒ bulletin non définitif (provisoire possible) | |
| P-RC-24 | `getBulletin` (`:433`), `getBulletinBts` (`:470`) | Deux mises en page ; la « BTS » réservée par regex aux Licences 1/2 (`:478`) ; rang plafonné à 300 (`:512`) | **Amélioré** | Gabarit = configuration ; rangs issus des résultats | R-RC-10, R-RC-12. |
| P-RC-25 | `rankAmong` (`:772`) : rang = nombre de valeurs strictement supérieures + 1 | Rang par UE/ECUE/global/annuel recalculé à la volée | **Abandonné** | Règle `rang` calculée en phase 2 de 011 et figée | |
| P-RC-26 | `attachGeneratedMeta` (`:779`) : date de génération « officielle » + statut du bulletin | Métadonnées | **Conservé** | `issued_at`, `status`, `version` | |
| P-RC-27 | `getBulletinHistory` (`:1360`) : historique par filière/« nom de classe » (`split_part(libelle, ' — ', 1)`) | Regroupement des bulletins par semestre, statut dérivé (`en_cours/terminee/aucune`), année scolaire déduite de la date | **Amélioré** | Liste par classe × période × version ; année = `academic_year_id` | Le « nom de classe » n'est plus extrait d'un libellé. |
| P-RC-28 | `listFullBulletins` (`:1293`) | Bulletins complets de tout le semestre pour un PDF combiné ; exclut les étudiants en attente de session 2 | **Conservé** | PDF combiné de classe (exclusions listées) | |
| P-RC-29 | `listRoster` (`:1128`) | Liste des étudiants du semestre et état du bulletin | **Conservé** | `GET /report-cards` + lot | |
| P-RC-30 | `reference` : `REL-{année}-{code filière}-{matricule}` en majuscules (`:1871`) | Référence « unique » dérivée de données | **Amélioré** | `verification_code` aléatoire + numéro de série lisible par tenant (si requis par l'établissement) | Une référence dérivée des données se devine et se falsifie. |
| P-RC-31 | Catégories d'UE `fondamentale / specialite / culture_generale` (`:1849-1867`) et libellés web `CATEGORIE_LABEL` | Regroupement d'affichage | **Conservé** | Attribut `category` de nœud (004) + libellés dans le gabarit | |
| P-RC-32 | Matricule professionnel de filière prioritaire sur le numéro d'établissement (`professional_student_matricules`, `:1637-1648`) | Deux matricules | **Reporté** | 008 (identité élève, matricule par programme/établissement) | Le bulletin imprime le matricule fourni par `people.students`. |
| P-RC-33 | Autorisations de lecture : `getBulletinForUser` (`:853`), `getBulletinBtsForUser` (`:890`), `isParentOfChild` (`:975`), `listChildSemestres` (`:990`), `getChildBulletin` (`:1046`), `getChildSemestreNotes` (`:1076`) | Trois chemins : admin, titulaire, parent | **Conservé** | Matrice d'accès (gestion / élève / tuteur lié) + `GuardianshipPort` ; publication obligatoire | Les gardes sont sensibles (cf. correctif `1dbb34f` pour la paie) : tests dédiés. |
| P-RC-34 | `owner-pedagogie.service.ts:179,228-273` lit `b.data->>'decision'` (`admis/rattrapage/ajourne`) et des clés numériques du JSON | Lecteur owner couplé au JSON du bulletin | **Amélioré** | Lecture des colonnes de `results.period_results` (`decision_outcome`, `average`, `credits_*`) | `safeQuery` avalait les erreurs : un changement de clé vidait les tableaux sans erreur. Contrat de lecture explicite. |

## 3. Côté web (générateurs et formatage)

| ID | Fichier:ligne | Contenu | Statut | Cible |
|---|---|---|---|---|
| P-RC-40 | `apps/web/src/lib/bulletin-pdf.ts` (517 l.), `bulletin-pdf-bts.ts` (490 l.) | Génération PDF côté navigateur (jsPDF) | **Abandonné** | Rendu serveur |
| P-RC-41 | `bulletin-format.ts:6-48` (`MINISTERE`, `REPUBLIQUE`, `INSTITUT`, `INSTITUT_SIGLE = "IPAM"`, `LOGO_*`, palette IPAM, `FOOTER_ADDRESS`, `FOOTER_NOTE`) | Identité IPAM en dur | **Abandonné** | `branding_versions` |
| P-RC-42 | `bulletin-format.ts:14-23` `juryIntro(date = new Date())` : « vu le procès-verbal de délibération en date du <aujourd'hui> » | **Date du jour** présentée comme date de délibération | **Abandonné** | Date réelle de `results.deliberations` (R-RC-11) |
| P-RC-43 | `bulletin-format.ts` `JURY_RESULTATS`, `JURY_NB`, `DECISION_TITRE`, `VISA_DIRECTEUR` | Phrases du relevé du supérieur | **Conservé** | Textes du gabarit `higher-bulletin-credits` (français, modifiables par version de gabarit) |
| P-RC-44 | `bulletin-format.ts` `decisionLabel`, `ueEtatLabel`, `ueEtatColor`, `statutEtudiantLabel`, `sessionLabel`, `rangLabel`, `fmtNote`, `fmtDateLongFr`, `semShort`, `releveSemestreTitre`, `semestreOrdinalFr` | Mise en forme et libellés | **Conservé** (forme) / **Abandonné** (logique : `semShort` etc. extraient des chiffres des libellés) | Fonctions de présentation du moteur de gabarit ; numéro de semestre = rang de période |
| P-RC-45 | `components/professional/BulletinView.tsx` (315 l.), `lib/utils/bulletin-historique-report.ts`, `semestre-report.ts` | Affichage HTML du relevé, exports | **Amélioré** | Écrans lisant l'API (valeurs fournies) ; exports générés côté serveur |
| P-RC-46 | Export Word du bulletin (`bulletin-docx` cité par `bulletin-format.ts`) | Export `.docx` | **Reporté** | Hors V1 (aucun besoin exprimé) |
| P-RC-47 | `diplome-pdf.ts`, `attestation-pdf.ts`, `attestation-authenticite-pdf.ts`, `diplome-format.ts` | Documents officiels (jsPDF) | **Reporté** | 019 (rendu via le port de 013) |

## 4. Défauts du legacy volontairement NON reproduits

1. **Identité d'un établissement (et noms de personnes) imprimée pour tous les tenants.**
2. **Date du jour imprimée comme date de délibération.**
3. Bulletin « définitif » réécrit à la régénération (`ON CONFLICT DO UPDATE`).
4. Bulletin manuel (note saisie + URL) tenant lieu de document officiel.
5. PDF jsPDF côté navigateur, Puppeteer dans le process API.
6. Rang recalculé à chaque lecture, plafonné à 300 étudiants (rang absent sans message).
7. Références de document dérivées de données de l'élève.
8. Choix de la mise en page par expression régulière sur le nom du programme.
9. Lecture des bulletins par des tableaux de bord qui parsent le JSON sans contrat.
10. Absences saisies à la main et faute d'orthographe dans un libellé réglementaire.
