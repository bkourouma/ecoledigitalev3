'use client';

import React from 'react';
// import { ParentProfileComponent } from '@/app/parent/components/settings/ParentProfile';
// import { ContactInformationComponent } from '@/app/parent/components/settings/ContactInformation';
// import { NotificationPreferencesComponent } from '@/app/parent/components/settings/NotificationPreferences';
// import { RelationshipManagementComponent } from '@/app/parent/components/settings/RelationshipManagement';
// import { ChangePasswordComponent } from '@/app/parent/components/settings/ChangePassword';

export default function ParentSettingsPage() {
  // Page désactivée - mise en commentaire
  return (
    <div className="container mx-auto py-4 sm:py-6 lg:py-8 px-4 sm:px-6 lg:px-8 max-w-4xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Paramètres</h1>
        <p className="text-gray-600 mt-2 text-sm sm:text-base">
          Cette page est temporairement désactivée.
        </p>
      </div>
    </div>
  );

  /* Code original mis en commentaire
  return (
    <div className="container mx-auto py-4 sm:py-6 lg:py-8 px-4 sm:px-6 lg:px-8 max-w-4xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Paramètres</h1>
        <p className="text-gray-600 mt-2 text-sm sm:text-base">
          Gérez vos informations personnelles et vos préférences
        </p>
      </div>

      <div className="space-y-4 sm:space-y-6" role="main" aria-label="Paramètres du compte parent">
        <ParentProfileComponent />
        <ContactInformationComponent />
        <NotificationPreferencesComponent />
        <RelationshipManagementComponent />
        <ChangePasswordComponent />
      </div>
    </div>
  );
  */
}

