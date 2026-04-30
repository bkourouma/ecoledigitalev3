# Quickstart: Trainer Space (Espace Formateurs)

**Date**: 2025-11-20  
**Feature**: 019-espace-formateurs-imhotep

## Overview

This guide helps developers quickly understand and start working with the trainer space feature. It covers key concepts, API endpoints, authentication, and common usage patterns for trainer-specific functionality.

## Key Concepts

### Trainer Authentication

- Trainers must be authenticated via existing authentication system
- Trainer identity verified by checking `formateurs.user_id = users.id`
- Trainer must be active (`formateurs.actif = true`)
- All endpoints require `formateurAuthMiddleware`

### Session Access Control

- Trainers can only access sessions they are assigned to
- Assignment verified via `session_formateurs` table
- Attempting to access non-assigned session returns 403 Forbidden

### Attendance Tracking

- Attendance can only be marked for sessions with status 'en_cours' or 'terminee'
- One attendance record per enrollment per session
- Attendance marked by trainer is logged with timestamp and trainer ID
- Attendance statistics calculated automatically

### Course Materials

- Materials can be associated with training program (all sessions) or specific sessions
- File uploads: max 100MB for materials, 5MB for photos, 10MB for CVs
- Supported formats: PDF, PPT, PPTX, DOC, DOCX, ZIP, MP4, AVI for materials
- Download tracking for statistics

## API Endpoints Quick Reference

### Dashboard

```typescript
// Get dashboard overview
GET /api/v1/formateur/dashboard
```

### Schedule

```typescript
// Get schedule with sessions and unavailability
GET /api/v1/formateur/planning?annee=2024&mois=11

// Get unavailability periods
GET /api/v1/formateur/disponibilites

// Create unavailability period
POST /api/v1/formateur/disponibilites
Body: { date_debut: "2024-12-01", date_fin: "2024-12-05", raison: "Vacances" }

// Delete unavailability period
DELETE /api/v1/formateur/disponibilites/:id
```

### Sessions

```typescript
// List assigned sessions
GET /api/v1/formateur/sessions?statuts=ouverte,en_cours&page=1&limit=10

// Get session details
GET /api/v1/formateur/sessions/:id

// Get enrolled learners
GET /api/v1/formateur/sessions/:id/inscrits
```

### Attendance

```typescript
// Mark attendance
PATCH /api/v1/formateur/sessions/:id/inscrits/:inscritId/presence
Body: { present: true }

// Export attendance list
GET /api/v1/formateur/sessions/:id/attendance/export?format=csv
```

### Course Materials

```typescript
// List materials
GET /api/v1/formateur/supports?formation_id=xxx&page=1

// Upload material
POST /api/v1/formateur/supports/upload
Body: FormData { file, titre, description, session_ids[], visible_apprenants }

// Get material details
GET /api/v1/formateur/supports/:id

// Update material metadata
PUT /api/v1/formateur/supports/:id
Body: { titre, description, visible_apprenants, session_ids[] }

// Delete material
DELETE /api/v1/formateur/supports/:id

// Get download statistics
GET /api/v1/formateur/supports/:id/statistiques
```

### Session Notes

```typescript
// Add/update session notes
POST /api/v1/formateur/sessions/:id/notes
Body: { notes: "Session went well, learners engaged..." }
```

### Messaging

```typescript
// Send group message
POST /api/v1/formateur/sessions/:id/message-groupe
Body: {
  sujet: "Rappel session",
  message: "La session commence demain à 9h...",
  type: "email", // or "sms" or "both"
  destinataires: "tous" // or "presents" or "absents"
}
```

### Profile

```typescript
// Get profile
GET /api/v1/formateur/profil

// Update profile
PUT /api/v1/formateur/profil
Body: { bio, specialites[], linkedin_url, photo (base64) }

// Upload CV
POST /api/v1/formateur/profil/cv
Body: FormData { file }
```

### Notifications

```typescript
// Get notifications
GET /api/v1/formateur/notifications?non_lues=true&page=1

// Mark as read
PATCH /api/v1/formateur/notifications/:id/lire
```

