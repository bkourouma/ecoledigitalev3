# Accessibilité des écrans `/v2` (WCAG 2.1 AA)

Ce document décrit la méthode d'audit automatisé, sa couverture, ses limites, puis la checklist **manuelle** (clavier et lecteur
d'écran) qu'une personne doit dérouler : l'automatisation ne remplace pas ce contrôle.

## Méthode

| Outil | Rôle | Commande |
| --- | --- | --- |
| `axe-core` (devDependency de `apps/web`) | Moteur de règles WCAG 2.0/2.1 A + AA + bonnes pratiques | utilisé par `src/platform/test/axe.ts` |
| `src/platform/test/axe.ts` | `auditA11y`, `expectNoBlockingViolations` : **0 violation `serious`/`critical`** exigée | |
| `src/platform/ui/shared.a11y.test.tsx` | Composants partagés (tableau, champs, dialogues, assistant, états, coquille, menu) + garde-fou du harnais | `pnpm test` |
| `src/app/v2/screens.a11y.test.tsx` | Écrans représentatifs : kanban admissions (+ dialogue de déplacement), grille de saisie de notes, pages publiques (`/v2/apply`, suivi, `/v2/verify`) | `pnpm test` |
| `src/platform/test/contrast.test.ts` | Contraste (>= 4,5:1) calculé sur les jetons de couleur de `globals.css` (`:root` et `.dark`) | `pnpm test` |
| `src/platform/test/motion-reflow.test.ts` | `prefers-reduced-motion`, reflow 320 px (pas de largeur minimale > 320 px hors tableau défilant), `lang="fr"`, zoom non bloqué | `pnpm test` |
| Balayage transversal | Rejoue **tous** les tests d'écran existants et passe axe sur le DOM de chacun (états réels, données de test des modules) ; une violation fait échouer le test | `pnpm --filter @ecoledigitale/web test:a11y` |

Le balayage transversal repose sur `A11Y_AUDIT=strict` (voir `vitest.a11y.config.ts` et le hook `afterEach` de
`src/platform/test/setup.ts`). Sans cette variable, le hook est inerte. `A11Y_AUDIT=<fichier.jsonl>` consigne les violations au lieu
de faire échouer ; `A11Y_AUDIT_STATS=<fichier>` compte les DOM audités ; `A11Y_VERBOSE=1` affiche les violations mineures
(`moderate`/`minor`) des tests dédiés.

