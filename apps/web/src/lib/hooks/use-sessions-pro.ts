/**
 * use-sessions-pro.ts
 * 
 * React hooks for session management and calendar functionality
 * Uses TanStack Query for data fetching and caching
 * 
 * Hooks:
 * - useSessionsCalendar: Fetch calendar events
 * - useSessionDetail: Fetch session details
 * - useSessionAvailability: Poll session availability
 * - useAdminSessionsList: Fetch admin session list
 * - useCreateSession: Create new session
 * - useUpdateSession: Update existing session
 * - useSessionEnrollments: Fetch session enrollments
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useMemo, useState, useEffect } from "react";
import {
  CalendarQuery,
  SessionListQuery,
  SessionDetail,
  SessionDetailResponseSchema,
  AvailabilityResponseSchema,
  CreateSessionSchema,
  UpdateSessionSchema,
  EnrollmentListQuerySchema,
  EnrollmentListResponseSchema,
} from "@ecoledigitale/contracts";
// Direct import as fallback if main export doesn't work
import { EnrollmentListResponseSchema as EnrollmentListResponseSchemaDirect } from "@ecoledigitale/contracts/src/sessions-pro/types";
import { AdminSessionListQuerySchema } from "@ecoledigitale/contracts/src/sessions-pro/admin.schema";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";
import { hasToken, getToken, isTokenExpired } from "@/lib/jwt-storage";
import { useDebounce } from "@/lib/hooks/use-debounce";
import toast from "react-hot-toast";

type AdminSessionListQuery = z.infer<typeof AdminSessionListQuerySchema>;

/**
 * Hook to fetch calendar events for FullCalendar
 * Supports polling for real-time availability updates
 */
export function useSessionsCalendar(
  query: CalendarQuery,
  options?: {
    enabled?: boolean;
    refetchInterval?: number; // Polling interval in milliseconds (default: 30 seconds)
  }
) {
  return useQuery<CalendarResponse>({
    queryKey: ["sessions-pro", "calendrier", query],
    queryFn: async () => {
      const queryString = buildQueryString(query as any);
      const url = `/api/v1/sessions-pro/calendrier${queryString}`;
      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch calendar events");
      }

      const rawData = await response.json();
      return rawData;
    },
    staleTime: 0, // Always refetch for real-time updates
    refetchInterval: options?.refetchInterval ?? 30000, // 30 seconds polling
    enabled: options?.enabled !== false,
  });
}

/**
 * Hook to fetch list of sessions with filters, pagination, and sorting
 */
export function useSessionsList(query: SessionListQuery = {}) {
  return useQuery<SessionListResponse>({
    queryKey: ["sessions-pro", "list", query],
    queryFn: async () => {
      const queryString = buildQueryString(query as any);
      const url = queryString
        ? `/api/v1/sessions-pro${queryString}`
        : `/api/v1/sessions-pro`;
      
      console.log('🌐 [useSessionsList] Fetching sessions:', {
        url,
        query,
        queryString,
        headers: createApiHeaders(),
      });

      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      console.log('📡 [useSessionsList] Response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (!response.ok) {
        let errorMessage = `Failed to fetch sessions (${response.status})`;
        try {
          const errorText = await response.text();
          if (errorText) {
            try {
              const error = JSON.parse(errorText);
              errorMessage = error.message || error.error || errorMessage;
            } catch {
              // If not JSON, use the text as error message
              errorMessage = errorText || errorMessage;
            }
          }
        } catch (e) {
          // If we can't read the response, use status text
          errorMessage = response.statusText || errorMessage;
        }
        console.error('❌ [useSessionsList] Error response:', {
          status: response.status,
          statusText: response.statusText,
          message: errorMessage,
        });
        throw new Error(errorMessage);
      }

      const responseText = await response.text();
      console.log('📄 [useSessionsList] Raw response text:', responseText);
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error('❌ [useSessionsList] Failed to parse JSON:', e);
        throw new Error('Invalid JSON response');
      }
      
      const firstSession = data?.data?.sessions?.[0] || null;
      console.log('✅ [useSessionsList] Success response:', {
        data,
        dataKeys: Object.keys(data || {}),
        dataDataKeys: data?.data ? Object.keys(data.data) : null,
        sessionsCount: data?.data?.sessions?.length || 0,
        firstSession: firstSession,
        firstSessionKeys: firstSession ? Object.keys(firstSession) : null,
        firstSessionOwnProperties: firstSession ? Object.getOwnPropertyNames(firstSession) : null,
        pagination: data?.data?.pagination,
        fullFirstSession: firstSession ? JSON.stringify(firstSession, null, 2) : null,
        allSessions: data?.data?.sessions,
        allSessionsStringified: data?.data?.sessions ? JSON.stringify(data.data.sessions, null, 2) : null,
        // Try to access properties directly
        firstSessionId: firstSession?.id,
        firstSessionCode: firstSession?.code_session,
        firstSessionFormation: firstSession?.formation,
        firstSessionDateDebut: firstSession?.date_debut,
      });

      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });
}