## Common Usage Patterns

### 1. Loading Trainer Dashboard

```typescript
// Using the provided hook
import { useFormateurDashboard } from "@/lib/hooks/use-formateur-dashboard";

function Dashboard() {
  const { data, isLoading, error } = useFormateurDashboard();
  
  if (isLoading) return <Loading />;
  if (error) return <Error message={error.message} />;
  
  // Display statistics
  console.log('Upcoming sessions:', data.data.stats.sessions_a_venir);
  console.log('Total learners:', data.data.stats.total_apprenants);
  
  return (
    <div>
      <StatsCards stats={data.data.stats} />
      {/* ... */}
    </div>
  );
}

// Or using TanStack Query directly
import { useQuery } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

const { data: dashboard } = useQuery({
  queryKey: ['formateur', 'dashboard'],
  queryFn: async () => {
    const response = await fetch('/api/v1/formateur/dashboard', {
      headers: createApiHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch dashboard');
    return response.json();
  }
});
```

### 2. Loading Trainer Schedule

```typescript
// Using the provided hook
import { useFormateurSchedule } from "@/lib/hooks/use-formateur-schedule";

function Planning() {
  const { data: schedule, isLoading } = useFormateurSchedule({
    annee: 2024,
    mois: 11,
  });
  
  if (isLoading) return <Loading />;
  
  // Use with FullCalendar
  const events = [
    ...schedule.data.sessions.map(s => ({
      id: s.id,
      title: s.title,
      start: s.start,
      end: s.end,
      backgroundColor: s.backgroundColor || '#3B82F6',
      extendedProps: s.extendedProps
    })),
    ...schedule.data.indisponibilites.map(i => ({
      id: `indispo-${i.id}`,
      title: `Indisponible: ${i.raison || ''}`,
      start: i.date_debut,
      end: i.date_fin,
      backgroundColor: '#9CA3AF',
      extendedProps: { type: 'indisponibilite' }
    }))
  ];
  
  return <FullCalendar events={events} />;
}

// Or using TanStack Query directly
import { useQuery } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";

const { data: schedule } = useQuery({
  queryKey: ['formateur', 'planning', year, month],
  queryFn: async () => {
    const queryString = buildQueryString({ annee: year, mois: month });
    const response = await fetch(`/api/v1/formateur/planning${queryString}`, {
      headers: createApiHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch schedule');
    return response.json();
  }
});
```

### 3. Marking Attendance

```typescript
// Using the provided hook
import { useMarkAttendance } from "@/lib/hooks/use-formateur-attendance";

function AttendanceList({ sessionId, inscrits }) {
  const markAttendance = useMarkAttendance();
  
  const handleMark = (inscriptionId: string, present: boolean) => {
    markAttendance.mutate({
      sessionId,
      inscriptionId,
      present,
    });
  };
  
  return (
    <div>
      {inscrits.map(inscrit => (
        <div key={inscrit.id}>
          <input
            type="checkbox"
            checked={inscrit.presence === true}
            onChange={(e) => handleMark(inscrit.inscription_id, e.target.checked)}
            disabled={markAttendance.isPending}
          />
        </div>
      ))}
    </div>
  );
}

// Or using TanStack Query mutation directly
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

const queryClient = useQueryClient();

const markAttendance = useMutation({
  mutationFn: async ({ sessionId, inscriptionId, present }: {
    sessionId: string;
    inscriptionId: string;
    present: boolean;
  }) => {
    const response = await fetch(
      `/api/v1/formateur/sessions/${sessionId}/inscrits/${inscriptionId}/presence`,
      {
        method: 'PATCH',
        headers: {
          ...createApiHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ present }),
      }
    );
    if (!response.ok) throw new Error('Failed to mark attendance');
    return response.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['formateur', 'sessions'] });
  },
});
```

### 4. Uploading Course Material

