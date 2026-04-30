# Script de Débogage des Notes Étudiants

Ce script permet de diagnostiquer pourquoi les notes ne s'affichent pas correctement dans la page de progression.

## Installation

Assurez-vous d'avoir les dépendances installées :
```bash
cd apps/api
npm install
```

## Utilisation

### 1. Voir toutes les soumissions corrigées
```bash
npx tsx scripts/debug-student-grades.ts
```

### 2. Voir les notes d'un étudiant spécifique
```bash
npx tsx scripts/debug-student-grades.ts <student_id>
```

### 3. Spécifier un tenant différent
```bash
npx tsx scripts/debug-student-grades.ts <student_id> <tenant_id>
```

## Ce que le script fait

1. **Vérifie les soumissions corrigées directement**
   - Affiche toutes les soumissions avec des notes (final_score ou manual_score)
   - Calcule la moyenne pour chaque étudiant

2. **Teste la requête de progression**
   - Exécute la même requête SQL que l'API
   - Compare les résultats avec les soumissions directes

3. **Identifie les différences**
   - Signale si les moyennes ne correspondent pas
   - Aide à identifier le problème dans la requête SQL

## Exemple de sortie

```
🔍 Début du débogage des notes étudiants

Tenant ID: imhotepacademy

================================================================================
1. SOUMISSIONS CORRIGÉES DIRECTEMENT
================================================================================

✅ Trouvé 5 soumissions corrigées:

1. Jean Dupont (STU12345)
   Assignment: Devoir de Mathématiques
   Course: Mathématiques
   Grade: 15.5/20
   Final Score: 15.5, Manual Score: NULL
   Graded At: 2024-01-15T10:30:00Z
   Status: graded

📊 MOYENNES CALCULÉES PAR ÉTUDIANT:
================================================================================
Jean Dupont (STU12345): 15.50/20
  Notes: [15.5, 16.0, 14.5]
  Nombre de notes: 3

================================================================================
2. REQUÊTE DE PROGRESSION (comme dans l'API)
================================================================================

✅ Requête de progression retourne 1 étudiants:

1. Jean Dupont (STU12345)
   Classe: Terminale A
   Cours: Mathématiques
   Note actuelle (via instances): 0.00/20
   Note actuelle (directe): 15.50/20

================================================================================
3. COMPARAISON
================================================================================

Étudiant: Jean Dupont
Moyenne directe (soumissions): 15.50/20
Moyenne via instances: 0.00/20
Moyenne directe (sans instances): 15.50/20

⚠️ DIFFÉRENCE DÉTECTÉE!
   La requête via instances ne correspond pas aux soumissions directes.
```

## Résolution des problèmes

Si le script détecte une différence :
1. Vérifiez que `assignment_submissions.assignment_instance_id` est correctement rempli
2. Vérifiez que les jointures avec `assignment_instances` fonctionnent
3. Utilisez la version "directe" de la requête qui utilise directement `assignment_id`

## Variables d'environnement

Le script utilise `DATABASE_URL` depuis `.env`. Assurez-vous qu'elle est correctement configurée.

