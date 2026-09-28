'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { ChildrenList } from '../components/ChildrenList';
import { useParentChildren } from '@/lib/hooks/use-parent-children';

export default function ParentChildrenPage() {
  const { data: session, status } = useSession();

  // Redirect if not authenticated
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

  // Check if user has parent role
  const roles = (session as any)?.roles ?? [];
  const isParent = Array.isArray(roles) && roles.includes('parent');

  if (!isParent) {
    redirect('/');
  }

  // Fetch children data
  const { data, isLoading, error } = useParentChildren();
  
  // Deduplicate children by id to prevent duplicate key errors
  const children = React.useMemo(() => {
    const childrenList = data?.data?.children || [];
    const seenIds = new Set<string>();
    const uniqueChildren: typeof childrenList = [];
    
    childrenList.forEach((child: any, index: number) => {
      if (!seenIds.has(child.id)) {
        seenIds.add(child.id);
        uniqueChildren.push(child);
      } else {
        console.warn(`[ParentChildrenPage] Duplicate child ID found at index ${index}:`, child.id);
      }
    });
    
    return uniqueChildren;
  }, [data?.data?.children]);

  const activeCount = children.filter((c: any) => c.status === 'active').length;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-emerald-500/15 p-3">
              <Users className="h-7 w-7 text-emerald-400" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-bold text-foreground whitespace-nowrap text-2xl leading-tight md:text-3xl">Mes Enfants</h1>
              <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                Suivez la scolarité de vos enfants en un coup d'œil
              </p>
            </div>
          </div>

          {!isLoading && !error && children.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
              <StatCard
                icon={<Users className="h-5 w-5" />}
                label="Enfants actifs"
                value={`${activeCount}/${children.length}`}
                tone="emerald"
              />
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ChildrenList
          children={children}
          isLoading={isLoading}
          error={error as Error | null}
        />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'emerald' | 'blue' | 'amber';
}) {
  const tones = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  } as const;

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className={`rounded-lg border p-2 ${tones[tone]}`}>{icon}</div>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold text-foreground">{value}</div>
      </div>
    </div>
  );
}