```typescript
// Using the provided hook
import { useUploadSupport } from "@/lib/hooks/use-formateur-supports";

function UploadMaterial() {
  const uploadSupport = useUploadSupport();
  
  const handleUpload = async (file: File, metadata: {
    titre: string;
    description?: string;
    session_ids?: string[];
    visible_apprenants: boolean;
  }) => {
    await uploadSupport.mutateAsync({
      file,
      titre: metadata.titre,
      description: metadata.description,
      session_ids: metadata.session_ids,
      visible_apprenants: metadata.visible_apprenants,
    });
  };
  
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const file = formData.get('file') as File;
      handleUpload(file, {
        titre: formData.get('titre') as string,
        description: formData.get('description') as string,
        visible_apprenants: formData.get('visible_apprenants') === 'true',
      });
    }}>
      {/* Form fields */}
    </form>
  );
}

// Or using TanStack Query mutation directly
import { useMutation } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

const uploadMaterial = useMutation({
  mutationFn: async ({ file, ...metadata }: {
    file: File;
    titre: string;
    description?: string;
    session_ids?: string[];
    visible_apprenants: boolean;
  }) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('titre', metadata.titre);
    if (metadata.description) formData.append('description', metadata.description);
    formData.append('visible_apprenants', metadata.visible_apprenants.toString());
    
    if (metadata.session_ids) {
      metadata.session_ids.forEach(id => {
        formData.append('session_ids[]', id);
      });
    }

    const response = await fetch('/api/v1/formateur/supports/upload', {
      method: 'POST',
      headers: createApiHeaders(), // Don't set Content-Type, browser will set it with boundary
      body: formData,
    });

    if (!response.ok) throw new Error('Failed to upload material');
    return response.json();
  },
});
```

### 5. Sending Group Message

```typescript
// Using the provided hook
import { useSendGroupMessage } from "@/lib/hooks/use-formateur-messaging";

function SendMessage({ sessionId }) {
  const sendMessage = useSendGroupMessage();
  
  const handleSend = async (message: {
    sujet: string;
    message: string;
    type: 'email' | 'sms' | 'both';
    destinataires?: 'tous' | 'presents' | 'absents';
  }) => {
    const result = await sendMessage.mutateAsync({
      sessionId,
      ...message,
      destinataires: message.destinataires || 'tous',
    });
    
    console.log(`Message sent to ${result.data.nb_destinataires} recipients`);
  };
  
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      handleSend({
        sujet: e.currentTarget.sujet.value,
        message: e.currentTarget.message.value,
        type: e.currentTarget.type.value,
      });
    }}>
      {/* Form fields */}
    </form>
  );
}

// Or using TanStack Query mutation directly
import { useMutation } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

const sendGroupMessage = useMutation({
  mutationFn: async ({
    sessionId,
    ...message
  }: {
    sessionId: string;
    sujet: string;
    message: string;
    type: 'email' | 'sms' | 'both';
    destinataires?: 'tous' | 'presents' | 'absents';
  }) => {
    const response = await fetch(
      `/api/v1/formateur/sessions/${sessionId}/message-groupe`,
      {
        method: 'POST',
        headers: {
          ...createApiHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...message,
          destinataires: message.destinataires || 'tous',
        }),
      }
    );

    if (!response.ok) throw new Error('Failed to send message');
    return response.json();
  },
});
```

### 6. Managing Unavailability

```typescript
// Using the provided hooks
import { useCreateIndisponibilite, useDeleteIndisponibilite } from "@/lib/hooks/use-formateur-schedule";

function UnavailabilityManager() {
  const createIndispo = useCreateIndisponibilite();
  const deleteIndispo = useDeleteIndisponibilite();
  
  const handleAdd = async (dateDebut: string, dateFin: string, raison: string) => {
    await createIndispo.mutateAsync({
      date_debut: dateDebut,
      date_fin: dateFin,
      raison,
    });
  };
  
  const handleRemove = async (indispoId: string) => {
    await deleteIndispo.mutateAsync(indispoId);
  };
  
  return (
    <div>
      {/* UI for managing unavailability */}
    </div>
  );
}

// Or using TanStack Query mutations directly
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

const queryClient = useQueryClient();

const addUnavailability = useMutation({
  mutationFn: async ({ date_debut, date_fin, raison }: {
    date_debut: string;
    date_fin: string;
    raison: string;
  }) => {
    const response = await fetch('/api/v1/formateur/disponibilites', {
      method: 'POST',
      headers: {
        ...createApiHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date_debut, date_fin, raison }),
    });
    if (!response.ok) throw new Error('Failed to add unavailability');
    return response.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['formateur', 'planning'] });
  },
});

const removeUnavailability = useMutation({
  mutationFn: async (indispoId: string) => {
    const response = await fetch(`/api/v1/formateur/disponibilites/${indispoId}`, {
      method: 'DELETE',
      headers: createApiHeaders(),
    });
    if (!response.ok) throw new Error('Failed to remove unavailability');
    return response.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['formateur', 'planning'] });
  },
});
```

