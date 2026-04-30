# Research: Espace Propriétaire (Owner)

**Feature**: `027-compte-proprietaire-owner` | **Date**: 2026-04-17

## R1 — Identifiant du rôle en base et dans le JWT

**Decision**: Utiliser `roles.key = 'owner'` (cohérent avec `roles.key` machine-readable dans `0001_init.sql`) et propager la chaîne `'owner'` dans le tableau `roles` du JWT, comme pour `admin`, `teacher`, etc.

**Rationale**: Le code existant teste souvent `roles.includes('admin')` ; un identifiant stable minuscule évite les divergences `Administrateur` vs `admin`.

**Alternatives considered**: Clé `proprietaire` (moins alignée avec l’anglais déjà utilisé dans le code) ; rôle global hors tenant (rejeté : le modèle actuel est tenant-scoped sur `roles` / `user_roles`).

---

## R2 — Persistance des alertes pilotage et acquittement

**Decision**: Introduire une table dédiée tenant-scoped, par ex. `owner_pilotage_alerts` (`id`, `tenant_id`, `severity`, `message`, `domain`, `created_at`, `acknowledged_at`, `acknowledged_by_user_id`), avec RLS sur `tenant_id`. Les jobs ou requêtes d’agrégation peuvent **insérer** ou **rafraîchir** des alertes ; l’owner **acquitte** via `PATCH` sur l’enregistrement.

**Rationale**: La table `notifications` (migration parent) est centrée parent/élève et ne porte pas les champs métier (severity, domain) requis par la spec.

**Alternatives considered**: Uniquement des alertes **calculées à la volée** sans table — impossible d’implémenter un acquittement persistant propre ; réutilisation `rso_notifications` — hors périmètre scolaire général.

---

## R3 — Validation des rémunérations enseignants par le propriétaire

**Decision**: Réutiliser le workflow existant sur `teacher_payments` (`status`, `approved_by`, `approved_at`, audit `payment_audit_log`). L’action owner « valider » correspond à une transition métier autorisée (ex. vers statut approuvé / payabilité) **sans** recalculer les heures ; tracer `approved_by` = user owner.

**Rationale**: La table et les triggers d’audit existent déjà (`0011_teacher_remuneration_fixed.sql`).

**Alternatives considered**: Nouvelle table `owner_payroll_validations` redondante — rejetée sauf si le métier impose une double signature distincte de `approved_by`.

---

## R4 — Exports PDF / CSV financiers

**Decision**: Réutiliser les services de génération / export déjà présents (`PDFGenerationService`, routes `exports` ou `financial-reports` si applicables) en ajoutant une couche « rapport owner » qui applique la règle de minimisation des identifiants élèves (initiales ou ID interne non nominatif).

**Rationale**: Cohérence des PDFs et maintenance unique.

**Alternatives considered**: Génération CSV ad hoc uniquement — acceptable en V1 si PDF est plus coûteux ; à trancher à l’implémentation selon charge.

---

## R5 — Graphiques dashboard (front)

**Decision**: Utiliser la bibliothèque **déjà présente** dans `apps/web` (package.json : Recharts, Chart.js, etc.). Si aucune n’est installée, privilégier **Recharts** pour les barres horizontales (recouvrement par cycle) pour rester dans l’écosystème React.

**Rationale**: Réduit les dépendances et le bundle tooling.

**Alternatives considered**: Chart.js — équivalent acceptable si déjà utilisé ailleurs dans le projet.

---

## R6 — Garde de route Next.js

**Decision**: Combiner **middleware** ou **layout serveur** (vérification session / rôle si disponible côté serveur) et **garde client** dans `layout.tsx` du groupe `(owner)` pour redirection `/login` ou `/unauthorized`, en cohérence avec les autres espaces role-based du web.

**Rationale**: Défense en profondeur ; le détail exact dépend des helpers auth existants dans `apps/web`.

**Alternatives considered**: Garde client seule — insuffisant pour la sécurité perçue et le flash de contenu.
