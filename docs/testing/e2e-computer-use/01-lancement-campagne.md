# Lancement d'une campagne

> Pour l'orchestrateur (Opus). Comment on déclenche, dans quel ordre, avec quel modèle, et
> comment on réagit quand un scénario revient cassé.

---

## 1. Avant de lancer quoi que ce soit

```bash
pnpm dev
```

API sur `:4000`, Web sur `:3000`. Si plusieurs `pnpm dev` ont été empilés, tuer les processus
node avant de relancer. **L'API ne recharge pas à chaud de façon fiable** : après tout correctif
serveur, la redémarrer, sinon le scénario rejoué teste du code périmé et l'anomalie « revient »
sans raison.

Vérifications d'amorçage (2 minutes, à faire soi-même, pas par un agent) :

| Point | Comment | Si ça cloche |
|---|---|---|
| Base joignable | `/login` affiche la liste des tenants | Les tenants viennent de l'API : écran vide = API ou base HS |
| Tenant | `ecoledigitale` présent | C'est le seul tenant seedé en local |
| Compte admin | connexion `admin@imhotepacademy.fr` | Mots de passe : `infra/scripts/seed.ts` et `apps/web/src/lib/technical-accounts.ts` |
| Migrations | les pages `/professionnel/admin/ue` et `/professionnel/admin/diplomes` chargent | Elles dépendent des migrations `0069` (UE/ECUE) et `0087` (signataires) |

> Le rôle **admin** est le seul qui ouvre `/api/v1/professional/*` (garde `requireAdmin` côté
> API ; il n'y a **aucune garde côté page** — une page peut donc s'afficher vide au lieu de
> renvoyer un refus. Une page pro qui s'affiche sans données sous un autre rôle n'est pas
> forcément un bug de données : c'est peut-être le 403 de l'API qui ne remonte pas à l'écran.
> À signaler comme anomalie d'affichage, pas comme donnée manquante.)

---

## 2. Choix du tag de run

`E2E-JJMM-N`, ex. `E2E-2209-1`. Tout objet créé le porte. Voir `00-protocole-agent.md` §4.
Un nouveau tag à chaque campagne, même pour un simple rejeu : sinon on ne sait plus quelle
donnée vient de quelle exécution.

---

## 3. Ordre d'exécution

Les scénarios ne sont pas indépendants : chacun consomme ce que le précédent a créé. L'ordre
n'est donc pas négociable à l'intérieur d'une chaîne, mais les chaînes A et C peuvent tourner
en parallèle (données disjointes).

```
CHAÎNE A — Module professionnel (le cœur, la seule qui mène au diplôme)
  S01 Socle : filière, classe, UE, ECUE, semestre
  S02 Ouverture : sessions, enseignants, emploi du temps, signataires
  S03 Peuplement : étudiants, inscriptions en lot
  S04 Vie du semestre : séances, présences, justificatifs
  S05 Notes session 1, conduite, recalcul
  S06 Rattrapages session 2
  S07 Bulletins : génération, contrôle des calculs, PDF, clôture
  S08 DIPLÔME : éligibilité, octroi, PDF, authenticité, révocation
  S09 Attestation de réussite
  S10 Vues aval : étudiant, parent

CHAÎNE B — Volet financier (s'accroche à A après S03)
  S11 Barème de la classe et encaissement
  S12 Prospection : commercial, provenance, commission
  S13 Rémunération du formateur : séances, tarifs, bulletin de paie
  S14 Tunnel d'inscription publique et paiement en ligne (indépendant)

CHAÎNE C — Parcours académique classique (indépendant de A)
  S15 Socle : cycle BTS, filière, classe, matières, année, inscription
  S16 Présences, moyennes, bulletins, relevé de notes
```

> Le détail de chaque scénario est dans `scenarios/`. Les chaînes B et C sont complétées
> ci-dessous une fois leurs fiches écrites.

**Règle d'arrêt** : un échec bloquant sur S01→S03 condamne toute la chaîne A. On ne lance pas
les scénarios aval « pour voir » — ils échoueront tous pour la même cause et on paiera dix fois
le même diagnostic. On corrige, on redémarre l'API, on rejoue le scénario cassé, puis on
reprend la file.

---

## 4. Prompt de lancement d'un scénario

Un agent = un scénario. Modèle **Sonnet 5**. Le prompt reste court : le protocole et le
scénario sont dans des fichiers que l'agent lit lui-même, on ne les recopie pas dans le prompt.

```
Tu joues un scénario de test E2E sur l'application EcoleDigitale en local, avec le volet
navigateur intégré.

1. Lis d'abord, dans cet ordre :
   - D:\EcoleDigitaleV2-main\docs\testing\e2e-computer-use\00-protocole-agent.md
     (contrat d'exécution : discipline de budget, classement des anomalies, format de sortie —
     applique-le à la lettre)
   - D:\EcoleDigitaleV2-main\docs\testing\e2e-computer-use\scenarios\<FICHIER>.md
     (le scénario que tu joues)
   - D:\EcoleDigitaleV2-main\docs\testing\e2e-computer-use\rapports\registre-<TAG>.md
     (les identifiants produits par les scénarios précédents — tu y prends ce dont tu as besoin,
     tu n'inventes aucun UUID)

2. Tag de run : <TAG>.  Compte à utiliser : <email> / <mot de passe>.

3. Joue le scénario, puis rends ton rapport au format imposé par le protocole. Rien d'autre :
   pas de récit, pas de résumé de ce que tu as lu.

Rappels non négociables : tu ne modifies aucun fichier source, tu ne touches pas à la base, tu
ne corriges rien. Sur anomalie bloquante, tu t'arrêtes et tu rends ton rapport immédiatement.
```

Ce qui fait dériver le budget, par ordre de gravité : les captures d'écran en rafale, les
clics un par un au lieu de `browser_batch`, et la relecture de pages déjà validées. Le §3 du
protocole existe pour ça — si un rapport revient avec 40 captures, le problème est le prompt,
pas l'agent.

---

## 5. Réaction à un rapport

| Ce qui revient | Ce qu'on fait |
|---|---|
| `OK` | On classe, on enchaîne le scénario suivant. |
| `OK_AVEC_RESERVES` | On enchaîne. Les majeures partent en P2 du rapport final, on ne s'arrête pas pour elles. |
| `ECHEC_BLOQUANT` | On lit la fiche. Si elle contient le couple requête/réponse, on diagnostique dans le code sans rejouer. On corrige, on redémarre l'API si le correctif est serveur, on rejoue **ce seul scénario**, puis on reprend la file. |
| `budget_atteint: true` | Le scénario est trop gros : on le coupe en deux fiches plutôt que de relancer le même agent avec plus de marge. |

Après chaque scénario, l'orchestrateur reporte lui-même les identifiants créés dans le registre
— il ne délègue pas cette écriture, c'est la mémoire de la campagne.

---

## 6. Fin de campagne

1. Rassembler les rapports de `rapports/` en un document unique selon `modeles/rapport-final.md`.
2. Prioriser : gravité × nombre de scénarios aval condamnés.
3. Écrire la section « ce qui n'a pas été testé » avant la section « plan d'implémentation » —
   dans cet ordre, parce qu'on est plus honnête sur ses trous avant d'avoir décrit ses succès.
4. Nettoyer les données du run (ordre inverse de création), ou décider explicitement de les
   garder et l'écrire.
