# Guide de Configuration - Validation des Heures Enseignées

## 📊 Résumé

**Total enseignants** : 3  
**Total affectations** : 8  
**Affectations à valider** : 8

---

## 👨‍🏫 Enseignants à Valider

### 1. Jean Koffi
- **Email** : jean.koffi@imhotepacademy.ci
- **ID** : `066300fc-8ad4-47e9-ac91-d8230c8dc6a8`
- **Affectations** : 3 cours

#### Affectations à valider :

| Cours | Code | Classe | Période | Heures Estimées | Assignment ID |
|-------|------|--------|---------|-----------------|---------------|
| Droit du Travail | L-RH-DT-102 | L1-RH-A | 01/11/2025 → 11/02/2026 | 40h | `a27f2f14-a166-4108-82f1-cba24c14e290` |
| Gestion de la Paie | L-RH-PAIE-104 | L1-RH-A | 01/11/2025 → 15/01/2026 | 40h | `cf5d25db-ebb0-48f6-804f-39f5e94c9931` |
| Relations Sociales en Entreprise | L-RH-RS-105 | L1-RH-A | 01/11/2025 → 05/03/2026 | 40h | `a791e81d-947e-4015-b38b-a7e0914990bf` |

**💡 Configuration recommandée pour janvier 2025** :
- Pour chaque cours, valider **20 heures** pour la période de janvier 2025
- Total à valider pour Jean Koffi : **60 heures** (3 cours × 20h)

---

### 2. Amina Diallo
- **Email** : amina.diallo@imhotepacademy.ci
- **ID** : `5ddc5ddd-3570-4c64-ad0a-1faab2823ac1`
- **Affectations** : 3 cours

#### Affectations à valider :

| Cours | Code | Classe | Période | Heures Estimées | Assignment ID |
|-------|------|--------|---------|-----------------|---------------|
| Deep Learning | M-DS-DL-202 | M1-DS-IA-B | 14/11/2025 → 18/04/2026 | 40h | `28307bc5-52bd-4b9b-86b3-a6b2acb80d07` |
| Machine Learning Avancé | M-DS-ML-201 | M1-DS-IA-B | 21/11/2025 → 11/06/2026 | 40h | `374d5e4e-18e2-4e38-824f-11a4a7952bef` |
| Big Data et Technologies NoSQL | M-DS-BD-203 | M1-DS-IA-B | 22/11/2025 → 11/02/2026 | 40h | `33fb35a1-e0a0-42f6-8bf7-5a51b242d44b` |

**💡 Configuration recommandée pour janvier 2025** :
- Pour chaque cours, valider **20 heures** pour la période de janvier 2025
- Total à valider pour Amina Diallo : **60 heures** (3 cours × 20h)

---

### 3. Marie Kouamé
- **Email** : marie.kouame@imhotepacademy.ci
- **ID** : `fe67f39e-cadd-47cd-a968-e8c5203c9be4`
- **Affectations** : 2 cours

#### Affectations à valider :

| Cours | Code | Classe | Période | Heures Estimées | Assignment ID |
|-------|------|--------|---------|-----------------|---------------|
| Psychologie Organisationnelle | L-RH-PSY-103 | L1-RH-A | 22/11/2025 → 06/03/2026 | 40h | `a5436d89-45e6-454d-a2a3-08849bc204be` |
| Gestion des Ressources Humaines | L-RH-GRH-101 | L1-RH-A | 22/11/2025 → 14/05/2026 | 40h | `d0202596-bbfd-4f90-b286-730941d73201` |

**💡 Configuration recommandée pour janvier 2025** :
- Pour chaque cours, valider **20 heures** pour la période de janvier 2025
- Total à valider pour Marie Kouamé : **40 heures** (2 cours × 20h)

---

## 📝 Données de Configuration pour Validation

### Configuration pour la période de janvier 2025