## Frontend Components

### Trainer Dashboard

```tsx
import { useFormateurDashboard } from "@/lib/hooks/use-formateur-dashboard";
import { DashboardStats } from "@/components/formateur/DashboardStats";
import { ProchainesSessionsWidget } from "@/components/formateur/ProchainesSessionsWidget";
import { SessionsRecentesWidget } from "@/components/formateur/SessionsRecentesWidget";
import { SupportsRecentsWidget } from "@/components/formateur/SupportsRecentsWidget";
import { NotificationsWidget } from "@/components/formateur/NotificationsWidget";
import { DashboardSkeleton } from "@/components/formateur/DashboardSkeleton";

function FormateurDashboard() {
  const { data: dashboard, isLoading, error } = useFormateurDashboard();

  if (isLoading) return <DashboardSkeleton />;
  if (error) return <Error message={error.message} />;
  if (!dashboard?.data) return null;

  return (
    <div>
      <DashboardStats stats={dashboard.data.stats} />
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <ProchainesSessionsWidget sessions={dashboard.data.prochaines_sessions} />
        <SessionsRecentesWidget sessions={dashboard.data.sessions_recentes} />
      </div>
      <SupportsRecentsWidget supports={dashboard.data.supports_recents} />
      <NotificationsWidget />
    </div>
  );
}
```

### Trainer Schedule Calendar

```tsx
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';

import { useFormateurSchedule } from "@/lib/hooks/use-formateur-schedule";
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useRouter } from 'next/navigation';

function FormateurPlanning() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  const { data: schedule, isLoading } = useFormateurSchedule({
    annee: year,
    mois: month,
  });

  const events = useMemo(() => {
    if (!schedule?.data) return [];
    
    return [
      ...schedule.data.sessions.map(s => ({
        id: s.id,
        title: s.title,
        start: s.start,
        end: s.end,
        backgroundColor: s.backgroundColor || '#3B82F6',
        extendedProps: s.extendedProps,
      })),
      ...schedule.data.indisponibilites.map(i => ({
        id: `indispo-${i.id}`,
        title: `Indisponible: ${i.raison || ''}`,
        start: i.date_debut,
        end: i.date_fin,
        backgroundColor: '#9CA3AF',
        extendedProps: { type: 'indisponibilite' },
      }))
    ];
  }, [schedule]);

  if (isLoading) return <Loading />;

  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin]}
      initialDate={currentDate}
      events={events}
      eventClick={(info) => {
        if (info.event.extendedProps?.type === 'session') {
          router.push(`/formateur/sessions/${info.event.id}/details`);
        }
      }}
    />
  );
}
```

### Attendance Table

