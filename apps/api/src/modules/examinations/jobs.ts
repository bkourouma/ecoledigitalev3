/**
 * Jobs planifiés du module `examinations` pour `apps/worker`. Aucun job : les exports, imports et calculs sont déclenchés par des
 * actions explicites (jamais en tâche de fond), et rien n'est purgé — la rétention des listes, notes et résultats est illimitée
 * (Q-E16). Le tableau vide est valide ; il est conservé pour que le worker découvre le module.
 */
export default [];