/**
 * Hook to fetch admin session list with extended filters, search, and statistics
 * Includes debounced search (300ms) to avoid excessive API calls
 */
export function useAdminSessionsList(query: AdminSessionListQuery = {}) {
  // Check if token is available
  const tokenAvailable = hasToken();
  
  // Debounce search input (300ms delay)
  const debouncedSearch = useDebounce(query.search ?? "", 300);
  
  // Create query with debounced search
  const debouncedQuery = useMemo(() => ({
    ...query,
    search: debouncedSearch ? debouncedSearch : undefined,
  }), [query.page, query.limit, query.formation_id, query.mode, query.date_debut, query.date_fin, query.statut, query.formateur_id, query.mois, query.annee, query.sort, debouncedSearch]);

  return useQuery<{
    success: true;
    data: {
      sessions: Array<SessionListItem & { notes_internes?: string | null }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
      statistics: {
        sessions_actives: number;
        sessions_ce_mois: number;
        taux_remplissage: number;
        ca_previsionnel: number;
      };
    };
  }>({
    queryKey: ["sessions-pro", "admin-list", debouncedQuery],
    queryFn: async () => {
      const queryString = buildQueryString(debouncedQuery as any);
      const url = queryString
        ? `/api/v1/admin/sessions-pro${queryString}`
        : `/api/v1/admin/sessions-pro`;

      console.log('🔍 [useAdminSessionsList] Fetching admin sessions:', {
        url,
        query: debouncedQuery,
        headers: createApiHeaders(),
      });

      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      console.log('📡 [useAdminSessionsList] Response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      });

      if (!response.ok) {
        // Handle 401 errors gracefully without triggering redirect
        if (response.status === 401) {
          const error = await response.json().catch(() => ({ message: "Authentication required" }));
          console.error('❌ [useAdminSessionsList] 401 error:', error);
          throw new Error(error.message || "Authentication required");
        }
        const error = await response.json();
        console.error('❌ [useAdminSessionsList] Error:', error);
        throw new Error(error.message || "Failed to fetch admin sessions");
      }

      const responseText = await response.text();
      console.log('📄 [useAdminSessionsList] Raw response length:', responseText.length);
      console.log('📄 [useAdminSessionsList] Raw response (first 1000 chars):', responseText.substring(0, 1000));
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error('❌ [useAdminSessionsList] Failed to parse JSON:', e);
        console.error('❌ [useAdminSessionsList] Response text that failed:', responseText);
        throw new Error('Invalid JSON response from server');
      }
      
      // Log the parsed data structure in detail
      console.log('✅ [useAdminSessionsList] Parsed data structure:', {
        hasData: !!data,
        hasDataData: !!data?.data,
        hasSessions: !!data?.data?.sessions,
        sessionsLength: data?.data?.sessions?.length || 0,
        sessionsType: Array.isArray(data?.data?.sessions) ? 'array' : typeof data?.data?.sessions,
        firstSessionKeys: data?.data?.sessions?.[0] ? Object.keys(data.data.sessions[0]) : [],
        firstSessionId: data?.data?.sessions?.[0]?.id,
        firstSessionCode: data?.data?.sessions?.[0]?.code_session,
        firstSessionFormation: data?.data?.sessions?.[0]?.formation,
        fullFirstSession: JSON.stringify(data?.data?.sessions?.[0] || {}),
        total: data?.data?.pagination?.total || 0,
      });
      
      return data;
    },
    enabled: tokenAvailable, // Only run if token is available
    retry: false, // Do not retry on 401 errors
    staleTime: 30 * 1000, // 30 seconds cache (shorter for admin view)
  });
}

