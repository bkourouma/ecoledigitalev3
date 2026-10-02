# Décisions métier validées par le propriétaire du produit

Source de vérité pour les specs et l'implémentation. Toute entrée ici l'emporte sur la « valeur par défaut » proposée dans les `open-questions.md`.

| Date | Sujet | Décision | Specs concernées |
|------|-------|----------|------------------|
| 2026-10-01 | Rattrapage (session 2), supérieur | **La note de session 2 REMPLACE toujours celle de session 1**, même si elle est plus faible (comportement legacy conservé). | 011, 012, 019 (RuleSet `CI-HIGHER-*`, paramètre `session2.mode = REPLACE`) |
| 2026-10-01 | Validation d'un semestre / passage, supérieur | **Un semestre est validé si TOUTES ses UE sont validées**, sans compensation entre UE. L'année est validée si toutes les UE des deux semestres le sont. Les règles « 20 crédits » et « > 48 crédits » du code legacy ne sont PAS reprises (elles n'étaient jamais appliquées). Le paramètre reste configurable dans le RuleSet pour d'autres établissements. | 012, 019 |
| 2026-10-01 | Abonnement des tenants existants | **Plan PROFESSIONAL + pack HIGHER** pour tous les tenants legacy rattrapés (`V2_LEGACY_TENANT_DEFAULT_PLAN=PROFESSIONAL`, `V2_LEGACY_TENANT_DEFAULT_PACK=HIGHER`). | tenancy, entitlements, platform |
| 2026-10-01 | Confirmation d'une inscription | **Automatique après paiement des frais d'inscription** (événement `finance.invoice.paid` sur la ligne d'inscription), comme le module Professionnel actuel. Le solde de la scolarité est suivi séparément. Pour les cours à la carte : confirmation du cours une fois son montant soldé. | 004, 008, 014 (requête « frais d'inscription soldés ») |
| 2026-10-01 | Nom du produit | EcoleDigitale (jamais ScolarFlow). | tous |
| 2026-10-01 | Imhotep | Supprimé (code retiré ; tables et données supprimées au reset de la Phase 2 après sauvegarde et confirmation explicite). | — |

## Questions encore ouvertes (valeur par défaut appliquée tant qu'elles ne sont pas tranchées)

Voir `004-academic-core/open-questions.md` (O-01 à O-23) et `012-rules-engine/open-questions.md` partie B (Q-01 à Q-40), et `012-rules-engine/regulatory-sources-needed.md` pour les textes officiels du primaire et du secondaire (nécessaires avant les Phases 4 et 5).

## Décisions du 2026-10-02 (réponses de l'utilisateur via AskUserQuestion)

| Sujet | Décision |
|-------|----------|
| Conduite non notée | Le semestre reste « en attente » tant que la conduite manque (défaut confirmé). |
| Précision des notes | 3 décimales, sans arrondi intermédiaire (9,995 n'est pas arrondi à 10) (défaut confirmé). |
| Paie | Taux et montants en francs entiers XOF (défaut confirmé). |
| Fournisseur SMS | Orange SMS API (adaptateur dédié à construire derrière le port existant ; aucun envoi réel sans configuration explicite). |
