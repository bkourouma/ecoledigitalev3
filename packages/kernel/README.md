# @ecoledigitale/kernel

Noyau **pur** de la plateforme v2 : aucune I/O, aucune dépendance d'exécution
(seulement `node:crypto` et `node:async_hooks`). Il est importé par tous les
modules ; il n'importe aucun module.

```ts
import { createRequestContext, runWithContext, Money, ok, err, NotFoundError } from "@ecoledigitale/kernel";
```

## Contenu

| Fichier | API principale |
|---|---|
| `context.ts` | `RequestContext`, `createRequestContext`, `createSystemContext`, `deriveContext`, `runWithContext`, `getRequestContext`, `requireRequestContext` |
| `errors.ts` | `NotFoundError`, `ForbiddenError`, `ConflictError`, `ValidationError`, `UnauthorizedError`, `InternalError`, `toAppError`, `toErrorBody`, `httpStatusFor`, `ErrorCode` |
| `result.ts` | `Result<T,E>`, `ok`, `err`, `map`, `mapErr`, `andThen`, `match`, `unwrap`, `unwrapOr`, `tryCatch`, `all` |
| `money.ts` | `Money`, `RoundingMode`, `divideRounded`, `MoneyError` |
| `clock.ts` | `Clock`, `systemClock`, `ManualClock`, `abidjanDate`, `startOfDayAbidjan`, `endOfDayAbidjan`, `zonedParts` |
| `id.ts` | `newId()` (UUID v7), `newUuidV4`, `isUuid`, `parseUuid`, `uuidV7Timestamp` |
| `events.ts` | `DomainEvent`, `createDomainEvent`, `EventBus`, `InMemoryEventBus`, `OutboxWriter` (port) |
| `logger.ts` | `Logger` (compatible pino), `noopLogger`, `consoleLogger` |

## Invariants

**Contexte.** `tenantId` est obligatoire et validé comme UUID ; il n'existe pas de
contexte « sans tenant ». `user` et `superAdmin` exigent un `userId`, `system`
n'en a pas. Le contexte est gelé ; `deriveContext` ne peut changer ni le tenant
ni l'acteur. La propagation utilise `AsyncLocalStorage.run` (jamais `enterWith`) :
pas de fuite d'une requête à l'autre.

**Erreurs.** Chaque erreur a un `kind` (catégorie → statut HTTP) et un `code`
machine **stable** (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION_FAILED`,
`UNAUTHORIZED`, `INTERNAL`, ou un code de module comme `finance.invoice_already_paid`).
Statuts : 404 / 403 / 409 / **400** (validation, aligné sur les clients historiques) /
401 / 500. `toAppError` n'expose jamais le message d'une erreur inconnue.

**Result.** Pour les échecs *attendus* d'un use case. Les exceptions restent pour
l'inattendu.

**Money.** Montants entiers en unités mineures (XOF : le franc, exposant 0).
Tout résultat doit rester un entier sûr JS, sinon `MONEY_OVERFLOW` — jamais de
dépassement silencieux. Produits intermédiaires en `bigint`. Arrondis toujours
explicites (`UP DOWN CEILING FLOOR HALF_UP HALF_DOWN HALF_EVEN`).
`allocate` / `split` répartissent **sans perte** (méthode du plus fort reste) :
la somme des parts égale exactement le montant, y compris pour les négatifs.

**Temps.** Tout est stocké en UTC ; `Africa/Abidjan` sert à l'affichage et au
découpage en jours calendaires (via `Intl`, pas de décalage codé en dur). Les
modules reçoivent un `Clock`, ils n'appellent pas `Date.now()`.

**Identifiants.** UUID v7 monotones dans le processus (compteur 12 bits,
résistant au recul d'horloge).

**Événements.** `DomainEvent` est sérialisable JSON. `InMemoryEventBus` est
séquentiel et déterministe, **non durable** : ce qui doit survivre à un crash
passe par `OutboxWriter` (implémentation Postgres dans `@ecoledigitale/database`),
écrit dans la transaction de la donnée.

## Tests

```bash
pnpm --filter @ecoledigitale/kernel test
pnpm --filter @ecoledigitale/kernel type-check
```
