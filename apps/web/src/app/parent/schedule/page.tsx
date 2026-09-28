'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { CalendarClock, Users } from 'lucide-react';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useParentChildren } from '@/lib/hooks/use-parent-children';
import { ChildEmploiTemps } from '../components/ChildEmploiTemps';

/**
 * Emploi du temps de mon enfant — espace parent.
 *
 * Même grille et mêmes filtres que « Mon emploi du temps » côté étudiant,
 * précédés du choix de l'enfant quand le parent en suit plusieurs.
 */
export default function ParentSchedulePage() {
  const { data: session, status } = useSession();
  const [childId, setChildId] = useState('');

  const { data: childrenData, isLoading: isLoadingChildren } = useParentChildren();
  const children = childrenData?.data?.children ?? [];

  const childOptions = useMemo(
    () => children.map((c) => ({ value: c.id, label: c.name })),
    [children]
  );

  // Un seul enfant : le choix n'apporte rien, on l'affiche directement.
  useEffect(() => {
    if (!childId && childOptions.length === 1) {
      setChildId(childOptions[0].value);
    }
  }, [childId, childOptions]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  const roles = (session as any)?.roles ?? [];
  const isParent = Array.isArray(roles) && roles.includes('parent');

  if (!isParent) {
    redirect('/');
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
          <CalendarClock className="h-7 w-7 text-indigo-500" />
          Emploi du temps de mon enfant
        </h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Les cours de la semaine, d'après le planning configuré par l'administration.
        </p>
      </div>

      {/* Le sélecteur d'enfant n'a de sens qu'à partir de deux enfants. */}
      {childOptions.length > 1 && (
        <div className="sm:max-w-md">
          <label className="text-sm font-medium">Enfant</label>
          <div className="mt-1.5">
            <SearchableSelect
              value={childId}
              onChange={setChildId}
              icon={<Users className="h-4 w-4 text-gray-400" />}
              placeholder="Choisir un enfant"
              searchPlaceholder="Rechercher un enfant…"
              options={childOptions}
            />
          </div>
        </div>
      )}

      <ChildEmploiTemps
        childId={childId || null}
        noChildMessage={
          isLoadingChildren
            ? 'Chargement de vos enfants…'
            : childOptions.length === 0
              ? "Aucun enfant n'est rattaché à votre compte."
              : 'Sélectionnez un enfant ci-dessus pour afficher son emploi du temps.'
        }
      />
    </div>
  );
}
