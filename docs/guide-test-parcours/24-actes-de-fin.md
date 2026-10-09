[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](23-superieur.md) · [Suivant →](99-bilan.md)

# Phase 24 — Actes de fin de recette (irréversibles)

Dernière phase : l'acte irréversible reporté depuis la phase « Emploi du temps ». À ne jouer qu'une fois, quand tout le reste est terminé.

Précondition : phases « Emploi du temps » et "Appel et présences" terminées.

## Étape 441 — Archiver l'emploi du temps de démonstration et publier le vôtre
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, MFA) · fenêtre **A** · 📂 fiche `Emploi du temps 6E-A` puis `Emploi du temps test guide 6e A` (`/v2/schedule/timetables`)

> ⚠️ Irréversible. Un emploi du temps archivé ne se republie jamais. C'est pourquoi cette étape est placée **tout à la fin** du guide : les phases précédentes lisent l'emploi du temps de démonstration `6E-A`.

1. Sur `Emploi du temps 6E-A` (publié), cliquer **« Archiver »** et confirmer.
2. Ouvrir `Emploi du temps test guide 6e A` (aucun conflit, voir l'étape *Provoquer un conflit entre créneaux*) et cliquer **« Publier »**.
3. Cliquer **« Générer les séances »** sur une période d'un mois (à partir de `12/10/2026`).

✅ "Emploi du temps archivé." (état « Archivé », lecture seule) ; "Emploi du temps publié." (badge « Publié », "Seul un brouillon est modifiable.") ; génération : « Créées » = vendredis × 2 créneaux hebdomadaires (P1 et P2) + P3 un vendredi sur deux ; « Déjà existantes » = 0. Les séances ponctuelles `Séance de remplacement test guide` (14:00) ne gênent pas.

⚠️ *Test d'erreur* : publier un second brouillon (`Emploi du temps test guide B`) → "Un emploi du temps est déjà publié pour cet établissement, cette année et cette période."

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :** `Emploi du temps test guide 6e A` publié ; `Emploi du temps 6E-A` archivé ; séances générées à partir du 12/10/2026.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](23-superieur.md) · [Suivant →](99-bilan.md)
