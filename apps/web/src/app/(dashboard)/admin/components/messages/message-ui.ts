/**
 * Fragments de style partagés par les écrans « Messages » de l'administration.
 */

/**
 * Le `Textarea` partagé (`@/components/ui/textarea`) est stylé pour un fond
 * sombre. Ces classes le ramènent sur la palette claire des cartes de cette
 * page, sans toucher au composant commun utilisé ailleurs dans l'application.
 */
export const LIGHT_TEXTAREA =
  'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 ' +
  'focus-visible:ring-emerald-500 focus-visible:ring-offset-0';

/** Libellés et couleurs des niveaux de priorité, partagés par les formulaires. */
export const PRIORITY_OPTIONS: Array<{
  value: 'low' | 'normal' | 'high' | 'urgent';
  label: string;
  className: string;
}> = [
  { value: 'low', label: 'Faible', className: 'bg-slate-100 text-slate-700' },
  { value: 'normal', label: 'Normale', className: 'bg-emerald-100 text-emerald-800' },
  { value: 'high', label: 'Élevée', className: 'bg-amber-100 text-amber-800' },
  { value: 'urgent', label: 'Urgente', className: 'bg-red-100 text-red-800' },
];

export function priorityBadgeClass(level?: string | null): string {
  return PRIORITY_OPTIONS.find((option) => option.value === level)?.className ?? PRIORITY_OPTIONS[1].className;
}
