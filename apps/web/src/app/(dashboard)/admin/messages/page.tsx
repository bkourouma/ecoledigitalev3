'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MessageSquare, Users, Megaphone } from 'lucide-react';
import { AdminParentConversations } from '../components/messages/AdminParentConversations';
import { AdminTeacherMessages } from '../components/messages/AdminTeacherMessages';
import { AdminStudentAnnouncements } from '../components/messages/AdminStudentAnnouncements';
import { useAllTeachers } from '@/lib/hooks/use-teachers';

export default function AdminMessagesPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<'parent-conversations' | 'teacher-messages' | 'student-announcements'>('parent-conversations');

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

  // Check if user has admin role
  const roles = (session as any)?.roles ?? [];
  const isAdmin = Array.isArray(roles) && roles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r));

  if (!isAdmin) {
    redirect('/');
  }

  // Fetch all teachers for message sending
  const { data: teachersData, isLoading: isLoadingTeachers, error: teachersError } = useAllTeachers();
  
  const teachers = React.useMemo(() => {
    if (!teachersData?.data) {
      console.log('No teachers data available');
      return [];
    }
    
    console.log('Total teachers fetched:', teachersData.data.length);
    
    // Filter teachers that have a userId (required for messaging)
    const withUserId = teachersData.data.filter(t => {
      const hasUserId = !!t.userId;
      if (!hasUserId) {
        console.log('Teacher without userId:', { id: t.id, name: `${t.firstName} ${t.lastName}`, email: t.email });
      }
      return hasUserId;
    });
    
    console.log('Teachers with userId:', withUserId.length);
    console.log('Sample teachers:', withUserId.slice(0, 5).map(t => ({ 
      id: t.userId, 
      name: `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.email || 'Enseignant sans nom',
      email: t.email 
    })));
    
    // Map to the format expected by AdminTeacherMessages
    const mappedTeachers = withUserId.map(t => ({ 
      id: t.userId!, 
      name: `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.email || 'Enseignant sans nom'
    }));
    
    console.log('Final teachers array length:', mappedTeachers.length);
    
    return mappedTeachers;
  }, [teachersData]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Messages</h1>
              <p className="text-sm sm:text-base text-emerald-100">
                Gérez les messages et conversations de l'établissement
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'parent-conversations' | 'teacher-messages' | 'student-announcements')} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 gap-2">
            <TabsTrigger value="parent-conversations" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Messages des Parents
            </TabsTrigger>
            <TabsTrigger value="teacher-messages" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Messages des Enseignants
            </TabsTrigger>
            <TabsTrigger value="student-announcements" className="flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Annonces aux Étudiants
            </TabsTrigger>
          </TabsList>

          <TabsContent value="parent-conversations" className="space-y-6">
            <AdminParentConversations />
          </TabsContent>

          <TabsContent value="teacher-messages" className="space-y-6">
            <AdminTeacherMessages 
              teachers={teachers} 
              isLoading={isLoadingTeachers}
              error={teachersError as Error | null}
            />
          </TabsContent>

          <TabsContent value="student-announcements" className="space-y-6">
            <AdminStudentAnnouncements />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