```tsx
import { useFormateurSessionInscrits } from "@/lib/hooks/use-formateur-sessions";
import { useMarkAttendance } from "@/lib/hooks/use-formateur-attendance";
import { FormateurInscritsList } from "@/components/formateur/FormateurInscritsList";

function AttendanceTable({ sessionId, sessionStatus }: { 
  sessionId: string;
  sessionStatus: string;
}) {
  const { data: inscritsData, isLoading } = useFormateurSessionInscrits(sessionId);
  const markAttendance = useMarkAttendance();

  if (isLoading) return <Loading />;
  if (!inscritsData?.data) return null;

  const canMarkAttendance = sessionStatus === 'en_cours' || sessionStatus === 'terminee';

  return (
    <FormateurInscritsList
      inscrits={inscritsData.data.inscrits}
      sessionId={sessionId}
      sessionStatus={sessionStatus}
      canMarkAttendance={canMarkAttendance}
    />
  );
}

// Or using the hooks directly for custom implementation
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

function CustomAttendanceTable({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();

  const { data: inscrits } = useQuery({
    queryKey: ['formateur', 'sessions', sessionId, 'inscrits'],
    queryFn: async () => {
      const response = await fetch(`/api/v1/formateur/sessions/${sessionId}/inscrits`, {
        headers: createApiHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch enrolled learners');
      return response.json();
    }
  });

  const updatePresence = useMutation({
    mutationFn: async ({ inscriptionId, present }: { 
      inscriptionId: string; 
      present: boolean;
    }) => {
      const response = await fetch(
        `/api/v1/formateur/sessions/${sessionId}/inscrits/${inscriptionId}/presence`,
        {
          method: 'PATCH',
          headers: {
            ...createApiHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ present }),
        }
      );
      if (!response.ok) throw new Error('Failed to mark attendance');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ['formateur', 'sessions', sessionId] 
      });
    }
  });

  return (
    <table role="table" aria-label="Liste des apprenants inscrits">
      <thead>
        <tr>
          <th scope="col">Nom</th>
          <th scope="col">Email</th>
          <th scope="col">Présence</th>
        </tr>
      </thead>
      <tbody>
        {inscrits?.data.inscrits.map(inscrit => (
          <tr key={inscrit.id}>
            <td>{inscrit.apprenant.prenom} {inscrit.apprenant.nom}</td>
            <td>{inscrit.apprenant.email}</td>
            <td>
              <input
                type="checkbox"
                checked={inscrit.presence === true}
                onChange={(e) => updatePresence.mutate({
                  inscriptionId: inscrit.inscription_id,
                  present: e.target.checked
                })}
                disabled={updatePresence.isPending}
                aria-label={`Marquer ${inscrit.apprenant.prenom} ${inscrit.apprenant.nom} comme ${e.target.checked ? 'présent' : 'absent'}`}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Backend Services

### Trainer Service

```typescript
// apps/api/src/services/formateur.service.ts

import { Pool } from "pg";

export class FormateurService {
  constructor(private pool: Pool) {}