/**
 * Hook to fetch session details by ID
 */
export function useSessionDetail(sessionId: string | null) {
  return useQuery<{ success: true; data: SessionDetail }>({
    queryKey: ["sessions-pro", "detail", sessionId],
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      const url = `/api/v1/sessions-pro/${sessionId}`;
      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          const error = await response.json();
          throw new Error(error.message || "Session not found");
        }
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch session details");
      }

      const data = await response.json();
      
      // Basic validation: check if data has the expected structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format');
      }

      if (!data.success || !data.data) {
        throw new Error('Invalid response: missing success or data field');
      }

      // Try to use schema validation if available
      if (SessionDetailResponseSchema && typeof SessionDetailResponseSchema.parse === 'function') {
        try {
          const parsed = SessionDetailResponseSchema.parse(data);
          return parsed;
        } catch (validationError: any) {
          console.warn('⚠️ [useSessionDetail] Schema validation failed, but data structure looks valid:', {
            error: validationError?.message,
            issues: validationError?.issues,
          });
          // Fall through to return data anyway if structure is valid
        }
      } else {
        console.warn('⚠️ [useSessionDetail] SessionDetailResponseSchema not available, skipping validation');
      }

      // Return data with type assertion if basic structure is valid
      if (data.success && data.data && typeof data.data === 'object') {
        return data as { success: true; data: SessionDetail };
      }

      throw new Error('Invalid response: data structure is not valid');
    },
    enabled: !!sessionId,
    staleTime: 2 * 60 * 1000, // 2 minutes cache
  });
}

/**
 * Hook to fetch real-time session availability with polling
 */
export function useSessionAvailability(
  sessionId: string | null,
  options?: {
    enabled?: boolean;
    refetchInterval?: number; // Polling interval in milliseconds (default: 30 seconds)
  }
) {
  return useQuery<z.infer<typeof AvailabilityResponseSchema>>({
    queryKey: ["sessions-pro", "availability", sessionId],
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      const url = `/api/v1/sessions-pro/${sessionId}/disponibilite`;
      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch session availability");
      }

      const data = await response.json();
      return AvailabilityResponseSchema.parse(data);
    },
    enabled: options?.enabled !== false && !!sessionId,
    staleTime: 0, // Always refetch for real-time updates
    refetchInterval: options?.refetchInterval ?? 30000, // 30 seconds polling
  });
}

/**
 * Hook to check trainer availability for a date range
 */
