"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Academic Calendar Event Types
export interface AcademicCalendarEvent {
  id: string;
  academicYearId: string;
  academicYearName?: string;
  name: string;
  type: 'semester_start' | 'semester_end' | 'holiday' | 'break' | 'special_event' | 'academic_milestone';
  eventDate: string;
  description: string | null;
  semester: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAcademicCalendarEvent {
  academicYearId: string;
  name: string;
  type: 'semester_start' | 'semester_end' | 'holiday' | 'break' | 'special_event' | 'academic_milestone';
  eventDate: string;
  description?: string;
  semester?: number;
}

export interface UpdateAcademicCalendarEvent {
  academicYearId?: string;
  name?: string;
  type?: 'semester_start' | 'semester_end' | 'holiday' | 'break' | 'special_event' | 'academic_milestone';
  eventDate?: string;
  description?: string;
  semester?: number;
}

export interface AcademicCalendarEventQuery {
  academicYearId?: string;
  type?: string;
  page?: number;
  limit?: number;
}

// API functions
async function fetchAcademicCalendarEvents(query: AcademicCalendarEventQuery = {}): Promise<{ data: AcademicCalendarEvent[]; pagination?: any }> {
  const searchParams = new URLSearchParams();
  
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const url = `/api/v1/academic-calendar-events${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch academic calendar events");
  }

  const payload = await response.json();
  
  // Handle both paginated and non-paginated responses
  if (payload.success !== false) {
    if (Array.isArray(payload.data)) {
      return { data: payload.data };
    } else if (payload.data && Array.isArray(payload.data.events)) {
      return { data: payload.data.events };
    } else if (Array.isArray(payload)) {
      return { data: payload };
    } else {
      return { data: [] };
    }
  }
  
  return { data: [] };
}

async function fetchAcademicCalendarEvent(id: string): Promise<AcademicCalendarEvent> {
  // Since there's no GET /academic-calendar-events/:id endpoint, we use the list endpoint
  // and filter client-side. We fetch with max limit (100) and paginate if needed.
  let page = 1;
  const limit = 100;
  let event: AcademicCalendarEvent | undefined;

  // Try to find the event by paginating through results
  while (!event) {
    const response = await fetch(`/api/v1/academic-calendar-events?limit=${limit}&page=${page}`, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || `Failed to fetch academic calendar event ${id}`);
    }
    
    const payload = await response.json();
    
    // Handle different response formats
    let events: AcademicCalendarEvent[] = [];
    if (payload.success !== false) {
      if (Array.isArray(payload.data)) {
        events = payload.data;
      } else if (payload.data && Array.isArray(payload.data.events)) {
        events = payload.data.events;
      } else if (Array.isArray(payload)) {
        events = payload;
      }
    }
    
    // Find the event by ID
    event = events.find((e: any) => e.id === id);
    
    // If not found and there are more pages, continue
    if (!event && payload?.pagination && page < payload.pagination.totalPages) {
      page++;
    } else {
      break;
    }
  }
  
  if (!event) {
    throw new Error(`Academic calendar event with id ${id} not found`);
  }
  
  return event;
}

async function createAcademicCalendarEvent(data: CreateAcademicCalendarEvent): Promise<AcademicCalendarEvent> {
  const response = await fetch(`/api/v1/academic-calendar-events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || "Failed to create academic calendar event");
  }

  const payload = await response.json();
  return payload.data || payload;
}

async function updateAcademicCalendarEvent(id: string, data: UpdateAcademicCalendarEvent): Promise<AcademicCalendarEvent> {
  const response = await fetch(`/api/v1/academic-calendar-events/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || "Failed to update academic calendar event");
  }

  const payload = await response.json();
  return payload.data || payload;
}

async function deleteAcademicCalendarEvent(id: string): Promise<void> {
  const response = await fetch(`/api/v1/academic-calendar-events/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || `Failed to delete academic calendar event: ${response.statusText}`);
  }
}

// React Query hooks
export function useAcademicCalendarEvents(query: AcademicCalendarEventQuery = {}) {
  return useQuery({
    queryKey: ["academic-calendar-events", query],
    queryFn: () => fetchAcademicCalendarEvents(query),
  });
}

export function useAcademicCalendarEvent(id?: string) {
  return useQuery({
    queryKey: ["academic-calendar-events", id],
    queryFn: () => fetchAcademicCalendarEvent(id as string),
    enabled: !!id,
  });
}

export function useCreateAcademicCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAcademicCalendarEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-calendar-events"] });
    },
  });
}

export function useUpdateAcademicCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAcademicCalendarEvent }) =>
      updateAcademicCalendarEvent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-calendar-events"] });
    },
  });
}

export function useDeleteAcademicCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAcademicCalendarEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-calendar-events"] });
    },
  });
}