  async getDashboardData(formateurId: string, tenantId: string) {
    const client = await this.pool.connect();
    try {
      // Set tenant context for RLS
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get assigned sessions with SQL queries
      // (Implementation uses raw SQL with PostgreSQL, not Prisma)
      const sessionsQuery = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.statut,
          f.titre as formation_titre
        FROM sessions_professionnelles s
        INNER JOIN session_formateurs sf ON sf.session_id = s.id
        INNER JOIN formations_professionnelles f ON f.id = s.formation_pro_id
        WHERE sf.formateur_id = $1
          AND s.tenant_id = $2
      `;
      
      const sessionsResult = await client.query(sessionsQuery, [formateurId, tenantId]);
      const sessions = sessionsResult.rows;

      // Calculate statistics
      const today = new Date();
      const stats = {
        sessions_a_venir: sessions.filter(s => 
          new Date(s.date_debut) > today && 
          ['planifiee', 'ouverte'].includes(s.statut)
        ).length,
        sessions_en_cours: sessions.filter(s =>
          new Date(s.date_debut) <= today &&
          new Date(s.date_fin) >= today &&
          s.statut === 'en_cours'
        ).length,
        // ... more stats calculated from SQL aggregations
      };

      // Get upcoming sessions, recent sessions, materials, notifications
      // (See actual implementation in formateur.service.ts)

      return { stats, prochaines_sessions, sessions_recentes, supports_recents, notifications };
    } finally {
      client.release();
    }
  }

  // Session access verification is handled by verifySessionAccess utility
  // See apps/api/src/utils/sessionAccess.ts
}
```

### Attendance Service

```typescript
// apps/api/src/services/formateur-attendance.service.ts

import { Pool } from "pg";
import { verifySessionAccess } from "../utils/sessionAccess";

export class FormateurAttendanceService {
  constructor(private pool: Pool) {}

  async markAttendance(
    sessionId: string,
    inscriptionId: string,
    present: boolean,
    formateurId: string,
    tenantId: string
  ) {
    const client = await this.pool.connect();
    try {
      // Set tenant context for RLS
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Verify trainer access
      await verifySessionAccess(sessionId, formateurId, tenantId, client);

      // Verify session status
      const sessionQuery = `
        SELECT statut
        FROM sessions_professionnelles
        WHERE id = $1 AND tenant_id = $2
      `;
      const sessionResult = await client.query(sessionQuery, [sessionId, tenantId]);
      
      if (sessionResult.rows.length === 0) {
        throw new Error("SESSION_NOT_FOUND: Session not found");
      }

      const sessionStatus = sessionResult.rows[0].statut;
      if (!['en_cours', 'terminee'].includes(sessionStatus)) {
        throw new Error("INVALID_SESSION_STATUS: Attendance can only be marked for sessions in progress or completed");
      }

      // Upsert attendance record using SQL
      const upsertQuery = `
        INSERT INTO session_attendance (
          tenant_id,
          session_id,
          inscription_id,
          present,
          marked_by
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id, session_id, inscription_id)
        DO UPDATE SET
          present = $4,
          marked_by = $5,
          marked_at = NOW(),
          updated_at = NOW()
        RETURNING *
      `;
      
      const attendanceResult = await client.query(upsertQuery, [
        tenantId,
        sessionId,
        inscriptionId,
        present,
        formateurId,
      ]);

      return attendanceResult.rows[0];
    } finally {
      client.release();
    }
  }
}
```

## Database Queries

### Get Trainer Sessions

```sql
SELECT 
  s.id,
  s.code_session,
  s.date_debut,
  s.date_fin,
  s.statut,
  f.titre as formation_titre
FROM sessions_professionnelles s
JOIN session_formateurs sf ON s.id = sf.session_id
JOIN formations_professionnelles f ON s.formation_pro_id = f.id
WHERE sf.formateur_id = $formateur_id
  AND s.tenant_id = $tenant_id
  AND s.statut IN ($statuts)
ORDER BY s.date_debut DESC;
```

### Get Session Attendance

```sql
SELECT 
  i.id as inscription_id,
  a.nom as apprenant_nom,
  a.prenom as apprenant_prenom,
  a.email as apprenant_email,
  att.present,
  att.marked_at
FROM inscriptions_professionnelles i
JOIN apprenants a ON i.apprenant_id = a.id
LEFT JOIN session_attendance att ON (
  att.session_id = i.session_id 
  AND att.inscription_id = i.id
)
WHERE i.session_id = $session_id
  AND i.tenant_id = $tenant_id
  AND i.statut = 'confirmee'
ORDER BY a.nom, a.prenom;
```

## Testing

### Unit Tests

```typescript
// Example unit test structure
// Note: Actual test files should be created in apps/api/src/__tests__/

import { FormateurService } from '../services/formateur.service';
import { verifySessionAccess } from '../utils/sessionAccess';

describe('FormateurService', () => {
  let service: FormateurService;
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    mockPool = createMockPool();
    service = new FormateurService(mockPool);
  });

  it('should get dashboard data for trainer', async () => {
    const dashboard = await service.getDashboardData(formateurId, tenantId);
    
    expect(dashboard.stats).toHaveProperty('sessions_a_venir');
    expect(dashboard.stats).toHaveProperty('sessions_en_cours');
    expect(dashboard.prochaines_sessions).toBeInstanceOf(Array);
  });
});

describe('verifySessionAccess', () => {
  it('should verify trainer session access', async () => {
    const hasAccess = await verifySessionAccess(
      sessionId,
      formateurId,
      tenantId,
      mockClient
    );
    expect(hasAccess).toBe(true);
  });

  it('should reject access to non-assigned session', async () => {
    await expect(
      verifySessionAccess(otherSessionId, formateurId, tenantId, mockClient)
    ).rejects.toThrow('ACCESS_DENIED');
  });
});
```

### Integration Tests

```typescript
// Example integration test structure
// Note: Actual test files should be created in tests/integration/

import { buildFastifyApp } from '../test-utils';

describe('GET /api/v1/formateur/dashboard', () => {
  let app: FastifyInstance;
  let trainerToken: string;

  beforeAll(async () => {
    app = await buildFastifyApp();
    trainerToken = await getTrainerAuthToken();
  });

  it('should return dashboard data for authenticated trainer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/formateur/dashboard',
      headers: {
        'Authorization': `Bearer ${trainerToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.stats).toHaveProperty('sessions_a_venir');
    expect(body.data.prochaines_sessions).toBeInstanceOf(Array);
  });

