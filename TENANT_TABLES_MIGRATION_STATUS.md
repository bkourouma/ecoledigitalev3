# État d'avancement : Migration vers Tables Tenant-Spécifiques

## ✅ Terminé

1. **Migration SQL créée** : `0046_create_aspci_professional_training_tables.sql`
   - Crée 17 tables dédiées pour ASPCI avec suffixe `_aspci`
   - Tables créées avec succès dans la base de données

2. **Helper créé** : `apps/api/src/utils/table-names.ts`
   - Fonction `getTableName(tenantId, baseTableName)` pour obtenir le nom de table selon le tenant
   - Support pour imhotepdata (tables de base) et ASPCI (tables avec suffixe `_aspci`)

3. **Service `formation-pro.service.ts`** : Partiellement adapté
   - Méthodes adaptées : `searchFormations`, `getFormationBySlug`, `getFormationSessions`, `getSimilarFormations`, `getThemes`, `getStats`, `createFormation`, `updateFormation`, `createSession`, `updateSession`, `deleteSession`, `deleteFormation`
   - ⚠️ Vérifier qu'il ne reste pas d'occurrences de noms de tables en dur

## 🔄 En cours / À faire

### Services à adapter (ordre de priorité)

1. **`session-pro.service.ts`** - Service de gestion des sessions
   - Remplacer toutes les occurrences de `sessions_professionnelles`, `formations_professionnelles`, `inscriptions_professionnelles`, etc.

2. **`formateur.service.ts`** - Service de gestion des formateurs
   - Remplacer `formateurs`, `session_formateurs`, `sessions_professionnelles`, `inscriptions_professionnelles`, etc.

3. **`inscription-pro.service.ts`** - Service de gestion des inscriptions
   - Remplacer `inscriptions_professionnelles`, `sessions_professionnelles`, etc.

4. **`paiement-pro.service.ts`** - Service de gestion des paiements
   - Remplacer `paiements_professionnels`, `inscriptions_professionnelles`, etc.

5. **`entreprise-cliente.service.ts`** - Service de gestion des entreprises
   - Remplacer `entreprises_clientes`, `inscriptions_professionnelles`, etc.

6. **`export.service.ts`** - Service d'export
   - Remplacer toutes les tables utilisées

7. **`document-generation.service.ts`** - Service de génération de documents
   - Remplacer toutes les tables utilisées

8. **`reporting.service.ts`** - Service de reporting
   - Remplacer toutes les tables utilisées

9. **Autres services** :
   - `formateur-messaging.service.ts`
   - `formateur-attendance.service.ts`
   - `formateur-availability.service.ts`

## 📋 Pattern à suivre pour chaque service

```typescript
// 1. Importer le helper
import { getTableName } from "../utils/table-names";

// 2. Au début de chaque méthode qui fait des requêtes SQL
const formationsTable = getTableName(tenantId, 'formations_professionnelles');
const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
// ... autres tables nécessaires

// 3. Remplacer tous les noms de tables en dur dans les requêtes SQL
// AVANT:
const sql = `SELECT * FROM formations_professionnelles WHERE tenant_id = $1`;

// APRÈS:
const sql = `SELECT * FROM ${formationsTable} WHERE tenant_id = $1`;
```

## ⚠️ Points d'attention

1. **Foreign keys** : Les tables ASPCI référencent d'autres tables ASPCI (ex: `formations_professionnelles_aspci` référence `sessions_professionnelles_aspci`)
2. **RLS Policies** : Chaque table ASPCI a ses propres policies RLS
3. **Triggers** : Chaque table ASPCI a ses propres triggers (ex: `generate_session_code_aspci`, `generate_enrollment_number_aspci`)
4. **Indexes** : Chaque table ASPCI a ses propres indexes

## 🧪 Tests à effectuer

1. Se connecter avec `admin@aspci.fr`
2. Créer une formation professionnelle
3. Créer une session
4. Créer une inscription
5. Vérifier que les données sont bien isolées (imhotepdata ne voit pas les données ASPCI et vice versa)

## 📝 Notes

- Les tables imhotepdata continuent d'utiliser les noms de base (sans suffixe)
- Les tables ASPCI utilisent le suffixe `_aspci`
- Chaque tenant a une isolation complète des données au niveau de la base de données