export function useFormateursDisponibilite(
  dateDebut: string | null,
  dateFin: string | null,
  formateurIds: string[],
  options?: {
    enabled?: boolean;
  }
) {
  // Only enable query if token is available to avoid 401 errors
  const tokenAvailable = typeof window !== 'undefined' ? hasToken() : false;
  
  return useQuery<{
    success: true;
    data: {
      formateurs: Array<{
        id: string;
        nom: string;
        prenom: string;
        disponible: boolean;
        conflits?: Array<{
          session_id: string;
          code_session: string;
          formation: string;
          date_debut: string;
          date_fin: string;
        }>;
      }>;
    };
  }>({
    queryKey: ["sessions-pro", "formateurs-disponibilite", dateDebut, dateFin, formateurIds],
    queryFn: async () => {
      if (!dateDebut || !dateFin || formateurIds.length === 0) {
        throw new Error("dateDebut, dateFin, and formateurIds are required");
      }

      const queryString = buildQueryString({
        date_debut: dateDebut,
        date_fin: dateFin,
        formateur_ids: formateurIds.join(","),
      });
      const url = `/api/v1/sessions-pro/admin/formateurs/disponibilites${queryString}`;
      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        // Don't throw for 401 - let React Query handle it gracefully
        if (response.status === 401) {
          const error = await response.json().catch(() => ({}));
          const errorObj = new Error(error.message || "Authentication required");
          (errorObj as any).status = 401;
          throw errorObj;
        }
        const error = await response.json();
        throw new Error(error.message || "Failed to check trainer availability");
      }

      return response.json();
    },
    enabled: tokenAvailable && (options?.enabled !== false) && !!dateDebut && !!dateFin && formateurIds.length > 0,
    staleTime: 30 * 1000, // 30 seconds cache
    retry: (failureCount, error: any) => {
      // Don't retry on 401 errors to avoid multiple redirect attempts
      if (error?.status === 401) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Hook to create a new training session
 */
export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: z.infer<typeof CreateSessionSchema>) => {
      const response = await fetch("/api/v1/admin/sessions-pro", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        // Extract error message, handling different response formats
        const errorMessage = error.message || error.error || "Failed to create session";
        // If error object has both error and message, prefer message but include error type if it's a known error
        if (error.error && error.message) {
          // For structured errors like TRAINER_CONFLICT, ensure the error type is in the message
          if (error.error === "TRAINER_CONFLICT" && !error.message.includes("TRAINER_CONFLICT")) {
            throw new Error(`TRAINER_CONFLICT: ${error.message}`);
          }
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      // Validate response structure
      if (!result || typeof result !== 'object') {
        throw new Error('Invalid response format');
      }

      if (!result.success || !result.data) {
        throw new Error('Invalid response: missing success or data field');
      }

      // Try to use schema validation if available
      if (SessionDetailResponseSchema && typeof SessionDetailResponseSchema.parse === 'function') {
        try {
          return SessionDetailResponseSchema.parse(result);
        } catch (validationError: any) {
          console.warn('⚠️ [useCreateSession] Schema validation failed, but data structure looks valid:', {
            error: validationError?.message,
            issues: validationError?.issues,
          });
          // Return data anyway if structure is valid
          return result as { success: true; data: SessionDetail };
        }
      } else {
        console.warn('⚠️ [useCreateSession] SessionDetailResponseSchema not available, skipping validation');
        return result as { success: true; data: SessionDetail };
      }
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["sessions-pro"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-pro", "calendrier"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-pro", "list"] });
    },
  });
}

/**
 * T081: Hook to update an existing session
 */
export function useUpdateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId, data }: { 
      sessionId: string; 
      data: z.infer<typeof UpdateSessionSchema> 
    }) => {
      const response = await fetch(`/api/v1/admin/sessions-pro/${sessionId}`, {
        method: "PUT",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update session");
      }

      const result = await response.json();
      
      // Validate response structure
      if (!result || typeof result !== 'object') {
        throw new Error('Invalid response format');
      }

      if (!result.success || !result.data) {
        throw new Error('Invalid response: missing success or data field');
      }

      // Try to use schema validation if available
      if (SessionDetailResponseSchema && typeof SessionDetailResponseSchema.parse === 'function') {
        try {
          return SessionDetailResponseSchema.parse(result);
        } catch (validationError: any) {
          console.warn('⚠️ [useUpdateSession] Schema validation failed, but data structure looks valid:', {
            error: validationError?.message,
            issues: validationError?.issues,
          });
          // Return data anyway if structure is valid
          return result as { success: true; data: SessionDetail };
        }
      } else {
        console.warn('⚠️ [useUpdateSession] SessionDetailResponseSchema not available, skipping validation');
        return result as { success: true; data: SessionDetail };
      }
    },
    onSuccess: (_, variables) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["sessions-pro"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-pro", "calendrier"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-pro", "list"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-pro", "admin-list"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-pro", variables.sessionId] });
    },
  });
}

/**
 * T102: Hook to fetch session enrollments with filtering
 */