**⚠️ IMPORTANT** : Les affectations commencent en novembre 2025, mais pour tester le calcul des paiements pour la période **janvier 2025** (01/01/2025 → 31/01/2025), vous devez valider des heures avec des dates dans cette période.

### Données à utiliser dans la page de validation :

1. **Filtres à appliquer** :
   - **Du** : `2025-01-01`
   - **Au** : `2025-01-31`
   - **Enseignant** : Tous (ou sélectionner un par un)
   - **Statut** : Non validées

2. **Heures à valider pour chaque affectation** :

#### Jean Koffi (3 affectations)
- Droit du Travail : **20 heures**
- Gestion de la Paie : **20 heures**
- Relations Sociales en Entreprise : **20 heures**

#### Amina Diallo (3 affectations)
- Deep Learning : **20 heures**
- Machine Learning Avancé : **20 heures**
- Big Data et Technologies NoSQL : **20 heures**

#### Marie Kouamé (2 affectations)
- Psychologie Organisationnelle : **20 heures**
- Gestion des Ressources Humaines : **20 heures**

### Total à valider
- **Total heures** : 160 heures (8 affectations × 20h)
- **Total enseignants** : 3
- **Total affectations** : 8

---

## 🎯 Étapes de Validation

1. **Accéder à la page** : `http://localhost:3000/payments/teaching-hours`

2. **Appliquer les filtres** :
   - Du : `2025-01-01`
   - Au : `2025-01-31`
   - Enseignant : `Tous`
   - Statut : `Non validées`
   - Cliquer sur **"Appliquer"**

3. **Sélectionner les affectations** :
   - Cocher toutes les affectations affichées (ou sélectionner par enseignant)

4. **Entrer les heures** :
   - Pour chaque affectation, entrer **20 heures** dans le champ "Heures à valider"

5. **Valider** :
   - Cliquer sur **"Valider les heures"**

6. **Vérifier** :
   - Les heures doivent apparaître comme "✓ Validé" avec le nombre d'heures validées

---

## ⚠️ Notes Importantes

1. **Dates des affectations** : Les affectations actuelles commencent en novembre 2025. Pour que les heures soient prises en compte dans le calcul des paiements pour janvier 2025, le système créera des enregistrements dans `teaching_hours` avec la date de fin de l'affectation comme `session_date`. 

2. **Période de paiement** : Assurez-vous que la période de paiement "Janvier 2025" (01/01/2025 → 31/01/2025) est active.

3. **Configuration enseignants** : Vérifiez que chaque enseignant a une configuration de paiement active avec `effective_from` ≤ 2025-01-01.

4. **Calcul des paiements** : Après validation, vous pouvez lancer le calcul des paiements sur la page `/payments/calculate` pour la période "Janvier 2025".

---

## 📋 Checklist de Validation

- [ ] Accéder à `/payments/teaching-hours`
- [ ] Appliquer les filtres (Du: 2025-01-01, Au: 2025-01-31)
- [ ] Sélectionner toutes les affectations
- [ ] Entrer 20 heures pour chaque affectation
- [ ] Cliquer sur "Valider les heures"
- [ ] Vérifier que toutes les heures sont validées
- [ ] Lancer le calcul des paiements sur `/payments/calculate`

---

## 🔍 Vérification Post-Validation

Après validation, vous pouvez vérifier que les heures ont été enregistrées :

```sql
SELECT 
  th.id,
  th.session_date,
  th.hours_taught,
  t.first_name || ' ' || t.last_name as teacher_name,
  c.name as course_name
FROM teaching_hours th
JOIN course_assignments ca ON th.assignment_id = ca.id
JOIN teachers t ON ca.teacher_id = t.id
JOIN courses c ON ca.course_id = c.id
WHERE th.tenant_id = (SELECT id FROM tenants WHERE slug = 'imhotepacademy')
  AND th.session_date >= '2025-01-01'
  AND th.session_date <= '2025-01-31'
ORDER BY teacher_name, course_name;
```

---

**Date de création** : 2025-01-27  
**Dernière mise à jour** : 2025-01-27

