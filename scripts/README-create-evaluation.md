# Script de création d'évaluation - Prof. Marie Kouamé

Ce script permet de créer automatiquement une évaluation en ligne avec 5 questions pour le compte de Prof. Marie Kouamé.

## Prérequis

1. **Base de données PostgreSQL** : La base de données doit être accessible et contenir les données nécessaires
2. **API Backend** : L'API backend doit être démarrée sur `http://localhost:4000`
3. **Variables d'environnement** : Le fichier `.env` doit contenir `DATABASE_URL` et `NEXT_PUBLIC_API_URL`

## Utilisation

### 1. Démarrer l'API backend

```bash
pnpm dev:api
```

### 2. Exécuter le script

```bash
npx tsx scripts/create-evaluation-marie-kouame.ts
```

ou

```bash
pnpm exec tsx scripts/create-evaluation-marie-kouame.ts
```

## Ce que fait le script

1. **Recherche l'enseignant** : Trouve l'utilisateur avec l'email `marie.kouame@imhotepacademy.ci`
2. **Trouve un cours** : Recherche un cours assigné à cet enseignant (ou un cours actif par défaut)
3. **Crée l'évaluation** : Crée une évaluation en ligne avec les paramètres suivants :
   - Type : Évaluation en ligne
   - Durée : 60 minutes
   - Date de début : Demain
   - Date de fin : 2 heures après le début
   - Mode de création : Manuel
   - Affichage des résultats : Après correction
4. **Crée 5 questions** : Chaque question vaut 5 points :
   - Question 1 : Choix unique (QCM) - Géographie
   - Question 2 : Choix multiples - Programmation web
   - Question 3 : Vrai/Faux - React
   - Question 4 : Réponse courte - API REST
   - Question 5 : Texte à trous - HTTP

## Résultat

Le script affiche :
- L'ID de l'évaluation créée
- Le nombre de questions créées
- Le total des points
- L'URL pour accéder à l'évaluation

## Exemple de sortie

```
🚀 Démarrage de la création de l'évaluation...

1️⃣  Recherche de l'enseignant...
   ✅ Enseignant trouvé: marie.kouame@imhotepacademy.ci (ID: xxx-xxx-xxx)

2️⃣  Recherche d'un cours...
   ✅ Cours ID: yyy-yyy-yyy

3️⃣  Création de l'évaluation...
   ✅ Évaluation créée avec succès: zzz-zzz-zzz
   Titre: Évaluation de contrôle - 15/01/2024

4️⃣  Création des questions...

   ✅ Question 1 créée: "Quelle est la capitale de la Côte d'Ivoire ?..."
   ✅ Question 2 créée: "Quels sont les langages de programmation web..."
   ✅ Question 3 créée: "React est une bibliothèque JavaScript..."
   ✅ Question 4 créée: "Qu'est-ce que l'API REST ?..."
   ✅ Question 5 créée: "Le protocole HTTP utilise les méthodes..."

✨ Toutes les questions ont été créées avec succès !

📝 Résumé:
   - Évaluation ID: zzz-zzz-zzz
   - Nombre de questions: 5
   - Points par question: 5
   - Total des points: 25

🔗 URL de l'évaluation: http://localhost:3000/academic/evaluations/zzz-zzz-zzz
```

## Personnalisation

Pour modifier les questions, éditez le tableau `questions` dans le fichier `scripts/create-evaluation-marie-kouame.ts`.

## Dépannage

### Erreur : "Aucun enseignant trouvé"
- Vérifiez que l'email `marie.kouame@imhotepacademy.ci` existe dans la base de données
- Vérifiez que l'utilisateur a un profil enseignant associé

### Erreur : "Aucun cours actif trouvé"
- Vérifiez qu'il existe au moins un cours avec le statut `active` dans la base de données
- Créez un cours si nécessaire

### Erreur de connexion à l'API
- Vérifiez que l'API backend est démarrée sur `http://localhost:4000`
- Vérifiez la variable d'environnement `NEXT_PUBLIC_API_URL`

### Erreur de connexion à la base de données
- Vérifiez que PostgreSQL est démarré
- Vérifiez la variable d'environnement `DATABASE_URL`

