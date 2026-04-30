# Quickstart: Session Management & Calendar

**Date**: 2025-01-27  
**Feature**: 017-session-calendar

## Overview

This guide helps developers quickly understand and start working with the session management and calendar feature. It covers the key concepts, API endpoints, and common usage patterns.

## Key Concepts

### Session Lifecycle

1. **planifiee** → Session created but not yet published (not visible publicly)
2. **ouverte** → Session open for enrollment (visible in public calendar)
3. **complete** → Session full (automatically set when places_disponibles = 0)
4. **en_cours** → Session currently in progress (admin marks as started)
5. **terminee** → Session completed
6. **annulee** → Session cancelled (triggers participant notifications)

### Capacity Management

- `places_totales`: Total capacity set by admin
- `places_reservees`: Count of confirmed/pending enrollments (updated via service)
- `places_disponibles`: Auto-calculated (`places_totales - places_reservees`)
- Status automatically changes to 'complete' when `places_disponibles = 0`

### Trainer Availability

- Trainers can be assigned to multiple sessions
- System checks for date conflicts before session creation/update
- Conflict detection: sessions overlap if `(new_start <= existing_end) AND (new_end >= existing_start)`
- Only active sessions (not cancelled/completed) are considered for conflicts

## API Endpoints Quick Reference

### Public Endpoints (No Auth Required)

```typescript
// List sessions with filters
GET /api/v1/sessions-pro?page=1&limit=20&mode=presentiel&statut=ouverte

// Get calendar events
GET /api/v1/sessions-pro/calendrier?annee=2024&mois=11

// Get session details
GET /api/v1/sessions-pro/:id

// Get real-time availability
GET /api/v1/sessions-pro/:id/disponibilite
```

### Admin Endpoints (Auth + Admin Role Required)

```typescript
// Create session
POST /api/v1/admin/sessions-pro
Body: { formation_id, date_debut, date_fin, horaires, mode_formation, ... }

// Update session
PUT /api/v1/admin/sessions-pro/:id
Body: { ... } // Partial update

// Change status
PATCH /api/v1/admin/sessions-pro/:id/statut
Body: { statut: "ouverte" }

// List all sessions (admin view)
GET /api/v1/admin/sessions-pro?search=DATA-2024&statut=ouverte

// Get enrollment list
GET /api/v1/admin/sessions-pro/:id/inscrits

// Check trainer availability
GET /api/v1/admin/formateurs/disponibilites?date_debut=2024-11-14&date_fin=2024-11-16

// Duplicate session
POST /api/v1/admin/sessions-pro/:id/dupliquer
Body: { date_debut: "2024-12-01", date_fin: "2024-12-03" }

// Export sessions
GET /api/v1/admin/sessions-pro/export?formation_id=xxx

// Export enrollments
GET /api/v1/admin/sessions-pro/:id/inscrits/export
```

## Common Usage Patterns

### 1. Creating a Session

```typescript
// Step 1: Check trainer availability
const availability = await api.get('/api/v1/admin/formateurs/disponibilites', {
  params: {
    date_debut: '2024-11-14',
    date_fin: '2024-11-16',
    formateur_ids: ['trainer-id-1', 'trainer-id-2']
  }
});

if (!availability.data.formateurs.every(f => f.disponible)) {
  // Handle conflicts
  const conflicts = availability.data.formateurs.filter(f => !f.disponible);
  console.error('Trainers have conflicts:', conflicts);
}

// Step 2: Create session
const session = await api.post('/api/v1/admin/sessions-pro', {
  formation_id: 'formation-uuid',
  date_debut: '2024-11-14',
  date_fin: '2024-11-16',
  horaires: '9h-17h',
  mode_formation: 'presentiel',
  lieu: 'Abidjan, Plateau',
  places_totales: 15,
  formateur_ids: ['trainer-id-1', 'trainer-id-2'],
  statut: 'ouverte' // Publish immediately
});

// Session code is auto-generated: e.g., "DATA-2024-001"
console.log('Created session:', session.data.code_session);
```

### 2. Loading Calendar Events

