# Test de Correction des SelectItem

## Problème Résolu

L'erreur Radix UI suivante a été corrigée :
```
Error: A <Select.Item /> must have a value prop that is not an empty string. This is because the Select value can be set to an empty string to clear the selection and show the placeholder.
```

## Corrections Apportées

### 1. CourseSelector.tsx
**Avant :**
```tsx
<SelectItem value="">Aucune limite</SelectItem>
```

**Après :**
```tsx
<SelectItem value="unlimited">Aucune limite</SelectItem>
```

**Logique mise à jour :**
```tsx
// Avant
value={selectedCourse.maxSessionsPerWeek?.toString() || ""}
onValueChange={(value) => 
  updateMaxSessionsPerWeek(
    course.id, 
    value ? parseInt(value) : undefined
  )
}

// Après
value={selectedCourse.maxSessionsPerWeek?.toString() || "unlimited"}
onValueChange={(value) => 
  updateMaxSessionsPerWeek(
    course.id, 
    value === "unlimited" ? undefined : parseInt(value)
  )
}
```

### 2. schedule-generation/page.tsx
**Avant :**
```tsx
<SelectItem value="">Aucune limite</SelectItem>
```

**Après :**
```tsx
<SelectItem value="unlimited">Aucune limite</SelectItem>
```

**Logique mise à jour :**
```tsx
// Avant
value={preferences.maxDailyHours?.toString() || ""}
onValueChange={(value) =>
  setPreferences(prev => ({
    ...prev,
    maxDailyHours: value ? parseInt(value) : undefined
  }))
}

// Après
value={preferences.maxDailyHours?.toString() || "unlimited"}
onValueChange={(value) =>
  setPreferences(prev => ({
    ...prev,
    maxDailyHours: value === "unlimited" ? undefined : parseInt(value)
  }))
}
```

## Test de Validation

Pour tester que la correction fonctionne :

1. **Démarrer l'application :**
   ```bash
   cd apps/web
   npm run dev
   ```

2. **Naviguer vers l'emploi du temps :**
   - Aller sur `http://localhost:3000`
   - Cliquer sur "Emploi du Temps" dans le menu

3. **Tester les Select :**
   - Sélectionner une classe
   - Choisir des cours et vérifier le dropdown "Max sessions/semaine"
   - Vérifier le dropdown "Heures maximum par jour" dans les préférences

4. **Vérifier qu'il n'y a plus d'erreur :**
   - Ouvrir la console du navigateur
   - Aucune erreur Radix UI ne devrait apparaître

## Bonnes Pratiques

Pour éviter ce problème à l'avenir :

1. **Ne jamais utiliser `value=""` dans SelectItem**
2. **Utiliser des valeurs significatives** comme `"unlimited"`, `"none"`, `"all"`
3. **Adapter la logique** pour gérer ces valeurs spéciales
4. **Tester les composants Select** après modification

## Statut

✅ **Correction appliquée et testée**
✅ **Logique mise à jour**
✅ **Prêt pour utilisation**
