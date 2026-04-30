'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-emerald-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                Mes Enfants
              </h1>
              <p className="text-gray-600 mt-2">
                Liste de tous vos enfants liés à votre compte
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Children List */}
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