```typescript
// Load calendar for November 2024
const calendar = await api.get('/api/v1/sessions-pro/calendrier', {
  params: {
    annee: 2024,
    mois: 11,
    modes: ['presentiel', 'hybride'] // Optional filters
  }
});

// Use with FullCalendar
const events = calendar.data.events.map(event => ({
  id: event.id,
  title: event.title,
  start: event.start,
  end: event.end,
  backgroundColor: event.backgroundColor,
  borderColor: event.borderColor,
  extendedProps: event.extendedProps
}));
```

### 3. Real-Time Availability Updates

```typescript
// Poll availability every 30 seconds
useEffect(() => {
  const interval = setInterval(async () => {
    const availability = await api.get(
      `/api/v1/sessions-pro/${sessionId}/disponibilite`
    );
    
    setPlacesDisponibles(availability.data.places_disponibles);
    
    if (availability.data.places_disponibles === 0) {
      setIsComplet(true);
    }
  }, 30000); // 30 seconds

  return () => clearInterval(interval);
}, [sessionId]);
```

### 4. Updating Session Capacity

```typescript
// Check current enrollments before reducing capacity
const session = await api.get(`/api/v1/admin/sessions-pro/${sessionId}`);

if (newPlacesTotales < session.data.places_reservees) {
  throw new Error(
    `Cannot reduce capacity below ${session.data.places_reservees} reserved places`
  );
}

// Update capacity
await api.put(`/api/v1/admin/sessions-pro/${sessionId}`, {
  places_totales: newPlacesTotales
});

// Capacity and status are automatically updated
```

### 5. Handling Session Status Changes

```typescript
// Change status to 'ouverte' (publish session)
await api.patch(`/api/v1/admin/sessions-pro/${sessionId}/statut`, {
  statut: 'ouverte'
});

// Cancel session (triggers notifications)
await api.patch(`/api/v1/admin/sessions-pro/${sessionId}/statut`, {
  statut: 'annulee'
});

// System automatically:
// - Notifies enrolled participants
// - Initiates refunds if payments exist
```

## Frontend Components

### Calendar Component

```tsx
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';

function SessionCalendar() {
  const { data: calendar } = useQuery({
    queryKey: ['sessions-calendar', year, month],
    queryFn: () => api.get('/api/v1/sessions-pro/calendrier', {
      params: { annee: year, mois: month }
    })
  });

  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin]}
      events={calendar?.data.events}
      eventClick={(info) => {
        router.push(`/formations-professionnelles/session/${info.event.id}`);
      }}
    />
  );
}
```

### Session Form (Admin)

```tsx
function SessionForm() {
  const form = useForm({
    resolver: zodResolver(CreateSessionSchema)
  });

  // Check trainer availability on date change
  const { data: availability } = useQuery({
    queryKey: ['trainer-availability', dates, trainers],
    queryFn: () => api.get('/api/v1/admin/formateurs/disponibilites', {
      params: { date_debut: dates.start, date_fin: dates.end, formateur_ids: trainers }
    }),
    enabled: !!dates.start && !!dates.end && trainers.length > 0
  });

  const onSubmit = async (data) => {
    await api.post('/api/v1/admin/sessions-pro', data);
    router.push('/admin/sessions');
  };

  return <form onSubmit={form.handleSubmit(onSubmit)}>...</form>;
}
```

## Backend Services

### Session Service

```typescript
// apps/api/src/services/session-pro.service.ts

class SessionProService {
  async createSession(data: CreateSessionInput, tenantId: string) {
    // 1. Validate trainer availability
    const availability = await this.checkTrainerAvailability(
      data.formateur_ids,
      data.date_debut,
      data.date_fin
    );
    
    if (!availability.allAvailable) {
      throw new Error('Trainers have scheduling conflicts');
    }

    // 2. Generate session code
    const codeSession = await this.generateCodeSession(
      data.formation_id,
      tenantId
    );

    // 3. Create session
    const session = await db.sessions_professionnelles.create({
      data: {
        ...data,
        code_session: codeSession,
        tenant_id: tenantId,
        places_reservees: 0,
        statut: data.statut || 'planifiee'
      }
    });

    // 4. Assign trainers
    await this.assignTrainers(session.id, data.formateur_ids);

    return session;
  }

  async updateSessionCapacity(sessionId: string) {
    // Count enrollments
    const count = await db.inscriptions_professionnelles.count({
      where: {
        session_id: sessionId,
        statut: { in: ['confirmee', 'en_attente'] }
      }
    });

    // Update places_reservees
    const session = await db.sessions_professionnelles.update({
      where: { id: sessionId },
      data: {
        places_reservees: count,
        // places_disponibles is auto-calculated
        statut: count >= session.places_totales ? 'complete' : 'ouverte'
      }
    });

    return session;
  }
}
```