Règles axe désactivées (et pourquoi) : `color-contrast` (jsdom n'a pas de CSS : remplacée par `contrast.test.ts`), `region`,
`landmark-one-main`, `page-has-heading-one`, `bypass` (règles de page entière, fausses alertes sur un écran isolé ; la coquille
est couverte avec `Shell` qui porte lien d'évitement, `<main>`, `<nav>` nommée), `scrollable-region-focusable` (nécessite une mise
en page ; vérifié statiquement pour `DataTable`).

## Résultats de l'audit

Voir la section « Journal » plus bas pour les chiffres de la dernière exécution. Violations trouvées puis corrigées à la source :

| Règle axe | Gravité | Où | Correction |
| --- | --- | --- | --- |
| `label` | critical | champs `<input type="file" class="sr-only">` des pièces de dossier (admissions `DossierDocuments`, suivi public `PublicTrackScreen`) | nom accessible (`aria-label` identique au bouton visible qui le pilote) + `tabIndex={-1}` |
| `listitem` | serious | fil de messages (`ThreadScreen`) : `role="log"` posé sur le `<ol>` retire la sémantique de liste | région `div role="log"` contenant le `<ol>` |
| `listitem` | serious | diagnostics de règles (`RuleEditor`, `RuleVersionScreen`) : même cause avec `role="alert"` sur un `<ul>` | `div role="alert"` contenant le `<ul>` |
| `definition-list` | serious | vue famille des affectations (`stateassign/FamilyScreen`), bulletin famille (`_family/FamilyReportCards`) : `<p>`/lien directement dans un `<dl>` | éléments sortis du `<dl>` |
| `aria-required-children` | critical | `SelectAsync` : liste `role="listbox"` vide quand il n'y a aucun résultat / une erreur | sans option, le message est un bloc simple (le `listbox` n'existe que s'il contient des options) |
| contraste 1.4.3 | (hors axe) | jeton `--destructive` : 3,6:1 (texte clair sur bouton rouge) et 3,7:1 (texte d'erreur sur fond sombre) | `--destructive: 0 84% 68%` + `--destructive-foreground: 220 13% 10%` : >= 4,5:1 dans les deux usages (`:root` et `.dark`) |
| cibles tactiles (bonne pratique, 2.5.5) | (hors axe) | fermeture des dialogues (36 px), « Réessayer » (36 px), effacement de `SelectAsync` (32 px) | 44 px / 40 px sur mobile, taille compacte conservée dès `sm` |

Points déjà conformes avant l'audit (non modifiés) : `lang="fr"` sur `<html>`, lien d'évitement et `<main id="v2-main">` dans la
coquille, tiroir mobile (`aria-expanded`, `aria-controls`, Échap, retour du focus), dialogues Radix (focus piégé et rendu,
titre et description reliés), `FormField` (libellé, aide, erreur `role="alert"`, `aria-invalid`, `aria-required`), `DataTable`
(légende, `aria-sort`, région défilante focalisable), `LoadingBlock`/`Notice` (`role="status"`/`alert`), `prefers-reduced-motion`
global dans `globals.css`.

## Limites : ce que axe ne détecte pas

axe ne couvre qu'environ un tiers des critères WCAG. Il ne vérifie pas :

- la **qualité** des libellés, des alternatives textuelles et des messages d'erreur (présents != compréhensibles) ;
- l'**ordre de focus** logique, le piège de focus réel, le retour du focus à la fermeture, les raccourcis clavier (kanban : déplacement
  d'une carte, grille de notes : navigation entre cellules, appel : saisie rapide) ;
- les **annonces** `aria-live` réellement vocalisées (présence du rôle != lecture par NVDA/VoiceOver) ;
- le **contraste réel** (jsdom sans CSS) : seuls les jetons globaux sont contrôlés ; les couleurs en dur (`bg-emerald-50`,
  `text-amber-900`, thème de marque `--brand-*` d'un établissement) et les états survol/focus/désactivé ne le sont pas ;
- le **reflow 320 px**, l'espacement du texte (1.4.12), le zoom 200 %, l'orientation, la taille réelle des cibles : jsdom n'a pas de
  mise en page (contrôles statiques seulement) ;
- les **animations** : seule l'existence de la règle `prefers-reduced-motion` est testée, pas le rendu ;
- les médias (PDF générés : balisage, ordre de lecture ; QR codes) ; les composants tiers (FullCalendar, LiveKit, graphiques) ;
- la **couverture** : un écran sans test RTL n'est pas audité, et les états non rendus par les tests (erreurs rares, dialogues
  secondaires) non plus.

## Checklist manuelle (à faire par une personne)

Navigateurs : Chrome + NVDA (Windows), Safari + VoiceOver (iOS/macOS), au moins un smartphone réel. Écrans prioritaires : connexion,
coquille et menu, liste + filtres + pagination, formulaire avec erreurs, dialogue de confirmation, kanban admissions, saisie de notes,
appel (y compris hors ligne), bulletins, portails parent/élève/enseignant, `/v2/apply`, `/v2/verify`.

Clavier seul (souris débranchée) :
- [ ] Tab/Maj+Tab : ordre logique, aucun piège, focus toujours visible (y compris sur fond sombre et sur les cartes du kanban) ;
- [ ] premier Tab : le lien « Aller au contenu » apparaît et déplace bien le focus dans `<main>` ;
- [ ] dialogues : le focus entre dans le dialogue, reste piégé, Échap ferme, le focus revient au déclencheur ;
- [ ] menu mobile : ouverture/fermeture, Échap, focus rendu au bouton ;
- [ ] tableaux : région défilante atteignable, tri au clavier, pagination ; liste déroulante `SelectAsync` (flèches, Entrée, Échap) ;
- [ ] kanban : déplacer un dossier sans glisser-déposer ; grille de notes : flèches/Tab/Entrée, valeurs spéciales (absent, dispensé) ;
- [ ] assistants (`Wizard`) : le titre d'étape reçoit le focus, erreurs de validation atteignables.

Lecteur d'écran :
- [ ] titre de page unique et pertinent à chaque navigation (`<title>`, `h1`) ; hiérarchie des titres sans saut ;
- [ ] champs : libellé, aide, « obligatoire », message d'erreur lus à la validation (une seule annonce, pas de doublon) ;
- [ ] annonces : chargement, succès, erreur de l'API, nouveau message, sauvegarde hors ligne/synchronisation de l'appel ;
- [ ] tableaux : en-têtes de colonne/ligne lus, tri annoncé (`aria-sort`) ; badges d'état lus en texte (jamais la couleur seule) ;
- [ ] pages publiques (`/v2/apply`, `/v2/verify`) : champ leurre invisible aux personnes, consentement lu, résultat de vérification annoncé ;
- [ ] bulletins/PDF : balisage et ordre de lecture du document téléchargé.

Visuel et mobile :
- [ ] reflow à 320 px de large et zoom 200 % : aucun défilement horizontal de la page (hors tableaux), aucune perte de contenu ;
- [ ] espacement du texte (1.4.12) augmenté : pas de troncature bloquante ;
- [ ] contraste réel (extension WebAIM/axe DevTools) sur les couleurs de marque d'établissement et les états survol/désactivé ;
- [ ] cibles tactiles >= 44 px sur téléphone, écarts suffisants ;
- [ ] `prefers-reduced-motion` activé dans le système : plus d'animation parasite (spinners, tiroirs, transitions) ;
- [ ] orientation portrait et paysage ; mode sombre et clair (le thème par défaut est sombre).

## Ajouter un écran au contrôle

Tout nouvel écran avec un test RTL est audité automatiquement par `pnpm test:a11y` (le DOM laissé à la fin de chaque test est
analysé : terminer le test sur l'état à contrôler). Pour une assertion ciblée dans un test :

```ts
import { expectNoBlockingViolations } from "@/platform/test/axe";
await expectNoBlockingViolations(container);
```

## Journal

Dernière exécution complète (2026-10-02) :

- balayage transversal `test:a11y` : 127 fichiers de test, 1 613 tests, **1 127 DOM audités** (états d'écran réels) sur 83 fichiers de test
  dont 58 fichiers de test d'écrans `src/app/v2/**` (une cinquantaine de modules : admissions, évaluations, appel, bulletins,
  parent/élève/enseignant, finance, paie, rôles, messages, pages publiques…) ;
- première passe (avant corrections) : 16 DOM en violation `serious`/`critical`, soit 6 défauts distincts (+ 1 découvert par la seconde passe) ;
- après corrections : **0 violation serious/critical** ; `pnpm test` (tests existants) vert.
