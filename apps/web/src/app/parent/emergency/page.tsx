'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
// import { EmergencyContacts } from '../components/emergency/EmergencyContacts';
// import { PickupAuthorizationComponent } from '../components/emergency/PickupAuthorization';
// import { RelationshipTypesComponent } from '../components/emergency/RelationshipTypes';
// import { DataAccessComponent } from '../components/emergency/DataAccess';

export default function ParentEmergencyPage() {
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
  const isParent = Array.isArray(roles) && roles.some((r: string) => ['parent', 'Parent'].includes(r));

  if (!isParent) {
    redirect('/');
  }

  // Page désactivée - mise en commentaire
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="font-bold text-gray-900 mb-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">Contacts d'urgence</h1>
        <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
          Cette page est temporairement désactivée.
        </p>
      </div>
    </div>
  );

  /* Code original mis en commentaire
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="font-bold text-gray-900 mb-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">Contacts d'urgence</h1>
        <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
          Gérez vos contacts d'urgence et les autorisations de récupération pour vos enfants
        </p>
      </div>

      <div className="space-y-6">
        <EmergencyContacts />
        <PickupAuthorizationComponent />
        <RelationshipTypesComponent />
        <DataAccessComponent />
      </div>
    </div>
  );
  */
}