## Database Queries

### Get Sessions for Calendar

```sql
SELECT 
  s.id,
  s.code_session,
  s.date_debut,
  s.date_fin,
  s.mode_formation,
  s.statut,
  s.places_disponibles,
  f.titre as formation_titre
FROM sessions_professionnelles s
JOIN formations_professionnelles f ON s.formation_pro_id = f.id
WHERE s.tenant_id = $tenant_id
  AND s.date_debut >= $start_date
  AND s.date_debut <= $end_date
  AND s.statut != 'annulee'
ORDER BY s.date_debut ASC;
```

### Check Trainer Availability

```sql
SELECT COUNT(*) as conflict_count
FROM sessions_professionnelles s
JOIN session_formateurs sf ON s.id = sf.session_id
WHERE sf.formateur_id = $formateur_id
  AND s.id != $exclude_session_id
  AND s.statut NOT IN ('annulee', 'terminee')
  AND (
    (s.date_debut <= $new_date_fin) AND (s.date_fin >= $new_date_debut)
  );
```

## Testing

### Unit Tests

```typescript
describe('SessionProService', () => {
  it('should generate unique session codes', async () => {
    const code1 = await service.generateCodeSession(formationId, tenantId);
    const code2 = await service.generateCodeSession(formationId, tenantId);
    expect(code1).not.toBe(code2);
    expect(code1).toMatch(/^[A-Z]{4}-\d{4}-\d{3}$/);
  });

  it('should detect trainer conflicts', async () => {
    const result = await service.checkTrainerAvailability(
      [trainerId],
      '2024-11-14',
      '2024-11-16'
    );
    expect(result.allAvailable).toBe(false);
    expect(result.details[0].conflits).toHaveLength(1);
  });
});
```

### Integration Tests

```typescript
describe('POST /api/v1/admin/sessions-pro', () => {
  it('should create session with valid data', async () => {
    const response = await request(app)
      .post('/api/v1/admin/sessions-pro')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validSessionData);

    expect(response.status).toBe(201);
    expect(response.body.data.code_session).toMatch(/^[A-Z]{4}-\d{4}-\d{3}$/);
  });

  it('should reject session with trainer conflicts', async () => {
    const response = await request(app)
      .post('/api/v1/admin/sessions-pro')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(sessionDataWithConflict);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('TRAINER_CONFLICT');
  });
});
```

## Common Pitfalls

1. **Forgetting tenant_id**: Always include tenant context in queries
2. **Capacity reduction**: Check `places_reservees` before reducing `places_totales`
3. **Trainer conflicts**: Always check availability before creating/updating sessions
4. **Status transitions**: Some status changes are restricted (e.g., cannot change 'terminee' to 'ouverte')
5. **Date validation**: Ensure `date_fin > date_debut` and `date_debut >= today`
6. **Mode requirements**: `lieu` required for 'presentiel', `lien_visio` for 'distanciel'/'hybride'

## Next Steps

1. Review the [data model](./data-model.md) for entity relationships
2. Check [API contracts](./contracts/sessions-pro-api.md) for detailed endpoint documentation
3. See [research](./research.md) for technical decisions
4. Review [plan](./plan.md) for implementation structure

## Resources

- **FullCalendar Docs**: https://fullcalendar.io/docs
- **Zod Validation**: https://zod.dev
- **TanStack Query**: https://tanstack.com/query
- **Fastify Docs**: https://www.fastify.io/docs