export function useSessionEnrollments(
  sessionId: string | null,
  query: z.infer<typeof EnrollmentListQuerySchema> = {}
) {
  const tokenAvailable = typeof window !== 'undefined' ? hasToken() : false;

  return useQuery<z.infer<typeof EnrollmentListResponseSchema>>({
    queryKey: ["sessions-pro", "enrollments", sessionId, query],
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      const queryString = buildQueryString(query as any);
      const url = queryString
        ? `/api/v1/admin/sessions-pro/${sessionId}/inscrits${queryString}`
        : `/api/v1/admin/sessions-pro/${sessionId}/inscrits`;

      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        if (response.status === 401) {
          const error = await response.json().catch(() => ({}));
          const errorObj = new Error(error.message || "Authentication required");
          (errorObj as any).status = 401;
          throw errorObj;
        }
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch enrollments");
      }

      const data = await response.json();
      
      // Use direct import as fallback if main export is undefined
      const schema = EnrollmentListResponseSchema || EnrollmentListResponseSchemaDirect;
      
      // Check if schema is available before parsing
      if (!schema) {
        console.error('[useSessionEnrollments] EnrollmentListResponseSchema is undefined (both imports) - returning data without validation');
        // Return data without validation as fallback
        return data as any;
      }
      
      try {
        return schema.parse(data);
      } catch (parseError: any) {
        console.error('[useSessionEnrollments] Parse error:', {
          error: parseError.message,
          issues: parseError.issues,
          dataKeys: data ? Object.keys(data) : null,
        });
        // Return data without validation as fallback
        return data as any;
      }
    },
    enabled: tokenAvailable && !!sessionId,
    staleTime: 30 * 1000, // 30 seconds cache
    retry: (failureCount, error: any) => {
      if (error?.status === 401) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Hook to fetch session statistics
 */
export function useSessionStats(sessionId: string | null) {
  const tokenAvailable = typeof window !== 'undefined' ? hasToken() : false;

  return useQuery<{
    success: true;
    data: {
      total_inscriptions: number;
      inscriptions_confirmees: number;
      taux_remplissage: number;
      revenus_totaux: number;
      inscriptions_timeline?: Array<{ date: string; count: number }>;
      type_distribution?: Array<{ type: string; count: number }>;
      payment_status?: Array<{ status: string; count: number }>;
    };
  }>({
    queryKey: ["sessions-pro", "stats", sessionId],
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      const response = await fetch(`/api/v1/admin/sessions-pro/${sessionId}/stats`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        if (response.status === 401) {
          const error = await response.json().catch(() => ({}));
          const errorObj = new Error(error.message || "Authentication required");
          (errorObj as any).status = 401;
          throw errorObj;
        }
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch statistics");
      }

      return response.json();
    },
    enabled: tokenAvailable && !!sessionId,
    staleTime: 60 * 1000, // 1 minute cache
    retry: (failureCount, error: any) => {
      if (error?.status === 401) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Hook to fetch list of formateurs (trainers)
 */
export function useFormateurs(search?: string) {
  // Use useState to track if token is ready (allows time for token validation)
  const [tokenReady, setTokenReady] = useState(false);

  // Check if token is available and valid (not expired)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Small delay to ensure token is validated by fetch-interceptor
    const timer = setTimeout(() => {
      const token = getToken();
      if (token && !isTokenExpired(token)) {
        setTokenReady(true);
      } else {
        setTokenReady(false);
      }
    }, 100); // 100ms delay to allow token validation

    return () => clearTimeout(timer);
  }, []);
  
  return useQuery<{
    success: true;
    data: Array<{
      id: string;
      nom: string;
      prenom: string;
      email: string;
      initialPassword?: string | null;
      specialites?: string[];
      bio?: string;
      photo_url?: string;
      actif: boolean;
    }>;
  }>({
    queryKey: ["formateurs", search],
    queryFn: async () => {
      const queryString = search ? `?search=${encodeURIComponent(search)}` : "";
      const url = `/api/v1/sessions-pro/admin/formateurs${queryString}`;
      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        // Don't throw for 401 - let React Query handle it gracefully
        if (response.status === 401) {
          const errorText = await response.text();
          let error;
          try {
            error = JSON.parse(errorText);
          } catch {
            error = {};
          }
          const errorObj = new Error(error.message || "Authentication required");
          (errorObj as any).status = 401;
          throw errorObj;
        }
        const errorText = await response.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { message: "Failed to fetch formateurs" };
        }
        throw new Error(error.message || "Failed to fetch formateurs");
      }

      // Use text() then JSON.parse() like useSessionsList does (which works correctly)
      const responseText = await response.text();
      console.log("✅ Formateurs hook - Raw response text:", responseText);
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error("❌ Formateurs hook - Failed to parse JSON:", e);
        throw new Error("Invalid JSON response");
      }
      
      console.log("✅ Formateurs hook - Data received:", data);
      console.log("✅ Formateurs hook - Data.data:", data?.data);
      if (data?.data && data.data.length > 0) {
        console.log("✅ Formateurs hook - First formateur:", data.data[0]);
        console.log("✅ Formateurs hook - First formateur keys:", Object.keys(data.data[0]));
        console.log("✅ Formateurs hook - First formateur JSON:", JSON.stringify(data.data[0], null, 2));
      }
      return data;
    },
    enabled: tokenReady, // Only fetch if token is ready and valid
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    retry: (failureCount, error: any) => {
      // Don't retry on 401 errors to avoid multiple redirect attempts
      if (error?.status === 401) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

export function useFormateurDetail(formateurId: string | null) {
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Small delay to ensure token is validated by fetch-interceptor
    const timer = setTimeout(() => {
      const token = getToken();
      if (token && !isTokenExpired(token)) {
        setTokenReady(true);
      } else {
        setTokenReady(false);
      }
    }, 100); // 100ms delay to allow token validation

    return () => clearTimeout(timer);
  }, []);

  return useQuery<{
    success: true;
    data: {
      id: string;
      civilite?: string;
      nom: string;
      prenom: string;
      email: string;
      telephone?: string;
      specialites?: string[];
      bio?: string;
      photo_url?: string;
      linkedin_url?: string;
      tarif_journalier?: number;
      actif: boolean;
      created_at?: string;
      updated_at?: string;
    };
  }>({
    queryKey: ["formateur", formateurId],
    queryFn: async () => {
      if (!formateurId) {
        throw new Error("Formateur ID is required");
      }

      const url = `/api/v1/sessions-pro/admin/formateurs/${formateurId}`;
      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        if (response.status === 401) {
          const errorText = await response.text();
          let error;
          try {
            error = JSON.parse(errorText);
          } catch {
            error = {};
          }
          const errorObj = new Error(error.message || "Authentication required");
          (errorObj as any).status = 401;
          throw errorObj;
        }
        if (response.status === 404) {
          const errorText = await response.text();
          let error;
          try {
            error = JSON.parse(errorText);
          } catch {
            error = {};
          }
          const errorObj = new Error(error.message || "Formateur not found");
          (errorObj as any).status = 404;
          throw errorObj;
        }
        const errorText = await response.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { message: "Failed to fetch formateur details" };
        }
        throw new Error(error.message || "Failed to fetch formateur details");
      }

      // Use text() then JSON.parse() like useSessionsList does (which works correctly)
      const responseText = await response.text();
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error("Invalid JSON response");
      }
      
      return data;
    },
    enabled: tokenReady && !!formateurId,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    retry: (failureCount, error: any) => {
      if (error?.status === 401 || error?.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

export interface CreateFormateurData {
  password?: string;
  civilite?: string;
  nom: string;
  prenom: string;
  email: string;
  telephone?: string;
  specialites?: string[];
  bio?: string;
  linkedin_url?: string;
  tarif_journalier?: number;
  actif?: boolean;
}

export function useCreateFormateur() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFormateurData) => {
      const response = await fetch("/api/v1/sessions-pro/admin/formateurs", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        // Handle 401 errors specifically to prevent redirect
        if (response.status === 401) {
          const error = await response.json().catch(() => ({}));
          const errorObj = new Error(error.message || "Authentication required");
          (errorObj as any).status = 401;
          throw errorObj;
        }
        const error = await response.json();
        throw new Error(error.message || "Erreur lors de la création du formateur");
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate formateurs list to refresh only on success
      queryClient.invalidateQueries({ queryKey: ["formateurs"] });
    },
    onError: (error: any) => {
      // Don't invalidate queries on error to prevent triggering new requests
      // that would fail and cause redirect
      if (error?.status === 401) {
        console.error("Authentication error during formateur creation:", error.message);
        // Don't throw or redirect here - let the component handle it
      }
    },
  });
}

export interface UpdateFormateurData {
  civilite?: string;
  nom?: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  specialites?: string[];
  bio?: string;
  linkedin_url?: string;
  tarif_journalier?: number;
  actif?: boolean;
}

export function useUpdateFormateur() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ formateurId, data }: { formateurId: string; data: UpdateFormateurData }) => {
      const response = await fetch(`/api/v1/sessions-pro/admin/formateurs/${formateurId}`, {
        method: "PUT",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        // Handle 401 errors specifically to prevent redirect
        if (response.status === 401) {
          const errorText = await response.text();
          let error;
          try {
            error = JSON.parse(errorText);
          } catch {
            error = {};
          }
          const errorObj = new Error(error.message || "Authentication required");
          (errorObj as any).status = 401;
          throw errorObj;
        }
        if (response.status === 404) {
          const errorText = await response.text();
          let error;
          try {
            error = JSON.parse(errorText);
          } catch {
            error = {};
          }
          const errorObj = new Error(error.message || "Formateur not found");
          (errorObj as any).status = 404;
          throw errorObj;
        }
        const errorText = await response.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { message: "Erreur lors de la mise à jour du formateur" };
        }
        throw new Error(error.message || "Erreur lors de la mise à jour du formateur");
      }

      // Use text() then JSON.parse() like other hooks
      const responseText = await response.text();
      let parsedData;
      try {
        parsedData = JSON.parse(responseText);
      } catch (e) {
        throw new Error("Invalid JSON response");
      }
      return parsedData;
    },
    onSuccess: (_, variables) => {
      // Invalidate formateurs list and detail to refresh
      queryClient.invalidateQueries({ queryKey: ["formateurs"] });
      queryClient.invalidateQueries({ queryKey: ["formateur", variables.formateurId] });
      toast.success("Formateur mis à jour avec succès");
    },
    onError: (error: any) => {
      // Don't show toast for 401 errors - let the auth system handle it
      if (error?.status === 401) {
        return;
      }
      toast.error(error.message || "Erreur lors de la mise à jour du formateur");
    },
  });
}