  it('should reject non-trainer users', async () => {
    const studentToken = await getStudentAuthToken();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/formateur/dashboard',
      headers: {
        'Authorization': `Bearer ${studentToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
  });
});
```

## Common Pitfalls

1. **Missing session access check**: Always verify trainer is assigned to session before allowing access
2. **Attendance for wrong session status**: Only allow attendance marking for 'en_cours' or 'terminee' sessions
3. **File upload size**: Validate file size before processing (100MB materials, 5MB photos, 10MB CVs)
4. **Tenant isolation**: Always include tenant_id in all queries
5. **Unavailability conflicts**: Unavailability periods are informational; administrators should check when assigning sessions
6. **Material associations**: Materials can be associated with program (all sessions) or specific sessions or both

## Next Steps

1. Review the [data model](./data-model.md) for entity relationships
2. Check [API contracts](./contracts/formateur-api.md) for detailed endpoint documentation
3. See [research](./research.md) for technical decisions
4. Review [plan](./plan.md) for implementation structure

## Endpoint Verification

All endpoints listed in this quickstart are implemented and accessible:

✅ **Dashboard**: `GET /api/v1/formateur/dashboard`  
✅ **Schedule**: `GET /api/v1/formateur/planning`  
✅ **Unavailability**: `GET /api/v1/formateur/disponibilites`, `POST /api/v1/formateur/disponibilites`, `DELETE /api/v1/formateur/disponibilites/:id`  
✅ **Sessions**: `GET /api/v1/formateur/sessions`, `GET /api/v1/formateur/sessions/:id`, `GET /api/v1/formateur/sessions/:id/inscrits`  
✅ **Attendance**: `PATCH /api/v1/formateur/sessions/:id/inscrits/:inscritId/presence`, `GET /api/v1/formateur/sessions/:id/attendance/export`  
✅ **Course Materials**: `GET /api/v1/formateur/supports`, `POST /api/v1/formateur/supports/upload`, `GET /api/v1/formateur/supports/:id`, `PUT /api/v1/formateur/supports/:id`, `DELETE /api/v1/formateur/supports/:id`, `GET /api/v1/formateur/supports/:id/statistiques`  
✅ **Session Notes**: `POST /api/v1/formateur/sessions/:id/notes`  
✅ **Group Messaging**: `POST /api/v1/formateur/sessions/:id/message-groupe`  
✅ **Profile**: `GET /api/v1/formateur/profil`, `PUT /api/v1/formateur/profil`, `POST /api/v1/formateur/profil/cv`  
✅ **Notifications**: `GET /api/v1/formateur/notifications`, `PATCH /api/v1/formateur/notifications/:id/lire`

All endpoints are registered in `apps/api/src/index.ts` and require authentication via `formateurAuthMiddleware`.

## Resources

- **FullCalendar Docs**: https://fullcalendar.io/docs
- **Zod Validation**: https://zod.dev
- **TanStack Query**: https://tanstack.com/query
- **Fastify Docs**: https://www.fastify.io/docs
- **File Upload**: See existing FileStorageService in `apps/api/src/services/fileStorage.ts`
- **Frontend Hooks**: All hooks are available in `apps/web/src/lib/hooks/use-formateur-*.ts`
- **Frontend Components**: All components are available in `apps/web/src/components/formateur/`