export function useDeleteFormateur() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formateurId: string) => {
      const headers = createApiHeaders();
      // Remove Content-Type for DELETE requests as they don't have a body
      delete (headers as any)['Content-Type'];
      
      const response = await fetch(`/api/v1/sessions-pro/admin/formateurs/${formateurId}`, {
        method: "DELETE",
        headers,
      });

      if (!response.ok) {
        // Handle 401 errors specifically to prevent redirect
        if (response.status === 401) {
          const errorText = await response.text();
          let error;
          try {
            error = JSON.parse(errorText);
          } catch {
            error = {};
          }
          const errorObj = new Error(error.message || "Authentication required");
          (errorObj as any).status = 401;
          throw errorObj;
        }
        if (response.status === 404) {
          const errorText = await response.text();
          let error;
          try {
            error = JSON.parse(errorText);
          } catch {
            error = {};
          }
          const errorObj = new Error(error.message || "Formateur not found");
          (errorObj as any).status = 404;
          throw errorObj;
        }
        const errorText = await response.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { message: "Erreur lors de la suppression du formateur" };
        }
        throw new Error(error.message || "Erreur lors de la suppression du formateur");
      }

      // Use text() then JSON.parse() like other hooks
      const responseText = await response.text();
      let parsedData;
      try {
        parsedData = JSON.parse(responseText);
      } catch (e) {
        throw new Error("Invalid JSON response");
      }
      return parsedData;
    },
    onSuccess: () => {
      // Invalidate formateurs list to refresh
      queryClient.invalidateQueries({ queryKey: ["formateurs"] });
    },
    onError: (error: any) => {
      // Don't show toast for 401 errors - let the auth system handle it
      if (error?.status === 401) {
        return;
      }
      // Toast will be shown in the component
      throw error;
    },
  });
}

export function useResetFormateurPassword() {
  return useMutation({
    mutationFn: async (formateurId: string) => {
      const headers = createApiHeaders();
      // No body sent for this POST endpoint
      delete (headers as any)["Content-Type"];

      const response = await fetch(`/api/v1/sessions-pro/admin/formateurs/${formateurId}/reset-password`, {
        method: "POST",
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Erreur lors de la réinitialisation du mot de passe");
      }

      return response.json() as Promise<{
        success: boolean;
        data: {
          formateurId: string;
          initialPassword: string;
        };
      }>;
    },
  });
}
